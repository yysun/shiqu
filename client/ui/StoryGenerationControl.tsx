// Pause active production or resume a manual pause; failed work uses its fault recovery action.
import StoryFlowAction from './StoryFlowAction';
import type {ProductionAction,SessionView} from '@/lib/reader-model';

type ControlState=Pick<SessionView,'awaitingContinue'|'snapshotUnavailable'|'id'|'state'|'superseded'|'generationControl'|'error'>&{intake?:Pick<NonNullable<SessionView['intake']>,'phase'>};
type Props={session:ControlState;busy:boolean;onControl:(id:string,action:ProductionAction)=>Promise<void>;primary?:boolean;link?:boolean};
export default function StoryGenerationControl({session,busy,onControl,primary=false,link=false}:Props){
 if(session.state==='completed')return null;
 // 已保存的修订：只有「继续制作」开始制作，不与暂停、恢复混用。
 if(session.awaitingContinue&&!session.superseded)return <StoryFlowAction asLink={link} type="button" className={primary?'yu-primary':'yu-generation-control'} disabled={busy} aria-busy={busy} onClick={()=>void onControl(session.id,'continue')}>继续制作</StoryFlowAction>;
 // 快照服务不可用：先应用当前模型设置，再用故障的重试继续。
 if(session.snapshotUnavailable&&!session.superseded)return <StoryFlowAction asLink={link} type="button" className="yu-generation-control" disabled={busy} aria-busy={busy} onClick={()=>void onControl(session.id,'apply-model')}>应用当前模型设置</StoryFlowAction>;
 if(session.superseded)return <p className="yu-generation-control">这是旧版本，请打开书架中的最新版本继续生成。</p>;
 const preparing=!!session.intake&&['preparing','discovering'].includes(session.intake.phase);
 const manual=!!session.generationControl&&session.generationControl!=='active';
 if(!manual&&(session.state==='failed'||session.error))return null;
 return <StoryFlowAction asLink={link} type="button" className={primary?'yu-primary':'yu-generation-control'} disabled={busy} aria-busy={busy} onClick={()=>void onControl(session.id,manual?'resume':'pause')}>{manual?(preparing?'恢复准备':'恢复生成'):'暂停生成'}</StoryFlowAction>;
}
