// 自备书从原件、结构确认到故事卡生成的工作流。
import {useEffect,useState} from 'react';
import {Check,Loader2,Plus,RefreshCw,Trash2,Upload} from 'lucide-react';
import {request} from './shared';
import './BookImport.css';

type Chapter={sourceIndex:number;block:number;title:string;excluded:boolean;chars:number;excerpt:string;quality:{empty:boolean;short:boolean;unreadableUnits:number;missingMarkers:number};flaggedUnits:{id:string;text:string;flags:string[]}[]};
type Preview={manifest:{bookId:string;title:string;sources:{originalName:string;sourceUrl?:string}[];quality:{emptySections:number;shortSections:number;unreadableUnits:number;missingMarkers:number}};chapters:Chapter[]};
type CardProgress={status:'pending'|'running'|'paused'|'complete'|'failed';calls:number;chapters:{status:'pending'|'running'|'done'|'failed'}[]};
type ImportedBook={id:string;title:string;author:string;era:string;status:string;sources:number;chapters:number;progress?:CardProgress|null;progressError?:boolean};
type TextEncoding='auto'|'utf-8'|'gb18030'|'big5';
type Props={onClose:()=>void;onComplete:(id:string)=>void};
const qualityLabels:Record<string,string>={'invalid-text':'不完整字符','unreadable-glyph':'无法识别的字形或非中文字符','unresolved-entity':'未解析实体','component-layout':'拆字描述','editorial-omission':'编者缺文说明','missing-marker':'缺文标记'};
async function api<T>(route:string,method='GET',value?:unknown){return await request('reader/'+route,method,value) as T;}
function uploadHeaders(file:File,encoding:TextEncoding){const textSource=/\.(?:txt|html?|htm)$/i.test(file.name)||['text/plain','text/html'].includes(file.type);return {'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name),...(textSource&&encoding!=='auto'?{'X-Text-Encoding':encoding}:{})};}
function cardProgressLabel(book:ImportedBook){
 if(book.progressError)return '故事卡进度暂不可用';
 if(!book.progress)return '尚未生成故事卡';
 const done=book.progress.chapters.filter(chapter=>chapter.status==='done').length,label=({pending:'尚未生成',running:'正在生成',paused:'已暂停',complete:'全部完成',failed:'部分失败'} as const)[book.progress.status];
 return `${label} · ${done}/${book.progress.chapters.length} 章`;
}
function EncodingChoice({value,onChange}:{value:TextEncoding;onChange:(value:TextEncoding)=>void}){return <label className="yu-book-import-encoding">TXT 或网页编码<select aria-label="TXT 或网页编码" value={value} onChange={event=>onChange(event.target.value as TextEncoding)}><option value="auto">自动判断</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="big5">Big5</option></select><small>自动判断不确定时，可选择原文编码后重试。</small></label>;}

export default function BookImport({onClose,onComplete}:Props){
 const [title,setTitle]=useState(''),[author,setAuthor]=useState(''),[era,setEra]=useState(''),[sourceNote,setSourceNote]=useState(''),[license,setLicense]=useState(''),[rights,setRights]=useState(false),[urls,setUrls]=useState(''),[files,setFiles]=useState<File[]>([]),[encoding,setEncoding]=useState<TextEncoding>('auto');
 const [draft,setDraft]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[estimate,setEstimate]=useState<any>(null),[progress,setProgress]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[books,setBooks]=useState<ImportedBook[]>([]),[replaceTarget,setReplaceTarget]=useState<ImportedBook|null>(null),[confirmAction,setConfirmAction]=useState<{kind:'replace'|'delete';book:ImportedBook}|null>(null);
 async function refreshBooks(){try{const result=await api<{books:ImportedBook[]}>('books/imported'),updated=await Promise.all((result.books||[]).map(async book=>{if(book.status!=='ready')return book;try{const value=await api<{progress:CardProgress|null}>(`books/imported/${book.id}/cards`);return {...book,progress:value.progress};}catch{return {...book,progressError:true};}}));setBooks(updated);}catch(reason){setError(reason instanceof Error?reason.message:'无法读取本地导入书。');}}
 useEffect(()=>{void refreshBooks();},[]);
 function updateChapter(index:number,change:Partial<Chapter>){setPreview(old=>old?{...old,chapters:old.chapters.map((chapter,i)=>i===index?{...chapter,...change}:chapter)}:old);}
 async function loadPreview(id:string){const next=await api<Preview>(`books/imported/${id}/structure`);setPreview(next);}
 async function openBook(book:ImportedBook){setBusy(true);setError('');setMessage('');try{const [manifest,cards]=await Promise.all([api<Preview['manifest']>(`books/imported/${book.id}`),api<{progress:CardProgress|null}>(`books/imported/${book.id}/cards`)]);setDraft(book.id);setTitle(manifest.title);setPreview({manifest,chapters:[]});setProgress(cards.progress);setEstimate(null);setReady(true);setReplaceTarget(null);setConfirmAction(null);}catch(reason){setError(reason instanceof Error?reason.message:'无法读取故事卡进度。');}finally{setBusy(false);}}
 async function performConfirmedAction(){if(!confirmAction)return;const action=confirmAction;setBusy(true);setError('');setMessage('');try{if(action.kind==='delete'){await api(`books/imported/${action.book.id}`,'DELETE');await refreshBooks();setMessage(`《${action.book.title}》及其故事卡与索引已删除。`);setConfirmAction(null);}else{const manifest=await api<{title:string;author?:string;era?:string;sourceNote?:string;license?:string}>(`books/imported/${action.book.id}`);setReplaceTarget(action.book);setTitle(manifest.title||action.book.title);setAuthor(manifest.author||'');setEra(manifest.era||'');setSourceNote(manifest.sourceNote||'');setLicense(manifest.license||'');setRights(false);setUrls('');setFiles([]);setError('');setMessage('');setConfirmAction(null);}}catch(reason){setError(reason instanceof Error?reason.message:'操作失败。');}finally{setBusy(false);}}
 async function close(){if(draft&&!ready)await api(`books/imports/${draft}`,'DELETE').catch(()=>{});onClose();}
 async function startImport(event:React.FormEvent){event.preventDefault();if(!rights)return;setBusy(true);setError('');setMessage('');
  try{
   const body={title:title.trim(),author,era,sourceNote,license,acceptRights:true,...(urls.trim()?{urls:urls.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),...(encoding!=='auto'?{encoding}:{})}:{})};
   const result=await api<{draft:{id:string}}> ('books/imports','POST',body);let id=result.draft.id;setDraft(id);
   for(const file of files){const response=await fetch(`/api/reader/books/imports/${encodeURIComponent(id)}/files`,{method:'POST',headers:uploadHeaders(file,encoding),body:file});const value=await response.json();if(!response.ok)throw Error(value.error||'文件导入失败。');setFiles(current=>current.filter(item=>item!==file));}
   await loadPreview(id);setMessage('原文已导入。请检查自动识别的章节，再确认书目。');
  }catch(reason){setError(reason instanceof Error?reason.message:'导入失败，请检查文件或网页地址。');}
  finally{setBusy(false);}
 }
 async function saveStructure(){if(!draft||!preview)return;setBusy(true);setError('');try{const value=await api<Preview>(`books/imported/${draft}/structure`,'PUT',{chapters:preview.chapters.map(({sourceIndex,block,title,excluded})=>({sourceIndex,block,title,excluded}))});setPreview(value);setMessage('章节结构已保存。');}catch(reason){setError(reason instanceof Error?reason.message:'结构未能保存。');}finally{setBusy(false);}}
 async function confirmBook(){if(!draft)return;setBusy(true);setError('');try{const result=replaceTarget?await api<{id:string}>(`books/imported/${replaceTarget.id}/replace`,'POST',{draftId:draft}):await api<{id:string}>(`books/imported/${draft}/confirm`,'POST',{});setDraft(result.id);setReady(true);setReplaceTarget(null);await Promise.all([loadCards(result.id),refreshBooks()]);setMessage('书目已加入本地书库。');}catch(reason){setError(reason instanceof Error?reason.message:'确认失败，请检查章节结构。');}finally{setBusy(false);}}
 async function loadCards(id=draft){if(!id)return;try{const value=await api<{progress:CardProgress|null;cards:any}>(`books/imported/${id}/cards`);setProgress(value.progress);}catch(reason){setError(reason instanceof Error?reason.message:'无法读取故事卡进度。');}}
 async function getEstimate(){setBusy(true);setError('');try{setEstimate(await api(`books/imported/${draft}/cards/estimate`));}catch(reason){setError(reason instanceof Error?reason.message:'暂时无法估算故事卡任务。');}finally{setBusy(false);}}
 async function generate(retryFailed=false){setBusy(true);setError('');setMessage('');setProgress((old:any)=>old?{...old,status:'running'}:old);
  try{
   const response=await fetch(`/api/reader/books/${encodeURIComponent('imported')}/${encodeURIComponent(draft)}/cards`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({retryFailed})});
   if(!response.ok)throw Error((await response.json()).error||'故事卡任务未能开始。');if(!response.body)throw Error('浏览器无法读取任务进度。');
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
   while(true){const {done,value}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop()||'';
    for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);if(event.type==='progress')setProgress(event.progress);else if(event.type==='complete'){setProgress(event.progress);setMessage('故事卡生成完成，可按故事或按主题检索。');}else if(event.type==='error')throw Error(event.error);}
    if(done)break;
   }
  }catch(reason){setError(reason instanceof Error?reason.message:'故事卡生成失败，请重试。');await loadCards();}finally{setBusy(false);}
 }
 async function cancel(){if(!draft)return;try{await api(`books/imported/${draft}/cards/cancel`,'POST',{});await loadCards();setMessage('任务已暂停，已完成的章节保留。');}catch(reason){setError(reason instanceof Error?reason.message:'取消失败。');}}
 async function addSources(){if(!draft||!files.length)return;setBusy(true);setError('');try{for(const file of files){const response=await fetch(`/api/reader/books/imports/${encodeURIComponent(draft)}/files`,{method:'POST',headers:uploadHeaders(file,encoding),body:file});const value=await response.json();if(!response.ok)throw Error(value.error||'文件导入失败。');setFiles(current=>current.filter(item=>item!==file));}setFiles([]);await loadPreview(draft);}catch(reason){setError(reason instanceof Error?reason.message:'添加原文失败。');}finally{setBusy(false);}}
 const chapters=preview?.chapters||[],available=chapters.filter(chapter=>!chapter.excluded).length,failed=progress?.chapters?.some((chapter:any)=>chapter.status==='failed'),activeQuality=chapters.filter(chapter=>!chapter.excluded).reduce((result,chapter)=>({emptySections:result.emptySections+Number(chapter.quality.empty),shortSections:result.shortSections+Number(chapter.quality.short),unreadableUnits:result.unreadableUnits+chapter.quality.unreadableUnits,missingMarkers:result.missingMarkers+chapter.quality.missingMarkers}),{emptySections:0,shortSections:0,unreadableUnits:0,missingMarkers:0});
 return <section className="yu-book-import" aria-label="导入自备书">
  {!draft?<>
   <section className="yu-book-import-library" aria-label="已导入的书">
    <header><h3>已导入的书</h3><span>{books.length} 本</span></header>
    {books.length?books.map(book=><article key={book.id}>
     <div><strong>{book.title}</strong><small>{book.status==='ready'?`${book.chapters} 章 · ${book.sources} 个来源${book.author?` · ${book.author}`:''}`:'书目暂不可用'}</small>{book.status==='ready'&&<small>{cardProgressLabel(book)}</small>}</div>
     <button type="button" disabled={busy||book.status!=='ready'} onClick={()=>void openBook(book)}>故事卡</button><button type="button" disabled={busy||book.status!=='ready'} onClick={()=>setConfirmAction({kind:'replace',book})}>重新导入</button><button type="button" disabled={busy} onClick={()=>setConfirmAction({kind:'delete',book})}>删除</button>
    </article>):<p className="yu-book-import-note">尚无导入书。添加后可用于故事制作和本地检索。</p>}
    {confirmAction&&<div className="yu-book-import-confirm" role="group" aria-label={confirmAction.kind==='delete'?'确认删除导入书':'确认重新导入'}>
     <p>{confirmAction.kind==='delete'?`删除《${confirmAction.book.title}》会移除原文、故事卡、向量和抽取缓存。`:`重新导入《${confirmAction.book.title}》会在新结构确认后替换当前版次；唯一且未变的章节故事卡会保留。`}</p>
     <button type="button" disabled={busy} onClick={()=>setConfirmAction(null)}>取消</button><button type="button" disabled={busy} onClick={()=>void performConfirmedAction()}>{confirmAction.kind==='delete'?'确认删除':'继续重新导入'}</button>
    </div>}
   </section>
   {replaceTarget&&<p className="yu-book-import-note">正在准备替换《{replaceTarget.title}》。确认新章节结构后才会替换原书。<button type="button" onClick={()=>{setReplaceTarget(null);setTitle('');setAuthor('');setEra('');setSourceNote('');setLicense('');setRights(false);}}>取消重新导入</button></p>}
   <form onSubmit={startImport}>
   <p className="yu-book-import-intro">把你有权使用的 TXT、HTML、EPUB 或公开网页加入本地书库。原文只保存在此设备的书库目录中。</p>
   <label>书名<input required maxLength={100} value={title} onChange={event=>setTitle(event.target.value)}/></label>
   <div className="yu-book-import-row"><label>作者<input maxLength={100} value={author} onChange={event=>setAuthor(event.target.value)}/></label><label>年代<input maxLength={100} value={era} onChange={event=>setEra(event.target.value)}/></label></div>
   <label>来源说明<textarea maxLength={1000} value={sourceNote} onChange={event=>setSourceNote(event.target.value)} placeholder="版本、出版社或网页来源"/></label>
   <label>授权说明<textarea maxLength={1000} value={license} onChange={event=>setLicense(event.target.value)} placeholder="例如：公版文本；个人使用许可；版权所有者授权"/></label>
   <label>公开网页地址<textarea value={urls} onChange={event=>setUrls(event.target.value)} placeholder="每行一个 http/https 地址，服务端会拒绝内网地址"/></label>
   <EncodingChoice value={encoding} onChange={setEncoding}/>
   <label className="yu-book-import-file"><Upload size={17}/>选择原文文件<input type="file" multiple accept=".txt,.html,.htm,.epub,text/plain,text/html,application/epub+zip" onChange={event=>setFiles(Array.from(event.target.files||[]))}/></label>
   {files.length>0&&<ul className="yu-book-import-files">{files.map(file=><li key={file.name}>{file.name} · {(file.size/1024/1024).toFixed(1)} MB</li>)}</ul>}
   <label className="yu-book-import-rights"><input type="checkbox" checked={rights} onChange={event=>setRights(event.target.checked)}/><span>我确认有权在本地导入、阅读并处理这些原文。</span></label>
   {error&&<p className="yu-book-import-error" role="alert">{error}</p>}
   <button className="yu-primary" type="submit" disabled={busy||!rights||!title.trim()||(!files.length&&!urls.trim())}>{busy?<Loader2 size={16} className="spin"/>:<Plus size={16}/>} {replaceTarget?'导入新原文并检查结构':'创建书目并导入原文'}</button>
  </form></>:<>
   <header className="yu-book-import-heading"><div><strong>{preview?.manifest.title||title}</strong><small>{ready?'本地书库':'待确认结构'} · {preview?.manifest.sources.length||0} 个原文来源</small></div>{!ready&&<button type="button" disabled={busy} onClick={()=>document.getElementById('yu-book-import-add-files')?.click()}><Upload size={15}/>添加文件</button>}</header>
   {!ready&&<>
    <EncodingChoice value={encoding} onChange={setEncoding}/>
    <input id="yu-book-import-add-files" className="yu-book-import-hidden" type="file" multiple onChange={event=>setFiles(Array.from(event.target.files||[]))}/>
    {files.length>0&&<button type="button" disabled={busy} onClick={()=>void addSources()}>上传 {files.length} 个文件</button>}
    <p className="yu-book-import-note">按标题自动切分。移除一个章节起点会把该段原文并入上一章；排除章节后保留原件，但不会参与检索或制作。</p>
    <div className="yu-book-import-quality" aria-label="原文质量检查"><strong>原文质量检查</strong><span>{activeQuality.unreadableUnits} 段有字形或文本异常 · {activeQuality.missingMarkers} 段含缺文标记 · {activeQuality.emptySections} 个空章节 · {activeQuality.shortSections} 个疑似过短章节</span><p>原文保持原样。展开章节可查看每段异常原文；无法确认的字形或缺文会阻止对应内容用于故事制作。</p></div>
    {chapters.length?<div className="yu-book-import-chapters">{chapters.map((chapter,index)=><article key={`${chapter.sourceIndex}:${chapter.block}`} className={chapter.excluded?'excluded':''}>
     <label className="yu-book-import-exclude"><input type="checkbox" checked={!chapter.excluded} onChange={event=>updateChapter(index,{excluded:!event.target.checked})}/><span>{String(index+1).padStart(2,'0')}</span></label>
     <div><input aria-label={`第${index+1}章标题`} maxLength={120} value={chapter.title} onChange={event=>updateChapter(index,{title:event.target.value})}/><small>{chapter.chars.toLocaleString('zh-CN')} 字 · {chapter.excerpt||'暂无预览'}</small>{(chapter.quality.empty||chapter.quality.short||chapter.flaggedUnits.length>0)&&<details className="yu-book-import-quality-detail"><summary>{chapter.flaggedUnits.length} 段原文异常{chapter.quality.empty?' · 空章节':''}{chapter.quality.short?' · 疑似过短':''} · 查看检查结果</summary>{chapter.flaggedUnits.map(unit=><div key={unit.id}><strong>{unit.id} · {unit.flags.map(flag=>qualityLabels[flag]||flag).join('、')}</strong><p>{unit.text}</p></div>)}</details>}</div>
     <button type="button" aria-label={`移除第${index+1}章起点`} onClick={()=>setPreview(old=>old?{...old,chapters:old.chapters.filter((_,i)=>i!==index)}:old)}><Trash2 size={15}/></button>
    </article>)}</div>:<p role="status">请先添加 TXT、HTML、EPUB 文件，或公开网页地址。</p>}
    <p className="yu-book-import-note">保留 {available} 章。当前解析按中文古典文本优化；无标点或混合文字可能无法准确切分。</p>
    <div className="yu-book-import-actions"><button type="button" disabled={busy||!chapters.length} onClick={()=>void saveStructure()}><RefreshCw size={15}/>保存结构</button><button className="yu-primary" type="button" disabled={busy||!available} onClick={()=>void confirmBook()}>{busy?<Loader2 size={16} className="spin"/>:<Check size={16}/>}确认并加入书库</button></div>
   </>}
   {ready&&<>
    <p className="yu-book-import-note">故事卡按相邻章节生成，梗概包含起因、关键行动和结果。生成可取消、可续跑；主题检索仍会回到本地原文核对。</p>
    {progress&&<div className="yu-book-import-progress"><strong>{progress.status==='complete'?'全部完成':progress.status==='running'?'正在生成':progress.status==='failed'?'部分章节失败':progress.status==='paused'?'已暂停':'尚未生成'}</strong><span>{progress.chapters.filter((chapter:any)=>chapter.status==='done').length} / {progress.chapters.length} 章已完成 · {progress.calls} 次模型调用</span>{progress.chapters.filter((chapter:any)=>chapter.status==='failed').map((chapter:any)=><small key={chapter.sectionId}>{chapter.title}：{chapter.failure}</small>)}</div>}
    {estimate&&<p className="yu-book-import-estimate">估算：{estimate.calls} 次未缓存调用 · {estimate.inputTokens.toLocaleString('zh-CN')} tokens · 约 {Math.max(1,Math.round(estimate.estimatedMs/60000))} 分钟（本地 o200k tokenizer 估算）</p>}
    <div className="yu-book-import-actions">{progress?.status==='running'?<button type="button" onClick={()=>void cancel()}>取消生成</button>:<button type="button" disabled={busy} onClick={()=>void getEstimate()}>估算费用与时间</button>}{progress?.status==='running'?null:<button className="yu-primary" type="button" disabled={busy} onClick={()=>void generate(!!failed)}>{busy?<Loader2 size={16} className="spin"/>:<RefreshCw size={16}/>} {failed?'重试失败章节':progress?.status==='complete'||progress?.status==='paused'?'继续生成':'生成故事卡'}</button>}<button type="button" onClick={()=>onComplete(draft)}>完成并选择</button></div>
   </>}
  </>}
  {message&&<p className="yu-book-import-success" role="status">{message}</p>}{error&&draft&&<p className="yu-book-import-error" role="alert">{error}</p>}
  <button type="button" className="yu-book-import-close" disabled={busy} onClick={()=>void close()}>关闭</button>
 </section>;
}
