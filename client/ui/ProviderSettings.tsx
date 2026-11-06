// 生成服务与模型：保存的默认值用于新任务；已开始的步骤保持原配置，密钥只显示来源与存在状态。
// 运维版式：顶部状态卡展示新任务配置及启动覆盖；提供方以卡片单选并标出密钥状态；
// 各分区标记未保存更改；推理档位以分段控件逐项展示；底部常驻操作栏提供放弃更改、重新读取与保存。
// 有未保存更改时表单带 data-dirty，返回或 Escape 关闭前先询问。
// 关闭时只在对话框是基础步骤（直接加载哈希）时去掉 #provider-settings；应用内打开的哈希条目由历史步骤登记释放。
import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,ChevronRight,Cpu,Image as ImageIcon,KeyRound,RefreshCw,RotateCcw,SlidersHorizontal,Type} from 'lucide-react';
import Sheet from './StorySheet';
import {historySteps} from './historySteps';
import {request} from './shared';
import {imageKeyDraftForProviderChange,type ProviderSettings as Settings,type ProviderSettingsSave,type ProviderSettingsView} from '@/lib/provider-settings';
import {codexReasoningEfforts} from '@/lib/codex-settings';
import {reasoningTasks,taskReasoningLabels,taskReasoningDefaults,geminiReasoningEfforts} from '@/lib/reader-reasoning';
import {effectiveImageProvider,isApiProvider} from '@/lib/system-settings';
import './ProviderSettings.css';

const labels:Record<string,string>={gemini:'Google / Gemini',openai:'OpenAI API',codex:'Codex · ChatGPT 订阅',readonly:'只读',claude:'Claude Code',deepseek:'DeepSeek API'};
type Runtime=ProviderSettingsView['runtime'];
type Tone='ok'|'warn'|'idle';
type KeyAction=ProviderSettingsSave['keyAction'];
type Option<T extends string>={value:T;label:string;hint?:string;badge?:{tone:Tone;text:string};disabled?:boolean};

// 运行状态只取当前进程上报的配置，资料页摘要与设置面板共用同一口径。
function runtimeState(runtime:Runtime|null):{tone:Tone;label:string}{
 if(!runtime)return {tone:'idle',label:'读取中'};
 if(runtime.provider==='readonly')return {tone:'idle',label:'只读'};
 return runtime.configured===false?{tone:'warn',label:'未配置'}:{tone:'ok',label:'已配置'};
}
function RuntimeRows({runtime}:{runtime:Runtime}){
 return <dl className="yu-provider-runtime">
  <dt><Type size={14}/>文本</dt><dd title={runtime.models.text}><span>{labels[runtime.provider]||runtime.provider}</span><code>{runtime.models.text||'默认模型'}</code></dd>
  <dt><ImageIcon size={14}/>图片</dt><dd title={runtime.models.image}><span>{labels[runtime.imageProvider||runtime.provider]||runtime.imageProvider}</span><code>{runtime.models.image||'默认模型'}</code></dd>
 </dl>;
}
export function ProviderRuntimeSummary({runtime}:{runtime:Runtime|null}){
 const state=runtimeState(runtime);
 return <section className="yu-provider-summary" aria-label="生成配置"><div><span>生成配置</span><em className={`yu-provider-pill ${state.tone}`}>{state.label}</em></div>
  {!runtime?<p role="status">正在读取生成配置…</p>:runtime.provider==='readonly'?<p>只读模式，不生成内容。</p>:<RuntimeRows runtime={runtime}/>}
  {runtime?.configured===false&&runtime.provider!=='readonly'&&<p>生成服务尚未接通。</p>}
 </section>;
}
// 卡片与分段控件都基于原生 radio，保留方向键切换，并随外层 fieldset 一起禁用。
function Choices<T extends string>({name,label,value,options,onChange,variant='cards'}:{name:string;label:string;value:T;options:Option<T>[];onChange:(value:T)=>void;variant?:'cards'|'segments'}){
 return <div role="radiogroup" aria-label={label} className={variant==='cards'?'yu-provider-cards':'yu-provider-segments'}>{options.map(option=><label key={option.value} className={option.value===value?'selected':undefined}>
  <input type="radio" name={name} value={option.value} checked={option.value===value} disabled={option.disabled} onChange={()=>onChange(option.value)}/>
  <strong>{option.label}</strong>{option.hint&&<small>{option.hint}</small>}{option.badge&&<em className={`yu-provider-pill ${option.badge.tone}`}>{option.badge.text}</em>}
 </label>)}</div>;
}
function Group({icon,title,label,changed,children}:{icon:React.ReactNode;title:string;label:string;changed:boolean;children:React.ReactNode}){
 return <section className="yu-provider-group" aria-label={label}><header>{icon}<h3>{title}</h3>{changed&&<i className="yu-provider-changed">已修改</i>}</header>{children}</section>;
}
function KeyField({name,title,present,override,action,onAction,value,onValue}:{name:string;title:string;present:boolean;override?:'valid'|'invalid';action:KeyAction;onAction:(action:KeyAction)=>void;value:string;onValue:(value:string)=>void}){
 const fromStartup=override==='valid';
 const description=override==='invalid'?'启动配置中的密钥为空或格式不正确，并覆盖了本机保存值；请修正或移除该启动覆盖。':fromStartup?(action==='remove'?'保存后仅移除本机保存的密钥；启动配置提供的密钥仍会使用。':present?'本机已有保存密钥；当前启动密钥优先。替换保存值不会移除启动覆盖。':'密钥由启动配置提供，未保存到本机。新任务会沿用，之后启动时仍需提供。'):action==='remove'?'保存后移除本机保存的密钥；不会取消已经开始的任务。':present||action==='replace'?'已存密钥不会显示或返回浏览器。':'尚未设置密钥，该服务暂时无法生成。';
 return <div className="yu-provider-key">
  <div className="yu-provider-key-head"><span><KeyRound size={14}/>{title}</span><em className={`yu-provider-pill ${override==='invalid'||!present&&!fromStartup?'warn':'ok'}`}>{override==='invalid'?'启动密钥无效':fromStartup?present?'启动覆盖':'启动提供 · 未保存':present?'已保存':'未设置'}</em></div>
  <Choices name={name} label={`${title}操作`} variant="segments" value={action} onChange={onAction} options={[{value:'keep',label:present?'保留':fromStartup?'沿用启动密钥':'暂不设置'},{value:'replace',label:present?'替换':'输入密钥'},{value:'remove',label:'移除',disabled:!present}]}/>
  {action==='replace'&&<label className="yu-provider-field">新{title}<input type="password" autoComplete="off" spellCheck={false} value={value} onChange={e=>onValue(e.target.value)} required maxLength={4096} placeholder="粘贴后保存，之后不再显示"/></label>}
  <p className={action==='remove'||override==='invalid'?'danger':undefined}>{description}</p>
 </div>;
}
export default function ProviderSettings({onRuntime,onAvailability,openRequest=0,showEntry=true,showPrompt=false}:{onRuntime?:(runtime:Runtime|null)=>void;onAvailability?:(allowed:boolean)=>void;openRequest?:number;showEntry?:boolean;showPrompt?:boolean}){
 const [access,setAccess]=useState<'unknown'|'allowed'|'denied'>('unknown');
 const [open,setOpen]=useState(false),[view,setView]=useState<ProviderSettingsView|null>(null),[draft,setDraft]=useState<Settings|null>(null);
 const [runtime,setRuntime]=useState<ProviderSettingsView['runtime']|null>(null);
 useEffect(()=>{onRuntime?.(runtime);},[runtime,onRuntime]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[key,setKey]=useState(''),[keyAction,setKeyAction]=useState<ProviderSettingsSave['keyAction']>('keep');
 const [imageKey,setImageKey]=useState(''),[imageKeyAction,setImageKeyAction]=useState<ProviderSettingsSave['imageKeyAction']>('keep');
 const live=useRef(true),saving=useRef(false),readVersion=useRef(0);
 function adopt(result:ProviderSettingsView){setAccess('allowed');setView(result);setDraft(result.settings);setRuntime(result.runtime);setKey('');setKeyAction('keep');setImageKey('');setImageKeyAction('keep');}
 async function load(){
  const version=++readVersion.current;
  setBusy(true);setError('');setMessage('');
  try{const result=await request('local/provider-settings');if(live.current&&version===readVersion.current){adopt(result);}}
  catch(e){
   if(live.current&&version===readVersion.current){
    const status=(e as {status?:number}).status;
    if(status===403||status===404){setAccess('denied');setOpen(false);setView(null);setDraft(null);setError('请使用本机或可信局域网地址打开生成服务设置；互联网阅读入口不支持编辑。');}
    else {if(status===503){setAccess('allowed');setView(null);setDraft(null);}setError(e instanceof Error?e.message:'暂时无法读取生成设置。');}
   }
   // 运行配置属于公开阅读元数据，与本机编辑权限无关。
   try{const status=await request('reader/status');if(live.current&&version===readVersion.current)setRuntime({provider:status.provider,imageProvider:status.imageProvider,models:status.models,configured:status.configured,taskReasoningEfforts:status.taskReasoningEfforts});}catch{}
  }
  finally{if(live.current&&version===readVersion.current)setBusy(false);}
 }
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[]);
 useEffect(()=>{onAvailability?.(access==='allowed');},[access,onAvailability]);
 useEffect(()=>{if(openRequest&&access==='allowed')setOpen(true);},[openRequest,access]);
 function update<K extends keyof Settings>(field:K,value:Settings[K]){setDraft(old=>old?{...old,[field]:value}:old);setMessage('');}
 function selectProvider(provider:Settings['provider']){
  if(!draft)return;
  // 与文本相同时不保存独立值；仅在独立图片密钥仍归属同一服务时保留草稿。
  const imageProvider=draft.imageProvider===provider?undefined:draft.imageProvider;
  const nextKey=imageKeyDraftForProviderChange(draft,{provider,imageProvider},{imageKeyAction,imageKey});
  setImageKey(nextKey.imageKey);setImageKeyAction(nextKey.imageKeyAction);
  setDraft({...draft,provider,imageProvider,...(provider==='gemini'?{taskReasoningEfforts:Object.fromEntries(reasoningTasks.map(task=>[task,(geminiReasoningEfforts as readonly string[]).includes(draft.taskReasoningEfforts[task])?draft.taskReasoningEfforts[task]:taskReasoningDefaults[task]])) as Settings['taskReasoningEfforts']}:{})});setKey('');setKeyAction('keep');setError('');setMessage('');
 }
 async function save(){
  if(!draft||!view||saving.current)return;saving.current=true;readVersion.current++;setBusy(true);setError('');setMessage('');
  try{
   // null 清空旧的独立图片服务，未传入字段保留已存值。
   const result:ProviderSettingsView=await request('local/provider-settings','POST',{settings:{...draft,imageProvider:draft.imageProvider??null},expectedRevision:view.revision,keyAction,key,imageKeyAction,imageKey});
   if(live.current){adopt(result);setMessage(result.appliesToNewJobs?'已保存，新任务使用此配置。正在执行的任务继续使用原配置。':'设置已保存到本机共享数据库。');}
  }catch(e){if(live.current)setError(e instanceof Error?e.message:'设置暂未保存，请重新读取后再试。');}
  finally{saving.current=false;if(live.current)setBusy(false);}
 }
 const provider=draft?.provider,api=provider==='gemini'||provider==='openai',efforts=provider==='gemini'?geminiReasoningEfforts:codexReasoningEfforts;
 const imageProvider=draft?effectiveImageProvider(draft):null,separateImage=!!imageProvider&&imageProvider!==provider,imageApi=separateImage&&isApiProvider(imageProvider)?imageProvider:null;
 const dirty=!!draft&&!!view&&(JSON.stringify(draft)!==JSON.stringify(view.settings)||keyAction!=='keep'||imageKeyAction!=='keep');
 const notice=message;
 const state=runtimeState(runtime),codexBlocked=view?.platform==='win32';
 const changed=(...fields:(keyof Settings)[])=>!!draft&&!!view&&fields.some(field=>JSON.stringify(draft[field])!==JSON.stringify(view.settings[field]));
 const textModelField=provider==='openai'?'openaiTextModel':provider==='codex'?'codexModel':'textModel',imageModelField=imageProvider==='openai'?'openaiImageModel':'imageModel';
 function keyOverride(name:'gemini'|'openai'):'valid'|'invalid'|undefined{return view?.keyOverrides&&view.overrides.includes(name==='gemini'?'GEMINI_API_KEY':'OPENAI_API_KEY')?view.keyOverrides[name]?'valid':'invalid':undefined;}
 const keyBadge=(name:'gemini'|'openai'):Option<string>['badge']=>view?(keyOverride(name)==='invalid'?{tone:'warn',text:'启动密钥无效'}:keyOverride(name)==='valid'?{tone:'ok',text:'启动提供'}:view.keyPresent[name]?{tone:'ok',text:'密钥已存'}:{tone:'warn',text:'缺少密钥'}):undefined;
 const providerOptions:Option<NonNullable<Settings['imageProvider']>>[]=[{value:'gemini',label:'Gemini',hint:'Google API 计费',badge:keyBadge('gemini')},{value:'openai',label:'OpenAI',hint:'OpenAI API 计费',badge:keyBadge('openai')},{value:'codex',label:'Codex',hint:codexBlocked?'Windows 暂不支持':'ChatGPT 订阅额度',disabled:codexBlocked}];
 function discard(){if(view){adopt(view);setError('');setMessage('');}}
 function selectImageProvider(value:NonNullable<Settings['imageProvider']>|''){
  if(!draft)return;
  // 选“与文本相同”时保持未设置；密钥操作与输入随独立图片服务一同清理。
  const next=value&&value!==provider?value:undefined;
  const nextKey=imageKeyDraftForProviderChange(draft,{provider:draft.provider,imageProvider:next},{imageKeyAction,imageKey});
  setImageKey(nextKey.imageKey);setImageKeyAction(nextKey.imageKeyAction);
  update('imageProvider',next);
 }
 async function testConnection(){
  if(!view||saving.current)return;
  saving.current=true;setBusy(true);setError('');setMessage('');
  try{const result=await request('local/provider-settings','POST',{action:'check',expectedRevision:view.revision});setMessage(result.message);}
  catch(e){setError(e instanceof Error?e.message:'操作失败，请重新读取设置。');}
  finally{saving.current=false;setBusy(false);}
 }
 return <>{showPrompt&&runtime?.configured===false&&!open&&<aside className="yu-provider-setup" role="status">请先配置生成服务。{access==='allowed'?<a href="#provider-settings">打开生成服务与模型</a>:<span>请使用本机或可信局域网地址打开 我的 → 生成服务与模型。</span>}</aside>}{showEntry&&access==='allowed'&&<button type="button" onClick={()=>{setOpen(true);void load();}}><Cpu size={20}/>生成服务与模型<ChevronRight size={18}/></button>}
 {open&&<Sheet title="生成服务与模型" busy={saving.current} onClose={()=>{setOpen(false);if(location.hash==='#provider-settings'&&historySteps.atBase())history.replaceState(history.state,'',location.pathname+location.search);setKey('');setKeyAction('keep');setImageKey('');setImageKeyAction('keep');}}>
  <div className="yu-provider-settings">
   <p className="yu-provider-intro">{view?.appliesToNewJobs?'与桌面、CLI 和技能共用。保存后用于新任务，无需重启；正在执行的任务保持原配置。':'与桌面、CLI 和技能共用。这里编辑保存的默认生成配置。'}</p>
   <section className={`yu-provider-status ${state.tone}`} aria-label="运行状态">
    <header><i className="yu-provider-dot"/><strong>{runtime?.provider==='readonly'?'只读模式':view?.appliesToNewJobs?'新任务配置':'当前服务配置'}</strong><em className={`yu-provider-pill ${state.tone}`}>{state.label}</em>
     {!!view?.overrides.length&&<em className="yu-provider-pill warn">{view.overrides.length} 项启动覆盖</em>}
    </header>
    {runtime&&runtime.provider!=='readonly'?<RuntimeRows runtime={runtime}/>:<p>{runtime?'当前不调用任何生成服务。':'正在读取运行配置…'}</p>}
    {!!view?.overrides.length&&<details className="yu-provider-overrides"><summary><AlertTriangle size={14}/>查看覆盖项</summary><ul>{view.overrides.map(name=><li key={name}><code>{name}</code></li>)}</ul><p>移除对应的启动覆盖后，保存值才会生效。</p></details>}
   </section>
   {view&&runtime?.configured===false&&runtime.provider!=='readonly'&&<aside className="yu-provider-diagnostics" aria-label="生成服务排查">
    <p>生成服务尚未就绪，可测试已保存配置的连接。</p>
    <button type="button" className="yu-provider-ghost" disabled={busy} onClick={()=>void testConnection()}>测试连接</button>
    <small>仅检查已保存配置及启动覆盖，不提交未保存的更改，不生成内容。</small>
   </aside>}
   {error?<p className="yu-batch-error" role="alert">{error}</p>:notice&&<p className="yu-provider-message" role="status">{notice}</p>}
   <form data-dirty={dirty?'true':undefined} onSubmit={e=>{e.preventDefault();void save();}}>
    {draft?<fieldset disabled={busy} aria-label="生成服务设置">
     <Group icon={<Type size={16}/>} title="文本服务" label="提供方与模型" changed={changed('provider',textModelField)||keyAction!=='keep'}>
      <Choices name="provider" label="文本服务" value={provider!} onChange={selectProvider} options={[...providerOptions,{value:'readonly',label:'只读',hint:'不调用生成服务'}]}/>
      {provider!=='readonly'&&<label className="yu-provider-field">文本模型<input value={draft[textModelField]} onChange={e=>update(textModelField,e.target.value)} placeholder={provider==='codex'?'留空使用 CLI 默认模型':undefined} spellCheck={false} required={api}/></label>}
      {api&&<KeyField name="key-action" title="API 密钥" present={!!view?.keyPresent[provider]} override={keyOverride(provider)} action={keyAction} onAction={value=>{setKeyAction(value);setKey('');setMessage('');}} value={key} onValue={setKey}/>}
     </Group>
     {provider!=='readonly'&&<Group icon={<ImageIcon size={16}/>} title="图片服务" label="图片服务设置" changed={changed('imageProvider',imageModelField)||imageKeyAction!=='keep'}>
      <Choices name="image-provider" label="图片服务" value={draft.imageProvider||''} onChange={selectImageProvider} options={[{value:'',label:'与文本相同',hint:labels[provider!]},...providerOptions.filter(option=>option.value!==provider)]}/>
      {separateImage&&<p>只用于绘制插图；选题、分镜与审核仍使用文本服务，制作流程不变。</p>}
      {isApiProvider(imageProvider)?<label className="yu-provider-field">图片模型<input value={draft[imageModelField]} onChange={e=>update(imageModelField,e.target.value)} spellCheck={false} required/></label>:<p>使用本机已登录的 Codex CLI 和订阅额度绘图。</p>}
      {imageApi?<KeyField name="image-key-action" title="图片服务 API 密钥" present={!!view?.keyPresent[imageApi]} override={keyOverride(imageApi)} action={imageKeyAction} onAction={value=>{setImageKeyAction(value);setImageKey('');setMessage('');}} value={imageKey} onValue={setImageKey}/>:!separateImage&&api&&<p>沿用文本服务的 API 密钥。</p>}
     </Group>}
     {provider!=='readonly'&&<details className="yu-provider-efforts"><summary><SlidersHorizontal size={16}/><span>推理档位</span><small>{reasoningTasks.length} 项任务</small>{changed('taskReasoningEfforts','codexReasoningEffort')&&<i className="yu-provider-changed">已修改</i>}</summary>
      <div className="yu-provider-effort-rows">
       {provider==='codex'&&<div className={draft.codexReasoningEffort!==view?.settings.codexReasoningEffort?'changed':undefined}><span>其他请求</span><Choices name="effort-codex" label="其他请求推理档位" variant="segments" value={draft.codexReasoningEffort} onChange={value=>update('codexReasoningEffort',value)} options={[{value:'',label:'默认'},...codexReasoningEfforts.map(value=>({value,label:value}))]}/></div>}
       {reasoningTasks.map(task=><div key={task} className={draft.taskReasoningEfforts[task]!==view?.settings.taskReasoningEfforts[task]?'changed':undefined}><span>{taskReasoningLabels[task]}</span><Choices<string> name={`effort-${task}`} label={`${taskReasoningLabels[task]}推理档位`} variant="segments" value={draft.taskReasoningEfforts[task]} onChange={value=>update('taskReasoningEfforts',{...draft.taskReasoningEfforts,[task]:value as Settings['taskReasoningEfforts'][typeof task]})} options={efforts.map(value=>({value,label:value}))}/></div>)}
      </div>
     </details>}
    </fieldset>:busy?<p role="status">正在读取本机设置…</p>:!error&&<p role="status">重新读取后可编辑设置。</p>}
    <div className="yu-provider-actions">
     <span className={dirty?'dirty':undefined}>{dirty?'有未保存的更改':draft?'与已保存设置一致':''}</span>
     <button type="button" className="yu-provider-ghost" aria-label="重新读取设置" title="只刷新表单，不重启服务" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>重新读取</button>
     {dirty&&<button type="button" className="yu-provider-ghost" disabled={busy} onClick={discard}><RotateCcw size={16}/>放弃</button>}
     {draft&&<button type="submit" className="yu-primary" disabled={!dirty||busy}>{saving.current?'正在保存…':dirty?'保存设置':'已保存'}</button>}
    </div>
   </form>
  </div>
 </Sheet>}</>;
}
