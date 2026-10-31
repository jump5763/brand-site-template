import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "./builder.mjs";
import { createBusinessApi, createLocalJobRunner } from "./local-jobs.mjs";
import { createLocalRuntime } from "./local-runtime.mjs";
import { createArtifactServer, listen } from "./local-services.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));

export async function startLocalStack({ env = process.env, logger = console, signal } = {}) {
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
  const execute=createLocalJobRunner({api,runtime,logger,config:{runtimeRepoDir:root,runtimeSourceCommit:env.RUNTIME_SOURCE_COMMIT,templateRepoDir:path.resolve(env.TEMPLATE_REPO_DIR),localDataDir,sitePort,artifactBaseUrl,previewBaseDomain:env.PREVIEW_BASE_DOMAIN||"preview.localhost",env}});
  const builder=createBuilder({execute,logger});
  try {
    await listen(artifacts,artifactPort);
    const environment=await api("GET","/site-runtime");
    if(environment.activeRuntime)await runtime.start(environment.activeRuntime);
    signal?.throwIfAborted();
    await listen(builder.server,builderPort);
  } catch(error){await runtime.stop();if(artifacts.listening)await new Promise(r=>artifacts.close(r));throw error;}
  logger.log(`HTTP Builder ready on ${builder.server.address().port}; artifacts ${artifacts.address().port}; runtime ${runtime.getCurrent()?.runtimeId||"none"}`);
  let closing;
  const close=()=>closing??=(async()=>{
    signal?.removeEventListener("abort",stop);
    const serverClosed=new Promise(resolve=>builder.server.close(resolve));
    try{await builder.stop();}finally{await runtime.stop();await Promise.all([serverClosed,new Promise(resolve=>artifacts.close(resolve))]);}
  })();
  const stop=()=>{void close().catch(error=>logger.error(error.message));};
  signal?.addEventListener("abort",stop,{once:true});if(signal?.aborted)await close();
  return{api,runtime,builder,artifacts,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){console.error("Usage: local-stack.mjs");process.exitCode=1;}
  else{const controller=new AbortController();process.once("SIGINT",()=>controller.abort());process.once("SIGTERM",()=>controller.abort());
    startLocalStack({signal:controller.signal}).catch(error=>{if(!controller.signal.aborted){console.error(error.message);process.exitCode=1;}});
  }
}
