'use client';
// Display saved full chapter context when available, retaining historical passage-only originals.
import {useEffect,useState} from 'react';
import {ArrowRight,BookOpen,Loader2,RefreshCw} from 'lucide-react';
import type {Story} from '@/lib/content';
import type {GeneratedStory} from '@/lib/reader-model';
import type {SourceResult} from '@/lib/reader-source-types';
import {request} from './shared';

type Props=({story:Story;sessionId?:never}|{story?:never;sessionId:string})&{book:string};
export default function StorySource({story,sessionId,book}:Props){
 const generated=!story||'generated'in story&&story.generated===true,id=story?.id||sessionId,sourceText=story?.sourceText||'';
 const [result,setResult]=useState<SourceResult|null>(null),[loading,setLoading]=useState(generated&&!sourceText),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{
  if(!generated||sourceText)return;
  let cancelled=false;setLoading(true);setError('');setResult(null);
  request('reader/sessions/'+id+'/source').then((data:SourceResult)=>{if(!cancelled)setResult(data);}).catch(()=>{if(!cancelled)setError('原文暂时没有加载出来，请重试。');}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[id,generated,sourceText]);
 async function saveOriginal(){
  setLoading(true);setSaving(true);setError('');
  try{setResult(await request('reader/sessions/'+id+'/source',story?'POST':'GET'));}
  catch(e){setError(e instanceof Error?e.message:story?'原文暂时没有保存成功，请重试。':'原文暂时没有加载出来，请重试。');}
  finally{setLoading(false);setSaving(false);}
 }
 const original=(story&&generated?(story as GeneratedStory).original:undefined)||result?.source;
 const text=original?.chapterContext?.text||sourceText||original?.text||'';
 const reference=story&&generated?(story as GeneratedStory).sourceReference:'';
 const adaptation=(story?.adaptationNote||'确认制作后，基于已保存的原文进行改编。').replace('；当前可使用设备朗读试听。','。');
 return <><div className="yu-source-heading"><BookOpen size={24}/><div><h3>{original?.chapterContext?.title||original?.title||book||'故事出处'}</h3><p>{original?.chapterContext?'完整原典章节 · 可上下滚动阅读':original?.kind==='chapter'?'原典章节节选 · 可上下滚动阅读':text?'原文节选':'故事原文'}</p></div></div>
 {loading?<div className="yu-source-status" role="status"><Loader2 size={19} className="spin"/>{saving&&story?'正在保存原文…':'正在加载已保存的原文…'}</div>:text?<p className="yu-original">{text}</p>:<div className="yu-source-status" role="status"><p>{error||result?.message||'这篇故事暂未找到可核对的原文。'}</p><button onClick={saveOriginal}><RefreshCw size={15}/>{story?'补全并保存原文':'重新加载原文'}</button></div>}
 {(story?.sourceUrl||original?.url)&&<a className="yu-source-link" href={story?.sourceUrl||original?.url} target="_blank" rel="noreferrer">查看原典出处{original?.provider?' · '+original.provider:''}<ArrowRight size={16}/></a>}
 {original&&<p className="yu-source-reference">{original.localSource?'已核对本地篇章范围，原文已随故事保存。':'原文已随故事保存，可随时回看。'}</p>}
 {!loading&&!text&&result?.searchUrl&&<a className="yu-source-link" href={result.searchUrl} target="_blank" rel="noreferrer">查找原典出处<ArrowRight size={16}/></a>}
 {reference&&!text&&<p className="yu-source-reference">原典线索：{reference}</p>}
 {original?.kind==='chapter'&&<p className="yu-source-reference">此处展示对应章节的节选，可能包含同章其他故事；完整内容可查看原典出处。</p>}
 <h3 className="yu-adaptation-heading">关于这次改编</h3><p className="yu-adaptation">{original?adaptation.replace('；原典线索由模型提供，尚未逐条核验。','；原文节选与改编内容分开保存。'):adaptation}</p></>;
}
