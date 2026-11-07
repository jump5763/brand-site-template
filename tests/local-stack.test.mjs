import assert from 'node:assert/strict';import test from 'node:test';import http from 'node:http';import {mkdtemp,rm,mkdir,writeFile,readdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {startLocalStack} from '../scripts/local-stack.mjs';
test('stack serves independent HTTP Builder and never queries persistent tasks or replays work',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'http-stack-'));t.after(()=>rm(root,{recursive:true,force:true}));const calls=[];
 const server=http.createServer((req,res)=>{calls.push(req.url);res.setHeader('Content-Type','application/json');if(req.url==='/healthz')res.end('{"status":"ok"}');else if(req.url==='/site-runtime')res.end('{"activeRuntime":null,"previousRuntime":null}');else{res.statusCode=404;res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const config={RUNTIME_SOURCE_COMMIT:'a'.repeat(40),TEMPLATE_REPO_DIR:root,LOCAL_DATA_DIR:root,ARTIFACT_PORT:'0',BUILDER_PORT:'0',SITE_PORT:'39991',BUSINESS_API_URL:`http://127.0.0.1:${server.address().port}`};
 for(let i=0;i<2;i++){
  const stack=await startLocalStack({env:config,logger:{log(){},error(){}}});const base=`http://127.0.0.1:${stack.builder.server.address().port}`;
  assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/builds/previous-process-id')).status,404);await stack.close();
 }
 assert.deepEqual(calls,['/healthz','/healthz']);
});

async function stackFixture(t, {missing = false} = {}) {
 const root = await mkdtemp(path.join(os.tmpdir(),'confirmed-stack-'));
 const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
 const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const appDir=path.join(root,'app');
 if(!missing){
  await mkdir(appDir);
  await writeFile(path.join(appDir,'package.json'),'{"type":"commonjs"}');
  await writeFile(path.join(appDir,'runtime.json'),'{"runtimeId":"current-one"}');
  await writeFile(path.join(appDir,'server.js'),`require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',runtimeId:process.env.RUNTIME_ID}));}).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
 }
 const activeRuntime={runtimeId:'current-one',appDir,sourceRoot:path.join(root,'source'),runtimeSourceCommit:'a'.repeat(40),templateSources:{}};
 const calls=[],errors=[];let gate;
 const business=http.createServer(async(req,res)=>{
  calls.push([req.method,req.url]);res.setHeader('Content-Type','application/json');
  if(req.url==='/healthz')res.end('{"status":"ok"}');
  else if(req.url==='/site-runtime'){if(gate)await gate;res.end(JSON.stringify({activeRuntime}));}
  else if(req.url==='/internal/sites')res.end('{"sites":[]}');
  else{res.statusCode=404;res.end('{}');}
 });
 await new Promise(r=>business.listen(0,'127.0.0.1',r));
 const env={RUNTIME_SOURCE_COMMIT:'a'.repeat(40),TEMPLATE_REPO_DIR:root,LOCAL_DATA_DIR:root,ARTIFACT_PORT:'0',BUILDER_PORT:'0',SITE_PORT:String(port),BUSINESS_API_URL:`http://127.0.0.1:${business.address().port}`};
 let stack;
 t.after(async()=>{if(stack)await stack.close();await new Promise(r=>business.close(r));await rm(root,{recursive:true,force:true});});
 return{root,activeRuntime,calls,errors,setGate:value=>{gate=value;},start:async options=>stack=await startLocalStack({env,logger:{log(){},error:e=>errors.push(e)},...options})};
}

test('only explicit startup reads the confirmed package without building or changing confirmation',async t=>{
 const f=await stackFixture(t),stack=await f.start();
 assert.equal(stack.runtime.getCurrent(),null);
 assert.deepEqual(f.calls,[['GET','/healthz']]);
 await assert.rejects(stack.startCurrent({runtimeId:'historical'}),/no package selector/);
 const first=await stack.startCurrent();assert.equal(first.runtimeId,f.activeRuntime.runtimeId);
 const stopped=await stack.runtime.stop();assert.equal(stopped.stopped,true);assert.equal(stopped.pid,first.pid);
 const second=await stack.startCurrent();assert.equal(second.runtimeId,first.runtimeId);assert.notEqual(second.pid,first.pid);
 assert.deepEqual(f.calls,[['GET','/healthz'],['GET','/site-runtime'],['GET','/site-runtime']]);
 assert.deepEqual((await readdir(f.root)).sort(),['app','artifacts','run']);
});

test('failed explicit startup keeps Builder available for manual apply',async t=>{
 const f=await stackFixture(t,{missing:true}),stack=await f.start({startCurrent:true});
 assert.equal(stack.runtime.getCurrent(),null);assert.match(f.errors.join('\n'),/Builder remains available/);
 const base=`http://127.0.0.1:${stack.builder.server.address().port}`;
 assert.equal((await fetch(base+'/healthz')).status,200);
 const accepted=await fetch(base+'/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'manual-apply',kind:'APPLY_TEMPLATE',target:{templateId:'template-a'}})});
 assert.equal(accepted.status,202);
 await stack.builder.stop();
 assert.equal((await fetch(base+'/builds/manual-apply')).status,200);
 assert.equal(stack.runtime.getCurrent(),null);
 assert.equal(f.calls.some(([method])=>method!=='GET'),false);
});

test('explicit startup and Builder execution share an exclusion boundary',async t=>{
 const f=await stackFixture(t),stack=await f.start();
 let release;f.setGate(new Promise(r=>{release=r;}));
 const starting=stack.startCurrent();
 await assert.rejects(stack.startCurrent(),{status:409});
 const base=`http://127.0.0.1:${stack.builder.server.address().port}`;
 try{
  const accepted=await fetch(base+'/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'while-starting',kind:'APPLY_TEMPLATE',target:{templateId:'template-a'}})});
  assert.equal(accepted.status,202);
  await stack.builder.stop();
  const result=await(await fetch(base+'/builds/while-starting')).json();
  assert.equal(result.status,'FAILED');
 }finally{release();}
 await starting;
 assert.equal(stack.runtime.getCurrent().runtimeId,'current-one');
 assert.equal(f.calls.some(([,route])=>route==='/internal/sites'),false);
});
