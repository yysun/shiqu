// 每次导出都重新读取作品和默认署名，未署名确认只对已展示的版本有效。
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type {Story} from '@/lib/content';
import {hasPublicationAuthor,publicationSchema,withPublicationDefaults} from '@/lib/story-publication';
import Sheet from './StorySheet';
import {request} from './shared';
import './story-publication.css';

export default function StoryExportControl({loadStory,format,disabled,busy,className,onExport,onEdit,children}:{loadStory:()=>Promise<Story|null>;format:'pdf'|'png'|'zip';disabled:boolean;busy:boolean;className:string;onExport:(story:Story)=>Promise<void>|void;onEdit?:(story:Story)=>void;children:ReactNode}){
 const [confirming,setConfirming]=useState<Story|null>(null),[checking,setChecking]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function start(allowUnsigned=false){
  if(disabled||lock.current)return;
  lock.current=true;setChecking(true);setError('');
  try{
   const story=await loadStory();
   if(!story||!live.current)return;
   const result=await request('reader/publication-defaults');
   if(!live.current)return;
   const defaults=result.publication===null?null:publicationSchema.parse(result.publication);
   const output=withPublicationDefaults(story,defaults);
   if((!allowUnsigned||confirming?.id!==output.id)&&!hasPublicationAuthor(output.publication)){setConfirming(story);return;}
   setConfirming(null);await onExport(output);
  }catch(error){if(live.current)setError(error instanceof Error?error.message:'署名说明暂时无法核对，请重试。');}
  finally{lock.current=false;if(live.current)setChecking(false);}
 }
 return <><button type="button" className={className} aria-busy={busy||checking} disabled={disabled||checking} onClick={()=>void start()}>{checking&&!busy?'正在核对署名…':children}</button>{error&&!confirming&&<p className="yu-export-credit-error" role="alert">{error}</p>}{confirming&&<Sheet title="作品还未署名" busy={checking} onClose={()=>setConfirming(null)}><div className="yu-export-confirmation"><p className="yu-publication-work">{confirming.title}</p><p>本次导出未设置制作署名，{format.toUpperCase()} 文件将显示「制作：未署名」。可以先填写署名，也可以确认继续。</p>{error&&<p role="alert">{error}</p>}<div className="yu-export-confirmation-actions">
  {onEdit&&<button type="button" className="yu-primary" disabled={disabled||checking} onClick={()=>{setConfirming(null);onEdit(confirming);}}>先填写署名</button>}
  <button type="button" className="yu-export-unsigned" disabled={disabled||checking} onClick={()=>void start(true)}>{checking?'正在核对署名…':'仍以未署名导出 '+format.toUpperCase()}</button>
  <button type="button" className="yu-revision-open" disabled={checking} onClick={()=>setConfirming(null)}>取消</button>
 </div></div></Sheet>}</>;
}
