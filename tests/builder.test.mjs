import assert from 'node:assert/strict';
import test from 'node:test';
import {createBuilder} from '../scripts/builder.mjs';
const quiet={log(){},error(){}};
const request=id=>({requestId:id,kind:'PUBLISH_SITE',target:{merchantId:'merchant-a'}});
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
test('HTTP accepts once, exposes volatile status and runs a single FIFO executor',async(t)=>{
 const entered=deferred(),release=deferred(),order=[];let active=0;
 const builder=createBuilder({logger:quiet,execute:async(r,{onProgress})=>{onProgress('building');assert.equal(active++,0);order.push(r.requestId);if(r.requestId==='one'){entered.resolve();await release.promise;}active--;return{status:'SUCCEEDED'}}});
 await new Promise(r=>builder.server.listen(0,'127.0.0.1',r));t.after(async()=>{release.resolve();await builder.stop();await new Promise(r=>builder.server.close(r));});
 const base=`http://127.0.0.1:${builder.server.address().port}`;
 const post=body=>fetch(base+'/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post(request('one'))).status,202);await entered.promise;
 assert.deepEqual(await(await fetch(base+'/healthz')).json(),{status:'ok',queued:0,running:1,current:{requestId:'one',kind:'PUBLISH_SITE',stage:'building'}});
 assert.equal((await post(request('two'))).status,202);assert.equal((await post(request('one'))).status,202);
 assert.equal((await post({...request('one'),target:{merchantId:'other'}})).status,409);
 assert.equal((await post({})).status,400);assert.equal((await fetch(base+'/builds/missing')).status,404);
 assert.equal((await(await fetch(base+'/healthz')).json()).queued,1);
 assert.deepEqual(order,['one']);release.resolve();await builder.done;assert.deepEqual(order,['one','two']);
 assert.equal((await(await fetch(base+'/builds/two')).json()).status,'SUCCEEDED');
 assert.deepEqual(await(await fetch(base+'/healthz')).json(),{status:'ok',queued:0,running:0,current:null});
 const fresh=createBuilder({logger:quiet,execute:async()=>{assert.fail('No replay')}});assert.throws(()=>fresh.get('one'),{status:404});await fresh.stop();
});
test('stop drains the executing operation but discards waiting work',async()=>{
 const entered=deferred(),release=deferred();const order=[];
 const builder=createBuilder({logger:quiet,execute:async(r,{signal})=>{order.push(r.requestId);entered.resolve();await release.promise;assert.equal(signal.aborted,true);return{status:'SUCCEEDED'}}});
 builder.submit(request('one'));builder.submit(request('two'));await entered.promise;
 let ended=false;const stop=builder.stop().then(()=>{ended=true});await Promise.resolve();assert.equal(ended,false);release.resolve();await stop;
 assert.deepEqual(order,['one']);assert.throws(()=>builder.submit(request('three')),{status:503});
});
test('uncertain runtime stops execution; ordinary failures allow the next operation',async()=>{
 const builder=createBuilder({logger:quiet,execute:async r=>{if(r.requestId==='one')throw new Error('build failure');throw Object.assign(new Error('runtime unknown'),{awaitingConfirmation:true})}});
 builder.submit(request('one'));builder.submit(request('two'));builder.submit(request('three'));await builder.done;
 assert.equal(builder.get('one').status,'FAILED');assert.equal(builder.get('two').status,'FAILED');assert.equal(builder.get('three').status,'QUEUED');assert.throws(()=>builder.submit(request('four')),{status:503});await builder.stop();
});


test('a submission at the drain completion boundary is executed without a later request', async () => {
 const order=[],secondEntered=deferred(),releaseSecond=deferred();let builder;
 builder=createBuilder({logger:quiet,execute:async request=>{
  order.push(request.requestId);
  if(request.requestId==='one')queueMicrotask(()=>queueMicrotask(()=>builder.submit({requestId:'two',kind:'PUBLISH_SITE',target:{merchantId:'merchant-a'}})));
  else {secondEntered.resolve();await releaseSecond.promise;}
  return {status:'SUCCEEDED'};
 }});
 builder.submit({requestId:'one',kind:'PUBLISH_SITE',target:{merchantId:'merchant-a'}});
 let completed=false;const done=builder.done.then(()=>{completed=true;});
 try {
  await secondEntered.promise;
  assert.equal(completed,false);
  assert.deepEqual(order,['one','two']);
  releaseSecond.resolve();await done;
  assert.equal(builder.get('two').status,'SUCCEEDED');
 } finally {releaseSecond.resolve();await builder.stop();}
});
