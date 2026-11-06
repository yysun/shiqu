// 桌面书架：≥1024px 时 ReaderShelf 网格右侧停靠选中故事的预览与操作（右栏），始终显示当前选中的故事。
// 768–1023px 没有右栏：Reader 不向书架传 onSelect，点卡片与手机一样直接打开全屏阅读，这里只渲染网格。
// 变窄跨过 1024px 时右栏卸载；焦点若在右栏里，移回选中的卡片。右栏不是返回键的步骤。
import {useEffect,useRef,type ReactNode} from 'react';
import {useDrawerForm} from './useDesktopLayout';

const focusCard=(id:string|null)=>{if(id)document.querySelector<HTMLElement>(`[data-story-id="${CSS.escape(id)}"] .yu-shelf-card-details`)?.focus();};
export default function DesktopLibrary({selectedId,shelf,detail}:{selectedId:string|null;shelf:ReactNode;detail:ReactNode|null}){
 const docked=!useDrawerForm(),focusInDetail=useRef(false);
 // 右栏卸载时焦点会丢失，因此用 focusin 记录焦点是否在右栏里，再移回选中的卡片。
 useEffect(()=>{if(!docked&&focusInDetail.current){focusInDetail.current=false;focusCard(selectedId);}},[docked]);
 return <div className="yu-library" onFocus={event=>{focusInDetail.current=!!(event.target as HTMLElement).closest('.yu-shelf-detail');}}>
  <div className="yu-library-grid">{shelf}</div>
  {docked&&(detail||<aside className="yu-shelf-detail is-empty"><p>选择一篇故事，在这里预览画面。</p></aside>)}
 </div>;
}
