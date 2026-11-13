// One story panel owns the title, downloads, credits and workflow for every entry point.
// Saved sessions can be named before a storyboard or artwork exists.
// Downloads and publication credits share one visibility rule: every saved frame must have an image.
// StorySettingsContent 是面板正文，手机面板与桌面工作区共用；它被当作普通函数调用，因此不得使用任何 hook。
import type {ReactNode} from 'react';
import type {Story} from '@/lib/content';
import type {SessionView} from '@/lib/reader-model';
import Sheet from './StorySheet';
import {StoryPublicationSummary} from './StoryPublication';
import StoryBackToShelf from './StoryBackToShelf';

type Props={story:Story|null;session?:SessionView|null;busy:boolean;disabled:boolean;onClose:()=>void;onBack:()=>void;onRename?:(id:string,title:string)=>void;downloads:ReactNode;exportStatus:string;exporting:boolean;onPublicationEdit?:()=>void;workflow?:ReactNode};
export function StorySettingsContent({story,session,busy,disabled,onBack,onRename,downloads,exportStatus,exporting,onPublicationEdit,workflow}:Omit<Props,'onClose'>){
 const title=session?.selection.displayTitle||story?.title||session?.selection.storyTitle||'未命名故事';
 const summary=story?.summary?.trim()||session?.frameRecommendation?.storySummary?.trim();
 const storyId=session?.id||story?.id;
 const canDownload=!!story?.pages.length&&story.pages.every(page=>!!page.image);
 return <fieldset className="yu-revision-fields" disabled={disabled}>
  {session?.selection.storyTitle!=='待拟标题'&&(!session?.intake||session.intake.selected||session.intake.phase==='confirmed')&&<div className="yu-story-name">
   <div className="yu-setting-row">
    <p>{title}</p>
    <button type="button" className="yu-revision-open" disabled={!onRename||!storyId} onClick={()=>{if(onRename&&storyId)onRename(storyId,title);}}>修改故事名</button>
   </div>
   {summary&&<p className="yu-story-summary">{summary}</p>}
  </div>}
  {canDownload&&<div className="yu-pdf-setting"><div className="yu-settings-formats" aria-label="下载故事">{downloads}</div><p className="yu-export-status" role="status">{exportStatus}</p>
   {story&&<StoryPublicationSummary story={story} onEdit={onPublicationEdit} disabled={exporting}/>}
  </div>}
  {workflow&&<section className="yu-settings-flow" aria-label="制作流程">{workflow}</section>}
  <StoryBackToShelf onBack={onBack} disabled={busy} link/>
 </fieldset>;
}
export function storyWorkflowHeading(session?:SessionView|null){
 const intake=session?.intake;
 const discovery=session?.selection.discovery;
 const preparing=!!intake&&intake.phase!=='confirmed'&&(discovery?.mode==='auto'&&discovery.combine||!!session?.selection.source&&!discovery);
 return preparing?'准备故事':'故事设置';
}
export default function StorySettingsPanel(props:Props){
 const intake=props.session?.intake,title=storyWorkflowHeading(props.session);
 return <Sheet title={title} fixedHeight={!!intake&&!intake.selected&&intake.phase!=='confirmed'&&title==='故事设置'} busy={props.busy} onClose={props.onClose}>{StorySettingsContent(props)}</Sheet>;
}
