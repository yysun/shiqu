// Inspect saved call receipts without enlarging production polling; preview edits are never history.
import {useEffect,useState} from 'react';
import {request} from './shared';
import {promptRecordText} from '@/lib/reader-prompt-records';
import type {PromptRecord} from '@/lib/reader-prompt-records';
import {acceptanceCriteria} from '@/lib/reader-acceptance';
import type {AcceptanceResult} from '@/lib/reader-acceptance';
import StoryFlowAction from './StoryFlowAction';
type Receipt={step:string;model:string;originId:string;index:number;record:PromptRecord};
export type PromptDetails={records:Receipt[];criteria:string[];results:AcceptanceResult[];overridden:boolean;previews:{production:PromptRecord;acceptance:PromptRecord}};
function PromptText({record}:{record:PromptRecord}){
 const [status,setStatus]=useState(''),text=promptRecordText(record);
 async function copy(){try{await navigator.clipboard.writeText(text);setStatus('已复制');}catch{setStatus('复制失败，可在下方选中文字复制。');}}
 return <><StoryFlowAction onClick={()=>void copy()}>复制完整提示词</StoryFlowAction>{status&&<small role="status">{status}</small>}<pre tabIndex={0} className="yu-prompt-text">{text}</pre></>;
}
export function PromptDetailsContent({data,kind,sessionId,preferences}:{data:PromptDetails;kind:'production'|'acceptance';sessionId:string;preferences:Record<string,unknown>}){
 const records=data.records.filter(item=>(item.step.startsWith('review'))===(kind==='acceptance'));
 const previewInput=kind==='production'?Object.fromEntries(Object.entries(preferences).filter(([key])=>!['acceptancePrompt','acceptanceCriteria'].includes(key))):preferences;
 const preview={...data.previews[kind],input:JSON.stringify(previewInput,null,2)};
 const labels={passed:'通过',failed:'未通过',unknown:'无法判断'};
 return <section className="yu-prompt-details" aria-label={kind==='acceptance'?'验收规则与结果':'制作提示词'}>
  {kind==='acceptance'&&<section aria-label="已保存的验收结果"><h3>上次验收结果</h3><p className="yu-count-help">以下结果属于已保存版本，编辑要求后须重新审核。</p>{data.overridden&&<p role="status">此前曾选择跳过审片问题并绘图；跳过不代表验收通过。</p>}{data.results.length?<ol>{data.results.map(result=><li key={result.criterion}><strong>第 {result.criterion} 条 · {labels[result.status]}</strong><p>{data.criteria[result.criterion-1]}</p><p>{result.evidence}</p>{result.pages.length>0&&<small>{result.pages.map(page=>page===0?'结语':`第 ${page} 幅`).join('、')}</small>}</li>)}</ol>:<p>尚无本篇验收条目的审核结果。</p>}</section>}
  <details><summary>查看当前系统规则（预览）</summary><p className="yu-count-help">这是当前规则与编辑中的本篇要求。执行时还会加入原文、分镜、批次或审核意见；完整实际输入以执行后留存的记录为准。</p><PromptText record={preview}/></details>
  <details><summary>查看实际使用的完整提示词（{records.length} 次）</summary>{!records.length?<p>未留存。下次实际制作或审核后会保存本阶段提示词，旧版本不会补造历史记录。</p>:<>{records.map(item=><details key={`${item.originId}:${item.index}`}><summary>{item.step} · {item.originId===sessionId?'本版本实际使用':'沿用旧版本记录'} · {item.model}</summary><PromptText record={item.record}/></details>)}</>}</details>
 </section>;
}
export default function StoryPromptDetails({sessionId,kind,preferences}:{sessionId?:string;kind:'production'|'acceptance';preferences:Record<string,unknown>}){
 const [data,setData]=useState<PromptDetails|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError('');if(sessionId)void request(`reader/sessions/${sessionId}/prompts`).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'提示词暂时无法载入。');});return()=>{active=false;};},[sessionId,attempt]);
 if(!sessionId)return <p className="yu-count-help">本篇尚无提示词使用记录。</p>;
 if(error)return <div role="alert"><p>{error}</p><StoryFlowAction onClick={()=>setAttempt(n=>n+1)}>重新载入提示词</StoryFlowAction></div>;
 if(!data)return <p role="status">正在载入规则与使用记录…</p>;
 return <PromptDetailsContent data={data} kind={kind} sessionId={sessionId} preferences={{...preferences,acceptanceCriteria:acceptanceCriteria(preferences.acceptancePrompt as string)}}/>;
}
