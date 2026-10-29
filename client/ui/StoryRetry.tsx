'use client';
// Make recovery explicit and preserve already completed work when resuming a stopped task.
import type {SessionView} from '@/lib/reader-model';

export default function StoryRetry({session,busy,onRetry,primary=false}:{session:SessionView;busy:boolean;onRetry:()=>void;primary?:boolean}){
 if(!session.retryAllowed)return null;
 const publication=session.retryStage==='publication';
 return <div className="yu-retry-control"><small>{publication?'图片已生成，可重试展开，不会重新绘制。':session.retryMayCharge?'已完成的内容会保留，仅继续生成未完成的部分。':'故事编排已保留，可重新检索原文。'}</small><button className={primary?'yu-primary':undefined} disabled={busy} onClick={onRetry}>{busy?'正在请求…':publication?'重试展开':session.retryMayCharge?(session.state==='failed'?'重试生成':'继续生成'):'重试原文检索'}</button></div>;
}
