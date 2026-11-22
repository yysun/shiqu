// 使用隔离夹具验证真实生产流程，保持适配器契约可独立快速运行。
import test from 'node:test';

import assert from 'node:assert/strict';

import {executeHeadless} from '../server/headless-cli.ts';

import {withLocalBooks} from '../server/local-generation.ts';

import {productionFixture,selection as legacy} from './fixtures/production.mjs';

import {libraryFixture} from './fixtures/story-library.mjs';

const selection={...legacy,length:'auto'};

test('DeepSeek runs the public production CLI through three scene batches and both review gates without images',{timeout:30000},async t=>{
 const f=await productionFixture(t,'deepseek');await f.stop();const library=libraryFixture();f.control.autoLength=41;
 f.control.beforeText=async kind=>kind==='recommend'?{storySummary:library.stories[0].summary,storyMatchReason:'原文的行动和结果支持本篇故事。'}:undefined;
 const context={generation:withLocalBooks(f.generation,library.books,f.media),localBooks:library.books,variables:{}};
 const call=(args,input={})=>executeHeadless(process.cwd(),[...args,'--data-dir',f.dataDirectory],{...context,input});
 const created=await call(['stories','create'],{requestId:crypto.randomUUID(),intake:false,selection:{...selection,narrativeDetail:'balanced',theme:'原典故事',storyTitle:library.stories[0].title,source:library.stories[0].source}});
 const result=await call(['run',created.session.id,'--until','reviewed','--timeout','15']);assert.equal(result.reason,'reviewed',JSON.stringify(result.session));
 assert.equal(result.session.generationProgress.reviewStatus,'passed');assert.equal(result.session.generationProgress.reviewOverridden,false);assert.equal(result.session.story.pages.length,41);assert.equal(result.session.ready,0);
 assert.equal(f.control.dagCalls.filter(name=>name==='sceneBatch').length,3,'20/20/1 scene batches');assert.ok(f.control.frameReviews.length);assert.ok(f.control.reviews.length);assert.equal(f.control.calls.length,0);
 assert.ok(result.session.story.generationModels.every(entry=>entry.model==='deepseek-flash'));
});
