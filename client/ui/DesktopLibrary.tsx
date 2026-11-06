// 桌面书架：ReaderShelf 网格加选中故事的详情。≥1024px 详情停靠在右侧，始终显示当前选中的故事；
// 768–1023px 详情是抽屉，只在点选或回车选择时打开，打开期间网格 inert，可用关闭按钮、Escape 或点击遮罩关闭。
// 变窄跨过 1024px 时抽屉保持关闭（不会自己弹出）；焦点若在停靠的详情里，移回选中的卡片。
// 抽屉形式打开时是返回键的一步（层级 2），返回只关闭抽屉并保留选中；停靠的详情不是步骤。
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useDrawerForm} from './useDesktopLayout';
import {useHistoryStep} from './historySteps';

type DetailState={open:boolean;drawerForm:boolean;onClose:()=>void};
const focusCard=(id:string|null)=>{if(id)document.querySelector<HTMLElement>(`[data-story-id="${CSS.escape(id)}"] .yu-shelf-card-details`)?.focus();};
export default function DesktopLibrary({selectedId,onSelect,shelf,detail}:{selectedId:string|null;onSelect:(id:string|null)=>void;shelf:(select:(id:string|null)=>void)=>ReactNode;detail:((state:DetailState)=>ReactNode)|null}){
 const drawerForm=useDrawerForm(),[open,setOpen]=useState(false),returnFocus=useRef(false),focusInDetail=useRef(false);
 // 变成抽屉形式时在渲染中同步关闭，避免网格带着旧的 open 状态提交一次 inert 而丢失焦点。
 const [seenDrawer,setSeenDrawer]=useState(drawerForm);
 if(seenDrawer!==drawerForm){setSeenDrawer(drawerForm);if(drawerForm)setOpen(false);}
 // 停靠的详情变为隐藏抽屉时焦点会丢失，因此用 focusin 记录焦点是否在详情里，再移回选中的卡片。
 useEffect(()=>{if(drawerForm&&focusInDetail.current){focusInDetail.current=false;focusCard(selectedId);}},[drawerForm]);
 function select(id:string|null){onSelect(id);if(id)setOpen(true);}
 // 抽屉关闭后网格才解除 inert，因此在下一次提交后再把焦点还给卡片。
 function close(){returnFocus.current=true;setOpen(false);}
 useHistoryStep(drawerForm&&open&&!!detail,2,close);
 useEffect(()=>{if(!open&&returnFocus.current){returnFocus.current=false;focusCard(selectedId);}},[open]);
 return <div className={'yu-library'+(selectedId?' has-selection':'')} onFocus={event=>{focusInDetail.current=!!(event.target as HTMLElement).closest('.yu-shelf-detail');}}>
  <div className="yu-library-grid" inert={drawerForm&&open&&!!detail}>{shelf(select)}</div>
  {drawerForm&&open&&detail&&<div className="yu-shelf-detail-scrim" onClick={close}/>}
  {detail?detail({open,drawerForm,onClose:close}):!drawerForm&&<aside className="yu-shelf-detail is-empty"><p>选择一篇故事，查看详情、下载与管理。</p></aside>}
 </div>;
}
