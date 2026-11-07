// Shelf metadata follows saved setup drafts without changing production inputs before confirmation.
import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/tsx.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {productionFixture,until,selection} from './fixtures/production.mjs';

const {default:Shelf}=await import('../client/ui/ReaderShelf.tsx');
const noop=()=>{};
function render(session,extra={}){
 return renderToStaticMarkup(createElement(Shelf,{stories:[],pending:[session],sessions:[session],progress:[],loading:false,refreshing:false,error:'',tab:'recent',query:'',grouping:'none',bookName:()=> '庄子',controlBusy:'',favoriteBusy:'',onControl:noop,onRetry:noop,onRefresh:noop,onTab:noop,onQuery:noop,onGrouping:noop,onOpen:noop,onResume:noop,onDelete:noop,onFavorite:noop,onCreate:noop,onDiscover:noop,...extra}));
}

test('saved setup art style drives shelf tags, search and grouping before confirmation',async t=>{
 const f=await productionFixture(t);
 f.generation.suggestions=async()=>({stories:[{title:'庄周梦蝶',description:'梦与醒之间的追问。',artRecommendation:{artStyle:'cinematic',reason:'以光影表现梦境。'}}],note:''});
 const created=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,storyTitle:undefined,length:'auto',narrativeDetail:'balanced'}});
 await f.startDiscovery(created.id);await f.demand(created.id);
 await until(async()=>(await f.read(created.id)).intake.phase==='choosing');
 const setup=async(action,settings)=>f.json(`sessions/${created.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:(await f.read(created.id)).intake.generation,action,...settings});
 await setup('choose',{batch:0,index:0});
 await until(async()=>(await f.read(created.id)).intake.phase==='confirming');
 await f.json(`sessions/${created.id}/production-control`,'POST',{action:'pause'});
 const settings={artStyle:'clay',productionPrompt:'保留完整因果。',narrativeDetail:'balanced',length:'auto'};
 await setup('draft',{settings});await f.restart();
 const session=(await f.json('sessions')).find(s=>s.id===created.id);
 assert.equal(session.selection.artStyle,'cinematic');assert.equal(session.intake.draft.artStyle,'clay');
 assert.equal(session.generationControl,'paused');assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 const html=render(session);
 assert.match(html,/黏土定格/);assert.doesNotMatch(html,/电影写实/);
 assert.match(render(session,{query:'黏土'}),/找到 1 \/ 1 篇/);
 assert.match(render(session,{query:'电影写实'}),/找到 0 \/ 1 篇/);
 // 制作中的条目不参与分组，画风仍以标签显示。
 const grouped=render(session,{grouping:'artStyle'});
 assert.match(grouped,/<span title="黏土定格">黏土定格<\/span>/);assert.doesNotMatch(grouped,/<h2>黏土定格<\/h2>/);

});

test('shelf falls back to the production style without a draft and ignores obsolete confirmed drafts',()=>{
 const session={id:'pending',selection:{...selection,artStyle:'cinematic'},state:'idle',generationControl:'paused',ready:0,story:null,page:0,saved:false};
 for(const intake of [undefined,{phase:'confirming'},{phase:'confirmed',draft:{artStyle:'clay'}}]){
  const html=render({...session,intake});assert.match(html,/电影写实/);assert.doesNotMatch(html,/黏土定格/);
 }
});
