import assert from 'node:assert/strict';import test from 'node:test';import http from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {startLocalStack} from '../scripts/local-stack.mjs';
test('stack serves independent HTTP Builder and never queries persistent tasks or replays work',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'http-stack-'));t.after(()=>rm(root,{recursive:true,force:true}));const calls=[];
 const server=http.createServer((req,res)=>{calls.push(req.url);res.setHeader('Content-Type','application/json');if(req.url==='/healthz')res.end('{"status":"ok"}');else if(req.url==='/site-runtime')res.end('{"activeRuntime":null,"previousRuntime":null}');else{res.statusCode=404;res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const config={RUNTIME_SOURCE_COMMIT:'a'.repeat(40),TEMPLATE_REPO_DIR:root,LOCAL_DATA_DIR:root,ARTIFACT_PORT:'0',BUILDER_PORT:'0',SITE_PORT:'39991',BUSINESS_API_URL:`http://127.0.0.1:${server.address().port}`};
 for(let i=0;i<2;i++){
  const stack=await startLocalStack({env:config,logger:{log(){},error(){}}});const base=`http://127.0.0.1:${stack.builder.server.address().port}`;
  assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/builds/previous-process-id')).status,404);await stack.close();
 }
 assert.deepEqual(calls,['/healthz','/site-runtime','/healthz','/site-runtime']);
});
