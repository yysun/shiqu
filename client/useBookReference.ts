// Share one operation lock across page/story changes; stale reads and saves cannot light a new page.
// replacing 表示阅读页星标会用当前画幅替换本书已有的参考图。
import {useEffect,useRef,useState} from 'react';
import {request} from '@/lib/reader-request';
import type {BookReference} from '@/server/book-image-reference';
export function useBookReference(storyId:string|undefined,page:number,image:string|undefined,notify:(text:string)=>void){
 const [reference,setReference]=useState<BookReference|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const latest=useRef({storyId,page}),sequence=useRef(0),locked=useRef(false),mounted=useRef(true);
 latest.current={storyId,page};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
 useEffect(()=>{
  const serial=++sequence.current;setLoading(true);setReference(null);
  if(!storyId)return;
  void request('reader/library/'+encodeURIComponent(storyId)+'/reference').then(result=>{if(serial===sequence.current){setReference(result.reference);setLoading(false);}},()=>{if(serial===sequence.current){setLoading(true);notify('参考图状态暂时无法读取，翻页或重新打开可重试。');}});
  return()=>{sequence.current++;};
 },[storyId,page,refresh]); // notify is a render-local toast callback; it does not define identity.
 async function toggle(){
  if(!storyId||!image||loading||locked.current)return;
  locked.current=true;setBusy(true);sequence.current++;
  const selected=!!reference&&reference.storyId===storyId&&reference.page===page;
  try{
   const result=await request('reader/library/'+encodeURIComponent(storyId)+'/reference','POST',{page,starred:!selected,...(selected&&reference?{token:reference.token}:{})});
   if(mounted.current&&latest.current.storyId===storyId&&latest.current.page===page){setReference(result.reference);notify(selected?(result.reference?'本书参考图已更换，已同步最新星标。':'已取消本书参考图。'):'已设为本书参考图，同书后续生图会使用；每本书仅一幅。');}
  }catch(error){if(mounted.current)notify(error instanceof Error?error.message:'参考图暂未保存，请重试。');}
  finally{locked.current=false;if(mounted.current){setBusy(false);setRefresh(value=>value+1);}}
 }
 const selected=!!reference&&reference.storyId===storyId&&reference.page===page;
 return {selected,replacing:!!reference&&!selected,disabled:!image||loading,busy,toggle};
}
