'use client';
// Make recovery explicit and preserve already completed work when resuming a stopped task.
import type {SessionView} from '@/lib/reader-model';

export default function StoryRetry({session,busy,onRetry,primary=false}:{session:SessionView;busy:boolean;onRetry:()=>void;primary?:boolean}){
 if(!session.retryAllowed||session.generationControl&&session.generationControl!=='active')return null;
 const publication=session.retryStage==='publication',review=session.retryStage==='review',source=session.retryStage==='source';
 return <div className="yu-retry-control"><small>{review?'分镜与审片问题已保存。继续修订会再次调用文本模型，通过后才开始绘图。':publication?'图片已生成，可重试展开，不会重新绘制。':source?'故事编排已保留，可重新检索原文。':'已完成的内容会保留，仅继续生成未完成的部分。'}</small><button className={primary?'yu-primary':undefined} disabled={busy} onClick={onRetry}>{busy?'正在请求…':review?'继续修订分镜':publication?'重试展开':source?'重试原文检索':(session.state==='failed'?'重试生成':'继续生成')}</button></div>;
}
