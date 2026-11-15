// Read saved audit and repair evidence on demand; version navigation never starts production.
import {useEffect,useState} from 'react';
import {request} from './shared';
import type {StoryReviewHistory as History,ReviewHistoryEntry,ReviewTextChange} from '@/lib/reader-review-history';
import type {RepairedPage} from '@/lib/reader-review';
import './story-review-history.css';
import StoryFlowAction from './StoryFlowAction';

const outcomeLabels={passed:'通过','needs-change':'需修订',unknown:'无法判断',changed:'已修订',unchanged:'无实际变化'};
const acceptanceLabels={passed:'通过',failed:'未通过',unknown:'无法判断'};
const pageLabel=(page:number)=>page===0?'结语':`第${page}幅`;
const range=(from:number,to:number)=>from===to?`第${from}幅`:`第${from}–${to}幅`;
function TextDiff({label,change}:{label:string;change:ReviewTextChange}){
 return <section className="yu-review-history-change"><h5>{label}</h5><div className="yu-review-history-diff"><div><strong>修改前</strong><p>{change.before??'未留存修改前内容。'}</p></div><div><strong>修改后</strong><p>{change.after}</p></div></div></section>;
}
function Frames({label,pages}:{label:string;pages:RepairedPage[]|null}){
 return <section className="yu-review-history-frames"><h5>{label}</h5>{pages===null?<p>未留存该段修改前内容。</p>:!pages.length?<p>无画幅</p>:pages.map(page=><div key={page.page}><strong>{pageLabel(page.page)}</strong><p>{page.caption}</p><details><summary>画面指令</summary><p>{page.prompt}</p></details></div>)}</section>;
}
export function ReviewHistoryEvent({entry,expanded=false}:{entry:ReviewHistoryEntry;expanded?:boolean}){
 const repair=entry.repair;
 return <details className="yu-review-history-event" open={expanded}>
  <summary><strong>{entry.title}</strong><span className={'yu-review-history-outcome is-'+entry.outcome}>{outcomeLabels[entry.outcome]}</span></summary>
  <div className="yu-review-history-body">
   <p className="yu-review-history-meta">{entry.recordedAt?new Date(entry.recordedAt).toLocaleString('zh-CN',{hour12:false}):'记录时间未留存'}{entry.model&&` · ${entry.model}`}</p>
   {entry.countReview&&<section><h4>画幅数判断</h4><p>{({keep:'保持现有分配',expand:'增加必要画幅',reduce:'精简重复画幅',redistribute:'重新分配画幅'})[entry.countReview.decision]} · 建议 {entry.countReview.proposedCount} 幅</p><p>{entry.countReview.reason}</p></section>}
   {!!entry.requirements?.length&&<section><h4>调整要求</h4><ol>{entry.requirements.map((item,index)=><li key={index}><strong>{pageLabel(item.page)} · {item.task}</strong><blockquote>{item.quote}</blockquote><p>原配文：{item.captionEvidence}</p><p>原画面：{item.visualEvidence}</p><p>问题：{item.loss}</p><p>修法：{item.instruction}</p></li>)}</ol></section>}
   {!entry.requirements?.length&&!!entry.issues.length&&<section><h4>审核意见</h4><ol>{entry.issues.map((issue,index)=><li key={index}><strong>{pageLabel(issue.page)}{issue.requiresReplan?' · 结构调整':''}</strong><p>{issue.problem}</p><p><strong>修订要求：</strong>{issue.instruction}</p></li>)}</ol></section>}
   {!!entry.acceptance?.length&&<section><h4>验收条目</h4><ol>{entry.acceptance.map(result=><li key={result.criterion}><strong>第{result.criterion}条 · {acceptanceLabels[result.status]}</strong><p>{result.text??'原验收要求未留存。'}</p><p>{result.evidence}</p>{!!result.pages.length&&<small>{result.pages.map(pageLabel).join('、')}</small>}</li>)}</ol></section>}
   {entry.titleChange&&<details><summary>标题审核</summary><p>{entry.titleChange.before===null?`《${entry.titleChange.after}》（旧标题未留存）`:entry.titleChange.before===entry.titleChange.after?`保留《${entry.titleChange.after}》`:`《${entry.titleChange.before}》 → 《${entry.titleChange.after}》`}</p><p>{entry.titleChange.reason}</p></details>}
   {entry.reflectionChoice&&<details><summary>结语选择</summary><p>{entry.reflectionChoice.text??'所选结语文本未留存。'}</p><p>{entry.reflectionChoice.reason}</p></details>}
   {!!entry.coverage?.length&&<details><summary>原文核对依据（{entry.coverage.length}项）</summary><ol>{entry.coverage.map((item,index)=><li key={index}><strong>{item.task}</strong><blockquote>{item.quote}</blockquote><p>{item.reason}</p>{!!item.pages.length&&<small>{item.pages.map(pageLabel).join('、')}</small>}</li>)}</ol></details>}
   {repair&&<>
    <p>本批对应：{repair.requested.map(pageLabel).join('、')||'全局人物设定'}</p>
    {entry.outcome==='unchanged'&&<p>本次返回的内容没有产生实际变化。</p>}
    {repair.structure&&<section><h4>结构修订 · {repair.structure.before} → {repair.structure.after} 幅</h4>{repair.structure.edits.map((edit,index)=><details key={index}><summary>{edit.to<edit.from?`在原第${edit.from}幅前插入`:edit.after.length?`替换原${range(edit.from,edit.to)}`:`删除原${range(edit.from,edit.to)}`}{!!edit.after.length&&` → 新${range(edit.newFrom,edit.newFrom+edit.after.length-1)}`}</summary><div className="yu-review-history-diff"><Frames label="修改前" pages={edit.before}/><Frames label="修改后" pages={edit.after}/></div></details>)}</section>}
    {repair.pages.map(page=><section className="yu-review-history-page" key={page.page}><h4>{pageLabel(page.page)}修订</h4>{page.before?.caption===page.after.caption?<p>旁白未变：{page.after.caption}</p>:<TextDiff label="旁白" change={{before:page.before?.caption??null,after:page.after.caption}}/>}<details><summary>{page.before?.prompt===page.after.prompt?'画面指令未变':'画面指令对照'}</summary>{page.before?.prompt===page.after.prompt?<p>{page.after.prompt}</p>:<TextDiff label="画面指令" change={{before:page.before?.prompt??null,after:page.after.prompt}}/>}</details></section>)}
    {repair.reflection&&<TextDiff label="结语修订" change={repair.reflection}/>}
    {repair.characters&&<details><summary>人物设定修订</summary><TextDiff label="人物设定" change={repair.characters}/></details>}
   </>}
  </div>
 </details>;
}
export function ReviewHistoryContent({data}:{data:History}){
 const ordered=data.entries.filter(x=>x.position!==null),unordered=data.entries.filter(x=>x.position===null);
 return <div className="yu-review-history-content">
  <h3>{data.title}</h3><p className="yu-review-history-note">第{data.revision}版 · 画幅编号以当次审核的稿件为准。</p>
  {data.overridden?<p className="yu-review-history-notice">已由你确认跳过未完成的审核；这不代表审核通过。</p>:data.status&&<p className="yu-review-history-notice">当前：{({pending:'审核尚未完成',repair:'待修订',passed:'审核通过',blocked:'审核已阻断'})[data.status]}</p>}
  {data.error&&<p className="yu-review-history-error">{data.error}</p>}
  {!data.entries.length?<p className="yu-review-history-empty">本版本尚无已保存的审核记录。{data.parentId?'可查看上一版本的记录。':''}</p>:<>
   <p className="yu-review-history-note">数量审核 {data.entries.filter(x=>x.kind==='count').length} 次 · 全篇审核 {data.entries.filter(x=>x.kind==='review').length} 次 · 修订 {data.entries.filter(x=>x.kind==='repair').length} 批</p>
   {ordered.map((entry,index)=><ReviewHistoryEvent key={entry.id} entry={entry} expanded={index===ordered.length-1}/>)}
   {!!unordered.length&&<section><h4>先后顺序未留存的记录</h4><p className="yu-review-history-note">以下按记录类别列出，未推断执行顺序。</p>{unordered.map(entry=><ReviewHistoryEvent key={entry.id} entry={entry}/>)}</section>}
  </>}
 </div>;
}
export default function StoryReviewHistory({sessionId}:{sessionId:string}){
 const [target,setTarget]=useState(sessionId),[attempt,setAttempt]=useState(0),[data,setData]=useState<History|null>(null),[error,setError]=useState('');
 useEffect(()=>{setTarget(sessionId);},[sessionId]);
 useEffect(()=>{let active=true;setData(null);setError('');void request(`reader/sessions/${encodeURIComponent(target)}/review-history`).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'审核记录暂时无法载入。');});return()=>{active=false;};},[target,attempt]);
 return <section className="yu-review-history" aria-label="审核、修订与复核记录">
  <div className="yu-review-history-nav">{target!==sessionId&&<StoryFlowAction onClick={()=>setTarget(sessionId)}>返回当前版本</StoryFlowAction>}{data?.parentId&&<StoryFlowAction onClick={()=>setTarget(data.parentId!)}>查看上一版本</StoryFlowAction>}<StoryFlowAction onClick={()=>setAttempt(n=>n+1)}>刷新记录</StoryFlowAction></div>
  {error?<div role="alert"><p>{error}</p><StoryFlowAction onClick={()=>setAttempt(n=>n+1)}>重新载入记录</StoryFlowAction></div>:!data?<p role="status">正在读取审核记录…</p>:<ReviewHistoryContent data={data}/>}
 </section>;
}
