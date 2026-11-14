// Render real shared controls to verify independent requirement editors and honest history/result labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/tsx.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {default:Editor,StoryEditorTabs:Tabs}=await import('../client/ui/StoryProductionEditor.tsx');
const {PromptDetailsContent:Details}=await import('../client/ui/StoryPromptDetails.tsx');
const {default:Review}=await import('../client/ui/StoryReviewTools.tsx');
const {default:Back}=await import('../client/ui/StoryBackToShelf.tsx');
const {default:Status}=await import('../client/ui/StoryGenerationStatus.tsx');
const {default:Setup}=await import('../client/ui/StoryCreationSetup.tsx');
const {default:Control}=await import('../client/ui/StoryGenerationControl.tsx');
const render=(component,props)=>renderToStaticMarkup(createElement(component,props));
const noop=()=>{},record={instructions:'系统约束 <script>bad()</script>',input:'{"productionPrompt":"保留对白"}',schema:{type:'object'}};
const data={criteria:['可见反应','核对实际图像'],records:[{step:'plan',model:'controlled',originId:'old',index:0,record},{step:'review:0',model:'controlled',originId:'current',index:1,record}],results:[{criterion:1,status:'passed',pages:[2],evidence:'第二幅已有可见反应。'},{criterion:2,status:'unknown',pages:[],evidence:'文字分镜不能判断实际成图。'}],previews:{production:record,acceptance:record}};
test('production and acceptance are sibling links/tabs; acceptance editing is an independent local patch',()=>{
 const tabs=render(Tabs,{tab:'acceptance',onChange:noop});assert.match(tabs,/制作要求.*验收要求/s);assert.equal((tabs.match(/>验收要求<\/button>/g)||[]).length,1);
 const changes=[],fields=Editor({tab:'acceptance',settings:{productionPrompt:'保留对白',acceptancePrompt:'可见反应',artStyle:'ink-pencil',narrativeDetail:'balanced',length:'auto'},disabled:false,onChange:value=>changes.push(value)});
 fields.props.children.flat().find(child=>child?.type==='label').props.children.find(child=>child?.type==='textarea').props.onChange({target:{value:'新的验收条目'}});
 assert.deepEqual(changes,[{acceptancePrompt:'新的验收条目'}]);
 const html=render(Editor,{tab:'acceptance',settings:{productionPrompt:'保留对白',artStyle:'ink-pencil',narrativeDetail:'balanced',length:'auto'},disabled:false,onChange:noop});assert.match(html,/每行一条/);assert.match(html,/重新审核/);
});
test('prompt history distinguishes inherited/current records, previews and missing history; model data is escaped',()=>{
 const production=render(Details,{data,kind:'production',sessionId:'current',preferences:{productionPrompt:'编辑中的要求',acceptancePrompt:'验收专用标记',acceptanceCriteria:['验收专用标记']}});
 assert.match(production,/沿用旧版本记录/);assert.doesNotMatch(production,/review:0/);assert.match(production,/预览/);assert.match(production,/编辑中的要求/);assert.doesNotMatch(production,/验收专用标记/);assert.match(production,/复制完整提示词/);assert.doesNotMatch(production,/<script>bad/);
 const acceptance=render(Details,{data,kind:'acceptance',sessionId:'current',preferences:{}});assert.match(acceptance,/本版本实际使用/);assert.match(acceptance,/第 1 条 · 通过/);assert.match(acceptance,/第 2 条 · 无法判断/);assert.match(acceptance,/文字分镜不能判断实际成图/);assert.match(acceptance,/可见反应/);assert.match(acceptance,/第 2 幅/);
 const missing=render(Details,{data:{...data,records:[],results:[]},kind:'acceptance',sessionId:'old',preferences:{}});assert.match(missing,/未留存/);assert.match(missing,/旧版本不会补造历史记录/);assert.match(missing,/尚无本篇验收条目的审核结果/);
});
test('an unknown criterion without fabricated frame issues still exposes the acceptance repair route',()=>{
 const session={id:'blocked',selection:{length:1},state:'failed',ready:1,story:{pages:[{image:'saved'}],original:{}},reviewIssues:[],generationProgress:{phase:'review',reviewStatus:'blocked',reviewStopReason:'requirements',reviewAudits:1}};
 const tools=render(Review,{session,busy:false,error:'',onScript:noop,onRetry:noop,onDrawAnyway:noop});
 assert.doesNotMatch(tools,/验收要求需要调整|查看并修改验收要求|继续自动修复/);
 for(const audits of [1,2]){
  const html=render(Status,{session:{...session,generationProgress:{...session.generationProgress,reviewAudits:audits}},busy:false,controlBusy:false,error:'',onControl:noop,onRetry:noop,onBack:noop,onAcceptance:noop});
  const target=audits===1?'review':'recheck',stage=html.match(new RegExp(`<li[^>]*data-stage="${target}"[^>]*>(.*?)</li>`,'s'))?.[1];
  assert.ok(stage);assert.match(stage,/验收要求需要调整/);assert.match(stage,/查看并修改验收要求/);assert.equal((html.match(/验收要求需要调整/g)||[]).length,1);assert.doesNotMatch(html,/继续自动修复/);
  assert.doesNotMatch(html,/yu-generation-description/);
  const other=html.match(new RegExp(`<li[^>]*data-stage="${audits===1?'recheck':'review'}"[^>]*>(.*?)</li>`,'s'))?.[1];assert.doesNotMatch(other,/验收要求需要调整/);
 }
});

test('flow recovery and exits are links while controls outside the flow retain their presentation',()=>{
 const session={id:'flow',selection:{bookId:'zhuangzi',theme:'选择',artStyle:'ink-pencil',productionPrompt:'保留对白',length:3},state:'idle',generationControl:'paused',story:null,error:null,ready:0,awaitingFrameCount:false,retryAllowed:false};
 const calls=[],props={session,busy:false,controlBusy:false,error:'',onControl:()=>calls.push('control'),onRetry:noop,onBack:()=>calls.push('back')};
 for(const state of ['idle','failed','running']){
  const html=render(Status,{...props,session:{...session,state}});assert.match(html,/<a[^>]*class="story-flow-link"[^>]*>恢复生成<\/a>/);assert.match(html,/<a[^>]*class="story-flow-link"[^>]*>.*?返回书架<\/a>/s);
 }
 const primary=render(Control,{session,busy:false,onControl:noop,primary:true});assert.match(primary,/class="yu-primary"/);
 const compact=render(Control,{session,busy:false,onControl:noop});assert.match(compact,/class="yu-generation-control"/);
 const back=Back({onBack:props.onBack});back.props.onClick();assert.deepEqual(calls,['back']);assert.equal(back.props.className,'yu-generation-back');
 const discovering=render(Setup,{session:{...session,intake:{phase:'discovering',generation:0,search:{state:'searching'},batches:[]}},book:'庄子',busy:false,onAction:noop,progress:props});assert.equal(discovering,'','Discovery stays in the story picker.');
 for(const phase of ['choosing','preparing','confirming']){
  const intake={phase,generation:0,search:{state:'idle'},batches:[{stories:[{title:'庄周梦蝶',description:'故事简介'}],note:''}],selected:{batch:0,index:0}};
  const html=render(Setup,{session:{...session,intake,selection:{...session.selection,narrativeDetail:'balanced'}},book:'庄子',busy:false,onAction:noop,progress:props});assert.equal((html.match(/>返回书架<\/(?:button|a)>/g)||[]).length,1,phase);
 }
});
