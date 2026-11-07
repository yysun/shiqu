// 桌面书架：≥1024px 时 ReaderShelf 网格右侧停靠阅读栏，显示在书架里打开的故事（就是阅读页本身，由 Reader 传入）；
// 尚未打开故事时显示提示。768–1023px 没有右栏：Reader 不向书架传 onSelect，点卡片直接打开全屏阅读，这里只渲染网格。
import type {ReactNode} from 'react';
import {useDrawerForm} from './useDesktopLayout';
import './DesktopLibrary.css';

export default function DesktopLibrary({shelf,reader}:{shelf:ReactNode;reader:ReactNode|null}){
 const docked=!useDrawerForm();
 return <div className="yu-library">
  <div className="yu-library-grid">{shelf}</div>
  {docked&&(reader?<div className="yu-library-reader">{reader}</div>:<aside className="yu-library-reader is-empty"><p>选择一篇故事，在这里阅读。</p></aside>)}
 </div>;
}
