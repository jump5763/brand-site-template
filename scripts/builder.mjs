import http from "node:http";
import { isDeepStrictEqual } from "node:util";

export const operationKinds = ["APPLY_TEMPLATE", "INITIALIZE_SITE", "PUBLISH_SITE", "SWITCH_TEMPLATE", "ROLLBACK_RUNTIME", "ROLLBACK_SITE_ARTIFACT"];
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

/** One HTTP process owns the queue and its volatile observations. Nothing replays on restart. */
export function createBuilder({ execute, logger = console }) {
  const records = new Map(), queue = [];
  let accepting = true, processing, blocked = false, current = null;
  const cancellation = new AbortController();
  async function drain() {
    while (queue.length && !blocked) {
      const record = queue.shift();
      record.status = "RUNNING";
      record.stage = "starting";
      current = record;
      try {
        const result = await execute(record.request, { signal: cancellation.signal,
          onProgress: stage => { record.stage = stage; } });
        Object.assign(record, result);
      } catch (error) {
        Object.assign(record, { status: "FAILED", error: { code: error.code || "BUILD_FAILED", message: error.message } });
        if (error.awaitingConfirmation) { blocked = true; accepting = false; }
        logger.error(`Builder ${record.requestId}: ${error.message}`);
      }
      current = null;
      record.finishedAt = new Date().toISOString();
    }
  }
  function startDrain() {
    processing = Promise.resolve().then(drain).finally(() => {
      processing = undefined;
      // A submission may arrive after drain exits but before this continuation.
      // Chain the next pass so callers already awaiting done include that work.
      if (queue.length && accepting && !blocked) return startDrain();
    });
    return processing;
  }
  function submit(request) {
    if (!request || !safeId.test(request.requestId || "") || !operationKinds.includes(request.kind) ||
      !request.target || typeof request.target !== "object" || Array.isArray(request.target)) throw fail(400, "Expected requestId, kind and target");
    if (request.kind !== "ROLLBACK_RUNTIME" && request.kind !== "APPLY_TEMPLATE" && !safeId.test(request.target.merchantId || "")) throw fail(400, "merchantId is required");
    if (["APPLY_TEMPLATE", "INITIALIZE_SITE"].includes(request.kind) && !safeId.test(request.target.templateId || "")) throw fail(400, "templateId is required");
    if (request.kind === "SWITCH_TEMPLATE" && !safeId.test(request.target.targetTemplateId || request.target.templateId || "")) throw fail(400, "targetTemplateId is required");
    const existing = records.get(request.requestId);
    if (existing) {
      if (!isDeepStrictEqual(existing.request, request)) throw fail(409, "requestId belongs to another operation");
      return existing;
    }
    if (!accepting) throw fail(503, "Builder is stopping or requires a checked restart");
    const record = { requestId: request.requestId, request: structuredClone(request), status: "QUEUED", stage: "queued", createdAt: new Date().toISOString() };
    records.set(request.requestId, record);queue.push(record);
    if (!processing) startDrain();
    return record;
  }
  function get(id) { const value = records.get(id); if (!value) throw fail(404, "No request record in this Builder process");return value; }
  const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/healthz") return json(res, accepting ? 200 : 503, { status: accepting ? "ok" : "unavailable", queued: queue.length, running: current ? 1 : 0,
        current: current ? { requestId: current.requestId, kind: current.request.kind, stage: current.stage } : null });
      if (req.method === "GET" && url.pathname.startsWith("/builds/")) return json(res, 200, get(decodeURIComponent(url.pathname.slice(8))));
      if (req.method === "POST" && url.pathname === "/build") {
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw fail(413,"Request too large");chunks.push(chunk);}
        let request;try{request=JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail(400,"Invalid JSON");}
        const record=submit(request);return json(res,202,{requestId:record.requestId,status:record.status});
      }
      throw fail(404,"Not found");
    }catch(error){json(res,error.status||500,{error:{message:error.message}});}
  });
  return { server, submit, get, get done(){return processing||Promise.resolve();}, async stop(){
    accepting=false;queue.length=0;cancellation.abort();await processing;
  } };
}
