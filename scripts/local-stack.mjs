import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "./builder.mjs";
import { createBusinessApi, createLocalJobRunner } from "./local-jobs.mjs";
import { createLocalRuntime } from "./local-runtime.mjs";
import { createArtifactServer, listen } from "./local-services.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));

export async function startLocalStack({ env = process.env, logger = console, signal, startCurrent = false } = {}) {
  if (!env.RUNTIME_SOURCE_COMMIT || !env.TEMPLATE_REPO_DIR) throw new Error("RUNTIME_SOURCE_COMMIT and TEMPLATE_REPO_DIR are required");
  const localDataDir = path.resolve(env.LOCAL_DATA_DIR || path.join(root,"output/local-e2e/runtime"));
  const sitePort=Number(env.SITE_PORT||3400),artifactPort=Number(env.ARTIFACT_PORT||4401),builderPort=Number(env.BUILDER_PORT||4402);
  const request=createBusinessApi({baseUrl:env.BUSINESS_API_URL||"http://127.0.0.1:4400"});
  const api=(method,route,body,options={})=>request(method,route,body,{signal:options.signal??signal});
  const health=await api("GET","/healthz");if(health.status!=="ok")throw new Error("Business API is unavailable");
  const artifactDir=path.join(localDataDir,"artifacts");await mkdir(artifactDir,{recursive:true});
  const artifactBaseUrl=env.ARTIFACT_BASE_URL||`http://127.0.0.1:${artifactPort}`;
  const artifacts=createArtifactServer({artifactDir});
  const runtime=createLocalRuntime({runDir:path.join(localDataDir,"run"),port:sitePort,logger,env:{...env,CONTENT_API_URL:env.CONTENT_API_URL||env.BUSINESS_API_URL||"http://127.0.0.1:4400",ARTIFACT_BASE_URL:artifactBaseUrl}});
  const runJob=createLocalJobRunner({api,runtime,logger,config:{runtimeRepoDir:root,runtimeSourceCommit:env.RUNTIME_SOURCE_COMMIT,templateRepoDir:path.resolve(env.TEMPLATE_REPO_DIR),localDataDir,sitePort,artifactBaseUrl,previewBaseDomain:env.PREVIEW_BASE_DOMAIN||"preview.localhost",env}});
  let operating = false;
  let pending = Promise.resolve();
  let closing;
  const exclusive = async operation => {
    if (closing || operating) throw Object.assign(new Error("A runtime operation is in progress or the stack is closing"), {status:409});
    operating = true;
    pending = Promise.resolve().then(operation);
    try { return await pending; } finally { operating = false; }
  };
  const execute = (...args) => exclusive(() => runJob(...args));
  const builder=createBuilder({execute,logger});
  const startConfirmed = (...args) => exclusive(async () => {
    if (args.length) throw new Error("Current runtime startup accepts no package selector");
    const {activeRuntime} = await api("GET", "/site-runtime");
    if (!activeRuntime) throw new Error("No confirmed runtime is installed; apply a template first");
    return runtime.start(activeRuntime);
  });
  try {
    await listen(artifacts,artifactPort);
    signal?.throwIfAborted();
    await listen(builder.server,builderPort);
  } catch(error){await runtime.stop();if(artifacts.listening)await new Promise(r=>artifacts.close(r));throw error;}
  logger.log(`HTTP Builder ready on ${builder.server.address().port}; artifacts ${artifacts.address().port}; runtime ${runtime.getCurrent()?.runtimeId||"none"}`);
  const close=()=>closing??=(async()=>{
    signal?.removeEventListener("abort",stop);
    const serverClosed=new Promise(resolve=>builder.server.close(resolve));
    try{await builder.stop();}finally{await pending.catch(()=>{});try{await runtime.stop();}finally{await Promise.all([serverClosed,new Promise(resolve=>artifacts.close(resolve))]);}}
  })();
  const stop=()=>{void close().catch(error=>logger.error(error.message));};
  signal?.addEventListener("abort",stop,{once:true});if(signal?.aborted)await close();
  if (startCurrent && !closing) {
    try { await startConfirmed(); }
    catch (error) { logger.error(`Current runtime startup failed; Builder remains available: ${error.message}`); }
  }
  return{api,runtime,builder,artifacts,close,startCurrent:startConfirmed};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length>3 || (process.argv[2] && process.argv[2]!=="--start-current")){console.error("Usage: local-stack.mjs [--start-current]");process.exitCode=1;}
  else{const controller=new AbortController();process.once("SIGINT",()=>controller.abort());process.once("SIGTERM",()=>controller.abort());
    startLocalStack({signal:controller.signal,startCurrent:process.argv[2]==="--start-current"}).catch(error=>{if(!controller.signal.aborted){console.error(error.message);process.exitCode=1;}});
  }
}
