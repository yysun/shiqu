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
 const title=session?.selection.displayTitle||story?.title||session?.selection.storyTitle||'等待选择故事';
 const storyId=session?.id||story?.id;
 const canDownload=!!story?.pages.length&&story.pages.every(page=>!!page.image);
 return <fieldset className="yu-revision-fields" disabled={disabled}>
  <div className="yu-setting-row yu-story-name"><div><p>{title}</p></div><button type="button" className="yu-revision-open" disabled={!onRename||!storyId} onClick={()=>{if(onRename&&storyId)onRename(storyId,title);}}>修改故事名</button></div>
  {canDownload&&<div className="yu-pdf-setting"><div className="yu-settings-formats" aria-label="下载故事">{downloads}</div><p className="yu-export-status" role="status">{exportStatus}</p>
   {story&&<StoryPublicationSummary story={story} onEdit={onPublicationEdit} disabled={exporting}/>}
  </div>}
  {workflow&&<section className="yu-settings-flow" aria-label="制作流程">{workflow}</section>}
  <StoryBackToShelf onBack={onBack} disabled={busy} link/>
 </fieldset>;
}
export default function StorySettingsPanel(props:Props){
 return <Sheet title="故事设置" busy={props.busy} onClose={props.onClose}>{StorySettingsContent(props)}</Sheet>;
}
