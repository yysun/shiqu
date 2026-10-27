'use client';
// Offer immediate manual recovery after automatic attempts are exhausted.
import type {SessionView} from '@/lib/reader-model';

export default function StoryRetry({session,busy,onRetry,primary=false}:{session:SessionView;busy:boolean;onRetry:()=>void;primary?:boolean}){
 if(!session.retryAllowed)return null;
 return <div className="yu-retry-control"><small>{session.retryMayCharge?'已完成的内容会保留，仅继续生成未完成的部分。':'故事编排已保留，可重新检索原文。'}</small><button className={primary?'yu-primary':undefined} disabled={busy} onClick={onRetry}>{session.retryMayCharge?'继续生成':'重试原文检索'}</button></div>;
}
