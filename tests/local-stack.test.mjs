import assert from 'node:assert/strict';import test from 'node:test';import http from 'node:http';import {mkdtemp,rm,mkdir,writeFile,readdir,readFile} from 'node:fs/promises';import {cleanupLocalData} from '../scripts/local-cleanup.mjs';import os from 'node:os';import path from 'node:path';import {startLocalStack} from '../scripts/local-stack.mjs';
test('stack serves independent HTTP Builder and never queries persistent tasks or replays work',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'http-stack-'));t.after(()=>rm(root,{recursive:true,force:true}));const calls=[];
 const server=http.createServer((req,res)=>{calls.push(req.url);res.setHeader('Content-Type','application/json');if(req.url==='/healthz')res.end('{"status":"ok"}');else if(req.url==='/site-runtime')res.end('{"activeRuntime":null}');else{res.statusCode=404;res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const config={RUNTIME_SOURCE_COMMIT:'a'.repeat(40),TEMPLATE_REPO_DIR:root,LOCAL_DATA_DIR:root,ARTIFACT_PORT:'0',BUILDER_PORT:'0',SITE_PORT:'39991',BUSINESS_API_URL:`http://127.0.0.1:${server.address().port}`};
 for(let i=0;i<2;i++){
  const stack=await startLocalStack({env:config,logger:{log(){},error(){}}});const base=`http://127.0.0.1:${stack.builder.server.address().port}`;
  assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/builds/previous-process-id')).status,404);await stack.close();
 }
 assert.deepEqual(calls,['/healthz','/site-runtime','/healthz','/site-runtime']);
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

test('only explicit startup launches the confirmed package without building or changing confirmation',async t=>{
 const f=await stackFixture(t),stack=await f.start();
 assert.equal(stack.runtime.getCurrent(),null);
 assert.deepEqual(f.calls,[['GET','/healthz'],['GET','/site-runtime']]);
 await assert.rejects(stack.startCurrent({runtimeId:'historical'}),/no package selector/);
 const first=await stack.startCurrent();assert.equal(first.runtimeId,f.activeRuntime.runtimeId);
 const stopped=await stack.runtime.stop();assert.equal(stopped.stopped,true);assert.equal(stopped.pid,first.pid);
 const second=await stack.startCurrent();assert.equal(second.runtimeId,first.runtimeId);assert.notEqual(second.pid,first.pid);
 assert.deepEqual(f.calls,[['GET','/healthz'],['GET','/site-runtime'],['GET','/site-runtime'],['GET','/site-runtime']]);
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


test('stack checks retention at startup and hourly while idle, then cancels the timer',async t=>{
 const f=await stackFixture(t);
 const expired=path.join(f.root,'executions','old');await mkdir(expired,{recursive:true});
 const terminal={status:'FAILED',endedAt:new Date(Date.now()-8*24*60*60*1000).toISOString()};
 await writeFile(path.join(expired,'result.json'),JSON.stringify(terminal));
 t.mock.timers.enable({apis:['setInterval']});
 const stack=await f.start();
 assert.equal((await readdir(path.join(f.root,'executions'))).length,0);
 await mkdir(expired,{recursive:true});await writeFile(path.join(expired,'result.json'),JSON.stringify(terminal));
 t.mock.timers.tick(60*60*1000);
 const deadline=Date.now()+2000;
 while((await readdir(path.join(f.root,'executions'))).length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 assert.equal((await readdir(path.join(f.root,'executions'))).length,0);
 await stack.close();const count=f.calls.length;t.mock.timers.tick(60*60*1000);await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,count);
});


test('startup releases proven stopped work but preserves unknown remnants',async t=>{
 const f=await stackFixture(t);
 for(const id of ['stopped','unknown']){await mkdir(path.join(f.root,'work',id),{recursive:true});await writeFile(path.join(f.root,'work',id,'input.json'),'content');}
 const evidence=path.join(f.root,'executions','stopped');await mkdir(evidence,{recursive:true});
 await writeFile(path.join(evidence,'result.json'),JSON.stringify({requestId:'stopped',childrenExited:true,status:'FAILED',endedAt:new Date().toISOString()}));
 const stack=await f.start();assert.deepEqual(await readdir(path.join(f.root,'work')),['unknown']);await stack.close();
});


test('idle maintenance owns the operation boundary until its captured cleanup facts are consumed',async t=>{
 const f=await stackFixture(t);
 const deferred=()=>{let resolve;return{promise:new Promise(r=>{resolve=r;}),resolve:()=>resolve()};};
 const id='old-process-request',compileEntered=deferred(),compileRelease=deferred();
 let gate,started=false;
 const work=path.join(f.root,'work',id),record=path.join(f.root,'executions',id,'result.json');
 t.mock.timers.enable({apis:['setInterval']});
 const stack=await f.start({createRunner:()=>{
  const execute=async request=>{
   assert.equal(request.requestId,id);started=true;
   await mkdir(work,{recursive:true});await writeFile(path.join(work,'input.json'),'new execution');
   compileEntered.resolve();await compileRelease.promise;
   assert.equal(await readFile(path.join(work,'input.json'),'utf8'),'new execution');
   return{status:'SUCCEEDED'};
  };
  execute.maintenance=async()=>{
   let stopped=[];
   try{stopped=[JSON.parse(await readFile(record,'utf8')).requestId];}catch(error){if(error.code!=='ENOENT')throw error;}
   const options={localDataDir:f.root,activeRuntimeId:'current-one',activeRequestIds:[],stoppedRequestIds:stopped};
   const waiting=gate;
   if(waiting){waiting.entered.resolve();await waiting.release.promise;}
   return cleanupLocalData(options);
  };
  return execute;
 }});
 await mkdir(work,{recursive:true});await writeFile(path.join(work,'input.json'),'old stopped execution');
 await mkdir(path.dirname(record),{recursive:true});await writeFile(record,JSON.stringify({requestId:id,status:'SUCCEEDED',childrenExited:true,endedAt:new Date().toISOString()}));
 gate={entered:deferred(),release:deferred()};t.mock.timers.tick(60*60*1000);await gate.entered.promise;
 stack.builder.submit({requestId:id,kind:'APPLY_TEMPLATE',target:{templateId:'a'}});
 await new Promise(r=>setImmediate(r));assert.equal(started,false);assert.equal(stack.builder.get(id).status,'RUNNING');
 gate.release.resolve();await compileEntered.promise;
 assert.equal(await readFile(path.join(work,'input.json'),'utf8'),'new execution');
 t.mock.timers.tick(60*60*1000);await new Promise(r=>setImmediate(r));
 assert.equal(await readFile(path.join(work,'input.json'),'utf8'),'new execution');
 compileRelease.resolve();await stack.builder.done;assert.equal(stack.builder.get(id).status,'SUCCEEDED');

 gate={entered:deferred(),release:deferred()};t.mock.timers.tick(60*60*1000);await gate.entered.promise;
 let launched=false;const startup=stack.startCurrent().then(result=>{launched=true;return result;});
 await new Promise(r=>setImmediate(r));assert.equal(launched,false);
 gate.release.resolve();assert.equal((await startup).runtimeId,'current-one');

 gate={entered:deferred(),release:deferred()};t.mock.timers.tick(60*60*1000);await gate.entered.promise;
 let closed=false;const close=stack.close().then(()=>{closed=true;});
 await new Promise(r=>setImmediate(r));assert.equal(closed,false);
 gate.release.resolve();await close;assert.equal(closed,true);
});
