'use client';
// Pending faults expose recovery actions; timelines can place those actions in their footer.
// Active recoveries keep their old error in a disclosure.
import StoryFlowAction from './StoryFlowAction';
import {useState} from 'react';
import type {SessionView} from '@/lib/reader-model';
import type {FaultView} from '@/lib/reader-recovery';

function label(fault:FaultView){
 if(fault.retryReview)return '重试审核';
 if(fault.stage==='redraw')return fault.page===null?'重绘图片':`重绘第 ${fault.page+1} 幅`;
 return {prepare:'重试准备',source:'重试原文检索',publication:'重试保存图片',review:'继续自动修复',generation:'重试生成'}[fault.stage];
}
function recoveryLabel(fault:FaultView){
 if(fault.retryReview)return '正在重新审核';
 if(fault.stage==='redraw')return fault.page===null?'正在重绘图片':`正在重绘第 ${fault.page+1} 幅`;
 return {prepare:'正在重新准备',source:'正在重新检索原文',publication:'正在重新保存图片',review:'正在继续修订',generation:'正在恢复生成'}[fault.stage];
}
export default function StoryRetry({session,busy,onRetry,primary=false,link=false,display='all'}:{session:SessionView;busy:boolean;onRetry:(faultId?:string)=>void|Promise<void>;primary?:boolean;link?:boolean;display?:'all'|'feedback'|'actions'}){
 const [pending,setPending]=useState<string[]>([]);
 function recover(id:string){setPending(ids=>[...ids,id]);void Promise.resolve(onRetry(id)).finally(()=>setPending(ids=>ids.filter(value=>value!==id)));}
 const paused=!!session.generationControl&&session.generationControl!=='active';
 const action=(fault:FaultView)=>fault.state==='pending'&&fault.retryAllowed&&!paused&&<StoryFlowAction key={fault.id} asLink={link} type="button" className={primary?'yu-primary':undefined} disabled={pending.includes(fault.id)} onClick={()=>recover(fault.id)}>{pending.includes(fault.id)?'正在请求…':label(fault)}</StoryFlowAction>;
 if(session.faults?.length&&display==='actions')return session.faults.some(fault=>fault.state==='pending'&&fault.retryAllowed&&!paused)?<div className="yu-retry-actions">{session.faults.map(action)}</div>:null;
 if(session.faults?.length)return <div className="yu-fault-list" aria-label="待处理问题">{session.faults.map(fault=><div className="yu-retry-control" key={fault.id}>
  {fault.state==='recovering'?<div className="yu-recovery-status"><small>{recoveryLabel(fault)}</small><details className="yu-recovery-detail"><summary>上次错误</summary><p>{fault.page===null?'':`第 ${fault.page+1} 幅：`}{fault.message}</p></details></div>:<small>{paused?'已暂停，另有问题：':''}{fault.page===null?'':`第 ${fault.page+1} 幅：`}{fault.message}</small>}
  {fault.stage==='redraw'&&fault.state==='pending'&&<small>将重新生成此幅，可能消耗额度；其他已保存图片保留。</small>}
  {fault.stage==='publication'&&fault.state==='pending'&&<small>将重试保存已生成图片，不重新绘制。</small>}
  {display!=='feedback'&&action(fault)}
 </div>)}</div>;
 if(!session.retryAllowed||paused)return null;
 const stage=session.retryStage;
 const retry=<StoryFlowAction asLink={link} className={primary?'yu-primary':undefined} disabled={busy} onClick={()=>onRetry()}>{busy?'正在请求…':stage==='review'?'继续自动修复':stage==='source'?'重试原文检索':stage==='publication'?'重试保存图片':stage==='prepare'?'重试准备':stage==='redraw'?'重绘图片':'重试生成'}</StoryFlowAction>;
 return display==='actions'?<div className="yu-retry-actions">{retry}</div>:<div className="yu-retry-control"><small>已完成的内容会保留，请刷新当前问题后恢复。</small>{display!=='feedback'&&retry}</div>;
}
