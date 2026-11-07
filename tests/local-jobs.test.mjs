import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,access,cp} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createLocalJobRunner,createBusinessApi,probePublication} from '../scripts/local-jobs.mjs';
import {createBuilder} from '../scripts/builder.mjs';
const merchantId='29742a52-d824-469b-a395-52084345b7ad';
const quiet={log(){},error(){}};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
async function fixture(t, {realHealthPort} = {}){
 const root=await mkdtemp(path.join(os.tmpdir(),'http-publication-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dataDir=path.join(root,'data'),source=path.join(root,'host'),app=path.join(dataDir,'releases/runtime/app');
 for(const dir of ['scripts','src/server'])await mkdir(path.join(source,dir),{recursive:true});await mkdir(app,{recursive:true});
 await writeFile(path.join(source,'pnpm-lock.yaml'),'lockfileVersion: 9.0');
 await writeFile(path.join(source,'scripts/install-template.mjs'),'export async function preparePreviewInputs(){return []} export async function installTemplates(){}');
 await writeFile(path.join(source,'src/server/site-input.mjs'),'export async function validateSiteInput({document}){return document}');
 const git=async(...args)=>(await promisify(execFile)('git',args,{cwd:source})).stdout.trim();
 await git('init','--quiet');await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Fixture');
 const sourceCommit=await git('rev-parse','HEAD');
 const deployedSource=path.join(dataDir,'releases/runtime/source');await cp(source,deployedSource,{recursive:true,filter:p=>path.basename(p)!=='.git'});
 const buildConfig={SITE_PORT:3400,PREVIEW_BASE_DOMAIN:'preview.localhost',STATIC_ASSET_PREFIX:'http://127.0.0.1:4401',SEARCH_INDEXING_ENABLED:'false'};
 await writeFile(path.join(app,'runtime.json'),JSON.stringify({runtimeId:'runtime',buildConfig}));
 const target={templateId:'a',sourceCommit:'b'.repeat(40),templateTreeHash:'c'.repeat(40),repositoryPath:'templates/a'};
 const installed={runtimeId:'runtime',sourceRoot:deployedSource,appDir:app,runtimeSourceCommit:sourceCommit,templateSources:{a:target,b:{...target,templateId:'b',repositoryPath:'templates/b'}}};
 const handle=candidate=>{const exit=deferred();return{...candidate,exited:exit.promise,finish:exit.resolve};};
 let active=installed,current=handle(installed);
 const site={merchantId,templateId:'a',state:'ACTIVE',siteUrl:'http://merchant.localhost:3400',hostname:'merchant.localhost',contentRevision:'latest',document:{siteId:merchantId,siteUrl:'http://merchant.localhost:3400',value:'latest content'}};
 const controls={},calls=[],events=[],built=[];
 const api=async(method,route,body)=>{
  calls.push({method,route,body});
  if(route==='/site-runtime')return{activeRuntime:structuredClone(active)};
  if(route==='/internal/sites')return{sites:controls.empty?[]:[structuredClone(site)]};
  if(route.endsWith('/activate')){
   events.push('activate');
   assert.equal(body.expectedRuntimeId,active.runtimeId);
   if(body.expectedTemplateId!==site.templateId||body.expectedContentRevision!==site.contentRevision||controls.activationConflict)
    throw Object.assign(new Error('activation conflict'),{status:409});
   site.state='ACTIVE';return{site:structuredClone(site)};
  }
  if(route==='/internal/site-runtime/confirm'){
   events.push('confirm');
   if(controls.confirm==='reject')throw Object.assign(new Error('conflict'),{status:409});
   if(controls.confirm!=='unknown')active=body.current;
   if(['unknown','lost-success'].includes(controls.confirm))throw new Error('response lost');
   return{activeRuntime:structuredClone(active)};
  }
  assert.fail('Unexpected API '+route);
 };
 const runtime={getCurrent:()=>current,
  switchTo:async(candidate,{verify})=>{events.push('switch');if(!controls.unknownPreviousExit)current?.finish?.();current=null;if(controls.startFails)throw Object.assign(new Error('start failed'),{stopped:true,processState:'stopped'});current=handle(candidate);await verify();return current;},
  stop:async()=>{events.push('stop');if(controls.stopFails)throw new Error('unknown stop');current?.finish?.();current=null;return{stopped:true,processState:'stopped'};}};
 const runner=async(command,args,cwd,env)=>{
  if(command==='corepack')return;
  assert.equal(env.BUILD_AUDIT_DIR,undefined);assert.equal(env.PUBLISH_AUDIT_DIR,undefined);
  const arg=f=>args[args.indexOf(f)+1];const selected=JSON.parse(await readFile(path.join(arg('--input-dir'),'sites.json')));
  assert.ok(arg('--input-dir').startsWith(arg('--work-root')+path.sep));assert.ok(arg('--result-file').startsWith(arg('--work-root')+path.sep));
  const documents=await Promise.all(selected.map(s=>readFile(path.join(arg('--input-dir'),s.contentFile),'utf8').then(JSON.parse)));
  built.push({selected,documents});events.push('compile');await controls.onCompile?.();
  const publications=selected.map(s=>({merchantId:s.id,siteId:s.id,templateId:s.templateId,contentRevision:s.contentRevision,runtimeId:arg('--runtime-id'),jobId:arg('--job-id'),publishId:arg('--job-id'),objectPrefix:`runtimes/${arg('--runtime-id')}/sites/${s.templateId}/${s.id}/responses/`,routes:[{path:'/',kind:'APP_PAGE',files:['index.html']}],uploaded:3,deleted:1,distributed:!controls.uploadFails}));
  controls.corrupt?.(publications);
  const result={runtimeId:arg('--runtime-id'),jobId:arg('--job-id'),publications};
  if(args[1]==='build'){
   await mkdir(arg('--output'),{recursive:true});await writeFile(path.join(arg('--output'),'server.js'),'fixture');
  }
  if(controls.uploadFails)Object.assign(result,{error:'remote may be partially updated',phase:'upload',objectPath:'target.meta',partial:true,code:'EUPLOAD'});
  await writeFile(arg('--result-file'),JSON.stringify(result));
  if(controls.uploadFails)throw new Error('child exit 1');
 };
 const execute=createLocalJobRunner({api,runtime,config:{localDataDir:dataDir,sitePort:realHealthPort||3400,runtimeRepoDir:source,runtimeSourceCommit:sourceCommit,templateRepoDir:root,env:{BUILD_AUDIT_DIR:'/old/audit',PUBLISH_AUDIT_DIR:'/old/publish-audit'}},runner,
  checkRuntime:realHealthPort?undefined:async()=>{events.push('health');if(controls.unhealthy)throw new Error('runtime unhealthy');},
  probePublication:async()=>{events.push('verify');if(controls.verifyFails)throw new Error('probe failed');return{routes:[{}],assets:['a.js','a.css'],rsc:[{}]};},logger:quiet});
 const publish=id=>execute({requestId:id,kind:'PUBLISH_SITE',target:{merchantId}});
 const apply=id=>execute({requestId:id,kind:'APPLY_TEMPLATE',target});
 return{root,dataDir,site,controls,calls,events,built,execute,publish,apply,setCurrent:v=>{current=v;},setActive:v=>{active=v;},getActive:()=>active};
}
async function summary(f,id){return JSON.parse(await readFile(path.join(f.dataDir,'executions',id,'result.json')));}

test('content execution fixes the current formal input and retains only a bounded summary',async t=>{
 const f=await fixture(t);
 f.controls.onCompile=()=>{f.site.document.value='later';f.site.contentRevision='newer';};
 const result=await f.publish('request');
 assert.equal(result.status,'SUCCEEDED');assert.equal(f.built[0].documents[0].value,'latest content');
 assert.equal(result.merchantResults[0].contentRevision,'latest');assert.equal(result.merchantResults[0].verified,true);
 assert.deepEqual((await readdir(path.join(f.dataDir,'executions/request'))),['result.json']);
 assert.equal(JSON.stringify(await summary(f,'request')).includes('latest content'),false);
 await assert.rejects(access(path.join(f.dataDir,'work/request')),{code:'ENOENT'});
 assert.deepEqual(f.events,['health','compile','verify']);
 for(const [name,change] of [['wrong-revision',p=>{p[0].contentRevision='stale';}],['wrong-identity',p=>{p[0].merchantId='other';}]]){
  f.controls.corrupt=change;
  const failed=await f.publish(name);assert.equal(failed.status,'FAILED');assert.equal(failed.merchantResults[0].verified,false);
 }
});

test('two selections queued before execution both publish B without click revision bindings',async t=>{
 const f=await fixture(t),gate=deferred();
 const builder=createBuilder({logger:quiet,execute:async(r,o)=>{await gate.promise;return f.execute(r,o);}});
 builder.submit({requestId:'selected-a',kind:'PUBLISH_SITE',target:{merchantId}});
 f.site.templateId='b';f.site.contentRevision='b6';
 builder.submit({requestId:'selected-b',kind:'PUBLISH_SITE',target:{merchantId}});
 gate.resolve();await builder.done;await builder.stop();
 assert.equal(builder.get('selected-a').status,'SUCCEEDED');assert.equal(builder.get('selected-b').status,'SUCCEEDED');
 assert.deepEqual(f.built.map(x=>x.selected[0].templateId),['b','b']);
});

test('first publication activates only after upload and reports activation or verification failure without undo',async t=>{
 const f=await fixture(t);f.site.state='INITIALIZING';f.controls.uploadFails=true;
 let result=await f.publish('upload-fails');assert.equal(result.status,'FAILED');assert.equal(f.site.state,'INITIALIZING');assert.equal(f.events.includes('activate'),false);
 assert.equal(result.error.phase,'upload');assert.equal(result.error.objectPath,'target.meta');assert.equal(result.error.partial,true);
 assert.equal(result.merchantResults[0].uploaded,3);assert.equal(result.merchantResults[0].distributed,false);
 assert.equal((await summary(f,'upload-fails')).error.partial,true);
 f.controls.uploadFails=false;f.controls.onCompile=()=>{f.site.templateId='b';};
 result=await f.publish('selected-during-build');assert.equal(result.status,'FAILED');assert.equal(result.error.phase,'activating');assert.equal(f.site.state,'INITIALIZING');
 f.controls.onCompile=()=>{f.site.drafts={b:{site:'candidate-only edit'}};};f.controls.verifyFails=true;
 result=await f.publish('verify-fails');assert.equal(result.status,'FAILED');assert.equal(f.site.state,'ACTIVE');assert.equal(result.merchantResults[0].activated,true);
 assert.equal(result.merchantResults[0].distributed,true);assert.equal(result.merchantResults[0].verified,false);
 f.controls.verifyFails=false;result=await f.publish('manual-republish');assert.equal(result.status,'SUCCEEDED');
 assert.equal(f.built.at(-1).documents[0].value,'latest content');
});

test('runtime preconditions reject publication before building and clean failed work',async t=>{
 const f=await fixture(t);f.controls.unhealthy=true;
 let result=await f.publish('unhealthy');assert.equal(result.status,'FAILED');assert.equal(result.error.phase,'precondition');assert.equal(f.built.length,0);
 await assert.rejects(access(path.join(f.dataDir,'work/unhealthy')),{code:'ENOENT'});
 f.setCurrent(null);f.controls.unhealthy=false;result=await f.publish('no-runtime');assert.equal(result.error.code,'RUNTIME_NOT_READY');assert.equal(f.built.length,0);
 f.controls.empty=true;result=await f.publish('no-formal');assert.equal(result.status,'FAILED');assert.match(result.error.message,/no formal/);
});

test('empty apply confirms new runtimes and retires only the exited previous runtime',async t=>{
 const f=await fixture(t);f.controls.empty=true;f.setActive(null);f.setCurrent(null);
 let result=await f.apply('new-one');assert.equal(result.status,'SUCCEEDED');assert.equal(f.getActive().runtimeId,'new-one');
 assert.deepEqual(f.built[0].selected,[]);await access(path.join(f.dataDir,'releases/new-one/app/runtime.json'));
 result=await f.apply('new-two');assert.equal(result.status,'SUCCEEDED');assert.equal(f.getActive().runtimeId,'new-two');
 await assert.rejects(access(path.join(f.dataDir,'releases/new-one')),{code:'ENOENT'});
 await access(path.join(f.dataDir,'releases/new-two/source/pnpm-lock.yaml'));
});

test('confirmation outcomes have at most one readback and never restart an old package',async t=>{
 for(const mode of ['reject','unknown','lost-success'])await t.test(mode,async t=>{
  const f=await fixture(t);f.controls.empty=true;f.controls.confirm=mode;
  const result=await f.apply('candidate');
  const confirmIndex=f.calls.findIndex(c=>c.method==='POST'&&c.route==='/internal/site-runtime/confirm');
  assert.ok(confirmIndex>=0);
  assert.equal(f.calls.slice(confirmIndex+1).filter(c=>c.route==='/site-runtime').length,mode==='reject'?0:1);
  assert.equal(f.events.filter(e=>e==='switch').length,1);
  if(mode==='lost-success'){assert.equal(result.status,'SUCCEEDED');assert.equal(f.events.includes('stop'),false);}
  else{
   assert.equal(result.status,'FAILED');assert.equal(result.error.partial,true);assert.equal(result.error.confirmation,mode==='reject'?'rejected':'unknown');assert.equal(result.error.stopped,true);
   if(mode==='unknown')await access(path.join(f.dataDir,'releases/candidate'));else await assert.rejects(access(path.join(f.dataDir,'releases/candidate')),{code:'ENOENT'});
   f.controls.confirm=undefined;const next=await f.apply('forward');assert.equal(next.status,'SUCCEEDED');
  }
 });
});

test('HTTP probes check HTML, complete RSC identity and resources',async t=>{
 const server=http.createServer((req,res)=>{
  res.setHeader('X-Brand-Site-Runtime-Id','runtime');res.setHeader('X-Brand-Site-Publish-Id','publication');
  if(req.headers.rsc){res.setHeader('Content-Type','text/x-component');res.end('RSC content');}
  else res.end(req.url.startsWith('/_next')?'asset':`<body data-site-id="${merchantId}" data-template="a"><script src="/_next/static/a.js"></script><link href="/_next/static/a.css" rel="stylesheet"></body>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const response=await probePublication({site:{siteId:merchantId,templateId:'a',siteUrl:`http://merchant.localhost:${server.address().port}`},runtimeId:'runtime',publication:{publishId:'publication',routes:[{path:'/',kind:'APP_PAGE'}]}});
 assert.equal(response.assets.length,2);assert.equal(response.rsc.length,1);
});
test('API does not retry a refused request',async t=>{
 let count=0;const server=http.createServer((req,res)=>{count++;res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":{"message":"offline"}}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 await assert.rejects(createBusinessApi({baseUrl:`http://127.0.0.1:${server.address().port}`})('GET','/healthz'),{status:503});assert.equal(count,1);
});


test('publication checks actual HTTP health identity before invoking the compiler',async t=>{
 let observed='wrong';
 const server=http.createServer((req,res)=>{assert.equal(req.url,'/healthz');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',runtimeId:observed}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const f=await fixture(t,{realHealthPort:server.address().port});
 let result=await f.publish('wrong-health');assert.equal(result.status,'FAILED');assert.equal(result.error.phase,'precondition');assert.equal(f.built.length,0);
 observed='runtime';result=await f.publish('healthy');assert.equal(result.status,'SUCCEEDED');assert.equal(f.built.length,1);
});

test('interruption keeps working input until the compiler completes and then releases it',async t=>{
 const f=await fixture(t),entered=deferred(),release=deferred(),controller=new AbortController();
 f.site.state='INITIALIZING';f.controls.onCompile=async()=>{entered.resolve();await release.promise;};
 const operation=f.execute({requestId:'interrupted',kind:'PUBLISH_SITE',target:{merchantId}},{signal:controller.signal});
 await entered.promise;controller.abort();
 await access(path.join(f.dataDir,'work/interrupted/input/sites.json'));
 release.resolve();const result=await operation;
 assert.equal(result.status,'FAILED');assert.equal(result.error.code,'STOP_REQUESTED');assert.equal(f.events.includes('activate'),false);
 await assert.rejects(access(path.join(f.dataDir,'work/interrupted')),{code:'ENOENT'});
 assert.equal((await summary(f,'interrupted')).childrenExited,true);
});


test('a failed replacement retains previous exit evidence for the next forward deployment',async t=>{
 for(const unknown of [false,true])await t.test(unknown?'unknown exit remains protected':'confirmed exit is reclaimed after forward confirmation',async t=>{
  const f=await fixture(t);f.controls.empty=true;
  const oldPage=path.join(f.dataDir,'artifacts/runtimes/runtime/sites/a/old/responses/page.html');
  const shared=path.join(f.dataDir,'artifacts/_next/static/shared.js');
  const neighbor=path.join(f.dataDir,'artifacts/runtimes/runtime-neighbor/keep');
  for(const file of [oldPage,shared,neighbor]){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'keep');}
  f.controls.startFails=true;f.controls.unknownPreviousExit=unknown;
  const failed=await f.apply('failed-start');assert.equal(failed.status,'FAILED');assert.equal(failed.error.partial,true);
  await access(path.join(f.dataDir,'releases/runtime/source/pnpm-lock.yaml'));await access(oldPage);
  assert.equal(f.getActive().runtimeId,'runtime');
  f.controls.startFails=false;
  const forward=await f.apply('forward-after-start-failure');assert.equal(forward.status,'SUCCEEDED');
  assert.equal(f.getActive().runtimeId,'forward-after-start-failure');
  if(unknown){await access(path.join(f.dataDir,'releases/runtime'));await access(oldPage);}
  else{
   await assert.rejects(access(path.join(f.dataDir,'releases/runtime')),{code:'ENOENT'});
   await assert.rejects(access(path.join(f.dataDir,'artifacts/runtimes/runtime')),{code:'ENOENT'});
  }
  await access(shared);await access(neighbor);await access(path.join(f.dataDir,'releases/forward-after-start-failure/app/runtime.json'));
 });
});
