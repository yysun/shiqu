// 服务状态、生命周期操作与只读生成摘要，均由控制器传入，不读取故事记录。
import type {ServiceState,Status} from './console-state';
import {stateLabels} from './console-state';
import type {ProviderSettingsView} from '../lib/provider-settings';
const labels:Record<string,string>={readonly:'只读',gemini:'Gemini',openai:'OpenAI API',codex:'Codex',claude:'Claude Code',deepseek:'DeepSeek'};
type Props={state:ServiceState;status:Status;native:boolean;busy:string;provider:ProviderSettingsView['runtime'];nodeVersion?:string;nodeError:string;onStart:()=>void;onStop:()=>void;onRestart:()=>void;onOpen:()=>void;onSettings:()=>void;previewUrl:string|null};
export function ServiceCard({state,status,native,busy,provider,nodeVersion,nodeError,onStart,onStop,onRestart,onOpen,onSettings,previewUrl}:Props){
 const pending=state==='starting'||state==='upgrading',locked=!native||!!busy||pending||state==='loading'||state==='unavailable';
 return <section className="service-card" aria-label="本机服务">
  <div className="service-label"><i className={status.running?'status-dot live':'status-dot'}/><span role="status">{stateLabels[state]}</span><span className="runtime-badge">{nodeVersion?`Node ${nodeVersion}`:nodeError?'运行时不可用':'内置运行时'}</span></div>
  <h2>故事在浏览器里，<br/>服务在这里。</h2><p>启动后，在电脑或手机上打开拾趣。</p>
  {(status.error||status.settingsError||nodeError)&&<p className="service-error" role="alert">{status.error||status.settingsError||nodeError}</p>}
  {status.agentSkill?.message&&<p className="agent-skill-status" role="status">{status.agentSkill.message}</p>}
  <div className="service-actions">
   <button className="primary" disabled={locked||status.running} onClick={onStart}>{pending?stateLabels[state]+'…':'启动服务'}</button>
   <button className="secondary" disabled={locked||!status.running} onClick={onStop}>停止</button>
   <button className="secondary" disabled={locked||!status.running} onClick={onRestart}>重启服务</button>
  </div>
  {native?<button className="browser-link" disabled={locked||!status.running} onClick={onOpen}>在浏览器打开 ↗</button>:previewUrl?<a className="browser-link" href={previewUrl} target="_blank" rel="noopener noreferrer">在浏览器打开 ↗</a>:<p>阅读端尚未连接，请先启动拾趣服务。</p>}
  {status.running&&status.url&&<p className="service-address">{status.url}</p>}
  {pending&&<p role="status">{state==='upgrading'?'升级与恢复完成后会继续启动，请保持应用打开。':'正在启动本机服务，请稍候。'}</p>}
  {status.backup&&<p className="backup-path">已校验的升级备份：{status.backup}</p>}
  <div className="provider-summary" aria-label={status.running?'当前运行配置':'已保存配置'}><div><strong>{status.running?'当前运行':'已保存配置'} · {provider.provider==='readonly'?'只读':provider.configured===false?'未配置生成服务':labels[provider.provider]||provider.provider}</strong>{status.restartRequired&&<span>待重启生效</span>}</div>
   {provider.provider!=='readonly'&&provider.configured!==false&&<p>文本：{labels[provider.provider]} · {provider.models.text}<br/>图片：{labels[provider.imageProvider||provider.provider]} · {provider.models.image}</p>}
   <button className="text-button" disabled={locked||!status.running} onClick={onSettings}>生成服务与模型 ↗</button><p>在浏览器中配置；保存后用于新任务，无需重启。</p>
  </div>
 </section>;
}
