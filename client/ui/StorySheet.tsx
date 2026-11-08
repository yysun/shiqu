// Share native dialog focus and scroll locks across reading, creation and nested editing.
// 父面板晚于子面板打开时（例如跨档切换在同一次提交里重新挂载嵌套面板），把已打开的子面板重新置顶，保证子面板在上。
// 每个面板在挂载效果里登记为返回键的一步（historySteps），每次 showModal 都记录置顶顺序。
// 关闭守卫：忙碌时不关；有未保存的输入（[data-dirty="true"]）时先询问。Escape 与 Chrome Android 的返回
// 都以 cancel 到达，走同一个守卫；浏览器强制关闭（close watcher）时重新打开忙碌或有输入的面板，绝不静默丢弃输入。
// 叠在另一个面板上打开时，标题上方显示关闭后回到哪里（返回「下层面板」）：嵌套的取所在面板，否则取当前顺序里的下一层。
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {DISCARD_PROMPT,historySteps} from './historySteps';

const sheetLocks=new Set<HTMLDialogElement>();
let restoreSheetScroll:(()=>void)|null=null;
export default function Sheet({title,onClose,children,busy=false,fixedHeight=false}:{title:string;onClose:()=>void;children:React.ReactNode;busy?:boolean;fixedHeight?:boolean}) {
 const dialogRef=useRef<HTMLDialogElement>(null),contentRef=useRef<HTMLElement>(null);
 const latest=useRef({onClose,busy});latest.current={onClose,busy};
 const [under,setUnder]=useState<string|null>(null);
 const dirty=()=>!!dialogRef.current?.querySelector('[data-dirty="true"]');
 function requestClose(){
  if(latest.current.busy||(dirty()&&!window.confirm(DISCARD_PROMPT)))return;
  latest.current.onClose();
 }
 useEffect(()=>{
  const dialog=dialogRef.current!,body=document.body,root=document.documentElement;
  const prior=document.activeElement as HTMLElement;
  if(!sheetLocks.size){
   const scrollY=window.scrollY,priorUrl=location.href;
   const bodyStyle={position:body.style.position,top:body.style.top,width:body.style.width,overflow:body.style.overflow},rootOverflow=root.style.overflow;
   // One shared lock survives nested sheets closing together after a version switch.
   Object.assign(body.style,{position:'fixed',top:`-${scrollY}px`,width:'100%',overflow:'hidden'});root.style.overflow='hidden';
   restoreSheetScroll=()=>{Object.assign(body.style,bodyStyle);root.style.overflow=rootOverflow;window.scrollTo({top:location.href===priorUrl?scrollY:0,behavior:'instant'});};
  }
  sheetLocks.add(dialog);dialog.showModal();historySteps.raised(dialog);contentRef.current?.focus({preventScroll:true});
  for(const nested of dialog.querySelectorAll<HTMLDialogElement>('dialog[open]')){nested.close();nested.showModal();historySteps.raised(nested);nested.querySelector<HTMLElement>('.yu-sheet')?.focus({preventScroll:true});}
  const unregister=historySteps.register({rank:3,close:()=>latest.current.onClose(),busy:()=>latest.current.busy,dirty,element:()=>dialog});
  // 跨档切换后共享对话框被重新置顶，下层可能换成新挂载的面板，因此每次置顶都重新计算
  const relabel=()=>setUnder((dialog.parentElement?.closest('dialog')??historySteps.dialogBelow(dialog))?.getAttribute('aria-label')??null);
  relabel();dialog.addEventListener('shiqu-raised',relabel);
  // 不是本组件发起的关闭（重新置顶时 close 后立即 showModal，事件到达时对话框已重新打开）
  const forced=()=>{
   if(dialog.open)return;
   if(!latest.current.busy&&!dirty()){latest.current.onClose();return;}
   dialog.showModal();historySteps.raised(dialog);
   if(!latest.current.busy&&window.confirm(DISCARD_PROMPT))latest.current.onClose();
  };
  dialog.addEventListener('close',forced);
  return()=>{
   dialog.removeEventListener('close',forced);dialog.removeEventListener('shiqu-raised',relabel);unregister();
   dialog.close();sheetLocks.delete(dialog);
   if(!sheetLocks.size){restoreSheetScroll?.();restoreSheetScroll=null;}
   if(prior?.isConnected)prior.focus({preventScroll:true});
  };
 },[]);
 return <dialog className="yu-backdrop" ref={dialogRef} aria-label={title} aria-modal="true" onCancel={e=>{e.preventDefault();requestClose();}} onClick={e=>{if(!busy&&e.target===e.currentTarget)onClose();}}><section className={fixedHeight?'yu-sheet yu-sheet-fixed-height':'yu-sheet'} tabIndex={-1} ref={contentRef} aria-busy={busy}><div className="yu-handle"/><header>{under?<div className="yu-sheet-title"><span className="yu-sheet-return">返回「{under}」</span><h2>{title}</h2></div>:<h2>{title}</h2>}<button className="yu-icon" disabled={busy} aria-label="关闭" onClick={onClose}><X size={21}/></button></header>{children}</section></dialog>;
}
