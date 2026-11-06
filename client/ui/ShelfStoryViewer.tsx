// 书架详情里的故事预览：复用阅读页的画面胶片（StoryFilmstrip）与滑动翻页层（StoryPageSurface），
// 左右滑动、点按两侧边缘或左右方向键翻页，点按中间显示或隐藏旁白。
// 只是预览：从已保存的阅读进度所在的那一幅开始，翻页不写回阅读进度；尚未绘制的画面显示占位。
import {useState,type KeyboardEvent} from 'react';
import {ChevronLeft,ChevronRight,Feather} from 'lucide-react';
import type {Page} from '@/lib/content';
import StoryFilmstrip from './StoryFilmstrip';
import StoryPageSurface from './StoryPageSurface';
import {createDragOffset} from './useDragOffset';

const noop=()=>{},noReloads={},surfaceLabel='左侧边缘返回上一幅，右侧边缘进入下一幅，也可左右滑动或用方向键翻页；点按中间显示或隐藏旁白';
export default function ShelfStoryViewer({title,pages,start}:{title:string;pages:Page[];start:number}){
 const [drag]=useState(createDragOffset),[page,setPage]=useState(start),[captionHidden,setCaptionHidden]=useState(false);
 const last=Math.max(0,pages.length-1),current=Math.min(page,last),frame=pages[current];
 function turn(direction:number){setPage(Math.max(0,Math.min(last,current+direction)));}
 function key(event:KeyboardEvent){
  const next=event.key==='ArrowRight'||event.key==='ArrowDown'?current+1:event.key==='ArrowLeft'||event.key==='ArrowUp'?current-1:event.key==='Home'?0:event.key==='End'?last:null;
  if(next===null)return;event.preventDefault();setPage(Math.max(0,Math.min(last,next)));
 }
 if(!pages.length)return <div className="yu-shelf-viewer is-empty"><Feather size={28}/></div>;
 return <section className="yu-shelf-viewer" aria-label={'预览《'+title+'》'} onKeyDown={key}>
  <div className={'yu-shelf-viewer-stage'+(captionHidden?' is-caption-hidden':'')}>
   <StoryFilmstrip pages={pages} page={current} drag={drag} reloads={noReloads} onImageError={noop} onImageLoad={noop}/>
   {!frame?.image&&<div className="yu-shelf-viewer-pending" role="status"><Feather size={24} strokeWidth={1.2}/><span>这一幅还没有画好</span></div>}
   <StoryPageSurface onTurn={turn} onDrag={drag.set} onToggleMetadata={()=>setCaptionHidden(hidden=>!hidden)} label={surfaceLabel}/>
   {frame?.caption&&<p className="yu-shelf-viewer-caption" key={current}>{frame.caption}</p>}
  </div>
  <div className="yu-shelf-viewer-nav">
   <button type="button" disabled={current===0} onClick={()=>turn(-1)} aria-label="上一幅" title="上一幅"><ChevronLeft size={18}/></button>
   <span aria-live="polite">{String(current+1).padStart(2,'0')} / {String(pages.length).padStart(2,'0')}</span>
   <button type="button" disabled={current===last} onClick={()=>turn(1)} aria-label="下一幅" title="下一幅"><ChevronRight size={18}/></button>
  </div>
 </section>;
}
