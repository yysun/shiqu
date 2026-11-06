// 书架故事详情（桌面）：选中故事的封面、书名与主题画风、阅读进度、生成状态，以及该故事今天的全部操作。
// 每个按钮都调用 Reader 现有的处理函数；≥1024px 停靠在网格右侧，768–1023px 是抽屉。
// 抽屉打开时焦点移到标题；在抽屉内按 Escape 关闭（保留选中），焦点由 DesktopLibrary 交还给卡片。
import {useEffect,useRef,type ReactNode} from 'react';
import {ArrowRight,Bookmark,Feather,PenLine,RotateCcw,Settings2,Trash2,X} from 'lucide-react';
import type {Story} from '@/lib/content';
import './ShelfStoryDetail.css';

type Props={
 story:Story;meta:string[];page:number;saved:boolean;status?:ReactNode;
 open:boolean;drawerForm:boolean;onClose:()=>void;
 onRead:(restart:boolean)=>void;onWorkflow:()=>void;downloads:ReactNode;exportStatus:string;
 onFavorite:()=>void;favoriteBusy:boolean;onRename?:()=>void;onPublication?:()=>void;onDelete:()=>void;
};
export default function ShelfStoryDetail({story,meta,page,saved,status,open,drawerForm,onClose,onRead,onWorkflow,downloads,exportStatus,onFavorite,favoriteBusy,onRename,onPublication,onDelete}:Props){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(drawerForm&&open)heading.current?.focus({preventScroll:true});},[drawerForm,open,story.id]);
 const total=story.pages.length,finished=total>0&&page+1>=total,started=page>0||finished;
 const image=story.pages.find(item=>item.image)?.image;
 return <aside className={'yu-shelf-detail'+(open?' is-open':'')} aria-label={'《'+story.title+'》详情'} onKeyDown={event=>{if(event.key==='Escape'&&drawerForm&&open){event.stopPropagation();onClose();}}}>
  {drawerForm&&<button type="button" className="yu-shelf-detail-close" aria-label="关闭详情" onClick={onClose}><X size={20}/></button>}
  <div className="yu-shelf-detail-cover">{image?<img src={image} alt=""/>:<Feather size={28}/>}</div>
  <h2 ref={heading} tabIndex={-1}>{story.title}</h2>
  <p className="yu-shelf-detail-meta">{meta.filter(Boolean).join(' · ')}</p>
  <div className="yu-shelf-detail-progress"><span className="yu-shelf-progress" aria-hidden="true"><i style={{width:`${total?Math.min(100,Math.round((page+1)/total*100)):0}%`}}/></span><span>{finished?`已读完 · ${total} 幅`:`第 ${page+1} / ${total} 幅`}</span></div>
  {status&&<div className="yu-shelf-detail-status">{status}</div>}
  <div className="yu-shelf-detail-primary">
   <button type="button" className="yu-primary" onClick={()=>onRead(finished)}>{finished?<><RotateCcw size={17}/>重读</>:<>{started?'继续阅读':'阅读'}<ArrowRight size={17}/></>}</button>
   <button type="button" className="yu-shelf-detail-secondary" onClick={onWorkflow}><Settings2 size={17}/>制作流程</button>
  </div>
  <section className="yu-shelf-detail-downloads" aria-label="下载故事"><div className="yu-settings-formats">{downloads}</div>{exportStatus&&<p className="yu-export-status" role="status">{exportStatus}</p>}</section>
  <div className="yu-shelf-detail-manage">
   <button type="button" aria-pressed={saved} disabled={favoriteBusy} onClick={onFavorite}><Bookmark size={17} fill={saved?'currentColor':'none'}/>{saved?'不再收藏':'收藏'}</button>
   {onRename&&<button type="button" onClick={onRename}><PenLine size={17}/>修改故事名</button>}
   {onPublication&&<button type="button" onClick={onPublication}><Feather size={17}/>署名与转载</button>}
   <button type="button" className="yu-shelf-detail-delete" onClick={onDelete}><Trash2 size={17}/>删除故事</button>
  </div>
 </aside>;
}
