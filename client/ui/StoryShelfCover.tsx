// 书架封面可以采用已保存的画幅或本地图片。编辑器只提交展示设置。
import {useRef,useState} from 'react';
import type {Story} from '@/lib/content';
import {shelfCoverMaxBytes} from '@/lib/reader-image-assets';
import Sheet from './StorySheet';
import {request} from './shared';

type Choice={type:'default'}|{type:'frame';index:number;image:string}|{type:'upload';file:File};
export default function StoryShelfCover({story,cover,onSaved,onClose}:{story:Story;cover?:string;onSaved:(cover:string|null)=>void;onClose:()=>void}){
 const [choice,setChoice]=useState<Choice|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),uploadInput=useRef<HTMLInputElement>(null);
 function chooseSaved(choice:Exclude<Choice,{type:'upload'}>){
  if(uploadInput.current)uploadInput.current.value='';
  setChoice(choice);setError('');
 }
 async function save(){
  if(lock.current||!choice)return;
  lock.current=true;setSaving(true);setError('');
  try{
   let input:FormData|{expected:string|null;frame?:{page:number;image:string}};
   if(choice.type==='upload'){
    input=new FormData();input.append('cover',choice.file);input.append('expected',cover??'');
   }else{
    input={expected:cover??null,...(choice.type==='frame'?{frame:{page:choice.index,image:choice.image}}:{})};
   }
   const result:{cover:string|null}=await request(`reader/sessions/${story.id}/shelf-cover`,'POST',input);
   onSaved(result.cover);onClose();
  }catch(error){setError(error instanceof Error?error.message:'书架封面暂未保存，请重试。');}
  finally{lock.current=false;setSaving(false);}
 }
 return <Sheet title="修改书架封面" busy={saving} onClose={onClose}>
  <form data-dirty={choice?'true':undefined} onSubmit={event=>{event.preventDefault();void save();}}>
   <label className="yu-custom-input">上传封面图片<input ref={uploadInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={saving} onChange={event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    setError('');
    if(!file.size||file.size>shelfCoverMaxBytes){setChoice(null);setError('请选择不超过 12 MiB 的图片。');return;}
    setChoice({type:'upload',file});
   }}/></label>
   {choice?.type==='upload'&&<p className="yu-count-help">待保存：{choice.file.name}</p>}
   <fieldset className="yu-cover-options" aria-label="选用已生成的画幅" disabled={saving}>
    {story.pages.map(({image},index)=>image&&<label key={index}><img src={image} alt="" loading="lazy" decoding="async"/>
     <span><input type="radio" name="shelf-cover-frame" checked={choice?.type==='frame'&&choice.index===index} onChange={()=>chooseSaved({type:'frame',index,image})}/>第 {index+1} 幅</span>
    </label>)}
   </fieldset>
   {cover&&<label className="yu-custom-input"><span><input type="radio" name="shelf-cover-frame" checked={choice?.type==='default'} disabled={saving} onChange={()=>chooseSaved({type:'default'})}/>使用首幅默认封面</span></label>}
   {error&&<p role="alert">{error}</p>}
   <div className="yu-revision-buttons"><button type="submit" className="yu-primary" disabled={saving||!choice}>{saving?'正在保存…':'保存书架封面'}</button><button type="button" disabled={saving} onClick={onClose}>取消</button></div>
  </form>
 </Sheet>;
}
