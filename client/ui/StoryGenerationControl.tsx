// Pause active production or resume a manual pause; failed work uses its fault recovery action.
// 需要读者操作而生命周期暂不提供该动作时，显示原因而不是留空，避免只有状态没有入口。
import StoryFlowAction from './StoryFlowAction';
import type {ProductionAction,SessionView} from '@/lib/reader-model';
import {productionBlockedReason} from '@/lib/shelf-generation';

type ControlState=Pick<SessionView,'awaitingContinue'|'redrawPage'|'snapshotUnavailable'|'id'|'state'|'superseded'|'generationControl'|'error'|'lifecycle'>&{intake?:Pick<NonNullable<SessionView['intake']>,'phase'>};
type Props={session:ControlState;busy:boolean;onControl:(id:string,action:ProductionAction)=>Promise<void>;primary?:boolean;link?:boolean};
export default function StoryGenerationControl({session,busy,onControl,primary=false,link=false}:Props){
 const offers=session.lifecycle?.actions;
 const available=(action:ProductionAction)=>offers?.some(offer=>offer.event===action)??true;
 // 已完成作品只在刷新建议进行中，或可选工作暂停且可恢复时显示控制。
 const pausedOptional=!!session.generationControl&&session.generationControl!=='active'&&(session.lifecycle?.optionalWork??!!offers?.some(offer=>offer.event==='resume'));
 if(session.state==='completed'&&session.lifecycle?.preparationRefresh!=='pending'&&!pausedOptional)return null;
 const blocked=<p className="yu-generation-control" role="status">{productionBlockedReason(session)}</p>;
 // 已保存的修订：只有「继续制作」开始制作，不与暂停、恢复混用。任务清单里的主要操作一律是文字链接（AGENTS.md 界面规则），不受 link 参数影响。
 if(session.awaitingContinue&&!session.superseded)return available('continue')?<StoryFlowAction type="button" className="yu-generation-control" disabled={busy} aria-busy={busy} onClick={()=>void onControl(session.id,'continue')}>{session.redrawPage?`重绘第 ${session.redrawPage} 幅`:'继续制作'}</StoryFlowAction>:blocked;
 // 快照服务不可用：恢复快照服务或应用当前模型设置后，已授权任务继续排队。
 if(session.snapshotUnavailable&&!session.superseded)return available('apply-model')?<StoryFlowAction type="button" className="yu-generation-control" disabled={busy} aria-busy={busy} onClick={()=>void onControl(session.id,'apply-model')}>应用当前模型设置</StoryFlowAction>:blocked;
 if(session.superseded)return <p className="yu-generation-control">这是旧版本，请打开书架中的最新版本继续生成。</p>;
 const preparing=!!session.intake&&['preparing','discovering'].includes(session.intake.phase);
 const manual=!!session.generationControl&&session.generationControl!=='active';
 if(!manual&&(session.state==='failed'||session.error))return null;
 const action=manual?'resume':'pause';
 if(!available(action))return manual?blocked:null;
 return <StoryFlowAction asLink={link} type="button" className={primary?'yu-primary':'yu-generation-control'} disabled={busy} aria-busy={busy} onClick={()=>void onControl(session.id,action)}>{manual?(preparing?'恢复准备':'恢复生成'):'暂停生成'}</StoryFlowAction>;
}
