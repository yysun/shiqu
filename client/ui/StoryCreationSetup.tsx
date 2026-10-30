// Present saved creation intent through the same production timeline and editor as revisions.
// Local edits stay local until an explicit recommendation or final production confirmation.
import {useEffect,useState} from 'react';
import type {ComponentProps} from 'react';
import type {SessionView} from '@/lib/reader-model';
import type {IntakeCommand} from '@/lib/reader-intake';
import {getArtStyle} from '@/lib/reader-styles';
import {generationProgress} from '@/lib/generation-progress';
import StoryProductionEditor,{StoryEditorTabs} from './StoryProductionEditor';
import type {StoryEditorTab} from './StoryProductionEditor';
import Sheet from './StorySheet';
import StorySource from './StorySource';
import StoryGenerationStatus from './StoryGenerationStatus';
import './story-revision.css';
type SetupTab=Exclude<StoryEditorTab,'script'>;
type Props={session:SessionView;book:string;busy:boolean;onAction:(command:IntakeCommand)=>Promise<void>;progress:Omit<ComponentProps<typeof StoryGenerationStatus>,'session'|'timeline'|'stages'|'children'|'compact'>};
export default function StoryCreationSetup({session,book,busy,onAction,progress}:Props){
 const intake=session.intake!;
 const [error,setError]=useState('');
 const [editing,setEditing]=useState<SetupTab|null>(null),[choosing,setChoosing]=useState(false),[sourceOpen,setSourceOpen]=useState(false);
 const [settings,setSettings]=useState({artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt,narrativeDetail:session.selection.narrativeDetail||'balanced' as const,length:session.frameRecommendation?.count||8});
 useEffect(()=>{setSettings({artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt,narrativeDetail:session.selection.narrativeDetail||'balanced',length:session.frameRecommendation?.count||8});setSourceOpen(false);setEditing(null);setError('');},[session.id,intake.generation,session.frameRecommendation?.count]);
 const locked=busy||session.state==='running',ready=intake.phase==='confirming';
 const candidates=intake.batches.flatMap((saved,batchIndex)=>saved.stories.map((candidate,index)=>({candidate,batchIndex,index})));
 const selected=intake.selected?intake.batches[intake.selected.batch]?.stories[intake.selected.index]:null;
 const choosingOnly=!selected&&intake.phase==='choosing'&&session.state!=='failed'&&!session.error&&(!session.generationControl||session.generationControl==='active')&&!progress.error;
 const preferences={artStyle:settings.artStyle,productionPrompt:settings.productionPrompt,narrativeDetail:settings.narrativeDetail};
 async function act(command:IntakeCommand){setError('');try{await onAction(command);return true;}catch(e){setError(e instanceof Error?e.message:'操作暂未保存，请重试。');return false;}}
 async function select(batchIndex:number,index:number){if(await act({action:'choose',batch:batchIndex,index,...(selected?{settings:preferences}:{})}))setChoosing(false);}
 const candidateList=<>
  <div className="yu-batch-heading"><h3>已找到 {candidates.length} 篇故事</h3><button type="button" className="yu-refresh-batch" disabled={locked||intake.phase==='discovering'||intake.batches.length>=40} onClick={()=>void act({action:'more',...(selected?{settings:preferences}:{})})}>{intake.phase==='discovering'?'正在查找…':'继续找故事'}</button></div>
  <div className="yu-candidate-list">{candidates.map(({candidate,batchIndex,index})=><button type="button" key={`${batchIndex}:${index}`} aria-pressed={intake.selected?.batch===batchIndex&&intake.selected.index===index} className={intake.selected?.batch===batchIndex&&intake.selected.index===index?'selected':''} disabled={locked} onClick={()=>void select(batchIndex,index)}><strong>{candidate.title}</strong><span className="yu-candidate-description">{candidate.description}</span>{candidate.sourceLabel&&<small>{candidate.sourceLabel}</small>}<span className="yu-candidate-action">{intake.selected?.batch===batchIndex&&intake.selected.index===index?'已选这篇':'选择这篇'}</span></button>)}</div>
  {!candidates.length?<p className="yu-candidate-note">还没有找到符合主题的故事，可以继续查找，或换个主题。</p>:intake.batches.at(-1)?.stories.length===0&&<p className="yu-candidate-note">暂时没有找到更多故事，已找到的故事都在上方。</p>}
 </>;
 const stages=generationProgress(session,Date.now()).steps.filter(step=>selected||step.id==='source').map(step=>{
  if(step.id==='source')return ready?{...step,label:'原文与制作要求',detail:`画风：${getArtStyle(settings.artStyle).label}`}:intake.phase==='discovering'?step:{...step,detail:`已找到 ${candidates.length} 篇故事`};
  return ready&&step.id==='count'?{...step,detail:`${settings.length} 幅 · 待确认`}:step;
 });
 return <section className="yu-creation-setup" aria-label={selected?'制作确认':'选择故事'}>
  <p className="yu-sheet-intro">《{book}》 · {session.selection.theme}</p>
  {selected?<div className="yu-batch-heading"><h3>{session.selection.storyTitle}</h3><button type="button" className="yu-revision-open" disabled={locked} onClick={()=>setChoosing(true)}>重新选择</button></div>:<p className="yu-count-help">书籍和主题已保存到书架，离开后可继续。</p>}
  {intake.phase==='discovering'&&<p role="status">正在寻找更多故事，已找到的故事会继续保留。{intake.progress?.currentChapters?.length?`正在翻阅：${intake.progress.currentChapters.join('、')}`:''}{intake.progress?.completedChars?`已读 ${intake.progress.completedChars.toLocaleString('zh-CN')} 字。`:''}</p>}
  {!selected&&intake.batches.length>0&&candidateList}
  {!choosingOnly&&<StoryGenerationStatus session={session} {...progress} compact={ready} stages={stages} timeline={ready?{
   links:{source:[{label:'原文',onClick:()=>setSourceOpen(true)},{label:'制作要求',onClick:()=>setEditing('requirements')}]},
   detailActions:{source:{label:'修改画风',onClick:()=>setEditing('style')}},
   actions:{count:{label:'修改画幅数',onClick:()=>setEditing('count')}}
  }:undefined}>
  {ready&&<><p className="yu-count-help">制作内容可从流程步骤修改。确认前不会编排分镜或绘图。</p><button type="button" className="yu-primary" disabled={locked} onClick={()=>void act({action:'confirm',settings})}>{busy?'正在保存…':`确认制作并生成 ${settings.length} 幅`}</button></>}
  </StoryGenerationStatus>}
  {choosingOnly&&<button type="button" className="yu-generation-later" onClick={progress.onBack}>稍后从书架继续</button>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
  {choosing&&<Sheet title="重新选择故事" busy={busy} onClose={()=>setChoosing(false)}>{candidateList}{error&&<p role="alert">{error}</p>}</Sheet>}
  {sourceOpen&&<Sheet title="故事原文" onClose={()=>setSourceOpen(false)}><StorySource sessionId={session.id} book={book}/></Sheet>}
  {editing&&<Sheet title="修改故事" busy={locked} onClose={()=>setEditing(null)}>
   <StoryEditorTabs tab={editing} disabled={locked} onChange={tab=>{if(tab!=='script')setEditing(tab);}}/>
   <StoryProductionEditor tab={editing} settings={settings} creation disabled={locked} recommendation={session.frameRecommendation} artRecommendation={selected?.artRecommendation} onChange={patch=>setSettings(s=>({...s,...patch}))} onRecommend={()=>void act({action:'recommend',settings:preferences})}/>
   {error&&<p className="yu-batch-error" role="alert">{error}</p>}
   <button type="button" className="yu-primary" disabled={locked} onClick={()=>setEditing(null)}>完成编辑</button><p className="yu-revision-note">关闭窗口保留本次草稿；返回流程页确认制作后才开始生成。</p>
  </Sheet>}
 </section>;
}
