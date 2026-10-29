// Keep durable generation intent explicit; mode changes never undo a manual pause or stop.
import type {ProductionAction,SessionView} from '@/lib/reader-model';

type Props={session:SessionView;busy:boolean;onControl:(id:string,action:ProductionAction)=>Promise<void>};
export default function StoryProductionControls({session,busy,onControl}:Props){
 if(session.state==='completed')return null;
 const background=session.generationMode==='background',manual=!!session.generationControl&&session.generationControl!=='active';
 return <section className="yu-production-controls" aria-label="故事生成控制">
  <label><input type="checkbox" role="switch" checked={background} disabled={busy} onChange={()=>void onControl(session.id,background?'reader':'background')}/><strong>后台生成整篇</strong></label>
  <p>{background?'离开页面后继续，服务启动后自动恢复；手动暂停或停止后保持暂停。':'仅在阅读时生成当前及后续画面。'}{background&&<span> 中断的请求恢复时可能再次消耗费用或额度。</span>}</p>
  <div>{manual?<button type="button" disabled={busy} onClick={()=>void onControl(session.id,'resume')}>恢复生成</button>:<button type="button" disabled={busy} onClick={()=>void onControl(session.id,'pause')}>暂停生成</button>}{session.generationControl!=='stopped'&&<button type="button" disabled={busy} onClick={()=>void onControl(session.id,'stop')}>停止生成</button>}<small role="status">{busy?'正在保存…':session.generationControl==='stopped'?'已手动停止':session.generationControl==='paused'?'已手动暂停':background?'后台模式':'阅读模式'}</small></div>
 </section>;
}
