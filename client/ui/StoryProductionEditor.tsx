// Share production fields across creation drafts and immutable story revisions.
// Callbacks only update their owner's local draft; recommending and submitting stay explicit.
import {useId,useRef} from 'react';
import {Check} from 'lucide-react';
import StoryPromptDetails from './StoryPromptDetails';
import StoryArtStylePicker from './StoryArtStylePicker';
import {narrativeDetails} from '@/lib/reader-frame-recommendation';
import type {IntakeDraft} from '@/lib/reader-intake';
import {StoryArtRecommendation} from './StoryArtRecommendation';
import {artStylePromptMaxLength,getArtStyle} from '@/lib/reader-styles';
import type {ArtStyleId} from '@/lib/reader-styles';
import type {FrameRecommendation} from '@/lib/reader-frame-recommendation';
import type {ArtRecommendation} from '@/lib/reader-art-recommendation';
import type {RequirementEdits} from '@/lib/reader-requirements';
import StoryFlowAction from './StoryFlowAction';
export type StoryEditorTab='requirements'|'acceptance'|'style'|'count'|'script';
export type ProductionSettings=IntakeDraft;
const tabs:{id:StoryEditorTab;label:string}[]=[{id:'requirements',label:'制作要求'},{id:'acceptance',label:'验收要求'},{id:'style',label:'画风'},{id:'count',label:'叙事详略'},{id:'script',label:'分镜'}];
export function StoryEditorTabs({tab,onChange,script=false,disabled=false}:{tab:StoryEditorTab;onChange:(tab:StoryEditorTab)=>void;script?:boolean;disabled?:boolean}){
 return <nav className="yu-revision-tabs" aria-label="修改内容">{tabs.filter(t=>script||t.id!=='script').map(t=><button type="button" key={t.id} disabled={disabled} aria-pressed={tab===t.id} onClick={()=>onChange(t.id)}>{t.label}</button>)}</nav>;
}
export default function StoryProductionEditor({tab,settings,disabled,onChange,sessionId,creation=false,requirementsEdited,preparationPaused=false,recommendation,artRecommendation}:{tab:Exclude<StoryEditorTab,'script'>;settings:ProductionSettings;sessionId?:string;disabled:boolean;onChange:(patch:Partial<ProductionSettings>)=>void;creation?:boolean;requirementsEdited?:RequirementEdits;preparationPaused?:boolean;recommendation?:FrameRecommendation|null;artRecommendation?:ArtRecommendation}){
 const fieldId=useId(),promptField=useRef<HTMLTextAreaElement>(null);
 const defaultPrompt=getArtStyle(settings.artStyle).prompt;
 const customPrompt=!!settings.artStylePrompt?.trim()&&settings.artStylePrompt.trim()!==defaultPrompt;
 const missingProduction=!settings.productionPrompt.trim(),missingAcceptance=!settings.acceptancePrompt?.trim();
 const emptyField=tab==='requirements'&&missingProduction?'productionPrompt':tab==='acceptance'&&missingAcceptance?'acceptancePrompt':null;
 const chooseStyle=(artStyle:ArtStyleId)=>onChange({artStyle,artStylePrompt:null});
 return <fieldset className="yu-revision-fields" disabled={disabled}>
  {tab==='requirements'&&<label className="yu-revision-field">制作要求<textarea rows={7} maxLength={1200} value={settings.productionPrompt} onChange={e=>onChange({productionPrompt:e.target.value})}/><small>调整制作要求后，按已核原文重新生成梗概，再编排分镜。</small></label>}
  {tab==='acceptance'&&<div className="yu-revision-field">
   <label htmlFor={fieldId}>验收要求</label>
   <textarea id={fieldId} aria-describedby={fieldId+'-help'} rows={7} maxLength={1200} value={settings.acceptancePrompt||''} placeholder="每行一条，例如：关键反应必须落实到可见画面。" onChange={e=>onChange({acceptancePrompt:e.target.value})}/>
   <small id={fieldId+'-help'} className="yu-acceptance-help">
    <span>{creation?'本篇的验收建议可修改或清空。':''}每行一条，最多 20 条。</span>
    <span>要求仅用于审核，逐条给出结论和依据。只改验收要求时，保留分镜和可复用图片并重新审核。</span>
    <span>遇到要求与原文或制作要求冲突，或无法从文字分镜判断时，审核会停下并说明原因。</span>
   </small>
  </div>}
  {creation&&emptyField&&<div className="production-stage-actions">
   <small role="status">{requirementsEdited?.[emptyField]?'已留空':preparationPaused?'准备已暂停':'等待准备建议'}</small>
   {!requirementsEdited?.[emptyField]&&<StoryFlowAction disabled={disabled} onClick={()=>onChange({[emptyField]:''})}>留空</StoryFlowAction>}
  </div>}
  {(tab==='requirements'||tab==='acceptance')&&<StoryPromptDetails key={sessionId} sessionId={sessionId} kind={tab==='acceptance'?'acceptance':'production'} preferences={{...settings}}
   onUseSuggestions={missingProduction||missingAcceptance?suggestions=>onChange({
    ...(missingProduction?{productionPrompt:suggestions.productionPrompt}:{}),
    ...(missingAcceptance?{acceptancePrompt:suggestions.acceptancePrompt}:{}),
   }):undefined}/>}
  {tab==='style'&&<>
   {artRecommendation&&<StoryArtRecommendation recommendation={artRecommendation} selected={settings.artStyle} disabled={disabled} onApply={()=>chooseStyle(artRecommendation.artStyle)}/>}
   <StoryArtStylePicker value={settings.artStyle} disabled={disabled} onChange={chooseStyle} onEditPrompt={()=>promptField.current?.focus()}/>
   <div className="yu-revision-field">
    <label htmlFor={fieldId}>画风提示词</label>
    <textarea ref={promptField} id={fieldId} aria-describedby={fieldId+'-help'} rows={7} maxLength={artStylePromptMaxLength} value={settings.artStylePrompt??defaultPrompt} placeholder={defaultPrompt} onChange={event=>onChange({artStylePrompt:event.target.value})} onBlur={event=>{const value=event.target.value;if(!value.trim()||value!==value.trim())onChange({artStylePrompt:value.trim()||null});}}/>
    <small id={fieldId+'-help'}>{customPrompt?'当前使用本篇修改。':'当前使用系统默认。'}编辑后应用于本篇的全部画幅。</small>
   </div>
   {customPrompt&&<>
    <details className="yu-style-default"><summary>查看系统默认提示词</summary><p>{defaultPrompt}</p></details>
    <div className="production-stage-actions"><StoryFlowAction onClick={()=>onChange({artStylePrompt:null})}>恢复系统默认</StoryFlowAction></div>
   </>}
  </>}
  {tab==='count'&&<section>
   <h3>叙事详略</h3>
   <div className="yu-narrative-details" role="group" aria-label="叙事详略">{narrativeDetails.map(detail=>{
    const selected=settings.narrativeDetail===detail.id;
    return <button type="button" key={detail.id} aria-pressed={selected} disabled={disabled} onClick={()=>onChange({narrativeDetail:detail.id,length:'auto'})}>
     <strong>{detail.label}{selected&&<Check size={14} aria-hidden="true"/>}</strong>
     <span>{detail.description.split(/(?<=[，、])/).map((part,index)=><span key={index}>{part}</span>)}</span>
    </button>;
   })}</div>
   <p className="yu-count-help">画幅数由模型按原文和详略编排，审核时可增减；文字稿稳定后再生成图片。</p>
   {recommendation&&<p className="yu-count-help">初步估计 {recommendation.count} 幅，最终数量以编排和审核结果为准。</p>}
  </section>}
 </fieldset>;
}
