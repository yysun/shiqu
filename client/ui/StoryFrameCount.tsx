// Separate narrative preference from the model's durable count suggestion; confirm before drawing.
import {useState} from 'react';
import {readerMinFrames,readerMaxFrames} from '@/lib/reader-limits';
import type {FrameRecommendation} from '@/lib/reader-frame-recommendation';
export function StoryFrameCountInput({count,disabled,onChange}:{count:number;disabled:boolean;onChange:(count:number)=>void}){
 function choose(value:number){if(Number.isInteger(value)&&value>=readerMinFrames&&value<=readerMaxFrames)onChange(value);}
 return <div className="yu-count-controls">
  <input type="range" disabled={disabled} aria-label="目标幅数滑块" aria-valuetext={count===1?'单幅概述':`${count} 幅`} min={readerMinFrames} max={readerMaxFrames} step={1} value={count} onChange={e=>choose(Number(e.target.value))}/>
  <label><input type="number" disabled={disabled} aria-label="目标幅数输入" min={readerMinFrames} max={readerMaxFrames} step={1} value={count} onChange={e=>choose(e.target.valueAsNumber)} onBlur={e=>{e.target.value=String(count);}}/><span>幅</span></label>
 </div>;
}
export default function StoryFrameCount({recommendation,disabled,onConfirm}:{recommendation:FrameRecommendation;disabled:boolean;onConfirm:(count:number)=>void}){
 const [count,setCount]=useState(recommendation.count);
 return <section className="yu-frame-recommendation" aria-label="画幅建议"><h3>建议用 {recommendation.count} 幅讲述</h3><p className="yu-count-help">{recommendation.reason}</p><fieldset className="yu-frame-count" disabled={disabled}>
  <legend className="yu-choice-label">画幅数，可自行调整</legend>
  <StoryFrameCountInput count={count} disabled={disabled} onChange={setCount}/>
  <p className="yu-count-help" aria-live="polite">{count===1?'单幅概述：用一个关键瞬间和旁白概括故事。':`按 ${count} 幅编排完整分镜，随后自动生成整篇画面。`}</p>
  <button type="button" className="yu-count-reset" disabled={count===recommendation.count} onClick={()=>setCount(recommendation.count)}>使用推荐数量（{recommendation.count} 幅）</button>
  <button type="button" className="yu-primary" onClick={()=>onConfirm(count)}>{disabled?'正在开启…':count===1?'生成单幅概述':`生成 ${count} 幅`}</button>
 </fieldset></section>;
}
