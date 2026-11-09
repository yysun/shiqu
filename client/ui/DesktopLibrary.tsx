// 大屏右栏优先显示阅读或故事设置，未选择故事时显示制作任务。没有内容时书架占满宽度。
import type {ReactNode} from 'react';
import './DesktopLibrary.css';

export default function DesktopLibrary({shelf,reader,productions}:{shelf:ReactNode;reader?:ReactNode;productions?:ReactNode}){
 return <div className={'yu-library'+(reader||productions?' has-side':'')}>
  <div className="yu-library-grid">{shelf}</div>
  {reader?<div className="yu-library-reader">{reader}</div>:productions?<aside className="yu-library-productions" id="shelf-production-panel" aria-label="制作中">{productions}</aside>:null}
 </div>;
}
