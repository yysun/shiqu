// Render the actual history view, including unknown results and missing before-text on mobile layouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/tsx.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {ReviewHistoryContent:Content,ReviewHistoryEvent:Event}=await import('../client/ui/StoryReviewHistory.tsx');
const base={id:'story',title:'测试故事',revision:2,parentId:'parent',status:'blocked',phase:'full',overridden:false,error:null,entries:[]};
test('unknown acceptance results are visible and do not look like an approved audit',()=>{
 const entry={id:'full:0',kind:'review',title:'第1次全篇审核',outcome:'unknown',position:1,recordedAt:null,model:'fixture',issues:[],acceptance:[{criterion:1,text:'比较旧稿',status:'unknown',pages:[3],evidence:'未提供修订前分镜。'}]};
 const html=renderToStaticMarkup(createElement(Content,{data:{...base,entries:[entry]}}));
 assert.match(html,/无法判断/);assert.match(html,/未提供修订前分镜/);assert.match(html,/第1次全篇审核/);assert.doesNotMatch(html,/is-passed|当前：审核通过/);
});
test('old missing text and unordered entries are explicit; overrides never become made-up events',()=>{
 const entry={id:'repair:0',kind:'repair',title:'第1批修订',outcome:'changed',position:null,recordedAt:null,model:null,issues:[],repair:{requested:[1],pages:[{page:1,before:null,after:{caption:'新的配文。',prompt:'One visible static instant.'}}]}};
 const html=renderToStaticMarkup(createElement(Content,{data:{...base,overridden:true,entries:[entry]}}));
 assert.match(html,/未留存修改前内容/);assert.match(html,/先后顺序未留存/);assert.match(html,/这不代表审核通过/);assert.equal((html.match(/yu-review-history-event/g)||[]).length,1);
});
test('structural history shows old and new frame numbers, captions and expandable prompts',()=>{
 const entry={id:'repair:0',kind:'repair',title:'第1批修订',outcome:'changed',position:1,recordedAt:'2026-11-03T03:00:00Z',model:'fixture',issues:[],repair:{requested:[2],pages:[],structure:{before:4,after:3,edits:[{from:2,to:3,newFrom:2,before:[{page:2,caption:'修改前第二幅。',prompt:'Old visible instant.'}],after:[{page:2,caption:'合并后的新第二幅。',prompt:'New visible instant.'}]}]}}};
 const html=renderToStaticMarkup(createElement(Event,{entry}));assert.match(html,/4 → 3 幅/);assert.match(html,/替换原第2–3幅/);assert.match(html,/新第2幅/);assert.match(html,/修改前第二幅/);assert.match(html,/<summary>画面指令/);
});
test('empty current versions explain the parent option and report text remains escaped',()=>{
 const empty=renderToStaticMarkup(createElement(Content,{data:base}));assert.match(empty,/本版本尚无已保存的审核记录/);assert.match(empty,/上一版本/);
 const entry={id:'full:0',kind:'review',title:'第1次全篇审核',outcome:'needs-change',position:0,recordedAt:null,model:null,issues:[{page:1,problem:'<img src=x onerror=alert(1)>',instruction:'修正指代。'}]};
 const html=renderToStaticMarkup(createElement(Event,{entry}));assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
