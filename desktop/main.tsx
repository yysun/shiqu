// Desktop tabs share shelf controls; native settings keep keys private and browser service controls disabled.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {invoke,isTauri} from '@tauri-apps/api/core';
import QRCode from 'qrcode';
import {BookOpen,Layers3,Settings2} from 'lucide-react';
import {LibraryPane} from './LibraryPane';
import type {DesktopTab} from './LibraryPane';
import {codexReasoningEfforts} from '../lib/codex-settings';
import type {CodexReasoningEffort} from '../lib/codex-settings';
import {taskReasoningDefaults,reasoningTasks,taskReasoningLabels,geminiReasoningEfforts} from '../lib/reader-reasoning';
import type {TaskReasoningEfforts} from '../lib/reader-reasoning';
import './styles.css';

type Settings={nodePath:string;dataDirectory:string;port:number;internetEnabled:boolean;cloudflaredPath:string;provider:'gemini'|'codex';textModel:string;imageModel:string;codexPath:string;codexModel:string;codexHome:string;codexReasoningEffort:CodexReasoningEffort;taskReasoningEfforts:TaskReasoningEfforts};
type View={settings:Settings;keyPresent:boolean;credentialError:string|null;platform:string;edition:'standard'|'lite'};
type Status={running:boolean;url?:string;phoneUrls:string[];publicUrl?:string;internetError?:string;error?:string};
type NodeInfo={path:string;version:string;sqlite:boolean};
type KeyAction='keep'|'replace'|'delete';
const tabs=[['library','书架',BookOpen],['queue','生成队列',Layers3],['settings','设置',Settings2]] as const;
const previewSettings:Settings={nodePath:'',dataDirectory:'桌面应用中保存的故事目录',port:3000,internetEnabled:false,cloudflaredPath:'',provider:'gemini',textModel:'gemini-3.8-flash',imageModel:'gemini-nano-banana-2.1',codexPath:'',codexModel:'gpt-6.1-sol',codexHome:'',codexReasoningEffort:'',taskReasoningEfforts:{...taskReasoningDefaults}};

function Desktop(){
 const [tab,setTab]=useState<DesktopTab>('library');
 const [view,setView]=useState<View|null>(null),[settings,setSettings]=useState<Settings|null>(null),[status,setStatus]=useState<Status>({running:false,phoneUrls:[]});
 const [key,setKey]=useState(''),[keyAction,setKeyAction]=useState<KeyAction>('keep'),[reveal,setReveal]=useState(false),[node,setNode]=useState<NodeInfo|null>(null),[nodeError,setNodeError]=useState('');
 const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[phone,setPhone]=useState(''),[qr,setQr]=useState('');
 const native=isTauri(),lite=view?.edition==='lite';
 async function checkNode(nodePath:string){try{const info=await invoke<NodeInfo>('detect_node',{nodePath});setNode(info);setNodeError('');return info;}catch(e){setNode(null);setNodeError(String(e));return null;}}
 useEffect(()=>{
  if(!native){if(import.meta.env.DEV){setSettings(previewSettings);setView({settings:previewSettings,keyPresent:false,credentialError:null,platform:'preview',edition:'standard'});}else setError('请在拾趣桌面应用中打开。');return;}
  void invoke<View>('get_settings').then(result=>{setView(result);setSettings(result.settings);void checkNode(result.settings.nodePath);}).catch(e=>setError(String(e)));
  let active=true,inFlight=false;
  const timer=setInterval(()=>{if(inFlight)return;inFlight=true;void invoke<Status>('server_status').then(result=>{if(active)setStatus(result);}).catch(()=>{}).finally(()=>{inFlight=false;});},2000);
  return()=>{active=false;clearInterval(timer);};
 },[native]);
 useEffect(()=>{const links=[status.publicUrl,...status.phoneUrls].filter((link):link is string=>!!link);setPhone(current=>links.includes(current)?current:links[0]||'');},[status.publicUrl,status.phoneUrls.join('|')]);
 useEffect(()=>{let active=true;setQr('');if(phone)void QRCode.toDataURL(phone,{width:240,margin:2,color:{dark:'#193d30',light:'#ffffff'}}).then(value=>{if(active)setQr(value);}).catch(()=>setError('二维码生成失败，请复制访问链接。'));return()=>{active=false;};},[phone]);
 async function action(name:string,work:()=>Promise<void>){if(busy)return;setBusy(name);setError('');setMessage('');try{await work();}catch(e){setError(String(e));}finally{setBusy('');}}
 function update<K extends keyof Settings>(name:K,value:Settings[K]){setSettings(previous=>previous?{...previous,[name]:value}:previous);}
 async function browse(kind:string,field:keyof Settings){const value=await invoke<string|null>('choose_path',{kind});if(value)update(field,value as never);}
 async function save(){
  if(!settings)return;
  const result=await invoke<View>('save_settings',{settings,keyAction,key});
  setView(result);setSettings(result.settings);setKey('');setKeyAction('keep');setReveal(false);
 }
 async function copy(value:string){await navigator.clipboard.writeText(value);setMessage('访问链接已复制。');}
 const links=[status.publicUrl,...status.phoneUrls].filter((link):link is string=>!!link),internet=!!phone&&phone===status.publicUrl;
 const locked=!native||!!busy||status.running,dirty=!!settings&&!!view&&(JSON.stringify(settings)!==JSON.stringify(view.settings)||keyAction!=='keep');
 return <main>
  <header className="app-header"><div className="brand"><div className="brand-mark" aria-hidden="true">拾</div><div><h1>拾趣 <span>{lite?'Lite':'桌面版'}</span></h1><p>在自己的电脑上，留一间故事书房。</p></div></div><span className="edition">桌面控制台</span></header>
  <div className="notice" role="status" aria-live="polite">{error?<span className="error">{error}</span>:message||(!native?'开发预览 · 使用本机书架，删除会同步阅读端；设置与服务操作需在桌面应用中使用。':(lite?'Lite 使用你安装的 Node 24。':'已内置 Node 24，无需另外安装。')+'故事保存在电脑上，浏览器和手机共用同一书架。')}</div>
  {!settings?<section className="card"><h2>{native?'正在读取设置…':'需要桌面应用'}</h2></section>:<div className="layout">
   <div className="desktop-left-pane">
    <div className="desktop-tabs" role="tablist" aria-label="桌面工作区">{tabs.map(([id,label,Icon],index)=><button type="button" id={'tab-'+id} key={id} role="tab" aria-selected={tab===id} aria-controls={'panel-'+id} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;if(next===null)return;event.preventDefault();setTab(tabs[next][0]);document.getElementById('tab-'+tabs[next][0])?.focus();}}><Icon size={17}/>{label}</button>)}</div>
    <div role="tabpanel" id={'panel-'+tab} aria-labelledby={'tab-'+tab} tabIndex={0}>
    {tab!=='settings'?<LibraryPane key={tab} tab={tab} native={native} revision={view?.settings.dataDirectory||''}/>:<div className="settings-stack">
    <section className="card"><div className="section-heading"><span className="step">01</span><div><h2>生成服务</h2><p>选择故事与插图的生成方式。</p></div></div>
     <fieldset disabled={locked}><legend className="sr-only">生成服务设置</legend>
      <label>提供方<select value={settings.provider} onChange={e=>update('provider',e.target.value as Settings['provider'])}><option value="gemini">Gemini · API 密钥</option><option value="codex" disabled={view?.platform==='windows'}>Codex · ChatGPT 订阅{view?.platform==='windows'?'（Windows 暂不支持）':''}</option></select></label>
      {settings.provider==='gemini'?<>
       <div className="label-row"><label htmlFor="api-key">Gemini API 密钥</label><span className={keyAction==='delete'?'key-state warning':'key-state'}>{keyAction==='delete'?'保存后删除':keyAction==='replace'?'等待保存到本机':view?.keyPresent?'已保存到本机数据库':'未设置 · 可阅读示例'}</span></div>
       <div className="input-row"><input id="api-key" type={reveal?'text':'password'} autoComplete="off" spellCheck={false} value={key} placeholder={view?.keyPresent?'输入新密钥以替换；留空保留已保存密钥':'粘贴你的 Gemini API 密钥'} onChange={e=>{setKey(e.target.value);setKeyAction(e.target.value?'replace':'keep');}}/><button className="subtle" type="button" onClick={()=>setReveal(!reveal)} aria-label={reveal?'隐藏输入的密钥':'显示输入的密钥'}>{reveal?'隐藏':'显示'}</button></div>
       <div className="key-help"><p className="help">密钥以明文保存在本机数据库，由系统文件权限保护。浏览器与手机无法读取。</p>{(view?.keyPresent||keyAction!=='keep')&&<button className="text-button danger" onClick={()=>{setKey('');setKeyAction(keyAction==='delete'?'keep':'delete');}}>{keyAction==='delete'?'撤销删除':'删除已保存的密钥'}</button>}</div>
       <p className="help">未保存密钥时，启动环境中的 GEMINI_API_KEY 会自动保存。无需钥匙串。</p>
       {view?.credentialError&&<p className="error" role="alert">{view.credentialError}</p>}
       <div className="two-fields"><label>文本模型<input value={settings.textModel} onChange={e=>update('textModel',e.target.value)} spellCheck={false}/></label><label>图片模型<input value={settings.imageModel} onChange={e=>update('imageModel',e.target.value)} spellCheck={false}/></label></div>
      </>:<>
       <p className="help">使用本机已安装并登录的 Codex CLI。不会使用 API 密钥，也不会切换到 API 计费。</p>
       <label>Codex 可执行文件<div className="input-row"><input placeholder="留空使用 PATH 中的 codex" value={settings.codexPath} onChange={e=>update('codexPath',e.target.value)}/><button className="subtle" onClick={()=>void action('选择文件',()=>browse('codex','codexPath'))}>选择</button></div></label>
       <label>Codex 文本模型<input value={settings.codexModel} onChange={e=>update('codexModel',e.target.value)} placeholder="留空使用 CLI 默认模型"/></label>
       <label>Codex 其他请求推理档位<select value={settings.codexReasoningEffort} onChange={e=>update('codexReasoningEffort',e.target.value as CodexReasoningEffort)}><option value="">跟随 Codex 默认</option>{codexReasoningEfforts.map(effort=><option value={effort} key={effort}>{effort}</option>)}</select></label>
       <p className="help">用于绘图调用等未分类请求；文本任务采用下方各自的档位。文字推理档位不等于图片质量。</p>
       <label>Codex 登录目录（可选）<div className="input-row"><input value={settings.codexHome} onChange={e=>update('codexHome',e.target.value)} placeholder="留空使用 CLI 默认目录"/><button className="subtle" onClick={()=>void action('选择目录',()=>browse('codexHome','codexHome'))}>选择</button></div></label>
       <p className="help">首次登录需先在终端执行 codex login；此处可检查登录状态。</p>
      </>}
      <div className="section-heading"><div><h3>按任务分配推理档位</h3><p>简单推荐优先速度，分镜与审核优先质量。</p></div></div>
      <div className="two-fields">{reasoningTasks.map(task=>{
       const options=settings.provider==='codex'?codexReasoningEfforts:geminiReasoningEfforts,value=settings.taskReasoningEfforts[task];
       return <label key={task}>{taskReasoningLabels[task]}<select value={value} onChange={e=>update('taskReasoningEfforts',{...settings.taskReasoningEfforts,[task]:e.target.value as TaskReasoningEfforts[typeof task]})}>
        {!(options as readonly string[]).includes(value)&&<option value={value} disabled>{value}（此提供方不支持，请调整）</option>}
        {options.map(effort=><option value={effort} key={effort}>{effort}{effort===taskReasoningDefaults[task]?'（推荐）':''}</option>)}
       </select></label>;
      })}</div>
      <p className="help">初审与复核使用同一档位。Gemini 支持 low、medium、high；Codex 的可用档位取决于模型与 CLI。保存后在下次启动服务时生效。</p>
      <div className="test-row"><button className="secondary" onClick={()=>void action('检查连接',async()=>{if(dirty)await save();const result=await invoke<{ok:boolean;message:string}>('test_provider');if(result.ok)setMessage(result.message);else setError(result.message);})}>检查连接</button><span className="help">检查前保存配置；仅检查访问或登录，不生成内容。</span></div>
     </fieldset>
    </section>
    <section className="card"><div className="section-heading"><span className="step">02</span><div><h2>本地运行</h2><p>运行时与故事数据，由你掌握。</p></div></div>
     <fieldset disabled={locked}><legend className="sr-only">本地运行设置</legend>
      {lite?<label>Node 可执行文件<div className="input-row"><input value={settings.nodePath} placeholder="自动检测 Node 24，或选择绝对路径" onChange={e=>{update('nodePath',e.target.value);setNode(null);}}/><button className="subtle" onClick={()=>void action('选择 Node',()=>browse('node','nodePath'))}>选择</button></div></label>:<label>运行时<input value={node?`内置 Node ${node.version}`:'内置 Node 24'} readOnly/></label>}
      <div className="node-check"><span className={node?'success':'help'}>{node?`Node ${node.version} · SQLite 可用`:!native?'运行时检查需在桌面应用中使用。':nodeError||'正在检查 Node 24…'}</span><button className="text-button" onClick={()=>void action('检查运行时',async()=>{await checkNode(settings.nodePath);})}>{lite?'重新检测':'检查运行时'}</button></div>
      {lite&&node&&<p className="path-caption" title={node.path}>{node.path}</p>}
      <label>故事数据目录<div className="input-row"><input value={settings.dataDirectory} onChange={e=>update('dataDirectory',e.target.value)}/><button className="subtle" onClick={()=>void action('选择目录',()=>browse('data','dataDirectory'))}>选择</button></div></label>
      <p className="help">保存 SQLite 和图片。更换目录会切换书架，不会搬移已有数据。</p>
      <label className="port-field">服务端口<input type="number" min="1024" max="65535" value={settings.port} onChange={e=>update('port',Number(e.target.value))}/></label>
     </fieldset>
     <div className="save-row"><span className="help">{status.running?'停止服务后可修改设置。':dirty?'有尚未保存的更改。':'设置已同步。'}</span><button className="secondary" disabled={locked||!dirty} onClick={()=>void action('保存设置',async()=>{await save();setMessage('设置已保存。');})}>保存设置</button></div>
    </section>
   </div>}
    </div>
   </div>
   <aside className="service-stack">
    <section className="service-card"><div className="service-label"><span className={'status-dot '+(status.running?'live':'')}/>{status.running?'服务运行中':'服务已停止'}</div><h2>{status.running?'书房已打开。':'让故事开始。'}</h2><p>{status.running?'在浏览器阅读，或让手机加入。':'启动后，在你熟悉的浏览器里阅读。'}</p>
     {status.error&&!busy&&<p className="service-error" role="alert">{status.error}</p>}
     <button className="primary" disabled={!!busy||!native} onClick={()=>void action(status.running?'停止服务':'启动服务',async()=>{if(status.running)setStatus(await invoke<Status>('stop_server'));else{if(dirty)await save();const info=await checkNode(settings.nodePath);if(!info)throw Error(lite?'请先选择兼容的 Node 24。':'内置运行时不可用，请检查运行时错误。');setStatus(await invoke<Status>('start_server'));}})}>{busy?busy+'…':!native?'请在桌面应用中启动':status.running?'停止服务':dirty?'保存并启动':'启动服务'}</button>
     {status.running&&<><a className="browser-link" href={status.url} onClick={event=>{event.preventDefault();if(!busy)void action('打开浏览器',async()=>{await invoke('open_reader');});}}>在浏览器打开 ↗</a><button className="local-link" title="复制本机访问链接" onClick={()=>void action('复制链接',()=>copy(status.url!))}>{new URL(status.url!).origin} · 复制链接</button></>}
     <div className="service-foot">关闭窗口后在托盘继续运行。<br/>退出应用会停止服务。</div>
    </section>
    <section className="card phone-card"><div className="section-heading"><span className="phone-glyph" aria-hidden="true">↗</span><div><h2>手机接着读</h2><p>无需安装手机应用。</p></div></div>
     <fieldset className="phone-sharing" disabled={locked}><legend className="sr-only">手机访问设置</legend>
      <label className="switch-row"><input type="checkbox" checked={settings.internetEnabled} onChange={e=>update('internetEnabled',e.target.checked)}/><span><strong>允许互联网访问</strong><small>{status.running?'停止服务后可修改互联网访问。':'使用免费 Cloudflare 临时隧道，手机可在其他 Wi-Fi 或蜂窝网络中连接。无需账户或域名。'}</small></span></label>
      {settings.internetEnabled&&<><label>cloudflared 可执行文件<input value={settings.cloudflaredPath} placeholder="留空自动查找，或填写绝对路径" onChange={e=>update('cloudflaredPath',e.target.value)} spellCheck={false}/></label><p className="help">需先安装 cloudflared。macOS：brew install cloudflared。Standard 与 Lite 均需另行安装。</p></>}
     </fieldset>
     <p className="help lan-status">局域网访问始终开启 · 无需配对 ID</p>
     {status.internetError&&<p className="error" role="status">{status.internetError}</p>}
     {status.running&&phone?<>{links.length>1&&<label>访问方式<select aria-label="手机访问方式" value={phone} onChange={e=>setPhone(e.target.value)}>{links.map(url=><option key={url} value={url}>{url===status.publicUrl?'互联网 · ':'局域网 · '}{new URL(url).hostname}</option>)}</select></label>}<p className="phone-url">{internet?'互联网 · 私密配对链接':'局域网 · 直接访问'}</p><div className="qr-wrap">{qr?<img src={qr} width="240" height="240" alt={internet?'扫描私密二维码，通过互联网连接书架':'扫描二维码，通过局域网打开书架'}/>:<p>正在生成二维码…</p>}</div><p className="phone-url">{new URL(phone).origin}</p><button className="secondary full" onClick={()=>void action('复制链接',()=>copy(phone))}>{internet?'复制私密互联网链接':'复制局域网访问链接'}</button></>:<div className="qr-placeholder"><span aria-hidden="true">▦</span><p>{status.running?'未找到可用的访问地址。':'启动服务后显示二维码。'}</p></div>}
     <p className="help network-note">电脑需保持唤醒，拾趣服务需保持运行。局域网使用 HTTP，仅限可信网络；可连接的设备共享书架和生成权限。</p>
     {settings.internetEnabled&&<p className="help network-note">互联网通过 Cloudflare 转发 HTTPS。完整二维码和私密链接可授权访问书架与生成服务，请勿公开分享。配对有效期为 12 小时；停服立即失效，重启后需重新扫码。免费隧道地址会变化，无可用性保证。</p>}
    </section>
   </aside>
  </div>}
  <footer><span>{lite?'拾趣 Lite · 使用系统 Node':'拾趣 · 内置 Node 24'} · 不需要 Docker</span><button className="text-button" disabled={!!busy||!native} onClick={()=>void action('退出',async()=>{await invoke('quit_app');})}>退出拾趣</button></footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Desktop/>);
