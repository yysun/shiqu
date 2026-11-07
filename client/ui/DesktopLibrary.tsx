// 桌面书架：≥1024px 时网格右栏显示 Reader 传入的阅读页或故事设置；未选择时显示提示和新建入口。
// 768–1023px 没有右栏，卡片沿用整页阅读或工作区入口，这里只渲染网格。
import type {ReactNode} from 'react';
import StoryFlowAction from './StoryFlowAction';
import {useDrawerForm} from './useDesktopLayout';
import './DesktopLibrary.css';

export default function DesktopLibrary({shelf,reader,onCreate}:{shelf:ReactNode;reader:ReactNode|null;onCreate:()=>void}){
 const docked=!useDrawerForm();
 return <div className="yu-library">
  <div className="yu-library-grid">{shelf}</div>
  {docked&&(reader?<div className="yu-library-reader">{reader}</div>:<aside className="yu-library-reader is-empty"><div><p>选择一篇故事，在这里阅读或继续制作。</p><StoryFlowAction onClick={onCreate}>新建故事</StoryFlowAction></div></aside>)}
 </div>;
}
