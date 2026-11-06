// 桌面外壳（≥768×560）：顶部横向导航（发现 · 书架 · 我的 · 新建故事），下方是页面主体。
// 高亮来自推导出的视图；导航动作统一交给 Reader 的 onNavigate，由它先离开当前打开的视图。
// 阅读视图隐藏顶栏以保持沉浸，阅读页自带返回按钮。
import type {ReactNode} from 'react';
import {BookOpen,Compass,Feather,Sparkles,UserRound} from 'lucide-react';
import type {TopItem} from '@/lib/desktop-view';
import './desktop.css';

const tabs=[{id:'discover',title:'发现',Icon:Compass},{id:'shelf',title:'书架',Icon:BookOpen},{id:'me',title:'我的',Icon:UserRound}] as const;
export default function DesktopShell({active,hidden,onNavigate,children}:{active:TopItem|null;hidden:boolean;onNavigate:(target:TopItem)=>void;children:ReactNode}){
 return <>
  {!hidden&&<header className="yu-topbar">
   <button type="button" className="yu-topbar-logo" onClick={()=>onNavigate('discover')} aria-label="拾趣，返回发现"><span><Feather size={20}/></span><strong>拾趣</strong></button>
   <nav aria-label="主导航">{tabs.map(({id,title,Icon})=><button key={id} type="button" aria-current={active===id?'page':undefined} onClick={()=>onNavigate(id)}><Icon size={18}/><span>{title}</span></button>)}</nav>
   <button type="button" className="yu-topbar-create" aria-current={active==='create'?'page':undefined} onClick={()=>onNavigate('create')}><Sparkles size={17}/><span>新建故事</span></button>
  </header>}
  {children}
 </>;
}
