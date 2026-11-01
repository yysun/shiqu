// Render real shared UI to guard the confirmation boundary and hide obsolete duplicate controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const noop=()=>{};
test('discovery stays in the picker and selection opens one continuous story flow',async()=>{
 const bundle=await build({stdin:{contents:"export {default as Control} from './client/ui/StoryGenerationControl.tsx';export {default as Paused} from './client/ui/StoryPausedEditing.tsx';export {default as Editor,revisionDraftSteps} from './client/ui/StoryRevisionEditor.tsx';export {default as Setup,storyCreationTitle} from './client/ui/StoryCreationSetup.tsx';export {default as Review} from './client/ui/StoryReviewTools.tsx';export {StoryRevisionActions as Actions} from './client/ui/StoryRevisionEditor.tsx';export {default as Fields,StoryEditorTabs as Tabs} from './client/ui/StoryProductionEditor.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'}});
 const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const {Setup,storyCreationTitle,Fields,Tabs,Review,Actions,Paused,Editor,revisionDraftSteps,Control}=compiled.exports;
 const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'选择',artStyle:'paper-cut',productionPrompt:'清楚的旁白。',narrativeDetail:'brief',length:'auto',voice:false};
 const session={id:'creating',selection,state:'idle',ready:0,story:null,error:null,awaitingFrameCount:false,retryAllowed:false,generationMode:'background',generationControl:'active',frameRecommendation:{count:7,reason:'保留因果。'},intake:{phase:'confirming',generation:1,search:{state:'idle'},selected:{batch:0,index:0},batches:[{stories:[{title:'庄周梦蝶',description:'不应铺开的候选介绍。'}],note:''}]},generationProgress:{sourceReady:true,frameCountConfirmed:false,phase:'production-confirmation'}};
 const html=renderToStaticMarkup(createElement(Setup,{session,book:'庄子',busy:false,onAction:async()=>{},progress:{busy:false,controlBusy:false,error:'',onControl:async()=>{},onRetry:noop,onBack:noop}}));
 assert.equal((html.match(/<ol /g)||[]).length,1);assert.match(html,/重新选择/);assert.match(html,/>开始制作<\/button>/);assert.match(html,/画风：剪纸艺术/);assert.match(html,/建议 7 幅/);assert.match(html,/制作要求（可选）/);
 for(const label of ['原文','制作要求','修改画风','修改幅数'])assert.ok(html.includes(label),label);
 assert.doesNotMatch(html,/叙事详略|<textarea|type="radio"|不应铺开的候选介绍|修改分镜|制作内容可从流程步骤修改|确认前不会/);
 assert.match(html,/data-stage="plan" data-state="pending"/);assert.match(html,/data-stage="image" data-state="pending"/);assert.doesNotMatch(html,/制作故事|yu-creation-confirmation|yu-creation-summary/);
 const props={session,book:'庄子',busy:false,onAction:async()=>{},progress:{busy:false,controlBusy:false,error:'',onControl:async()=>{},onRetry:noop,onBack:noop}};
 const choosing={...session,intake:{...session.intake,phase:'choosing',selected:undefined}};
 // Discovery, an empty result, and late candidate updates keep the same picker title and layout.
 for(const phase of ['discovering','choosing']){
  const waiting={...choosing,state:'running',intake:{...choosing.intake,phase,search:{state:'searching'},batches:[]}};
  assert.equal(storyCreationTitle(waiting),'选择故事');
  const opening=renderToStaticMarkup(createElement(Setup,{...props,session:waiting}));
  assert.match(opening,/正在寻找更多故事/);assert.doesNotMatch(opening,/data-stage=|生成进展|制作故事|故事流程|yu-generation-stage/);
 }
 for(const phase of ['preparing','confirming','confirmed'])assert.equal(storyCreationTitle({...session,intake:{...session.intake,phase}}),'故事流程');
 const candidates=renderToStaticMarkup(createElement(Setup,{...props,session:choosing}));
 assert.match(candidates,/已找到 1 篇故事/);assert.doesNotMatch(candidates,/完整审片流程|开始制作|<textarea|叙事详略|<select|候选批次/);
 // The review tools stay reachable once a reused first image exists; a clean story has no need of them.
 const reviewProps={busy:false,error:'',onScript:noop,onEdit:noop,onDrawAnyway:noop},story=image=>({original:{},pages:[{image}]}),issue={page:3,problem:'配文含混。',instruction:'说清楚。'};
 assert.match(renderToStaticMarkup(createElement(Review,{...reviewProps,session:{story:story('/a.png'),reviewIssues:[issue]}})),/仍然绘制/);
 const endingReview=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{story:story('/a.png'),reviewIssues:[{...issue,page:0,category:'reflection'}]}}));
 assert.match(endingReview,/<strong>结语<\/strong>/);assert.doesNotMatch(endingReview,/第 0 幅/);
 assert.equal(renderToStaticMarkup(createElement(Review,{...reviewProps,session:{story:story('/a.png')}})),'');
 const unreviewed=renderToStaticMarkup(createElement(Review,{...reviewProps,session:{story:story('')}}));assert.match(unreviewed,/查看分镜/);assert.doesNotMatch(unreviewed,/仍然绘制/);
 // Both the editor and the settings sheet show these actions, so a conflict cannot go unseen.
 const conflict=renderToStaticMarkup(createElement(Actions,{editor:{impact:{changed:true,replan:false,reused:1,redraw:0,conflict:false},conflict:true,error:'',busy:false,submit:noop,discard:noop,load:noop,setChanges:noop}}));
 assert.match(conflict,/丢弃草稿，载入最新/);assert.match(conflict,/不会自动合并/);
 // Search and selection report separately; each offers only the action that applies.
 const failedSearch=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,intake:{...session.intake,search:{state:'failed',error:'查找暂未完成。'}}}}));
 assert.match(failedSearch,/查找暂未完成/);assert.match(failedSearch,/重试查找/);assert.match(failedSearch,/开始制作/);assert.doesNotMatch(failedSearch,/准备这篇/);
 const firstFailed=renderToStaticMarkup(createElement(Setup,{...props,session:{...choosing,intake:{...choosing.intake,batches:[],search:{state:'failed',error:'查找暂未完成。'}}}}));
 assert.match(firstFailed,/重试查找/);
 const searching=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,intake:{...session.intake,search:{state:'searching'}}}}));
 assert.match(searching,/正在寻找更多故事/);assert.match(searching,/开始制作/);assert.doesNotMatch(searching,/<button[^>]*disabled[^>]*>开始制作/);
 const pausedSearch=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,generationControl:'paused',intake:{...session.intake,search:{state:'searching'}}}}));
 assert.match(pausedSearch,/查找已暂停/);assert.doesNotMatch(pausedSearch,/正在寻找更多故事/);
 const pausedConfirmation=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,generationControl:'paused'}}));
 assert.equal((pausedConfirmation.match(/>恢复生成<\/button>/g)||[]).length,1);assert.doesNotMatch(pausedConfirmation,/>开始制作<\/button>/);
 const unprepared={...session,frameRecommendation:null,intake:{...session.intake,phase:'choosing'}};
 assert.match(renderToStaticMarkup(createElement(Setup,{...props,session:unprepared})),/准备这篇/);
 const failedPreparation=renderToStaticMarkup(createElement(Setup,{...props,session:{...unprepared,state:'failed',error:'准备失败。',retryAllowed:true,intake:{...session.intake,phase:'preparing'}}}));
 assert.doesNotMatch(failedPreparation,/准备这篇/);assert.match(failedPreparation,/yu-retry-control/);
 assert.match(renderToStaticMarkup(createElement(Setup,{...props,session:{...session,intake:{...session.intake,draft:{artStyle:'paper-cut',productionPrompt:'手改',narrativeDetail:'brief',length:5}}}})),/5 幅 · 待确认/);
 const preparing=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,state:'running',frameRecommendation:null,intake:{...session.intake,phase:'preparing'}}}));
 assert.match(preparing,/生成进展/);assert.match(preparing,/data-stage="count"/);assert.doesNotMatch(preparing,/>开始制作<\/button>/);
 const pausedPreparation=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,state:'idle',generationControl:'paused',frameRecommendation:null,intake:{...session.intake,phase:'preparing'}}}));
 assert.match(pausedPreparation,/恢复生成/);assert.match(pausedPreparation,/生成进展/);
 for(const label of ['制作要求（可选）','修改画风','修改幅数','重新选择故事'])assert.ok(pausedPreparation.includes(label),label);
 const pausedProps={session:{...session,intake:undefined,generationControl:'paused'},...props.progress,editor:{base:null,changes:{},impact:null,busy:false,open:noop},onReselect:noop};
 const pausedWithoutPlan=renderToStaticMarkup(createElement(Paused,pausedProps));
 const pausedTimeline=pausedWithoutPlan.match(/<ol .*?<\/ol>/s)[0];
 for(const label of ['制作要求','修改画风','修改画幅数','重新选择故事'])assert.ok(pausedTimeline.includes(label),label);
 assert.equal((pausedWithoutPlan.match(/>恢复生成<\/button>/g)||[]).length,1);
 assert.match(pausedWithoutPlan,/<button type="button" class="yu-primary"[^>]*>恢复生成<\/button>/);
 assert.doesNotMatch(pausedWithoutPlan,/暂停后修改|开始制作新版|yu-review-tools/);
 assert.equal(renderToStaticMarkup(createElement(Paused,{...pausedProps,session})), '');
 const opened=[],controls=[];
 const pausedSurface=Paused({...pausedProps,editor:{...pausedProps.editor,open:tab=>opened.push(tab)}});
 pausedSurface.props.timeline.links.source[1].onClick();pausedSurface.props.timeline.detailActions.source.onClick();pausedSurface.props.timeline.actions.count.onClick();
 assert.deepEqual(opened,['requirements','style','count']);assert.deepEqual(controls,[]);
 const resume=Control({session:pausedProps.session,busy:false,primary:true,onControl:async(id,action)=>controls.push([id,action])});
 await resume.props.onClick();assert.deepEqual(controls,[[session.id,'resume']]);
 // The shared control stays compact unless the flow dialog explicitly asks for a primary action.
 const shelfControl=renderToStaticMarkup(createElement(Control,{session:pausedProps.session,busy:false,onControl:noop}));
 assert.match(shelfControl,/class="yu-generation-control"/);assert.doesNotMatch(shelfControl,/class="yu-primary"/);
 const emptyPlanEditor=renderToStaticMarkup(createElement(Editor,{editor:{base:{selection:{...selection,length:5},plan:null,images:[]},changes:{},tab:'count',busy:false,loading:false,setTab:noop,setChanges:noop,impact:{changed:true,replan:true,total:5},submit:noop,discard:noop}}));
 assert.match(emptyPlanEditor,/value="5"/);assert.match(emptyPlanEditor,/开始制作新版/);assert.doesNotMatch(emptyPlanEditor,/保持暂停|恢复生成/);assert.doesNotMatch(emptyPlanEditor,/>分镜<|保存修改并加入队列/);

 // Settings edits return to a draft preview; only the explicit production action submits.
 const draftEditor={base:{selection:{...selection,length:5},plan:null,images:[]},changes:{length:30,artStyle:'ink-pencil'},tab:'count',busy:false,loading:false,setTab:noop,setChanges:noop,impact:{changed:true,replan:true,total:30},submit:noop,discard:noop};
 const editing=renderToStaticMarkup(createElement(Editor,{editor:draftEditor,onDone:noop}));
 assert.match(editing,/>完成编辑<\/button>/);assert.doesNotMatch(editing,/>开始制作新版<\/button>|保持暂停|恢复生成/);
 const confirmation=renderToStaticMarkup(createElement(Actions,{editor:draftEditor}));
 assert.match(confirmation,/>开始制作新版<\/button>/);assert.doesNotMatch(confirmation,/>完成编辑<\/button>|保持暂停|恢复生成/);
 const pausedDraft=renderToStaticMarkup(createElement(Paused,{...pausedProps,editor:draftEditor}));
 assert.match(pausedDraft,/30 幅 · 待确认/);assert.doesNotMatch(pausedDraft,/开始制作新版|暂停后修改/);
 assert.equal((pausedDraft.match(/>恢复生成<\/button>/g)||[]).length,1);
 const pausedEditor=renderToStaticMarkup(createElement(Editor,{editor:draftEditor,onDone:noop,resuming:true}));
 assert.match(pausedEditor,/>完成编辑<\/button>/);assert.doesNotMatch(pausedEditor,/>恢复生成<\/button>|开始制作新版/);
 const pausedConflict=renderToStaticMarkup(createElement(Paused,{...pausedProps,editor:{...draftEditor,conflict:true}}));
 assert.match(pausedConflict,/<button type="button" class="yu-primary" disabled="">恢复生成<\/button>/);
 const draftSteps=revisionDraftSteps(draftEditor.base,draftEditor.changes);
 assert.equal(draftSteps.find(s=>s.id==='count').detail,'30 幅 · 待确认');
 assert.equal(draftSteps.find(s=>s.id==='count').state,'current');
 assert.equal(draftSteps.find(s=>s.id==='source').detail,'画风：彩铅国漫');
 for(const id of ['plan','review','repair','recheck','image'])assert.equal(draftSteps.find(s=>s.id===id).state,'pending',id);
 const savedPlan={pages:Array(5).fill({caption:'已保存的旁白。',prompt:'Saved scene.'})};
 const styleSteps=revisionDraftSteps({...draftEditor.base,plan:savedPlan},{artStyle:'ink-pencil'});
 assert.equal(styleSteps.find(s=>s.id==='plan').state,'done');assert.equal(styleSteps.find(s=>s.id==='review').state,'pending');assert.equal(styleSteps.find(s=>s.id==='image').state,'pending');
 const manualSteps=revisionDraftSteps({...draftEditor.base,plan:savedPlan},{plan:{...savedPlan,reflection:'手改余味。'}});
 assert.equal(manualSteps.find(s=>s.id==='plan').detail,'已修改分镜 · 待审片');

 const transportFailure=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,retryAllowed:true,intake:{...session.intake,phase:'preparing'}},progress:{...props.progress,error:'网络暂时不可用'}}));
 assert.match(transportFailure,/网络暂时不可用/);assert.match(transportFailure,/yu-retry-control/);
 const started=renderToStaticMarkup(createElement(Setup,{...props,session:{...session,state:'running',intake:{...session.intake,phase:'confirmed'},generationProgress:{...session.generationProgress,phase:'plan',frameCount:7,frameCountConfirmed:true}}}));
 assert.match(started,/生成进展/);assert.match(started,/data-stage="plan"/);assert.doesNotMatch(started,/>开始制作<\/button>/);
 const collected={...choosing,intake:{...choosing.intake,batches:[...choosing.intake.batches,{stories:[{title:'佝偻承蜩',description:'追加找到的故事。'},{title:'庄周梦蝶',description:'同名但出处不同的选项。',sourceLabel:'另一处原文'}],note:''}]}};
 const all=renderToStaticMarkup(createElement(Setup,{...props,session:collected}));
 assert.match(all,/已找到 3 篇故事/);assert.match(all,/佝偻承蜩|追加找到的故事/);assert.match(all,/另一处原文/);assert.equal((all.match(/<strong>庄周梦蝶<\/strong>/g)||[]).length,2);assert.doesNotMatch(all,/<select|候选批次/);

 const paused=renderToStaticMarkup(createElement(Setup,{...props,session:{...choosing,generationControl:'paused'}}));
 assert.match(paused,/恢复生成/);
 const failed=renderToStaticMarkup(createElement(Setup,{...props,session:{...choosing,state:'failed',error:'受控提取失败',retryAllowed:true}}));
 assert.match(failed,/重试|受控提取失败/);

 const createTabs=renderToStaticMarkup(createElement(Tabs,{tab:'style',onChange:noop})),revisionTabs=renderToStaticMarkup(createElement(Tabs,{tab:'script',onChange:noop,script:true}));
 assert.doesNotMatch(createTabs,/分镜/);assert.match(revisionTabs,/分镜/);
 const count=renderToStaticMarkup(createElement(Fields,{tab:'count',settings:{artStyle:'paper-cut',productionPrompt:'',length:80},disabled:true,creation:true,onChange:noop}));
 assert.match(count,/disabled/);assert.equal((count.match(/max="80"/g)||[]).length,2);assert.doesNotMatch(count,/保存修改并加入队列|叙事详略/);
 const style=renderToStaticMarkup(createElement(Fields,{tab:'style',settings:{artStyle:'paper-cut',productionPrompt:'',length:7},artRecommendation:{artStyle:'woodblock',reason:'鲜明轮廓适合人物动作。'},disabled:false,creation:true,onChange:noop}));
 assert.match(style,/推荐：木版年画/);assert.match(style,/鲜明轮廓适合人物动作。/);assert.match(style,/当前选择：剪纸艺术/);assert.match(style,/采用推荐/);
});
