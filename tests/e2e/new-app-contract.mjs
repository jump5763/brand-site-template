import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {createRequire,builtinModules} from 'node:module';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import http from 'node:http';
import {createServer} from 'node:net';
import {installTemplates,preparePreviewInputs} from '../../scripts/install-template.mjs';
import {createArtifactServer,listen} from '../../scripts/local-services.mjs';
import {createLocalRuntime} from '../../scripts/local-runtime.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const designerRoot=path.resolve(root,'../design-coding-agent');
const evidence=path.resolve(process.env.PRODUCER_REPAIR_EVIDENCE || path.join(root,'output/local-e2e/evidence/producer-repair'));
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const save=async(name,value)=>writeFile(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
const exec=promisify(execFile);
const git=async(cwd,...args)=>(await exec('git',args,{cwd})).stdout.trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function run(cmd,args,cwd,env,logfile){return new Promise((resolve,reject)=>{const log=createWriteStream(logfile,{flags:'a'});const child=spawn(cmd,args,{cwd,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>{log.write(b);process.stdout.write(b);});child.stderr.on('data',b=>{log.write(b);process.stderr.write(b);});child.once('error',reject);child.once('close',code=>{log.end();code===0?resolve():reject(new Error(`${cmd} exited ${code}`));});});}
async function configuration(){try{return await json(path.join(evidence,'context.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const temporary=await mkdtemp(path.join(tmpdir(),'new-app-contract-'));await mkdir(evidence,{recursive:true});
 const context={designerRoot,temporary,evidence,nodePath:'/Users/penn/.nvm/versions/node/v22.23.1/bin/node',pnpmCliPath:path.join(designerRoot,'node_modules/pnpm/bin/pnpm.cjs'),templateId:`new-app-${randomUUID().slice(0,8)}`,runtimeId:randomUUID(),siteId:randomUUID()};await save('context.json',context);return context;}
async function prepare(context){
 const require=createRequire(path.join(designerRoot,'package.json'));
 const {build}=await import(path.join(designerRoot,'node_modules/vite/dist/node/index.js'));
 const built=await build({configFile:false,logLevel:'warn',build:{lib:{entry:path.join(root,'tests/e2e/helpers/new-app-preparation-worker.ts'),formats:['cjs']},write:false,minify:false,rollupOptions:{external:['electron','better-sqlite3',...builtinModules.flatMap(n=>[n,`node:${n}`])]}}});
 const output=(Array.isArray(built)?built[0]:built).output.find(o=>o.type==='chunk');
 const worker=path.join(context.temporary,'worker.cjs');
 await writeFile(worker,output.code.replaceAll('require("better-sqlite3")',`require(${JSON.stringify(require.resolve('better-sqlite3'))})`));
 const identity={};for(const f of ['src/main/workspace/template-service.ts','src/main/dyad/app/create/service.ts','src/main/template-publishing/source-preparation.ts','src/main/template-publishing/installable-template.mjs','src/main/template-publishing/host-installation-baseline.json','src/main/template-publishing/preview-capture.ts','resources/templates/next-default.manifest.json'])identity[f]=hash(await readFile(path.join(designerRoot,f)));
 await save('producer-source-identity.json',{files:identity,workerSha256:hash(await readFile(worker))});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 await run(path.join(designerRoot,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[worker,path.join(evidence,'context.json')],designerRoot,env,path.join(evidence,'preparation.log'));
}
async function consume(c){
 const prepared=await json(path.join(evidence,'prepared-app.json'));
 const repo=path.join(c.temporary,'template-repository'),target=path.join(repo,'templates',c.templateId);
 await mkdir(target,{recursive:true});await cp(prepared.sourceDirectory,target,{recursive:true});
 await mkdir(path.join(target,'previews'),{recursive:true});await cp(path.join(evidence,'new-app-cover.png'),path.join(target,'previews/cover.png'));
 await writeFile(path.join(target,'template.json'),JSON.stringify({id:c.templateId,templateVersion:'1.0.0',name:'New App contract acceptance',description:'Local production-entry acceptance without GitHub publishing',tags:[],formatVersion:1,projectRoot:'.',contentFile:'src/site-schema/current.json',preview:{pagePath:'/',cover:'previews/cover.png',width:1600,height:900}},null,2));
 await git(repo,'init','--quiet');await git(repo,'add','.');await git(repo,'-c','user.name=Local Acceptance','-c','user.email=acceptance@example.invalid','commit','--quiet','-m','Freeze prepared new App template');
 const sourceCommit=await git(repo,'rev-parse','HEAD'),templateTreeHash=await git(repo,'rev-parse',`HEAD:templates/${c.templateId}`);
 for(const file of prepared.files)assert.equal(hash(await readFile(path.join(target,file.path))),file.sha256);
 const host=path.join(c.temporary,'host');await mkdir(host,{recursive:true});
 const hostFiles=['src','scripts','public','package.json','pnpm-lock.yaml','.npmrc','tsconfig.json','next.config.ts','cache-handler.cjs','postcss.config.mjs','tailwind.config.cjs'];
 for(const file of hostFiles){try{await cp(path.join(root,file),path.join(host,file),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}}
 await git(host,'init','--quiet');await git(host,'add','.');await git(host,'-c','user.name=Local Acceptance','-c','user.email=acceptance@example.invalid','commit','--quiet','-m','Freeze actual host source before installation');
 const hostCommit=await git(host,'rev-parse','HEAD');
 const sources={[c.templateId]:{sourceCommit,templateTreeHash,repositoryPath:`templates/${c.templateId}`}};
 await installTemplates({sourceRoot:host,templateRepoDir:repo,templateSources:sources});
 const env={...process.env,PATH:path.dirname(c.nodePath)+path.delimiter+process.env.PATH,CI:'true'};
 await run(c.nodePath,[c.pnpmCliPath,'install','--frozen-lockfile','--offline'],host,env,path.join(evidence,'host-install.log'));
 const sitePort=await freePort(),artifactPort=await freePort();
 const inputDir=path.join(c.temporary,'input'),artifactDir=path.join(c.temporary,'artifacts'),appDir=path.join(c.temporary,'application');
 await mkdir(path.join(inputDir,'sites',c.siteId),{recursive:true});await mkdir(artifactDir,{recursive:true});
 const siteUrl=`http://new-app.localhost:${sitePort}`;
 const {instantiateSiteDefaults}=await import(pathToFileURL(path.join(host,'src/server/site-input.mjs')));
 const document=instantiateSiteDefaults(await json(path.join(target,'src/site-schema/current.json')),{siteId:c.siteId,siteUrl});
 const site={id:c.siteId,templateId:c.templateId,name:'New App acceptance',hostname:'new-app.localhost',siteUrl,contentFile:`sites/${c.siteId}/current.json`};
 await writeFile(path.join(inputDir,'sites.json'),JSON.stringify([site]));await writeFile(path.join(inputDir,site.contentFile),JSON.stringify(document));
 await preparePreviewInputs({sourceRoot:host,inputDir,port:sitePort});
 const buildEnv={...env,ARTIFACT_DIR:artifactDir,STATIC_ASSET_PREFIX:`http://127.0.0.1:${artifactPort}`,SEARCH_INDEXING_ENABLED:'false'};
 await save('installation.json',{sourceAppCommit:prepared.sourceHead,templateId:c.templateId,sourceCommit,templateTreeHash,hostCommit,hostRoot:host,appDir,inputDir,artifactDir,sitePort,artifactPort,runtimeId:c.runtimeId,allPreparedBytesUnchanged:true,templateRepoClean:(await git(repo,'status','--porcelain'))===''});
 await run(c.nodePath,['scripts/sites.mjs','build','--input-dir',inputDir,'--runtime-id',c.runtimeId,'--job-id',c.runtimeId,'--output',appDir,'--result-file',path.join(evidence,'build-result.json')],host,buildEnv,path.join(evidence,'host-build.log'));
 const api=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://localhost');if(url.pathname==='/sites/resolve')res.end(JSON.stringify({public:true,siteId:c.siteId,templateId:c.templateId,siteUrl}));else if(url.pathname===`/sites/${c.siteId}/content`)res.end(JSON.stringify({public:true,templateId:c.templateId,document}));else{res.statusCode=404;res.end('{}');}});
 await listen(api,0);const apiPort=api.address().port;
 const artifacts=createArtifactServer({artifactDir});await listen(artifacts,artifactPort);
 const runtime=createLocalRuntime({runDir:path.join(c.temporary,'run'),port:sitePort,env:{...env,CONTENT_API_URL:`http://127.0.0.1:${apiPort}`,ARTIFACT_BASE_URL:`http://127.0.0.1:${artifactPort}`},logger:console});
 const request=address=>new Promise((resolve,reject)=>{const u=new URL(address);const req=http.get({hostname:'127.0.0.1',port:u.port,path:u.pathname+u.search,headers:{Host:u.host}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({url:address,status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('HTTP timeout')));});
 try{
  await runtime.start({runtimeId:c.runtimeId,appDir});
  const pages=await Promise.all([siteUrl+'/',`http://${c.templateId}.preview.localhost:${sitePort}/`].map(request));
  const resources=new Set();for(const page of pages){assert.equal(page.status,200);assert.ok(page.body.includes('New App portable section verified'));assert.match(page.body,/<h1\b[^>]*>New App portable section verified<\/h1>/);for(const match of page.body.matchAll(/(?:src|href)="([^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"/g))resources.add(new URL(match[1].replaceAll('&amp;','&'),page.url).href);}
  assert.equal(pages[0].headers['x-brand-site-runtime-id'],c.runtimeId);assert.equal(pages[0].headers['x-brand-site-publish-id'],c.runtimeId);
  const assets=await Promise.all([...resources].map(request));assert.ok(assets.length>0);assert.ok(assets.every(a=>a.status===200));
  await writeFile(path.join(evidence,'merchant.html'),pages[0].body);await writeFile(path.join(evidence,'preview.html'),pages[1].body);
  await save('http-verification.json',{pages:pages.map(({url,status,headers})=>({url,status,headers})),resources:assets.map(({url,status})=>({url,status})),h1Verified:true,marker:'New App portable section verified',runtimeId:c.runtimeId,githubPublished:false});
 }finally{await runtime.stop();await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>artifacts.close(r))]);}
 await retainEvidence(c);
 await save('completed.json',{completedAt:new Date().toISOString(),runtimeId:c.runtimeId,preparedSourceCommit:prepared.sourceHead,templateCommit:sourceCommit,hostCommit,servicesStopped:true,productionEnvironmentUntouched:true});
}
async function retainEvidence(c){
 const created=await json(path.join(evidence,'created-app.json'));
 const installed=await json(path.join(evidence,'installation.json'));
 const bundles=[];
 for(const [name,source] of [['source-app',created.rootPath],['template-repository',path.join(c.temporary,'template-repository')],['host-source',installed.hostRoot]]){
  const output=path.join(evidence,`${name}.bundle`);
  await git(source,'bundle','create',output,'HEAD');
  await git(source,'bundle','verify',output);
  bundles.push({name,sha256:hash(await readFile(output)),commit:await git(source,'rev-parse','HEAD')});
 }
 await cp(installed.inputDir,path.join(evidence,'fixed-input'),{recursive:true});
 await save('retained-sources.json',{bundles,appWorktreeClean:(await git(created.rootPath,'status','--porcelain'))==='',temporaryDirectory:c.temporary});
}
const context=await configuration();
const command=process.argv[2];
if(command==='prepare')await prepare(context);else if(command==='consume')await consume(context);else throw new Error('Choose prepare or consume');
