// Protect reading gestures, shelf navigation, and persisted reading/favorite reconciliation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {newWheelGesture,wheelPageDirection,swipePageDirection,edgePageDirection} from '../lib/reader-navigation.ts';

test('scene edge clicks use the outer quarters of the reader, not the viewport',()=>{
 for(const [left,width] of [[400,480],[0,360],[90,240]]){
  assert.equal(edgePageDirection(left,left,width),-1);
  assert.equal(edgePageDirection(left+width*.25,left,width),-1);
  assert.equal(edgePageDirection(left+width*.26,left,width),0);
  assert.equal(edgePageDirection(left+width*.5,left,width),0);
  assert.equal(edgePageDirection(left+width*.74,left,width),0);
  assert.equal(edgePageDirection(left+width*.75,left,width),1);
  assert.equal(edgePageDirection(left+width,left,width),1);
  assert.equal(edgePageDirection(left-1,left,width),0);
  assert.equal(edgePageDirection(left+width+1,left,width),0);
 }
 assert.equal(edgePageDirection(0,0,0),0);
});
import {defaultProductionPrompt,promptAfterThemeChange} from '../lib/reader-prompts.ts';

test('trackpad rebound cannot reverse or skip a page within the same gesture',()=>{
 const gesture=newWheelGesture();
 const move=(time,x,y=0)=>wheelPageDirection(gesture,{time,x,y,mode:0,height:800});
 assert.equal(move(0,20),0);assert.equal(move(30,50),1);
 for(let time=100;time<=1000;time+=100)assert.equal(move(time,time%200===0?-75:80),0);
 assert.equal(move(1400,-65),-1);
});
test('mouse wheel units, small movements and cross-axis jitter are handled consistently',()=>{
 const gesture=newWheelGesture();
 assert.equal(wheelPageDirection(gesture,{time:0,x:0,y:3,mode:1,height:800}),1);
 assert.equal(wheelPageDirection(gesture,{time:500,x:8,y:10,mode:0,height:800}),0);
 assert.equal(wheelPageDirection(gesture,{time:520,x:80,y:10,mode:0,height:800}),0);
 assert.equal(wheelPageDirection(gesture,{time:540,x:0,y:40,mode:0,height:800}),1);
});
test('theme suggestions update automatically while reader-written requirements remain intact',()=>{
 const original=defaultProductionPrompt('给我一个反转');
 assert.notEqual(original,defaultProductionPrompt('爱情与错过'));
 assert.equal(promptAfterThemeChange(original,'给我一个反转','爱情与错过'),defaultProductionPrompt('爱情与错过'));
 assert.equal(promptAfterThemeChange('旁白更克制，结尾不要提问。','给我一个反转','爱情与错过'),'旁白更克制，结尾不要提问。');
 assert.match(defaultProductionPrompt('成年人重新开始'),/成年人重新开始/);
});


import {freshSuggestions,suggestionKey,suggestionRequestSchema} from '../lib/reader-suggestions.ts';
import {assertPdfReady,pdfFilename,wrapPdfText} from '../lib/reader-pdf.ts';
import {makeStory} from './fixtures/story.mjs';
test('batch history isolates book, custom source and theme without splitting on style or length',()=>{
 assert.equal(suggestionKey('liaozhai','irrelevant','反转'),suggestionKey('liaozhai',undefined,' 反转 '));
 assert.notEqual(suggestionKey('other','书一','反转'),suggestionKey('other','书二','反转'));
 assert.notEqual(suggestionKey('liaozhai',undefined,'反转'),suggestionKey('liaozhai',undefined,'善意'));
 assert.equal(freshSuggestions({stories:[{title:'《庄周梦蝶》',description:'重复'}],note:''},['庄周梦蝶']).stories.length,0);
 assert.throws(()=>suggestionRequestSchema.parse({bookId:'liaozhai',theme:'反转',length:10,excludeTitles:Array(201).fill('旧故事')}));
});
test('PDF refuses incomplete stories and wraps Chinese, newlines and long links without losing content',()=>{
 const story=makeStory();assert.doesNotThrow(()=>assertPdfReady(story));
 assert.throws(()=>assertPdfReady({...story,pages:[{...story.pages[0],image:''}]}),/全部|所有/);
 const text='他有一车梨，道士只想讨一个。';const lines=wrapPdfText(text,6,s=>Array.from(s).length);
 assert.equal(lines.join(''),text);assert.ok(lines.every(line=>Array.from(line).length<=6));assert.ok(lines.every(line=>!/[，。]/.test(line[0])));
 assert.deepEqual(wrapPdfText('前一行\n后一行',10,s=>s.length),['前一行','后一行']);
 const long='https://example.com/'+('path'.repeat(100));assert.equal(wrapPdfText(long,30,s=>s.length).join(''),long);
 assert.equal(pdfFilename('故事/名字?'),'故事名字-拾趣.pdf');
});


import {recentHero} from '../lib/reader-home.ts';
test('home hero resumes the last viewed story and stays empty for new or missing history',()=>{
 const sample=makeStory(),last={...sample,id:'generated-2',title:'最后看的故事'};
 const hero=recentHero([sample,last],last.id,[{storyId:sample.id,page:1},{storyId:last.id,page:4}]);
 assert.equal(hero.story.id,last.id);assert.equal(hero.page,4);assert.equal(hero.image,last.pages[4].image);assert.equal(hero.recent,true);
 assert.equal(recentHero([sample,last],'',[]),null);
 assert.equal(recentHero([sample,last],'deleted-story',[]),null);
 assert.equal(recentHero([],last.id,[]),null);
 assert.equal(recentHero([sample,last],last.id,[{storyId:last.id,page:99}]).page,sample.pages.length-1);
});


test('touch swipes support four directions while ignoring taps and ambiguous diagonals',()=>{
 assert.equal(swipePageDirection(-80,10),1);assert.equal(swipePageDirection(80,-10),-1);
 assert.equal(swipePageDirection(10,-80),1);assert.equal(swipePageDirection(-10,80),-1);
 assert.equal(swipePageDirection(30,10),0);assert.equal(swipePageDirection(80,78),0);
});

import {recentHeroes,mergeReadingProgress} from '../lib/reader-home.ts';
test('recent carousel keeps ten distinct readable stories, newest reading first, and resumes each page',()=>{
 const sample=makeStory(),stories=Array.from({length:12},(_,i)=>({...sample,id:'s'+i}));
 const progress=stories.map((s,i)=>({storyId:s.id,page:i%10,updatedAt:new Date(1700000000000+i*1000).toISOString()}));
 const items=recentHeroes(stories,'s0',[...progress,progress[0],{storyId:'deleted',page:0,updatedAt:'2099-01-01'}]);
 assert.equal(items.length,10);assert.equal(new Set(items.map(h=>h.story.id)).size,10);assert.equal(items[0].story.id,'s11');assert.equal(items[0].page,1);assert.equal(items[9].story.id,'s2');
 assert.equal(recentHeroes(stories.filter(s=>s.id!=='s11'),'s11',progress)[0].story.id,'s10');
 assert.deepEqual(recentHeroes([],sample.id,progress),[]);
 assert.equal(recentHeroes([sample],'',[]).length,0);
 const merged=mergeReadingProgress([{storyId:'s0',page:1,updatedAt:'2026-10-20'}],[{storyId:'s0',page:5,updatedAt:'2026-10-27'}]);assert.equal(merged[0].page,5);
});

import {reconcileReadingProgress} from '../lib/reader-home.ts';
test('server favorite resets replace newer browser flags without discarding the latest reading position',()=>{
 const cached=[{storyId:'generated',page:7,saved:1,updatedAt:'2026-10-29T12:00:00Z'}];
 const server=[{storyId:'generated',page:3,saved:0,updatedAt:'2026-10-28T12:00:00Z'}];
 const [row]=reconcileReadingProgress(cached,server);
 assert.deepEqual(row,{...cached[0],saved:0});
 assert.equal(reconcileReadingProgress(cached,[{...server[0],saved:1}])[0].saved,1);
 assert.equal(reconcileReadingProgress(cached,[{storyId:'other',page:0,saved:0}]).find(row=>row.storyId==='generated').saved,1);
});
test('published and generated progress hydration reconcile favorite flags regardless of response order',()=>{
 const local=[{storyId:'generated',page:7,saved:1,updatedAt:'2026-10-29'},{storyId:'published',page:3,saved:1,updatedAt:'2026-10-29'}];
 const generated=[{storyId:'generated',page:1,saved:0,updatedAt:'2026-10-28'}],published=[{storyId:'published',page:0,saved:0,updatedAt:'2026-10-28'}];
 for(const groups of [[generated,published],[published,generated]]){
  let authoritative=[],visible=local;
  for(const group of groups){authoritative=reconcileReadingProgress(authoritative,group);visible=reconcileReadingProgress(visible,authoritative);}
  assert.ok(visible.every(row=>row.saved===0));
  assert.equal(visible.find(row=>row.storyId==='generated').page,7);
  assert.equal(visible.find(row=>row.storyId==='published').page,3);
 }
});
