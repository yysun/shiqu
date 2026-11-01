// Save a display name independently of the story revision and production flows.
import {useRef,useState} from 'react';
import {displayTitleSchema} from '@/lib/reader-model';
import Sheet from './StorySheet';

export default function StoryTitleEditor({title,onSave,onClose}:{title:string;onSave:(title:string)=>Promise<void>;onClose:()=>void}){
 const [name,setName]=useState(title),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 const parsed=displayTitleSchema.safeParse(name);
 async function save(){
  if(lock.current||!parsed.success||parsed.data===title)return;
  lock.current=true;setBusy(true);setError('');
  try{await onSave(parsed.data);onClose();}
  catch(e){setError(e instanceof Error?e.message:'故事名暂未保存，请重试。');}
  finally{lock.current=false;setBusy(false);}
 }
 return <Sheet title="修改故事名" busy={busy} onClose={onClose}>
  <form onSubmit={event=>{event.preventDefault();void save();}}>
   <label className="yu-custom-input">故事名<input autoFocus maxLength={40} value={name} disabled={busy} onChange={event=>{setName(event.target.value);setError('');}}/></label>
   <p className="yu-count-help">最多 40 字，保存后更新故事名。</p>
   {error&&<p role="alert">{error}</p>}
   <div className="yu-revision-buttons"><button type="submit" className="yu-primary" disabled={busy||!parsed.success||parsed.data===title}>{busy?'正在保存…':'保存故事名'}</button><button type="button" disabled={busy} onClick={onClose}>取消</button></div>
  </form>
 </Sheet>;
}
