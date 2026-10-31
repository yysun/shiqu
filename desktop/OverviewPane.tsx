// The desktop is a local service console; reading and creation stay in the single browser frontend.
import {ArrowRight,BookOpen,Bookmark,Check,ChevronRight,Clock3,ExternalLink,Feather,Layers3,RefreshCw,Sparkles} from 'lucide-react';
import {getArtStyle} from '../lib/reader-styles';
import type {SystemSettings} from '../lib/system-settings';
import {overviewStoryState,overviewSummary,type ServiceState} from './library-summary';
import {useLibrarySummary} from './useLibrarySummary';

type Props={native:boolean;state:ServiceState;busy:string;configured:boolean;settings:SystemSettings;previewUrl:string|null;onLaunch:()=>void;onQueue:()=>void;onSettings:()=>void};
const serviceLabels:Record<ServiceState,string>={loading:'正在读取服务状态',unavailable:'服务状态暂不可用',stopped:'服务尚未启动',running:'本机服务运行中',preview:'桌面开发预览'};
const providerLabels:Record<SystemSettings['provider'],string>={readonly:'只读模式',codex:'Codex',openai:'OpenAI API',gemini:'Gemini'};
export function OverviewPane({native,state,busy,configured,settings,previewUrl,onLaunch,onQueue,onSettings}:Props){
 const {summary,error,loading,refresh}=useLibrarySummary(native,settings.dataDirectory);
 const stats=summary?overviewSummary(summary.stories):null;
 const primaryLabel=busy?busy+'…':native?!configured?'完成设置':state==='running'?'打开拾趣':'启动并打开拾趣':'在浏览器打开拾趣';
 const disabled=!!busy||native&&configured&&['loading','unavailable'].includes(state);
 function launch(label:string,className:string){
  const content=<><span>{label}</span><ExternalLink size={16} aria-hidden="true"/></>;
  return native?<button type="button" className={className} disabled={disabled} onClick={onLaunch}>{content}</button>:previewUrl?<a className={className} href={previewUrl} target="_blank" rel="noopener noreferrer">{content}</a>:<button type="button" className={className} disabled>{content}</button>;
 }
 const metrics=[{key:'completed',label:'已完成',detail:'可以慢慢读的故事',Icon:BookOpen},{key:'active',label:'生成任务',detail:native&&state!=='running'?'启动服务后继续':'排队或生成中的记录',Icon:Layers3},{key:'attention',label:'待处理',detail:'确认、继续或重试',Icon:Clock3},{key:'saved',label:'已收藏',detail:'想再读一遍的故事',Icon:Bookmark}] as const;
 return <div className="overview-pane">
  <section className="overview-hero" aria-labelledby="overview-title">
   <div className="overview-hero-copy"><div className={'overview-status is-'+state}><span aria-hidden="true"/>{serviceLabels[state]}</div><p className="overview-eyebrow">一台电脑，一间自己的故事书房</p><h2 id="overview-title">把今天，留给<br/>一个好故事<span>。</span></h2><p className="overview-intro">在浏览器里阅读与创作。<br/>故事、插图和阅读进度，都留在这台电脑。</p><div className="overview-hero-actions">{launch(primaryLabel,'overview-launch')}<button type="button" className="overview-hero-settings" onClick={onSettings}>设置<ChevronRight size={14}/></button></div>{!native&&!previewUrl&&<p className="overview-preview-help">预览未连接阅读端。启动阅读端后，用 VITE_DESKTOP_READER_URL 指定本机地址。</p>}</div>
   <div className="overview-book-art" aria-hidden="true"><div className="overview-orbit"/><div className="overview-art-leaf"><Feather size={26} strokeWidth={1.1}/></div><div className="overview-art-book book-back"><span>山海之间</span></div><div className="overview-art-book book-front"><div className="overview-book-border"/><small>片刻入戏 · 久久回味</small><strong>拾趣</strong><i>故事有尽<br/>余味未尽</i></div><span className="overview-art-caption">好故事，近在身边。</span></div>
  </section>
  <section className="overview-library" aria-labelledby="overview-library-title"><div className="overview-section-heading"><div><p className="overview-kicker">故事留在这里</p><h2 id="overview-library-title">书库一瞥</h2></div><span className="overview-data-note">本机生成记录 · 每 4 秒更新</span></div>
   <div className="overview-metrics">{metrics.map(({key,label,detail,Icon})=><div className={'overview-metric metric-'+key} key={key}><div><span>{label}</span><Icon size={17} strokeWidth={1.5} aria-hidden="true"/></div><strong>{stats?stats[key]:'—'}</strong><p>{detail}</p></div>)}</div>
   {error&&<div className="overview-summary-error" role="alert"><span>书库暂时无法读取，统计尚不可用。</span><button type="button" onClick={refresh}>重新读取<RefreshCw size={13}/></button><p>{error}</p></div>}
  </section>
  <div className="overview-details">
   <section className="overview-card overview-attention" aria-labelledby="overview-attention-title"><div className="overview-card-heading"><h2 id="overview-attention-title"><Sparkles size={17} strokeWidth={1.5}/>接下来做什么</h2><button type="button" onClick={onQueue}>查看队列<ArrowRight size={14}/></button></div>
    {!stats?<div className="overview-small-empty" role="status"><Clock3 size={23}/><p>{loading?'正在读取生成进度…':'进度暂不可用'}</p></div>:stats.actionable.length?<><ul className="overview-action-list">{stats.actionable.map(story=><li key={story.id}><button className="overview-action-row" type="button" onClick={onQueue} aria-label={'查看生成队列：'+story.title}><span className={'overview-action-dot '+(story.failed||story.state==='failed'?'needs-retry':'')}/><div><h3>{story.title}</h3><p>{story.book} · {overviewStoryState(story).label}</p></div><ChevronRight size={15} aria-hidden="true"/></button></li>)}</ul><div className="overview-card-foot">{launch('打开拾趣处理','overview-text-link')}</div></>:<div className="overview-small-empty"><Check size={26} strokeWidth={1.4}/><h3>{stats.active?native&&state!=='running'?'任务已保留。':'故事正在慢慢展开':'此刻，不必着急。'}</h3><p>{stats.active?native&&state!=='running'?`${stats.active} 篇故事尚未完成，启动服务后可继续。`:`${stats.active} 篇故事正在排队或生成，可到队列查看进度。`:'没有需要处理的任务，翻开故事就好。'}</p></div>}
   </section>
   <section className="overview-card" aria-labelledby="overview-recent-title"><div className="overview-card-heading"><h2 id="overview-recent-title"><BookOpen size={17} strokeWidth={1.5}/>最近的故事</h2><span>{summary?summary.stories.length+' 条生成记录':'—'}</span></div>
    {!stats?<div className="overview-small-empty" role="status"><BookOpen size={24}/><p>{loading?'正在打开本机书库…':'书库暂不可用'}</p></div>:stats.recent.length?<><ul className="overview-recent-list">{stats.recent.map((story,index)=><li key={story.id}><div className={'overview-mini-book mini-book-'+index%3} aria-hidden="true"><BookOpen size={20} strokeWidth={1.3}/></div><div className="overview-recent-copy"><h3>{story.title}</h3><p>{story.book} · {getArtStyle(story.artStyle).label}</p><span>{overviewStoryState(story).label}{story.total>0?' · '+story.ready+' / '+story.total+' 幅':''}</span></div>{!!story.saved&&<Bookmark size={14} fill="currentColor" className="overview-saved" aria-label="已收藏"/>}</li>)}</ul><div className="overview-card-foot">{launch('在拾趣里继续阅读','overview-text-link')}</div></>:<div className="overview-small-empty"><Feather size={29} strokeWidth={1.2}/><h3>第一篇故事，等你翻开。</h3><p>在浏览器中开启一篇故事，它会留在这间书房。</p></div>}
   </section>
  </div>
  <div className="overview-config"><span className="overview-config-icon"><Feather size={17}/></span><div><strong>{native?providerLabels[settings.provider]:'生成配置'}</strong><p>{!native?'在桌面应用中查看或修改':settings.provider==='readonly'?'已保存 · 只读模式，不调用生成服务':!configured?'尚未完成生成配置':'已保存的生成配置 · '+(settings.provider==='openai'?settings.openaiTextModel:settings.provider==='codex'?settings.codexModel||'跟随 Codex 默认':settings.textModel)}</p></div><button type="button" onClick={onSettings}>调整配置<ChevronRight size={14}/></button></div>
 </div>;
}
