// Edit owner defaults and independent story snapshots; render public notices as untrusted text.
// 编辑器有未保存更改时表单带 data-dirty，返回或 Escape 关闭前先询问。
import {useEffect,useRef,useState} from 'react';
import type {Story} from '@/lib/content';
import {aiDisclosure,emptyPublication,generationModelNames,hasPublicationAuthor,publicationSchema,rightsBoundary,watermarkFontSize,withPublicationDefaults} from '@/lib/story-publication';
import type {StoryPublication} from '@/lib/story-publication';
import Sheet from './StorySheet';
import {request} from './shared';
import './story-publication.css';

type PublicationDetailsStory=Story&{generated?:boolean;generationModels?:{step:string;model:string}[]};

export function GenerationModelsDetails({story}:{story:PublicationDetailsStory}){
 if(story.generated!==true)return null;
 const textModels=generationModelNames(story.generationModels,'text').join('、')||'未记录',imageModels=generationModelNames(story.generationModels,'image').join('、')||'未记录';
 return <div className="yu-generation-models" aria-label="生成模型"><p>文本生成模型：{textModels}</p><p>图像生成模型：{imageModels}</p></div>;
}

export function StoryPublicationDetails({story}:{story:PublicationDetailsStory}){
 const p=story.publication;
 return <section className="yu-publication" aria-label="署名与转载"><h3>署名与转载</h3><p>制作：{p?.author||'未署名'}</p><p>{aiDisclosure(story)}</p><GenerationModelsDetails story={story}/>{p?.workUrl&&<p>作品链接：{p.workUrl}</p>}{p?.contact&&<p>联系：{p.contact}</p>}{p?.sourceNote&&<p>来源与许可：{p.sourceNote}</p>}<p>转载与再使用：{p?.reuse||'未另行提供授权；请先核对来源许可，必要时联系相应权利人。'}</p><small>{rightsBoundary}</small></section>;
}

export function StoryPublicationSummary({story,onEdit,disabled=false}:{story:Story;onEdit?:()=>void;disabled?:boolean}){
 const needsDefaults='generated'in story&&story.generated===true&&!hasPublicationAuthor(story.publication);
 const [current,setCurrent]=useState<{storyId:string;publication:StoryPublication|null;loading:boolean;error:boolean}>({storyId:'',publication:null,loading:true,error:false}),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!needsDefaults)return;
  let live=true,read=0;
  async function refresh(){
   const attempt=++read;setCurrent({storyId:story.id,publication:null,loading:true,error:false});
   try{
    const result=await request('reader/publication-defaults'),publication=result.publication===null?null:publicationSchema.parse(result.publication);
    if(live&&attempt===read)setCurrent({storyId:story.id,publication,loading:false,error:false});
   }catch{if(live&&attempt===read)setCurrent({storyId:story.id,publication:null,loading:false,error:true});}
  }
  const focus=()=>{void refresh();},visible=()=>{if(document.visibilityState==='visible')void refresh();};
  void refresh();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visible);
  return()=>{live=false;window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible);};
 },[story.id,needsDefaults,retry]);
 const loading=needsDefaults&&(current.storyId!==story.id||current.loading),error=needsDefaults&&current.storyId===story.id&&current.error;
 const publication=withPublicationDefaults(story,current.publication).publication;
 const author=loading?'正在读取署名…':error?'暂时无法读取':hasPublicationAuthor(publication)?publication!.author:'未署名';
 return <div className="yu-publication-summary" aria-busy={loading}><p aria-live="polite">制作：{author}</p>{error&&<button type="button" className="yu-revision-open" onClick={()=>setRetry(value=>value+1)}>重新读取署名</button>}{onEdit&&<button type="button" className="yu-revision-open" disabled={disabled} onClick={onEdit}>编辑署名与转载说明</button>}</div>;
}

export function StoryPublicationDefaults({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){
 const [loaded,setLoaded]=useState(false),[publication,setPublication]=useState<StoryPublication|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let live=true;setError('');
  request('reader/publication-defaults').then(result=>{if(live){setPublication(result.publication);setLoaded(true);}}).catch(error=>{if(live)setError(error instanceof Error?error.message:'默认说明暂时无法读取，请重试。');});
  return()=>{live=false;};
 },[retry]);
 if(!loaded)return <Sheet title="默认署名与转载说明" onClose={onClose}>{error?<div className="yu-batch-error" role="alert">{error}<button type="button" className="yu-revision-open" onClick={()=>setRetry(value=>value+1)}>重新加载</button></div>:<p role="status">正在读取默认说明…</p>}</Sheet>;
 return <StoryPublicationEditor publication={publication} onClose={onClose} onSave={async(value,expected)=>{await request('reader/publication-defaults','POST',{publication:value,expected});onSaved();}}/>;
}

export default function StoryPublicationEditor({story,publication=null,onSave,onClose}:{story?:Story;publication?:StoryPublication|null;onSave:(value:StoryPublication,expected:StoryPublication|null)=>Promise<void>;onClose:()=>void}){
 const [initial]=useState(story?.publication??publication),[draft,setDraft]=useState<StoryPublication>(initial||{...emptyPublication});
 const [busy,setBusy]=useState(false),[restoring,setRestoring]=useState(false),[error,setError]=useState(''),[restoreNote,setRestoreNote]=useState('');const lock=useRef(false);
 const parsed=publicationSchema.safeParse(draft),changed=JSON.stringify(parsed.success?parsed.data:draft)!==JSON.stringify(initial||emptyPublication);
 async function save(){
  if(lock.current||!parsed.success||!changed)return;
  lock.current=true;setBusy(true);setError('');
  try{await onSave(parsed.data,initial);onClose();}catch(e){setError(e instanceof Error?e.message:'署名说明暂未保存，请重试。');}finally{lock.current=false;setBusy(false);}
 }
 async function restoreDefaults(){
  if(!story||lock.current)return;
  lock.current=true;setBusy(true);setRestoring(true);setError('');setRestoreNote('');
  try{
   const result=await request('reader/publication-defaults');
   setDraft(publicationSchema.parse(result.publication??emptyPublication));
   setRestoreNote(result.publication?'已载入「我的」中的当前默认说明，保存后应用于本篇。':'「我的」尚未设置默认说明，已载入空白说明，保存后应用于本篇。');
  }catch(e){setError(e instanceof Error?e.message:'默认说明暂时无法读取，请重试。');}
  finally{lock.current=false;setBusy(false);setRestoring(false);}
 }
 function field(key:Exclude<keyof StoryPublication,'watermarkFontSize'>,label:string,maxLength:number,placeholder:string,multiline=false){
  const props={value:draft[key],maxLength,placeholder,disabled:busy,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{setDraft(old=>({...old,[key]:event.target.value}));setError('');}};
  return <label className="yu-custom-input">{label}{multiline?<textarea rows={3} {...props}/>:<input {...props}/>}</label>;
 }
 return <Sheet title={story?'署名与转载':'默认署名与转载说明'} onClose={onClose} busy={busy}><form className="yu-publication-editor" data-dirty={changed?'true':undefined} onSubmit={event=>{event.preventDefault();void save();}}>
  {story&&<div className="yu-publication-heading"><p className="yu-publication-work">{story.title}</p><button type="button" className="yu-revision-open" disabled={busy} onClick={()=>void restoreDefaults()}>{restoring?'正在读取默认…':'恢复默认说明'}</button></div>}
  {restoreNote&&<p className="yu-count-help" role="status">{restoreNote}</p>}
  <p className="yu-count-help">{story?'仅修改这篇作品。导出时已填写的内容优先，留空项实时沿用「我的」默认说明。':'新故事会保存这份默认说明。导出时，单篇未填写的项目也会实时沿用这里的内容；单篇已填写的内容优先。'}</p>
  <p className="yu-count-help">这些信息会随作品和下载文件公开。填写用于公开展示的署名与联系方式。</p>
  {field('author','制作署名',80,'你的姓名、笔名或团队名，如：山间读书人')}
  <label className="yu-watermark-size"><span>WebP 签名水印字号<output>{draft.watermarkFontSize??watermarkFontSize.default} px</output></span><input type="range" aria-label="WebP 签名水印字号" min={watermarkFontSize.min} max={watermarkFontSize.max} step={1} value={draft.watermarkFontSize??watermarkFontSize.default} disabled={busy} onChange={event=>{setDraft(old=>({...old,watermarkFontSize:Number(event.target.value)}));setError('');}}/><small>按原图像素计算，{watermarkFontSize.min}–{watermarkFontSize.max} px，默认 {watermarkFontSize.default} px。仅影响 ZIP 内的 WebP 图片。</small></label>
  {field('workUrl','公开作品链接',1000,'作品页或个人主页，如：https://example.com')}
  {field('contact','公开联系方式',200,'供读者联系的邮箱或公开账号（选填）')}
  {field('sourceNote','来源版本与许可说明',1200,'填写原文出处、所用版本和许可；如使用他人译文，也请注明来源。',true)}
  {field('reuse','转载与再使用条件',1200,'例如：转载时请注明制作人并附作品链接；其他使用请先联系。',true)}
  <p className="yu-count-help">原作出处和 AI 生成说明会自动保留。这里只声明你有权决定的部分；公版材料和已有许可按各自规则使用。{story?'保存不会重新生成故事。':'作品链接、来源版本与许可因篇而异时，请在单篇中修改。'}</p>
  {(!parsed.success||error)&&<p role="alert">{error||parsed.error?.issues[0].message}</p>}
  <div className="yu-revision-buttons"><button className="yu-primary" type="submit" disabled={busy||!parsed.success||!changed}>{restoring?'正在读取默认…':busy?'正在保存…':story?'保存本篇说明':'保存默认说明'}</button><button type="button" disabled={busy} onClick={onClose}>取消</button></div>
 </form></Sheet>;
}
