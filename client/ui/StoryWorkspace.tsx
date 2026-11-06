// 故事工作区（桌面）：把手机上从“故事设置”层层打开的面板合成一个整页。
// 顶部是返回与分区标签（制作流程 · 修改故事 · 分镜剧本 · 审核记录 · 原文），只显示今天有入口的分区；
// 左侧分镜列表，中间是当前分区的现有组件，右侧是所选分镜的画面、旁白与该幅的审片问题（0 表示结语）。
// ≥1280px 三栏；1024–1279px 分镜列表变为上方横条，右栏缩小画面；768–1023px 右栏改为“画面与审核”抽屉。
// 分区由 Reader 的状态标志推导，本组件只负责排布；画面抽屉的开合是唯一的本地状态。
// 画面抽屉打开时是返回键的一步（层级 2）；停靠的右栏不是步骤。
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,Feather,PanelRight,X} from 'lucide-react';
import type {Story} from '@/lib/content';
import type {ReviewIssue} from '@/lib/reader-review';
import type {WorkspaceSection} from '@/lib/desktop-view';
import {useDrawerForm} from './useDesktopLayout';
import {useHistoryStep} from './historySteps';
import './StoryWorkspace.css';

export const workspaceLabels:Record<WorkspaceSection,string>={flow:'制作流程',edit:'修改故事',script:'分镜剧本',history:'审核记录',source:'原文'};
type Props={
 title:string;section:WorkspaceSection;sections:WorkspaceSection[];onSection:(section:WorkspaceSection)=>void;onBack:()=>void;
 story:Story|null;frame:number;onFrame:(frame:number)=>void;issues:ReviewIssue[];children:ReactNode;
};
export default function StoryWorkspace({title,section,sections,onSection,onBack,story,frame,onFrame,issues,children}:Props){
 const drawerForm=useDrawerForm(),[previewOpen,setPreviewOpen]=useState(false),toggle=useRef<HTMLButtonElement>(null),focusInPreview=useRef(false);
 // 变为抽屉形式时同步关闭预览；焦点若在停靠的右栏里，移到“画面与审核”按钮。
 const [seenDrawer,setSeenDrawer]=useState(drawerForm);
 if(seenDrawer!==drawerForm){setSeenDrawer(drawerForm);if(drawerForm)setPreviewOpen(false);}
 useEffect(()=>{if(drawerForm&&focusInPreview.current){focusInPreview.current=false;toggle.current?.focus();}},[drawerForm]);
 useHistoryStep(drawerForm&&previewOpen&&!!story,2,()=>{setPreviewOpen(false);toggle.current?.focus();});
 const pages=story?.pages||[],page=frame>0?pages[frame-1]:null,frameIssues=issues.filter(issue=>issue.page===frame);
 const preview=story&&<aside className={'yu-workspace-preview'+(previewOpen?' is-open':'')} aria-label="画面与审核" onKeyDown={event=>{if(event.key==='Escape'&&drawerForm&&previewOpen){event.stopPropagation();setPreviewOpen(false);toggle.current?.focus();}}}>
  {drawerForm&&<button type="button" className="yu-workspace-preview-close" aria-label="关闭画面与审核" onClick={()=>{setPreviewOpen(false);toggle.current?.focus();}}><X size={20}/></button>}
  <h2>{frame>0?`第 ${frame} 幅`:'结语'}</h2>
  {frame>0?<>
   <div className="yu-workspace-art">{page?.image?<img src={page.image} alt={page.caption||`第 ${frame} 幅`}/>:<span className="yu-workspace-drawing"><Feather size={24}/>这一幅还在绘制</span>}</div>
   <p className="yu-workspace-caption">{page?.caption||'这幅的旁白尚未保存。'}</p>
  </>:<p className="yu-workspace-caption">{story.reflection||'结语尚未保存。'}</p>}
  <section className="yu-workspace-issues" aria-label="本幅审片问题">
   <h3>审片问题</h3>
   {frameIssues.length?<ol>{frameIssues.map((issue,index)=><li key={index}><p>{issue.problem}</p><p><strong>修订要求：</strong>{issue.instruction}</p></li>)}</ol>:<p className="yu-workspace-empty">这一幅没有待处理的审片问题。</p>}
  </section>
 </aside>;
 return <div className={'yu-workspace'+(story?' has-frames':'')} onFocus={event=>{focusInPreview.current=!!(event.target as HTMLElement).closest('.yu-workspace-preview');}}>
  <header className="yu-workspace-header">
   <button type="button" className="yu-workspace-back" onClick={onBack}><ArrowLeft size={18}/>返回</button>
   <h1>{title}</h1>
   <nav className="yu-workspace-tabs" aria-label="工作区分区">{sections.map(id=><button key={id} type="button" aria-current={section===id?'page':undefined} onClick={()=>onSection(id)}>{workspaceLabels[id]}</button>)}</nav>
   {story&&<button type="button" ref={toggle} className="yu-workspace-preview-toggle" aria-expanded={previewOpen} onClick={()=>setPreviewOpen(!previewOpen)}><PanelRight size={17}/>画面与审核</button>}
  </header>
  {story&&<nav className="yu-workspace-frames" aria-label="分镜">
   <ol>
    {pages.map((item,index)=><li key={index}><button type="button" aria-current={frame===index+1?'true':undefined} aria-label={`选择第 ${index+1} 幅`} onClick={()=>onFrame(index+1)}>
     {item.image?<img src={item.image} alt="" loading="lazy"/>:<span className="yu-workspace-pending">待绘制</span>}
     <span className="yu-workspace-frame-copy"><strong>第 {index+1} 幅</strong><span>{item.caption||'旁白尚未保存'}</span></span>
    </button></li>)}
    {story.reflection!==undefined&&<li><button type="button" aria-current={frame===0?'true':undefined} aria-label="选择结语" onClick={()=>onFrame(0)}><span className="yu-workspace-pending">结语</span><span className="yu-workspace-frame-copy"><strong>结语</strong><span>{story.reflection||'结语尚未保存'}</span></span></button></li>}
   </ol>
  </nav>}
  <main className="yu-workspace-center" data-section={section}>{children}</main>
  {preview}
  {drawerForm&&previewOpen&&<div className="yu-workspace-scrim" onClick={()=>{setPreviewOpen(false);toggle.current?.focus();}}/>}
 </div>;
}
