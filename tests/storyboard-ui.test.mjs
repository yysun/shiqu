// Render actual reader controls to verify batch progress and automatic frame arrangement without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/tsx.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {defaultProductionDirection} from '../lib/reader-prompts.ts';
import {revisionImpact} from '../lib/reader-revision.ts';
import {makePlan,selection} from './fixtures/production.mjs';

test('style-only revision UI preserves review progress and offers drawing without a fresh audit',async()=>{
 const {StoryRevisionActions,revisionDraftSteps}=await import('../client/ui/StoryRevisionEditor.tsx');
 const base={selection,plan:makePlan(3),images:[],reviewStatus:'passed'},changes={artStyle:'paper-cut'};
 const editor={base,changes,impact:revisionImpact(base,changes),busy:false,submit(){},discard(){}};
 const html=renderToStaticMarkup(createElement(StoryRevisionActions,{editor,reviewOnSave:true}));
 assert.match(html,/不重新审核/);assert.match(html,/审片已通过时直接重绘/);assert.match(html,/保存修改/);assert.doesNotMatch(html,/保存并重新审核|重新审片/);
 const steps=revisionDraftSteps(base,changes);
 assert.equal(steps.find(s=>s.id==='count').state,'done');assert.equal(steps.find(s=>s.id==='review').state,'done');assert.equal(steps.find(s=>s.id==='image').state,'current');
 assert.match(steps.find(s=>s.id==='review').detail,/不重新审核/);
 assert.notEqual(revisionDraftSteps({...base,reviewStatus:'blocked'},changes).find(s=>s.id==='image').state,'current');
 const mixed={...changes,acceptancePrompt:'保留关键行动。'},mixedEditor={...editor,changes:mixed,impact:revisionImpact(base,mixed)};
 assert.match(renderToStaticMarkup(createElement(StoryRevisionActions,{editor:mixedEditor,reviewOnSave:true})),/保存并重新审核/);
});

test('reader renders saved directory, batch range, honest progress and automatic frame controls',async()=>{
 const {default:Status}=await import('../client/ui/StoryGenerationStatus.tsx');
 const {default:Count}=await import('../client/ui/StoryFrameCount.tsx');
 const {default:Retry}=await import('../client/ui/StoryRetry.tsx');
 const {default:Review}=await import('../client/ui/StoryReviewTools.tsx');
 const {default:Editor}=await import('../client/ui/StoryRevisionEditor.tsx');
 const session={id:'render',selection:{length:45},state:'running',productionState:'running',ready:0,story:null,error:null,stage:'正在编排第 21–40 幅分镜',awaitingFrameCount:false,frameRecommendation:null,generationProgress:{sourceReady:true,frameCountConfirmed:true,frameCount:45,phase:'plan',startedAt:Date.now(),attempt:1,storyboardFrames:20,storyboardBatch:{first:21,last:40}}};
 const status=renderToStaticMarkup(createElement(Status,{session,busy:false,error:'',onRetry(){},onBack(){}}));
 const timedSession={...session,generationProgress:{...session.generationProgress,startedAt:Date.now()-65000,timeoutAt:Date.now()+235000}};
 const timed=renderToStaticMarkup(createElement(Status,{session:timedSession,busy:false,error:'',onRetry(){},onBack(){}}));
 assert.doesNotMatch(timed,/本阶段|已用时/);assert.match(timed,/距超时 3分 5[45]秒/);
 const expired=renderToStaticMarkup(createElement(Status,{session:{...timedSession,generationProgress:{...timedSession.generationProgress,timeoutAt:Date.now()-1000}},busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(expired,/已达超时，等待状态更新/);
 assert.match(status,/已保存 20 \/ 45 幅分镜/);assert.match(status,/当前第 21–40 幅/);assert.doesNotMatch(status,/分镜目录已保存|正在生成整篇，离开页面后继续/);
 assert.doesNotMatch(status,/<progress/);assert.match(status,/进行中/);
 for(const label of ['确认原文','叙事详略与篇幅','分批分镜','全篇审片','定向修订','复核','绘图'])assert.ok(status.includes(label),label);
 assert.match(status,/data-stage="review" data-state="pending"/);
 const count=renderToStaticMarkup(createElement(Count,{recommendation:{count:80,reason:'展开关键动作与转折。'},disabled:false,onConfirm(){}}));
 assert.doesNotMatch(count,/type="range"|type="number"/);assert.match(count,/80 幅/);assert.match(count,/由编排和审核确定/);
 const reviewing={...session,story:{pages:Array(45).fill({})},stage:'正在审核全篇分镜',generationProgress:{...session.generationProgress,phase:'review',reviewStatus:'pending',reviewRound:0}};
 const review=renderToStaticMarkup(createElement(Status,{session:reviewing,busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(review,/全篇审片/);assert.match(review,/等待审片通过/);assert.doesNotMatch(review,/<progress/);
 const blocked={...reviewing,state:'failed',error:'第 2 幅动作不清楚。',retryStage:'review',retryAllowed:true,generationProgress:{...reviewing.generationProgress,reviewStatus:'blocked',repairTotal:1}};
 const retry=renderToStaticMarkup(createElement(Status,{session:blocked,busy:false,error:blocked.error,onRetry(){},onBack(){}}));
 assert.match(retry,/继续自动修复/);assert.match(retry,/仍有 1 项待修订/);assert.match(retry,/第 2 幅动作不清楚/);
 const reviewProps={session:{...blocked,story:{original:{},pages:[{}]},reviewIssues:[{page:18,problem:'收尾缺少对应动作。',instruction:'补上掩面作哭状。'}],generationProgress:{...blocked.generationProgress,reviewStopReason:'limit',repairPasses:20,reviewAudits:21}},busy:false,error:'',onRetry(){},onScript(){},onEdit(){},onDrawAnyway(){}};
 const tools=renderToStaticMarkup(createElement(Review,reviewProps));
 const trimmed={...reviewProps.session,story:{pages:[{image:'/api/reader/images/saved.webp'}]},generationProgress:{...reviewProps.session.generationProgress,sourceReady:true}};
 const shelfTools=renderToStaticMarkup(createElement(Review,{...reviewProps,session:trimmed}));
 assert.match(shelfTools,/收尾缺少对应动作/);assert.match(shelfTools,/继续自动修复/);
 assert.equal(renderToStaticMarkup(createElement(Review,{...reviewProps,session:{...trimmed,story:null}})),'');
 assert.match(tools,/已完成 20 轮自动修复，复核仍未通过/);assert.match(tools,/已修复 20 轮 · 已审核 21 次/);
 assert.match(tools,/本次最多 20 轮/);assert.match(tools,/<a[^>]*class="story-flow-link"[^>]*>继续自动修复/);assert.match(tools,/手动修改/);assert.match(tools,/跳过问题并绘图/);assert.match(tools,/<details><summary>修订建议/);
 const combined=renderToStaticMarkup(createElement(Status,{session:reviewProps.session,reviewTools:createElement(Review,reviewProps),busy:false,error:blocked.error,onRetry(){},onBack(){}}));
 assert.equal((combined.match(/继续自动修复/g)||[]).length,1,'Only the issue panel owns review recovery');assert.match(combined,/has-review-issues/);
 const unchanged=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{...reviewProps.session,generationProgress:{reviewStopReason:'unchanged',repairPasses:1,reviewAudits:1}}}));
 assert.match(unchanged,/上次修订没有产生实际变化/);assert.doesNotMatch(unchanged,/复核仍未通过/);
 const incomplete=renderToStaticMarkup(createElement(Review,{...reviewProps,onReplan(){},session:{...reviewProps.session,retryAllowed:false,reviewIssues:[{page:18,requiresReplan:true,problem:'缺少原文已有的结局。',instruction:'重新分配全篇画幅。'}],generationProgress:{reviewStopReason:'replan',repairPasses:0,reviewAudits:1}}}));
 assert.match(incomplete,/修改制作要求/);assert.match(incomplete,/整篇结构/);assert.match(incomplete,/局部自动修补与绘图已停止/);
 assert.doesNotMatch(incomplete,/继续自动修复|手动修改第 18 幅|已完成 20 轮/);
 const legacy=defaultProductionDirection.replace('按原文自身的事件、人物与因果展开，不额外套入主题或要求反转。','用相遇、犹疑与错过的具体细节表现感情，克制煽情，让未说出口的话和选择留下余味。');
 const editor={tab:'requirements',base:{selection:{artStyle:'chibi',theme:'爱情与错过',productionPrompt:legacy,length:18},plan:null},changes:{},impact:null,setTab(){},setChanges(){}};
 const neutral=renderToStaticMarkup(createElement(Editor,{editor}));
 assert.doesNotMatch(neutral,/按原文自身的事件、人物与因果展开/);assert.doesNotMatch(neutral,/用相遇、犹疑与错过/);
 const authored=renderToStaticMarkup(createElement(Editor,{editor:{...editor,changes:{productionPrompt:'保留人物原话，并在第一幅介绍当前处境。'}}}));
 assert.match(authored,/保留人物原话，并在第一幅介绍当前处境/);
 const oldLimit=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{...reviewProps.session,generationProgress:{reviewStopReason:'limit',repairPasses:3,reviewAudits:4}}}));
 assert.match(oldLimit,/已完成 3 轮自动修复/);assert.match(oldLimit,/本次最多 20 轮/);
 for(const extra of [{busy:true},{session:{...reviewProps.session,retryAllowed:false}},{session:{...reviewProps.session,generationControl:'paused'}}]){
  const locked=renderToStaticMarkup(createElement(Review,{...reviewProps,...extra}));assert.match(locked,/<a[^>]*aria-disabled="true"/);
 }
 const pausedReview=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{...reviewProps.session,generationControl:'paused'}}));assert.match(pausedReview,/请先恢复生成/);
 for(const [retryStage,label] of [['source','重试原文检索'],['publication','重试保存图片'],['review','继续自动修复'],['redraw','重绘图片'],[undefined,'重试生成']]){
  const action=renderToStaticMarkup(createElement(Retry,{session:{...blocked,retryStage},busy:false,onRetry(){}}));
  assert.match(action,new RegExp(label));assert.doesNotMatch(action,/收费|计费|额度/);
  if(retryStage==='publication'){assert.match(action,/重试保存/);assert.doesNotMatch(action,/重试展开/);}
 }
 const drawing={...reviewing,ready:3,stage:'正在生成画面',generationProgress:{...reviewing.generationProgress,phase:'image',reviewStatus:'passed'}};
 const images=renderToStaticMarkup(createElement(Status,{session:drawing,busy:false,error:'',onRetry(){},onBack(){}}));
 assert.doesNotMatch(images,/<progress/);assert.match(images,/3 \/ 45 幅/);
 const paused=renderToStaticMarkup(createElement(Status,{session:{...session,generationControl:'paused'},busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(paused,/生成已暂停/);assert.match(paused,/>恢复生成<\/a>/);assert.match(paused,/可在书架中管理和继续生成/);assert.doesNotMatch(paused,/is-generating|production-stage-spin|class="spin"|<progress/);
 const queued=renderToStaticMarkup(createElement(Status,{session:{...session,productionState:'queued'},busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(queued,/等待中/);assert.doesNotMatch(queued,/is-generating|production-stage-spin|class="spin"|<progress/);
});
