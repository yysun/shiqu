// Render actual reader controls to verify batch progress and the 80-frame input limit without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('reader renders saved directory, batch range, honest progress and 80-frame controls',async()=>{
 const bundle=await build({stdin:{contents:"export {default as Status} from './client/ui/StoryGenerationStatus.tsx';export {default as Count} from './client/ui/StoryFrameCount.tsx';export {default as Retry} from './client/ui/StoryRetry.tsx';export {default as Review} from './client/ui/StoryReviewTools.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'}});
 const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const {Status,Count,Retry,Review}=compiled.exports,session={id:'render',selection:{length:45},state:'running',productionState:'running',ready:0,story:null,error:null,stage:'正在编排第 21–40 幅分镜',awaitingFrameCount:false,frameRecommendation:null,generationProgress:{sourceReady:true,frameCountConfirmed:true,frameCount:45,phase:'plan',startedAt:Date.now(),attempt:1,storyboardFrames:20,storyboardBatch:{first:21,last:40}}};
 const status=renderToStaticMarkup(createElement(Status,{session,busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(status,/已保存 20 \/ 45 幅分镜/);assert.match(status,/分镜目录已保存/);assert.match(status,/当前编排第 21–40 幅/);
 assert.doesNotMatch(status,/<progress/);assert.match(status,/进行中/);
 for(const label of ['确认原文','确定画幅数','分批分镜','全篇审片','定向修订','复核','绘图'])assert.ok(status.includes(label),label);
 assert.match(status,/data-stage="review" data-state="pending"/);
 const count=renderToStaticMarkup(createElement(Count,{recommendation:{count:80,reason:'展开关键动作与转折。'},disabled:false,onConfirm(){}}));
 assert.equal((count.match(/max="80"/g)||[]).length,2);assert.match(count,/生成 80 幅/);
 const reviewing={...session,story:{pages:Array(45).fill({})},stage:'正在审核全篇分镜',generationProgress:{...session.generationProgress,phase:'review',reviewStatus:'pending',reviewRound:0}};
 const review=renderToStaticMarkup(createElement(Status,{session:reviewing,busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(review,/全篇审片/);assert.match(review,/审片通过后才开始绘图/);assert.doesNotMatch(review,/<progress/);
 const blocked={...reviewing,state:'failed',error:'第 2 幅动作不清楚。',retryStage:'review',retryAllowed:true,generationProgress:{...reviewing.generationProgress,reviewStatus:'blocked',repairTotal:1}};
 const retry=renderToStaticMarkup(createElement(Status,{session:blocked,busy:false,error:blocked.error,onRetry(){},onBack(){}}));
 assert.match(retry,/继续自动修复/);assert.match(retry,/仍有 1 项待修订/);assert.match(retry,/第 2 幅动作不清楚/);
 const reviewProps={session:{...blocked,story:{original:{},pages:[{}]},reviewIssues:[{page:18,problem:'收尾缺少对应动作。',instruction:'补上掩面作哭状。'}],generationProgress:{...blocked.generationProgress,reviewStopReason:'limit',repairPasses:20,reviewAudits:21}},busy:false,error:'',onRetry(){},onScript(){},onEdit(){},onDrawAnyway(){}};
 const tools=renderToStaticMarkup(createElement(Review,reviewProps));
 assert.match(tools,/已完成 20 轮自动修复，复核仍未通过/);assert.match(tools,/已修复 20 轮 · 已审核 21 次/);
 assert.match(tools,/本次最多 20 轮/);assert.match(tools,/<button[^>]*class="yu-primary"[^>]*>.*继续自动修复/);assert.match(tools,/手动修改/);assert.match(tools,/跳过问题并绘图/);assert.match(tools,/<details><summary>修订建议/);
 const combined=renderToStaticMarkup(createElement(Status,{session:reviewProps.session,reviewActionsInContent:true,busy:false,error:blocked.error,onRetry(){},onBack(){}},createElement(Review,reviewProps)));
 assert.equal((combined.match(/继续自动修复/g)||[]).length,1,'Only the issue panel owns review recovery');assert.match(combined,/has-review-issues/);
 const unchanged=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{...reviewProps.session,generationProgress:{reviewStopReason:'unchanged',repairPasses:1,reviewAudits:1}}}));
 assert.match(unchanged,/上次修订没有产生实际变化/);assert.doesNotMatch(unchanged,/复核仍未通过/);
 const oldLimit=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{...reviewProps.session,generationProgress:{reviewStopReason:'limit',repairPasses:3,reviewAudits:4}}}));
 assert.match(oldLimit,/已完成 3 轮自动修复/);assert.match(oldLimit,/本次最多 20 轮/);
 for(const extra of [{busy:true},{session:{...reviewProps.session,retryAllowed:false}},{session:{...reviewProps.session,generationControl:'paused'}}]){
  const locked=renderToStaticMarkup(createElement(Review,{...reviewProps,...extra}));assert.match(locked,/<button[^>]*class="yu-primary"[^>]*disabled=""/);
 }
 const pausedReview=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{...reviewProps.session,generationControl:'paused'}}));assert.match(pausedReview,/请先恢复生成/);
 for(const [retryStage,label] of [['source','重试原文检索'],['publication','重试生成'],['review','继续自动修复'],['redraw','重试生成'],[undefined,'重试生成']]){
  const action=renderToStaticMarkup(createElement(Retry,{session:{...blocked,retryStage},busy:false,onRetry(){}}));
  assert.match(action,new RegExp(label));assert.doesNotMatch(action,/收费|计费|额度/);
  if(retryStage==='publication'){assert.match(action,/重试保存/);assert.doesNotMatch(action,/重试展开/);}
 }
 const drawing={...reviewing,ready:3,stage:'正在生成画面',generationProgress:{...reviewing.generationProgress,phase:'image',reviewStatus:'passed'}};
 const images=renderToStaticMarkup(createElement(Status,{session:drawing,busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(images,/<progress aria-label="画面生成进度" max="45" value="3"/);assert.match(images,/3 \/ 45 幅/);
 const paused=renderToStaticMarkup(createElement(Status,{session:{...session,generationControl:'paused'},busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(paused,/生成已暂停/);assert.match(paused,/点击“恢复生成”后继续/);assert.match(paused,/可在书架中管理和继续生成/);assert.doesNotMatch(paused,/is-generating|production-stage-spin|class="spin"|<progress/);
 const queued=renderToStaticMarkup(createElement(Status,{session:{...session,productionState:'queued'},busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(queued,/等待中/);assert.doesNotMatch(queued,/is-generating|production-stage-spin|class="spin"|<progress/);
});
