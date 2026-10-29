// Choose automatic story pacing or a bounded exact count before creating a new session.
import {useState} from 'react';
import {readerMinFrames,readerMaxFrames} from '@/lib/reader-limits';
import type {Selection} from '@/lib/reader-model';

export default function StoryFrameCount({value,disabled,onChange}:{value:Selection['length'];disabled:boolean;onChange:(value:Selection['length'])=>void}){
 const [manual,setManual]=useState(value==='auto'?36:value);
 const automatic=value==='auto',count=automatic?manual:value;
 function choose(count:number){if(!Number.isInteger(count)||count<readerMinFrames||count>readerMaxFrames)return;setManual(count);onChange(count);}
 return <fieldset className="yu-frame-count" disabled={disabled}>
  <legend className="yu-choice-label">目标幅数</legend>
  <div className="yu-count-modes">
   <label><input type="radio" name="frame-count-mode" checked={automatic} onChange={()=>onChange('auto')}/>模型自动决定</label>
   <label><input type="radio" name="frame-count-mode" checked={!automatic} onChange={()=>onChange(manual)}/>指定幅数</label>
  </div>
  {automatic?<p className="yu-count-help">按故事的事件与转折编排，通常参考 30–60 幅；短故事可以更少，不凑数。</p>:<>
   <div className="yu-count-controls">
    <input type="range" aria-label="目标幅数滑块" aria-valuetext={count===1?'单幅':`${count} 幅`} min={readerMinFrames} max={readerMaxFrames} step={1} value={count} onChange={e=>choose(Number(e.target.value))}/>
    <label><input type="number" aria-label="目标幅数输入" min={readerMinFrames} max={readerMaxFrames} step={1} value={count} onChange={e=>choose(e.target.valueAsNumber)} onBlur={e=>{e.target.value=String(count);}}/><span>幅</span></label>
   </div>
   <p className="yu-count-help" aria-live="polite">{count===1?'单幅：用一个关键瞬间讲述故事。':`将故事编排为 ${count} 幅。`}画面随阅读分批生成。</p>
  </>}
 </fieldset>;
}
