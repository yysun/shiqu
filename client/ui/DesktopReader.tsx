// 桌面阅读：画面舞台加可选侧栏（分镜列表或原文）。侧栏在任何宽度都不是模态：舞台从不 inert，
// 键盘、滚轮与边缘点击照常翻页。≥1024px 侧栏停靠在舞台右侧、舞台随之收窄；768–1023px 侧栏是覆盖舞台的抽屉。
// Escape 只由 Reader 的窗口键盘处理负责：先关侧栏，再返回。
import type {ReactNode} from 'react';
import {X} from 'lucide-react';
import './desktop.css';

export default function DesktopReader({stage,panel,title,onClose}:{stage:ReactNode;panel:ReactNode|null;title:string;onClose:()=>void}){
 return <div className={'yu-reader-layout'+(panel?' has-panel':'')}>
  {stage}
  {panel&&<aside className="yu-reader-panel" aria-label={title}>
   <header><h2>{title}</h2><button type="button" aria-label={'关闭'+title} onClick={onClose}><X size={20}/></button></header>
   <div className="yu-reader-panel-body">{panel}</div>
  </aside>}
 </div>;
}
