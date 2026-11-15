// One story panel owns the title, downloads, credits and workflow for every entry point.
// Saved sessions can be named before a storyboard or artwork exists.
// Downloads and publication credits share one visibility rule: every saved frame must have an image.
// StorySettingsContent 是面板正文，手机面板与桌面工作区共用；它被当作普通函数调用，因此不得使用任何 hook。
// 从阅读页打开时显示“本书参考图”，以当前所读的一幅设为或取消参考；面板内操作统一用文字链接。
import {isDirectSourceSelection} from '@/lib/reader-discovery-themes';
import type {ReactNode} from 'react';
import type {Story} from '@/lib/content';
import type {SessionView} from '@/lib/reader-model';
import Sheet from './StorySheet';
import {StoryPublicationSummary} from './StoryPublication';
import StoryBackToShelf from './StoryBackToShelf';
import StoryFlowAction from './StoryFlowAction';

// 阅读中的那一幅；没有图片或在结语页时不传。
export type StoryBookReference={page:number;selected:boolean;replacing:boolean;disabled:boolean;busy:boolean;toggle:()=>void};

type Props={story:Story|null;session?:SessionView|null;busy:boolean;disabled:boolean;onClose:()=>void;onBack:()=>void;onRename?:(id:string,title:string)=>void;downloads:ReactNode;exportStatus:string;exporting:boolean;onPublicationEdit?:()=>void;workflow?:ReactNode;bookReference?:StoryBookReference};
export function StorySettingsContent({story,session,busy,disabled,onBack,onRename,downloads,exportStatus,exporting,onPublicationEdit,workflow,bookReference}:Omit<Props,'onClose'>){
 const title=session?.selection.displayTitle||story?.title||session?.selection.storyTitle||'未命名故事';
 const summary=story?.summary?.trim()||session?.frameRecommendation?.storySummary?.trim();
 const storyId=session?.id||story?.id;
 const canDownload=!!story?.pages.length&&story.pages.every(page=>!!page.image);
 return <fieldset className="yu-revision-fields" disabled={disabled}>
  {storyId&&session?.selection.storyTitle!=='待拟标题'&&(!session?.intake||session.intake.selected||session.intake.phase==='confirmed')&&<div className="yu-story-name">
   <div className="yu-setting-row">
    <p>{title}</p>
    <StoryFlowAction disabled={!onRename||!storyId} onClick={()=>{if(onRename&&storyId)onRename(storyId,title);}}>修改故事名</StoryFlowAction>
   </div>
   {summary&&<p className="yu-story-summary">{summary}</p>}
  </div>}
  {canDownload&&<div className="yu-pdf-setting"><div className="yu-settings-formats" aria-label="下载故事">{downloads}</div><p className="yu-export-status" role="status">{exportStatus}</p>
   {story&&<StoryPublicationSummary story={story} onEdit={onPublicationEdit} disabled={exporting}/>}
  </div>}
  {bookReference&&<div className="yu-setting-row yu-book-reference">
   <div><strong>{bookReference.selected?`第 ${bookReference.page+1} 幅是本书参考图`:'本书参考图'}</strong><p>{bookReference.selected?'同书以后生图会参考这一幅。':bookReference.replacing?'本书已有参考图，设当前这一幅会替换它。':'每本书一幅，同书以后生图会参考它。'}</p></div>
   <StoryFlowAction disabled={bookReference.disabled||bookReference.busy} aria-busy={bookReference.busy} onClick={bookReference.toggle}>{bookReference.busy?'正在保存…':bookReference.selected?'取消参考图':`设第 ${bookReference.page+1} 幅为参考图`}</StoryFlowAction>
  </div>}
  {workflow&&<section className="yu-settings-flow" aria-label="制作流程">{workflow}</section>}
  <StoryBackToShelf onBack={onBack} disabled={busy} link/>
 </fieldset>;
}
export function storyWorkflowHeading(session?:SessionView|null){
 const intake=session?.intake;
 const discovery=session?.selection.discovery;
 const preparing=!!intake&&intake.phase!=='confirmed'&&(discovery?.mode==='auto'&&discovery.combine||!!session&&isDirectSourceSelection(session.selection));
 return preparing?'准备故事':'故事设置';
}
export default function StorySettingsPanel(props:Props){
 const intake=props.session?.intake,title=storyWorkflowHeading(props.session);
 return <Sheet title={title} fixedHeight={!!intake&&!intake.selected&&intake.phase!=='confirmed'&&title==='故事设置'} busy={props.busy} onClose={props.onClose}>{StorySettingsContent(props)}</Sheet>;
}
