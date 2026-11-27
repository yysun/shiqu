// 桌面书库维护在服务停止或启动失败后仍可用，切换书库需再次确认。
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';

type Compatibility={version:number;state:'current'|'migration'|'unsupported'|'unknown';migrations:string[]};
type Snapshot={path:string;kind:'manual'|'upgrade'|'unknown';createdAt?:string;bytes?:number;appVersion?:string;error?:string;deletion?:'protected'|'uncertain'|'unattributed'|null;deleteToken?:string;verifiedAt?:string;compatibility?:Compatibility};
type BackupList={directory:string;available:boolean;entries:Snapshot[]};
type Operation='list'|'create'|'inspect'|'verify'|'restore'|'delete'|'reveal';
type Props={native:boolean;library:string;busy:string;running:boolean;starting:boolean;canSwitch:boolean;untouched:boolean;onSwitch:(directory:string)=>Promise<void>;action:(label:string,work:()=>Promise<void>)=>Promise<void>};
const kinds={manual:'手动',upgrade:'升级前',unknown:'来源未知'};
const formatDate=(value:string)=>new Date(value).toLocaleString();
function size(bytes:number){
 if(bytes<1024)return bytes+' B';
 const unit=Math.min(3,Math.floor(Math.log(bytes)/Math.log(1024)));
 return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(bytes/1024**unit)+' '+['B','KiB','MiB','GiB'][unit];
}
function appendPath(directory:string,child:string){
 const separator=/^(?:[a-z]:|\\\\)/i.test(directory)?'\\':'/';
 return directory.replace(/[\\/]+$/,'')+separator+child;
}
function compatibilityText(compatibility:Compatibility){
 const schema='书库格式 V'+compatibility.version;
 switch(compatibility.state){
  case 'current':return schema+'，当前版本可打开。';
  case 'migration':return schema+'，恢复副本需要迁移'+(compatibility.migrations.length?'（'+compatibility.migrations.join('、')+'）':'')+'。回退时使用原备份和匹配的拾趣版本。';
  case 'unsupported':return schema+'，当前版本无法恢复。请使用支持此格式的拾趣版本。';
  case 'unknown':return schema+'，暂无法判断兼容性。恢复时将执行正式校验。';
 }
}
export function LibraryBackupCard({native,library,busy,running,starting,canSwitch,untouched,onSwitch,action}:Props){
 const [list,setList]=useState<BackupList>(),[loading,setLoading]=useState(false),[listError,setListError]=useState(''),[operationError,setOperationError]=useState('');
 const [selection,setSelection]=useState<Snapshot>(),[checks,setChecks]=useState<Record<string,Snapshot>>({});
 const [deleteTarget,setDeleteTarget]=useState<Snapshot>(),[creation,setCreation]=useState(''),[destination,setDestination]=useState(''),[completed,setCompleted]=useState(''),[restored,setRestored]=useState('');
 const listRequest=useRef(0),deleteDialog=useRef<HTMLDialogElement>(null);
 const disabled=!native||!!busy||loading;
 const fetchBackup=<T,>(operation:Operation,input:object={})=>invoke<T>('library_backup',{request:{operation,library,...input}});
 function perform(label:string,work:()=>Promise<void>){
  return action(label,async()=>{
   setOperationError('');
   try{await work();}catch(error){setOperationError(String(error));}
  });
 }
 async function refresh(){
  const request=++listRequest.current;
  setLoading(true);setListError('');setChecks({});
  try{const result=await fetchBackup<BackupList>('list');if(request===listRequest.current)setList(result);}
  catch(error){if(request===listRequest.current){setList(undefined);setListError(String(error));}}
  finally{if(request===listRequest.current)setLoading(false);}
 }
 useEffect(()=>{
  deleteDialog.current?.close();setDeleteTarget(undefined);
  setList(undefined);setSelection(undefined);setChecks({});setCreation('');setDestination('');setCompleted('');setRestored('');setOperationError('');
  if(native)void refresh();
  return ()=>{listRequest.current++;};
 // 书库切换时重新读取，上一书库的结果作废。
 },[native,library]);
 const chooseFolder=()=>invoke<string|null>('choose_path',{kind:'data'});
 function createHere(parent:string){
  setCreation(appendPath(parent,'manual-'+new Date().toISOString().replace(/[:.]/g,'-')));
 }
 async function inspect(backup:string){
  const result=await fetchBackup<Snapshot>('inspect',{backup});
  setChecks(current=>{const next={...current};delete next[backup];return next;});
  setSelection(result);setDestination('');setCompleted('');setCreation('');
 }
 async function verify(backup:string){
  setChecks(current=>{const next={...current};delete next[backup];return next;});
  const verified=await fetchBackup<Snapshot>('verify',{backup});
  setChecks(current=>({...current,[backup]:verified}));
 }
 function confirmDelete(entry:Snapshot){
  if(!entry.deleteToken)return;
  setDeleteTarget(entry);deleteDialog.current?.showModal();
 }
 function deleteBackup(entry:Snapshot){
  if(!entry.deleteToken)return;
  const confirmUnattributed=entry.deletion==='unattributed'?true:undefined;
  deleteDialog.current?.close();
  void perform('正在删除备份',async()=>{
   try{await fetchBackup('delete',{backup:entry.path,deleteToken:entry.deleteToken,confirmUnattributed});if(selection?.path===entry.path)setSelection(undefined);}
   finally{await refresh();}
  });
 }
 const inspected=selection?.compatibility;
 function checkedAt(snapshot:Snapshot){
  const verified=checks[snapshot.path];
  return !snapshot.error&&verified?.createdAt===snapshot.createdAt?verified?.verifiedAt:undefined;
 }
 return <section className="card backup-card" aria-labelledby="backup-heading">
  <div className="section-heading"><h2 id="backup-heading">书库备份与恢复</h2><p>私有整库快照。全局设置和 API 密钥另存于本机设置数据库。</p></div>
  <p className="backup-location"><strong>来源书库</strong> {library}</p>
  {list&&<p className="backup-location"><strong>默认备份目录</strong> {list.directory}</p>}
  <p className="help">同盘的升级备份用于回退。外置磁盘上的副本也可用于硬盘故障后的恢复。</p>
  {!native&&<p className="help">请在桌面应用中管理备份。</p>}
  {native&&(running||starting)&&<p className="help">请先停止服务，再创建备份。</p>}
  <div className="backup-actions">
   <button className="secondary" disabled={disabled||running||starting||!list} onClick={()=>{if(list){setSelection(undefined);createHere(list.directory);}}}>备份到默认目录</button>
   <button className="secondary" disabled={disabled||running||starting} onClick={()=>void perform('正在选择备份位置',async()=>{const parent=await chooseFolder();if(parent){setSelection(undefined);createHere(parent);}})}>备份到其他位置</button>
   <button className="secondary" disabled={disabled} onClick={()=>void perform('正在打开备份',async()=>{const backup=await chooseFolder();if(backup)await inspect(backup);})}>打开其他备份</button>
   <button className="secondary" disabled={disabled} onClick={()=>void refresh()}>刷新备份列表</button>
  </div>
  {busy.startsWith('正在')&&<p role="status">{busy}…</p>}
  {loading&&<p role="status">正在读取备份列表…</p>}
  {operationError&&<p className="error" role="alert">{operationError}</p>}
  {listError&&<p className="error" role="alert">{listError}</p>}
  {list&&!list.entries.length&&<p className="help">{list.available?'此目录暂无备份。':'默认备份目录尚不可用。首次备份时将创建目录，也可选择其他位置。'}</p>}
  {creation&&<div className="backup-panel">
   <p className="backup-location"><strong>备份位置</strong> {creation}</p>
   <div className="backup-actions">
    <button className="secondary" disabled={disabled||running||starting} onClick={()=>void perform('正在备份并校验',async()=>{
     const result=await fetchBackup<Snapshot>('create',{target:creation});
     setCreation('');setCompleted('备份已校验 · '+formatDate(result.createdAt!)+' · '+result.path);await refresh();
    })}>确认备份</button>
    <button className="secondary" disabled={disabled} onClick={()=>setCreation('')}>取消</button>
   </div>
  </div>}
  {list&&list.entries.length>0&&<ul className="backup-list">
   {list.entries.map(entry=><li key={entry.path}>
    <strong>{entry.createdAt?formatDate(entry.createdAt):'备份信息不可用'}</strong>
    <span>{kinds[entry.kind]}{entry.bytes!==undefined?' · '+size(entry.bytes):''}</span>
    <p className="backup-location">{entry.path}</p>
    {entry.error&&<p className="error">{entry.error}</p>}
    {entry.deletion&&<p className="help">{entry.deletion==='protected'?'恢复或升级仍需要此备份。':entry.deletion==='unattributed'?'此旧备份缺少归属记录。':'暂无法确认此备份可安全删除。'}</p>}
    <p className="help">{checkedAt(entry)?'本次校验通过 · '+formatDate(checkedAt(entry)!):entry.createdAt?'创建时校验 · 尚未在本次打开后校验':''}</p>
    <div className="backup-actions">
     <button className="secondary" disabled={disabled||!!entry.error} onClick={()=>void perform('正在校验备份',()=>verify(entry.path))}>校验</button>
     <button className="secondary" disabled={disabled||!!entry.error} onClick={()=>void perform('正在检查恢复兼容性',()=>inspect(entry.path))}>恢复…</button>
     <button className="secondary" disabled={disabled} onClick={()=>void perform('正在定位备份',async()=>{await fetchBackup('reveal',{backup:entry.path});})}>在文件管理器中显示</button>
     <button className="secondary" disabled={disabled||!entry.deleteToken} onClick={()=>confirmDelete(entry)}>删除备份…</button>
    </div>
   </li>)}
  </ul>}
  <dialog ref={deleteDialog} className="card backup-delete-dialog" aria-labelledby="backup-delete-title" aria-describedby="backup-delete-warning" onClose={()=>setDeleteTarget(undefined)}>
   <h2 id="backup-delete-title">删除备份</h2>
   {deleteTarget&&<>
    <p id="backup-delete-warning">将永久删除这份备份及其中所有文件。{deleteTarget.deletion==='unattributed'?'缺少归属记录，请确认任何书库都不再依赖它回退。':''}</p>
    {deleteTarget.createdAt&&deleteTarget.bytes!==undefined&&<p>{formatDate(deleteTarget.createdAt)} · {size(deleteTarget.bytes)}</p>}
    <p className="backup-location">{deleteTarget.path}</p>
   </>}
   <div className="backup-actions">
    <button className="secondary" onClick={()=>deleteDialog.current?.close()}>取消</button>
    <button className="secondary error" disabled={disabled||!deleteTarget} onClick={()=>{if(deleteTarget)deleteBackup(deleteTarget);}}>永久删除</button>
   </div>
  </dialog>
  {selection&&<div className="backup-panel">
   <div className="section-heading"><h3>恢复到新目录</h3><p className="backup-location">来源备份 {selection.path}</p></div>
   {inspected&&<p>{compatibilityText(inspected)}</p>}
   <p className="help">{checkedAt(selection)?'本次校验通过 · '+formatDate(checkedAt(selection)!):'恢复前将完整校验备份。'}</p>
   <label>新书库的完整路径<input value={destination} placeholder="尚未创建的目录" onChange={event=>setDestination(event.target.value)}/></label>
   <div className="backup-actions">
    <button className="secondary" disabled={disabled} onClick={()=>void perform('正在选择恢复位置',async()=>{const parent=await chooseFolder();if(parent)setDestination(appendPath(parent,'restored-library'));})}>选择上级目录</button>
    <button className="secondary" disabled={disabled} onClick={()=>void perform('正在校验备份',()=>verify(selection.path))}>校验备份</button>
    <button className="secondary" disabled={disabled||!destination.trim()||inspected?.state==='unsupported'} onClick={()=>void perform('正在校验并恢复书库',async()=>{
     const result=await fetchBackup<{path:string}>('restore',{backup:selection.path,target:destination.trim(),createdAt:selection.createdAt});
     setCompleted('书库已恢复 · '+result.path);setDestination('');setSelection(undefined);
     setRestored(result.path);
    })}>确认恢复</button>
    <button className="secondary" disabled={disabled} onClick={()=>setSelection(undefined)}>取消</button>
   </div>
  </div>}
  {completed&&<p className="backup-location" role="status">{completed}</p>}
  {restored&&<div className="backup-actions">
   <button className="secondary" disabled={disabled||!canSwitch||!untouched} onClick={()=>{
    if(window.confirm('将故事数据目录切换到恢复的书库？\n'+restored))void perform('正在切换书库',async()=>{await onSwitch(restored);setRestored('');});
   }}>使用恢复的书库</button>
   {(!canSwitch||!untouched)&&<span className="help">停止服务并处理未保存的本机设置后即可切换。</span>}
  </div>}
 </section>;
}
