// 本地 Ollama 设置与生成模型分开；逐书显示建库进度，并在关闭界面时停止任务。
import {useEffect,useRef,useState} from 'react';
import {Loader2,RefreshCw,Save} from 'lucide-react';
import {request} from './shared';
import './StoryEmbeddingSettings.css';

type Settings={baseUrl:string;model:string;enabled:boolean};
type Status={settings:Settings;available:boolean;error:string;models:string[];model:{name:string;digest:string;dimensions:number;modifiedAt:string}|null;catalog:{id:string;title:string}[];books:{id:string;cardCount:number;indexedCount:number;ready:boolean;reason:string}[]};
type Progress={id:string;completed:number;total:number;title:string};

export default function StoryEmbeddingSettings(){
 const [state,setState]=useState<Status|null>(null),[draft,setDraft]=useState<Settings|null>(null),[selected,setSelected]=useState('liaozhai');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[progress,setProgress]=useState<Progress|null>(null);
 const abort=useRef<AbortController|null>(null),live=useRef(true);
 async function load(){setLoading(true);setError('');try{const value:Status=await request('reader/books/embedding-settings');if(live.current){setState(value);setDraft(value.settings);}}catch(reason){if(live.current)setError(reason instanceof Error?reason.message:'暂时无法读取嵌入设置。');}finally{if(live.current)setLoading(false);}}
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;abort.current?.abort();};},[]);
 function update<K extends keyof Settings>(key:K,value:Settings[K]){setDraft(old=>old?{...old,[key]:value}:null);setMessage('');}
 const dirty=!!draft&&!!state&&JSON.stringify(draft)!==JSON.stringify(state.settings);
 async function save(){if(!draft)return false;setBusy(true);setError('');setMessage('');try{await request('reader/books/embedding-settings','POST',{settings:draft});await load();setMessage('嵌入设置已保存。');return true;}catch(reason){setError(reason instanceof Error?reason.message:'设置未能保存。');return false;}finally{setBusy(false);}}
 async function test(){setBusy(true);setError('');setMessage('');try{const result=await request('reader/books/embedding-test','POST',{settings:draft});setState(old=>old?{...old,models:result.models||[]}:old);setMessage(result.model?`连接成功 · ${result.model} · ${result.dimensions} 维`: `Ollama 已连接；所选模型未找到。可用 Embedding 模型：${result.models?.join('、')||'无'}`);}catch(reason){setError(reason instanceof Error?reason.message:'连接失败。');}finally{setBusy(false);}}
 async function build(id:string){
  if(dirty&&!(await save()))return;setBusy(true);setError('');setMessage('');setProgress({id,completed:0,total:0,title:''});const controller=new AbortController();abort.current=controller;
  try{
   const response=await fetch(`/api/reader/books/${encodeURIComponent(id)}/embedding-index`,{method:'POST',signal:controller.signal});
   if(!response.ok)throw Error((await response.json()).error||'建库请求失败。');
   if(!response.body)throw Error('浏览器无法读取建库进度。');
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
   while(true){const {done,value}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop()||'';
    for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);
     if(event.type==='progress')setProgress({id,completed:event.completed,total:event.total,title:event.title});
     else if(event.type==='error')throw Error(event.error);
     else if(event.type==='complete')setMessage(`建库完成 · ${event.indexed} 张故事卡`);
    }
    if(done)break;
   }
   await load();
  }catch(reason){if(!(reason instanceof Error&&reason.name==='AbortError'))setError(reason instanceof Error?reason.message:'建库失败，请重试。');else setMessage('已取消建库；已完成的旧索引保持不变。');}
  finally{abort.current=null;setProgress(null);setBusy(false);}
 }
 const readyById=new Map(state?.books.map(book=>[book.id,book])||[]);
 return <section className="yu-embedding-settings" aria-label="嵌入模型设置" aria-busy={loading}>
  <p className="yu-sheet-intro">用本机 Ollama 为故事卡建库。向量只用于找候选，原文和出处仍由书库核对。</p>
  {loading&&!state?<p role="status">正在读取嵌入设置…</p>:null}
  {draft&&<>
   <label className="yu-embedding-field">Ollama 服务地址<input value={draft.baseUrl} disabled={busy} onChange={event=>update('baseUrl',event.target.value)} placeholder="http://127.0.0.1:11434"/></label>
   <label className="yu-embedding-field">Embedding 模型<select value={draft.model} disabled={busy} onChange={event=>update('model',event.target.value)}>{!state?.models.includes(draft.model)&&<option value={draft.model}>{draft.model}（当前选择）</option>}{(state?.models||[]).map(model=><option value={model} key={model}>{model}</option>)}</select></label>
   <label className="yu-embedding-toggle"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event=>update('enabled',event.target.checked)}/><span>开启故事卡向量检索</span></label>
   <div className="yu-embedding-runtime" role="status"><span className={state?.available?'ok':'warn'}>{state?.available?'模型可用':'模型不可用'}</span><span>{state?.model?`${state.model.name} · ${state.model.dimensions} 维`:'尚未确认模型身份'}</span>{state?.error&&<small>{state.error}</small>}</div>
   <div className="yu-embedding-actions"><button type="button" className="yu-embedding-secondary" disabled={busy} onClick={()=>void test()}>{busy?<Loader2 size={15}/>:<RefreshCw size={15}/>}测试连接</button>{dirty&&<button type="button" className="yu-primary" disabled={busy} onClick={()=>void save()}><Save size={15}/>保存设置</button>}</div>
  </>}
  <h3>故事卡索引</h3><p className="yu-embedding-note">建库按书进行；改模型、原文版次或卡片内容后，只需更新受影响的书。</p>
  <div className="yu-embedding-books">{(state?.catalog||[]).map(book=>{const indexed=readyById.get(book.id),active=progress?.id===book.id;return <article key={book.id}>
   <div><strong>{book.title}</strong><span>{indexed?.ready?`已覆盖 ${indexed.indexedCount} 张`:indexed?.reason||'未覆盖'}</span>{active&&<small role="status">{progress!.total?`正在处理 ${progress!.completed}/${progress!.total} · ${progress!.title}`:'正在准备建库…'}</small>}</div>
   <button type="button" disabled={busy||loading||!draft?.enabled} onClick={()=>active?abort.current?.abort():void build(book.id)}>{active?'取消':indexed?.ready?'更新这本书':'开始建库'}</button>
  </article>})}</div>
  {(error||message)&&<p className={error?'yu-embedding-error':'yu-embedding-success'} role={error?'alert':'status'}>{error||message}</p>}
  <p className="yu-embedding-note">未配置模型、模型不可用或索引待更新时，仍可按标题、故事卡文字和原文查找。</p>
 </section>;
}
