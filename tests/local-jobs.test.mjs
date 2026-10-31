import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createLocalJobRunner,createBusinessApi,probePublication} from '../scripts/local-jobs.mjs';
test('content execution uses a fresh business snapshot and deployed source without any task API',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'http-publication-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=path.join(root,'deployed/source'),app=path.join(root,'deployed/app');
 for(const dir of ['scripts','src/server'])await mkdir(path.join(source,dir),{recursive:true});await mkdir(app,{recursive:true});
 await writeFile(path.join(source,'pnpm-lock.yaml'),'lockfileVersion: 9.0');
 await writeFile(path.join(source,'scripts/install-template.mjs'),'export async function preparePreviewInputs(){return []}');
 await writeFile(path.join(source,'src/server/site-input.mjs'),'export async function validateSiteInput({document}){return document}');
 const buildConfig={SITE_PORT:3400,PREVIEW_BASE_DOMAIN:'preview.localhost',STATIC_ASSET_PREFIX:'http://127.0.0.1:4401',SEARCH_INDEXING_ENABLED:'false'};
 await writeFile(path.join(app,'runtime.json'),JSON.stringify({runtimeId:'runtime',buildConfig}));
 const runtime={runtimeId:'runtime',sourceRoot:source,appDir:app,runtimeSourceCommit:'a'.repeat(40),templateSources:{a:{sourceCommit:'b'.repeat(40),templateTreeHash:'c'.repeat(40),repositoryPath:'templates/a'}}};
 const site={merchantId:'merchant',siteId:'site',templateId:'a',state:'ACTIVE',siteUrl:'http://merchant.localhost:3400',hostname:'merchant.localhost',contentRevision:'latest',document:{siteId:'site',value:'latest content'}};
 const calls=[];
 const api=async(method,route)=>{calls.push(route);if(route==='/site-runtime')return{activeRuntime:runtime};if(route==='/internal/sites')return{sites:[site]};assert.fail('Unexpected task/state API '+route)};
 let compiled=0,corrupt;

 const runner=async(command,args)=>{if(command==='corepack')return;compiled++;const arg=f=>args[args.indexOf(f)+1];const input=JSON.parse(await readFile(path.join(arg('--input-dir'),'sites.json')));assert.equal(input[0].contentRevision,'latest');const document=JSON.parse(await readFile(path.join(arg('--input-dir'),input[0].contentFile)));assert.equal(document.value,'latest content');
 const identity={runtimeId:'runtime',siteId:'site',templateId:'a',publishId:arg('--job-id'),contentRevision:'latest'};
 const publication={siteId:'site',templateId:'a',current:{...identity},manifest:{...identity},releaseDir:'complete-release'};
 corrupt?.(publication);
 await writeFile(arg('--result-file'),JSON.stringify({runtimeId:'runtime',jobId:arg('--job-id'),publications:[publication]}));};
 const execute=createLocalJobRunner({api,runtime:{switchTo(){assert.fail('Content must not restart Next')}},config:{localDataDir:path.join(root,'data')},runner,probePublication:async()=>({status:200}),logger:{log(){},error(){}}});
 const result=await execute({requestId:'request',kind:'PUBLISH_SITE',target:{merchantId:'merchant'}});
 assert.equal(result.status,'SUCCEEDED');assert.equal(compiled,1);assert.deepEqual(calls,['/site-runtime','/internal/sites']);
 assert.equal(result.merchantResults[0].contentRevision,'latest');assert.equal(result.merchantResults[0].verified,true);
 for (const [name,change] of [
  ['missing-current-revision',p=>{delete p.current.contentRevision;}],
  ['wrong-manifest-revision',p=>{p.manifest.contentRevision='older';}],
  ['wrong-manifest-site',p=>{p.manifest.siteId='another-site';}],
 ]) {
  await t.test(name,async()=>{
   corrupt=change;
   const rejected=await execute({requestId:name,kind:'PUBLISH_SITE',target:{merchantId:'merchant'}});
   assert.equal(rejected.status,'FAILED');
   assert.match(rejected.error.message,/identity or content revision/);
   assert.equal(rejected.merchantResults[0].verified,false);
  });
 }
});
test('HTTP probes require actual publication identity and resources',async(t)=>{
 const server=http.createServer((req,res)=>{res.setHeader('X-Brand-Site-Runtime-Id','runtime');res.setHeader('X-Brand-Site-Publish-Id','publication');res.end(req.url.startsWith('/_next')?'asset':'<body data-site-id="site"><script src="/_next/static/a.js"></script><link href="/_next/static/a.css" rel="stylesheet"></body>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const response=await probePublication({site:{siteId:'site',siteUrl:`http://merchant.localhost:${server.address().port}`},runtimeId:'runtime',publication:{current:{publishId:'publication'},manifest:{routes:[{path:'/'}]}}});assert.equal(response.assets.length,2);
});
test('API does not retry a refused request',async(t)=>{
 let count=0;const server=http.createServer((req,res)=>{count++;res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":{"message":"offline"}}')});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 await assert.rejects(createBusinessApi({baseUrl:`http://127.0.0.1:${server.address().port}`})('GET','/healthz'),{status:503});assert.equal(count,1);
});
