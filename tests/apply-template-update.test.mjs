import assert from 'node:assert/strict';
import test from 'node:test';
import {applyTemplate} from '../scripts/jobs/apply-template.mjs';
function fixture(){
 const original={runtimeId:'old',runtimeSourceCommit:'host',templateSources:{a:{},b:{}}};
 const sites=[{siteId:'a',templateId:'a',state:'ACTIVE'},{siteId:'b',templateId:'b',state:'ACTIVE'},{siteId:'disabled',templateId:'a',state:'DISABLED'}];
 const events=[],facts=[];let current=original;
 const context={job:{_id:'request',target:{templateId:'a'},input:{runtime:original,sites}},settings:{},sourceRoot:'/candidate',dataDir:'/data',workDir:'/work',runtimeId:'new',
  planRuntimeSource:async()=>({runtimeSourceCommit:'host',templateSources:original.templateSources}),prepareSource:async()=>{},
  modules:{installTemplates:async options=>assert.equal(options.temporaryRoot,'/work')},
  validate:async site=>{events.push(['validate',site.siteId]);return site;},writeInputs:async input=>{events.push(['sites',input.map(s=>s.siteId)]);},
  setInput:async()=>{},compile:async()=>{events.push(['build']);},commitRuntime:async()=>({runtimeId:'new',appDir:'/new'}),
  runtime:{getCurrent:()=>current,switchTo:async(candidate,{verify})=>{events.push(['switch',candidate.runtimeId]);current=candidate;await verify();},
   stop:async()=>{events.push(['stop',current.runtimeId]);current=null;return{stopped:true,processState:'stopped'};}},
  verifyPreviews:async()=>{},verifySites:async()=>{},confirmRuntime:async()=>{events.push(['confirm']);},progress:async()=>{},
  recordRuntimeFact:fact=>facts.push(fact),success:()=>({status:'SUCCEEDED'})};return{context,events,facts};
}
test('shared update validates affected bindings and uploads before runtime confirmation',async()=>{
 const f=fixture();await applyTemplate(f.context);
 assert.deepEqual(f.events,[['validate','a'],['validate','disabled'],['sites',['a','b']],['build'],['switch','new'],['confirm']]);
 assert.deepEqual(f.facts,[{runtimeId:'old',disposition:'retired',stopped:true,confirmation:'known'}]);
});
test('confirmation conflict stops the candidate without restarting a previous package',async()=>{
 const f=fixture();f.context.confirmRuntime=async()=>{throw Object.assign(new Error('revision changed'),{status:409,confirmation:'rejected'});};
 await assert.rejects(applyTemplate(f.context),{status:409,stopped:true});
 assert.deepEqual(f.events.at(-1),['stop','new']);assert.equal(f.events.some(e=>e[0]==='switch'&&e[1]==='old'),false);
 assert.equal(f.facts.at(-1).disposition,'abandoned');
});
test('unknown confirmation or candidate stop never produces a known retirement fact',async()=>{
 for(const stopFails of [false,true]){
  const f=fixture();f.context.confirmRuntime=async()=>{throw Object.assign(new Error('lost confirmation'),{confirmation:'unknown'});};
  if(stopFails)f.context.runtime.stop=async()=>{throw new Error('exit unknown');};
  await assert.rejects(applyTemplate(f.context),e=>e.confirmation==='unknown'&&e.stopped===!stopFails);
  assert.equal(f.facts.some(fact=>fact.runtimeId==='new'),false);
 }
});


test('a candidate that exits while confirmation is pending still reports its actual exit',async()=>{
 const f=fixture();let exit;const exited=new Promise(resolve=>{exit=resolve;});
 const switchTo=f.context.runtime.switchTo;
 f.context.runtime.switchTo=async(...args)=>{await switchTo(...args);return{runtimeId:'new',pid:123,exited};};
 f.context.confirmRuntime=async()=>{
  f.context.runtime.getCurrent=()=>null;
  exit({code:1});
  throw Object.assign(new Error('confirmation rejected after exit'),{status:409,confirmation:'rejected'});
 };
 f.context.runtime.stop=async()=>({stopped:false,processState:'not-managed'});
 await assert.rejects(applyTemplate(f.context),e=>e.stopped===true&&e.processState==='stopped'&&e.pid===123);
 assert.ok(f.facts.some(fact=>fact.runtimeId==='new'&&fact.disposition==='abandoned'));
});
