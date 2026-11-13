// 单页控制台管理本机服务、路径及访问方式；故事操作和生成设置由浏览器负责。
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {invoke,isTauri} from '@tauri-apps/api/core';
import QRCode from 'qrcode';
import {ServiceCard} from './ServiceCard';
import {PhoneAccessCard} from './PhoneAccessCard';
import {localReaderUrl} from './reader-url';
import {useReleaseUpdate} from './release-update';
import {savedProvider} from './console-state';
import type {Status,ServiceState} from './console-state';
import {defaultSystemSettings} from '../lib/system-settings';
import type {SystemSettings} from '../lib/system-settings';
import './styles.css';
type View={settings:SystemSettings;revision:number;providerKeys?:{gemini:boolean;openai:boolean}};
type NodeInfo={version:string};
const nativeFields=['dataDirectory','port','internetEnabled','cloudflaredPath','codexPath','codexHome'] as const;
const nativeValues=(settings:SystemSettings)=>Object.fromEntries(nativeFields.map(name=>[name,settings[name]]));
const preview=defaultSystemSettings('桌面应用中保存的故事目录');
function Desktop(){
 const native=isTauri(),[view,setView]=useState<View|null>(null),[settings,setSettings]=useState<SystemSettings|null>(null),[status,setStatus]=useState<Status>({running:false,phoneUrls:[]});
 const release=useReleaseUpdate(native);
 const [known,setKnown]=useState(false),[statusError,setStatusError]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[node,setNode]=useState<NodeInfo|null>(null),[nodeError,setNodeError]=useState('');
 const [phone,setPhone]=useState(''),[qr,setQr]=useState('');
 const inFlight=useRef(false),dirtyRef=useRef(false),epoch=useRef(0);
 const dirty=!!view&&!!settings&&JSON.stringify(nativeValues(settings))!==JSON.stringify(nativeValues(view.settings));dirtyRef.current=dirty;
 function adopt(next:View){setView(next);setSettings(next.settings);}
 function accept(next:Status){epoch.current++;setStatus(next);setKnown(true);setStatusError('');}
 async function reload(){adopt(await invoke<View>('get_settings'));}
 async function checkNode(){try{setNode(await invoke<NodeInfo>('detect_node',{nodePath:''}));setNodeError('');}catch{setNodeError('内置运行时不可用，请重新安装拾趣。');}}
 useEffect(()=>{
  if(!native){adopt({settings:preview,revision:0});return;}
  void reload().catch(e=>setError(String(e)));void checkNode();
  let live=true,polling=false;
  async function poll(){if(polling)return;polling=true;const started=epoch.current;try{const next=await invoke<Status>('server_status');if(live&&started===epoch.current){setStatus(next);setKnown(true);setStatusError('');}const current=await invoke<View>('get_settings');if(live&&!dirtyRef.current)adopt(current);}catch{if(live&&started===epoch.current){setKnown(false);setStatusError('暂时无法读取服务状态，正在重试。');}}finally{polling=false;}}
  void poll();const timer=setInterval(()=>void poll(),2000);return()=>{live=false;clearInterval(timer);};
 },[native]);
 const links=[status.publicUrl,...status.phoneUrls].filter((url):url is string=>!!url);
 useEffect(()=>{setPhone(current=>links.includes(current)?current:links[0]||'');},[links.join('|')]);
 useEffect(()=>{let live=true;setQr('');if(phone)void QRCode.toDataURL(phone,{width:240,margin:2,color:{dark:'#193d30',light:'#ffffff'}}).then(next=>{if(live)setQr(next);}).catch(()=>setError('二维码生成失败，请复制访问链接。'));return()=>{live=false;};},[phone]);
 async function action(name:string,work:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(name);setError('');setMessage('');try{await work();}catch(e){setError(String(e));}finally{inFlight.current=false;setBusy('');}}
 function update<K extends keyof SystemSettings>(name:K,value:SystemSettings[K]){setSettings(current=>current?{...current,[name]:value}:current);}
 async function browse(kind:string,field:keyof SystemSettings){const path=await invoke<string|null>('choose_path',{kind});if(path)update(field,path as never);}
 async function save(){if(!settings||!view)throw Error('请先重新读取设置。');const result=await invoke<View>('save_settings',{settings:nativeValues(settings),expectedRevision:view.revision});adopt(result);return result;}
 async function start(){if(dirty)await save();accept({running:false,phoneUrls:[],state:'starting'});try{const next=await invoke<Status>('start_server');accept(next);if(!next.running)throw Error(next.error||'服务尚未启动。');}catch(e){accept({running:false,phoneUrls:[],state:'failed',error:String(e)});throw e;}}
 async function stop(){accept(await invoke<Status>('stop_server'));await reload();}
 async function restart(){if(!window.confirm(status.generating?'正在生成故事。重启会停止当前生成，之后可从浏览器继续。是否重启？':'重启会停止正在生成的工作，之后可从浏览器继续。是否重启？'))return;await stop();await start();}
 async function copy(value:string){await navigator.clipboard.writeText(value);setMessage('访问链接已复制。');}
 const state:ServiceState=!native?'preview':!known?statusError?'unavailable':'loading':status.state==='upgrading'||status.state==='starting'?status.state:status.running?'running':status.error?'failed':'stopped';
 const locked=!native||!!busy||!known||status.running||state==='starting'||state==='upgrading';
 const previewUrl=import.meta.env.DEV?localReaderUrl(import.meta.env.VITE_DESKTOP_READER_URL,window.location.href):null;
 return <main className="desktop-console"><header className="app-header"><div className="brand"><div className="brand-mark" aria-hidden="true">拾</div><div><h1>拾趣 <span>桌面控制台</span></h1><p>留一间故事书房，随时打开。</p></div></div></header>
  {release.latest&&<div className="notice release-notice"><span role="status">拾趣 {release.latest} 已发布。</span><button className="secondary" onClick={()=>void release.openDownload()}>打开官方下载页</button>{release.openError&&<span className="error" role="status">{release.openError}</span>}</div>}
  {(error||message||statusError)&&<div className="notice" role="status">{error||statusError?<span className="error">{error||statusError}</span>:message}</div>}
  {!settings?<section className="card"><h2>正在读取本机设置…</h2><button onClick={()=>void action('读取设置',reload)}>重新读取设置</button></section>:<div className="layout"><div className="settings-stack">
   <ServiceCard state={state} status={status} native={native} busy={busy} provider={status.running&&status.provider?status.provider:savedProvider(view?.settings||settings,view?.providerKeys)} nodeVersion={node?.version} nodeError={nodeError} onStart={()=>void action('启动服务',start)} onStop={()=>void action('停止服务',stop)} onRestart={()=>void action('重启服务',restart)} onOpen={()=>void action('打开浏览器',async()=>{await invoke('open_reader');})} onSettings={()=>void action('打开生成设置',async()=>{await invoke('open_reader',{generationSettings:true});})} previewUrl={previewUrl}/>
   <section className="card local-settings"><div className="section-heading"><h2>本机与存储</h2><p>停止服务后可修改。</p></div><fieldset disabled={locked}><legend className="sr-only">本机设置</legend>
    <label>故事数据目录<div className="input-row"><input value={settings.dataDirectory} onChange={e=>update('dataDirectory',e.target.value)}/><button className="secondary" onClick={()=>void action('选择目录',()=>browse('data','dataDirectory'))}>选择目录</button></div></label>
    <label className="port-field">服务端口<input type="number" min="1024" max="65535" value={settings.port} onChange={e=>update('port',Number(e.target.value))}/></label>
    <details className="advanced-settings"><summary>高级设置</summary><p className="help">仅在需要自定义 Codex 路径或登录目录时修改，留空使用默认值。</p>
    <label>Codex 可执行文件<div className="input-row"><input value={settings.codexPath} placeholder="留空使用 PATH 中的 codex" onChange={e=>update('codexPath',e.target.value)}/><button className="secondary" onClick={()=>void action('选择文件',()=>browse('codex','codexPath'))}>选择文件</button></div></label>
    <label>Codex 登录目录<div className="input-row"><input value={settings.codexHome} placeholder="留空使用默认登录目录" onChange={e=>update('codexHome',e.target.value)}/><button className="secondary" onClick={()=>void action('选择目录',()=>browse('codexHome','codexHome'))}>选择目录</button></div></label>
    </details>
   </fieldset><div className="save-row"><p className="help">{dirty?'有未保存的本机更改':'与已保存设置一致'}</p><button className="secondary" disabled={!native||!!busy} onClick={()=>void action('读取设置',reload)}>重新读取设置</button><button className="secondary" disabled={locked||!dirty} onClick={()=>void action('保存设置',async()=>{await save();setMessage('本机设置已保存。');})}>保存本机设置</button></div></section>
  </div><PhoneAccessCard state={state} running={status.running} busy={!!busy} locked={locked} links={links} phone={phone} publicUrl={status.publicUrl} qr={qr} internetEnabled={settings.internetEnabled} cloudflaredPath={settings.cloudflaredPath} internetError={status.internetError} onChoose={setPhone} onInternetChange={value=>update('internetEnabled',value)} onCloudflaredChange={value=>update('cloudflaredPath',value)} onBrowseCloudflared={()=>void action('选择文件',()=>browse('cloudflared','cloudflaredPath'))} onCopy={()=>void action('复制链接',()=>copy(phone))}/></div>}
  <footer><span>关闭窗口后在托盘运行，退出应用时停止服务。</span>{native&&<div className="release-status">{release.current&&<span>当前版本 {release.current}</span>}<button className="text-button" disabled={release.checking} onClick={()=>void release.check(true)}>{release.checking?'正在检查…':'检查更新'}</button>{release.feedback&&<span role="status">{release.feedback}</span>}</div>}<button className="text-button" disabled={!native||!!busy} onClick={()=>void action('退出应用',async()=>{await invoke('quit_app');})}>退出拾趣</button></footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Desktop/>);
