// Separate narrative preference from the model's durable count suggestion; confirm before drawing.
import {useState} from 'react';
import {readerMinFrames,readerMaxFrames} from '@/lib/reader-limits';
import {narrativeDetails} from '@/lib/reader-frame-recommendation';
import type {FrameRecommendation,NarrativeDetail} from '@/lib/reader-frame-recommendation';
export function StoryNarrativeDetail({value,disabled,onChange}:{value:NarrativeDetail;disabled:boolean;onChange:(value:NarrativeDetail)=>void}){
 return <fieldset className="yu-frame-count" disabled={disabled}><legend className="yu-choice-label">叙事详略</legend><div className="yu-detail-options">{narrativeDetails.map(detail=><label key={detail.id} className={value===detail.id?'selected':''}><input type="radio" name="narrative-detail" value={detail.id} checked={value===detail.id} onChange={()=>onChange(detail.id)}/><strong>{detail.label}</strong><span>{detail.description}</span></label>)}</div><p className="yu-count-help">先按原文推荐画幅数，你可以再调整；短故事不凑数。</p></fieldset>;
}
export default function StoryFrameCount({recommendation,disabled,onConfirm}:{recommendation:FrameRecommendation;disabled:boolean;onConfirm:(count:number)=>void}){
 const [count,setCount]=useState(recommendation.count);
 function choose(value:number){if(Number.isInteger(value)&&value>=readerMinFrames&&value<=readerMaxFrames)setCount(value);}
 return <section className="yu-frame-recommendation" aria-label="画幅建议"><h3>建议用 {recommendation.count} 幅讲述</h3><p className="yu-count-help">{recommendation.reason}</p><fieldset className="yu-frame-count" disabled={disabled}>
  <legend className="yu-choice-label">画幅数，可自行调整</legend>
  <div className="yu-count-controls">
   <input type="range" aria-label="目标幅数滑块" aria-valuetext={count===1?'单幅概述':`${count} 幅`} min={readerMinFrames} max={readerMaxFrames} step={1} value={count} onChange={e=>choose(Number(e.target.value))}/>
   <label><input type="number" aria-label="目标幅数输入" min={readerMinFrames} max={readerMaxFrames} step={1} value={count} onChange={e=>choose(e.target.valueAsNumber)} onBlur={e=>{e.target.value=String(count);}}/><span>幅</span></label>
  </div>
  <p className="yu-count-help" aria-live="polite">{count===1?'单幅概述：用一个关键瞬间和旁白概括故事。':`按 ${count} 幅编排完整分镜，画面随阅读分批生成。`}</p>
  <button type="button" className="yu-count-reset" disabled={count===recommendation.count} onClick={()=>setCount(recommendation.count)}>使用推荐数量（{recommendation.count} 幅）</button>
  <button type="button" className="yu-primary" onClick={()=>onConfirm(count)}>{disabled?'正在开启…':count===1?'生成单幅概述':`生成 ${count} 幅`}</button>
 </fieldset></section>;
}
