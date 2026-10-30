// Share native dialog focus and scroll locks across reading, creation and nested editing.
import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';

const sheetLocks=new Set<HTMLDialogElement>();
let restoreSheetScroll:(()=>void)|null=null;
export default function Sheet({title,onClose,children,busy=false}:{title:string;onClose:()=>void;children:React.ReactNode;busy?:boolean}) {
 const dialogRef=useRef<HTMLDialogElement>(null),contentRef=useRef<HTMLElement>(null);
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
  sheetLocks.add(dialog);dialog.showModal();contentRef.current?.focus({preventScroll:true});
  return()=>{
   dialog.close();sheetLocks.delete(dialog);
   if(!sheetLocks.size){restoreSheetScroll?.();restoreSheetScroll=null;}
   if(prior?.isConnected)prior.focus({preventScroll:true});
  };
 },[]);
 return <dialog className="yu-backdrop" ref={dialogRef} aria-label={title} aria-modal="true" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} onClick={e=>{if(!busy&&e.target===e.currentTarget)onClose();}}><section className="yu-sheet" tabIndex={-1} ref={contentRef} aria-busy={busy}><div className="yu-handle"/><header><h2>{title}</h2><button className="yu-icon" disabled={busy} aria-label="关闭" onClick={onClose}><X size={21}/></button></header>{children}</section></dialog>;
}

