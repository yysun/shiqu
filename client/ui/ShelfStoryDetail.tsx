// 书架故事详情（桌面 ≥1024px 右栏）：上方是选中故事的预览查看器（复用阅读页的画面胶片，翻页不改阅读进度），
// 下方是书名与主题画风、阅读进度、生成状态，以及两个按钮：阅读（继续阅读/重读）与故事设置。
// 故事设置与阅读页的设置按钮是同一入口（改名、署名、下载与制作流程都在那里）；收藏与删除在卡片上。
// 更窄时没有右栏，点卡片直接打开阅读。
import type {ReactNode} from 'react';
import {ArrowRight,RotateCcw,Settings2} from 'lucide-react';
import type {Story} from '@/lib/content';
import ShelfStoryViewer from './ShelfStoryViewer';
import './ShelfStoryDetail.css';

type Props={story:Story;meta:string[];page:number;status?:ReactNode;onRead:(restart:boolean)=>void;onSettings:()=>void};
export default function ShelfStoryDetail({story,meta,page,status,onRead,onSettings}:Props){
 const total=story.pages.length,finished=total>0&&page+1>=total,started=page>0||finished;
 return <aside className="yu-shelf-detail" aria-label={'《'+story.title+'》详情'}>
  <ShelfStoryViewer title={story.title} pages={story.pages} start={Math.min(page,Math.max(0,total-1))}/>
  <h2>{story.title}</h2>
  <p className="yu-shelf-detail-meta">{meta.filter(Boolean).join(' · ')}</p>
  <div className="yu-shelf-detail-progress"><span className="yu-shelf-progress" aria-hidden="true"><i style={{width:`${total?Math.min(100,Math.round((page+1)/total*100)):0}%`}}/></span><span>{finished?`已读完 · ${total} 幅`:`第 ${page+1} / ${total} 幅`}</span></div>
  {status&&<div className="yu-shelf-detail-status">{status}</div>}
  <div className="yu-shelf-detail-primary">
   <button type="button" className="yu-primary" onClick={()=>onRead(finished)}>{finished?<><RotateCcw size={17}/>重读</>:<>{started?'继续阅读':'阅读'}<ArrowRight size={17}/></>}</button>
   <button type="button" className="yu-shelf-detail-secondary" onClick={onSettings}><Settings2 size={17}/>故事设置</button>
  </div>
 </aside>;
}
