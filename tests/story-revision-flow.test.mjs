// Exercise the real revision hook against controlled production: editing makes no version,
// confirmation starts work, and a lost response cannot create duplicate versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {productionFixture,until} from './fixtures/production.mjs';
import {completedStory} from './fixtures/production-dag-story.mjs';

const compiled=build({stdin:{contents:"export {useStoryRevision} from './client/ui/useStoryRevision.ts';export {beginRender} from 'react';export {setTransport} from 'revision-transport';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{
 name:'revision-hooks',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'revision'}));
  b.onResolve({filter:/^(\.\/shared|revision-transport)$/},()=>({path:'transport',namespace:'revision'}));
  b.onLoad({filter:/.*/,namespace:'revision'},({path})=>({loader:'js',contents:path==='hooks'?`
   const cells=[];let cursor=0;
   export function beginRender(){cursor=0;}
   export function useState(initial){const index=cursor++;if(!(index in cells))cells[index]=typeof initial==='function'?initial():initial;return [cells[index],next=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];}
   export function useRef(value){const index=cursor++;return cells[index]??= {current:value};}
   export function useEffect(){}
  `:`let transport;export const setTransport=value=>transport=value;export const request=(...args)=>transport(...args);export const randomId=()=>crypto.randomUUID();`}));
 }
}]});
async function harness(t,{loseResponse=false,initialTab='count',initialPage,beforeSnapshot}={}){
 const f=await productionFixture(t,'codex');f.control.hold=false;
 const {id}=await completedStory(f,{length:3});
 const bundle=await compiled,module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const requests=[],submitted=[],opened=[];
 const {useStoryRevision,beginRender,setTransport}=module.exports;
 setTransport(async(path,method='GET',body)=>{
  if(method==='POST')requests.push(body);
  const response=await f.request(path.slice('reader/'.length),method,body);
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error),{status:response.status});
  if(method==='GET'&&path.endsWith('/revisions'))await beforeSnapshot?.();
  if(loseResponse&&method==='POST'){loseResponse=false;throw new TypeError('Lost response');}
  return data;
 });
 const render=()=>{beginRender();return useStoryRevision(id,async session=>{submitted.push(session);},async current=>{opened.push(current);});};
 render().open(initialTab,initialPage);await until(()=>!!render().base);
 return {f,id,requests,submitted,opened,render};
}
/** 修订保存后等待读者继续；这里模拟读者点「继续」。 */
const proceed=(h,child)=>h.f.json(`sessions/${child.id}/production-control`,'POST',{action:'continue'});

test('a concurrent revision preserves the open draft and offers the new current story',async t=>{
 const h=await harness(t);
 const token=h.render().base.token;
 h.render().setChanges({narrativeDetail:'detailed'});
 const next=await h.f.json(`sessions/${h.id}/revisions`,'POST',{requestId:crypto.randomUUID(),token,changes:{artStyle:'paper-cut'}});
 await h.render().submit();
 assert.equal(h.render().conflict,true);
 assert.equal(h.render().changes.narrativeDetail,'detailed');
 assert.equal(h.render().tab,'count');
 assert.deepEqual(h.submitted,[]);
 await h.render().loadLatest();
 assert.deepEqual(h.opened,[next.id]);
});

test('review edit targets survive initial loading, reopening and ending selection without submitting',async t=>{
 const h=await harness(t,{initialTab:'script',initialPage:3});
 assert.equal(h.render().tab,'script');assert.equal(h.render().scriptPage,3);
 h.render().setChanges({plan:{...h.render().base.plan,reflection:'保留本次草稿。'}});
 h.render().setScriptPage(2);h.render().setTab('requirements');h.render().setTab('script');
 assert.equal(h.render().scriptPage,2);
 h.render().setTab(null);h.render().open('script',1);
 assert.equal(h.render().scriptPage,1);assert.equal(h.render().changes.plan.reflection,'保留本次草稿。');
 h.render().open('script',0);assert.equal(h.render().scriptPage,0);
 h.render().open('script');assert.equal(h.render().scriptPage,1);
 assert.equal(h.requests.length,0);assert.equal(h.submitted.length,0);
});

test('completed story count edits remain a draft until confirmation starts the new version',async t=>{
 const h=await harness(t);
 h.render().setChanges({length:5});
 h.render().setTab(null); // Finish editing and return to settings.
 assert.equal(h.requests.length,0);assert.equal(h.render().changes.length,5);
 assert.equal((await h.f.json('sessions')).length,1);
 assert.equal((await h.f.read(h.id)).state,'completed');
 await h.render().submit();
 assert.equal(h.requests.length,1);assert.notEqual(h.requests[0].paused,true);
 assert.equal(h.submitted.length,1);
 const child=h.submitted[0];assert.equal(child.generationControl,'paused','a saved revision that needs work is paused and waits for 继续制作');assert.equal(child.awaitingContinue,true);
 await proceed(h,child);await until(async()=>(await h.f.read(child.id)).state==='completed',20000);
 assert.equal((await h.f.read(child.id)).story.pages.length,5);
 assert.equal((await h.f.read(h.id)).story.pages.length,3);
 assert.deepEqual(h.render().changes,{});
});

test('retrying explicit production after a lost response uses the same version',async t=>{
 const h=await harness(t,{loseResponse:true});
 h.render().setChanges({length:5});await h.render().submit();
 assert.match(h.render().error,/Lost response/);assert.equal(h.render().changes.length,5);
 await h.render().submit();
 assert.equal(h.requests.length,2);assert.equal(h.requests[0].requestId,h.requests[1].requestId);
 assert.equal(h.submitted.length,1);
 const child=h.submitted[0];assert.equal(child.generationControl,'paused','a saved revision that needs work is paused and waits for 继续制作');assert.equal(child.awaitingContinue,true);
 const rows=await h.f.app.services.database.prepare("SELECT id FROM stories WHERE json_extract(document,'$.revision.parentId')=?").bind(h.id).all();
 assert.equal(rows.results.length,1);
});
