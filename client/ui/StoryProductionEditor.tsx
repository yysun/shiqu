// Share production fields across creation drafts and immutable story revisions.
// Callbacks only update their owner's local draft; recommending and submitting stay explicit.
import StoryPromptDetails from './StoryPromptDetails';
import StoryArtStylePicker from './StoryArtStylePicker';
import {narrativeDetails} from '@/lib/reader-frame-recommendation';
import type {NarrativeDetail} from '@/lib/reader-frame-recommendation';
import {StoryArtRecommendation} from './StoryArtRecommendation';
import type {ArtStyleId} from '@/lib/reader-styles';
import type {FrameRecommendation} from '@/lib/reader-frame-recommendation';
import type {ArtRecommendation} from '@/lib/reader-art-recommendation';
import StoryFlowAction from './StoryFlowAction';
export type StoryEditorTab='requirements'|'acceptance'|'style'|'count'|'script';
export type ProductionSettings={artStyle:ArtStyleId;productionPrompt:string;acceptancePrompt?:string;length:number|'auto';narrativeDetail:NarrativeDetail};
const tabs:{id:StoryEditorTab;label:string}[]=[{id:'requirements',label:'制作要求'},{id:'acceptance',label:'验收要求'},{id:'style',label:'画风'},{id:'count',label:'叙事详略'},{id:'script',label:'分镜'}];
export function StoryEditorTabs({tab,onChange,script=false,disabled=false}:{tab:StoryEditorTab;onChange:(tab:StoryEditorTab)=>void;script?:boolean;disabled?:boolean}){
 return <nav className="yu-revision-tabs" aria-label="修改内容">{tabs.filter(t=>script||t.id!=='script').map(t=><button type="button" key={t.id} disabled={disabled} aria-pressed={tab===t.id} onClick={()=>onChange(t.id)}>{t.label}</button>)}</nav>;
}
export default function StoryProductionEditor({tab,settings,disabled,onChange,sessionId,creation=false,recommendation,artRecommendation,onRecommend}:{tab:Exclude<StoryEditorTab,'script'>;settings:ProductionSettings;sessionId?:string;disabled:boolean;onChange:(patch:Partial<ProductionSettings>)=>void;creation?:boolean;recommendation?:FrameRecommendation|null;artRecommendation?:ArtRecommendation;onRecommend?:()=>void}){
 return <fieldset className="yu-revision-fields" disabled={disabled}>
  {tab==='requirements'&&<label className="yu-revision-field">制作要求<textarea rows={7} maxLength={1200} value={settings.productionPrompt} onChange={e=>onChange({productionPrompt:e.target.value})}/><small>{creation?'根据本篇原文提供改编建议，可修改或清空。确认制作后用于编排分镜和生成画面。':'修改制作要求会重新编排故事和生成画面，原文保持不变。'}</small></label>}
  {tab==='acceptance'&&<label className="yu-revision-field">验收要求<textarea rows={7} maxLength={1200} value={settings.acceptancePrompt||''} placeholder="每行一条，例如：关键反应必须落实到可见画面。" onChange={e=>onChange({acceptancePrompt:e.target.value})}/><small>{creation?'根据本篇改编重点提供验收建议，可修改或清空；仅用于审核，不参与分镜生成。':''}每行一条，最多20条。审核逐条给出结论和依据；只改验收要求会保留分镜与可复用图片，重新审核。与原文或制作要求冲突、无法从文字分镜判断时会停下说明。</small></label>}
  {(tab==='requirements'||tab==='acceptance')&&<StoryPromptDetails sessionId={sessionId} kind={tab==='acceptance'?'acceptance':'production'} preferences={{...settings}}/>}
  {tab==='style'&&<>
   {artRecommendation&&<StoryArtRecommendation recommendation={artRecommendation} selected={settings.artStyle} disabled={disabled} onApply={()=>onChange({artStyle:artRecommendation.artStyle})}/>}
   <StoryArtStylePicker value={settings.artStyle} disabled={disabled} onChange={artStyle=>onChange({artStyle})}/>
  </>}
  {tab==='count'&&<section><h3>叙事详略</h3><div className="yu-narrative-details" role="group" aria-label="叙事详略">{narrativeDetails.map(detail=><button type="button" key={detail.id} aria-pressed={settings.narrativeDetail===detail.id} className={settings.narrativeDetail===detail.id?'selected':''} disabled={disabled} onClick={()=>onChange({narrativeDetail:detail.id,length:'auto'})}><strong>{detail.label}</strong><span>{detail.description.split(/(?<=[，、])/).map((part,index)=><span key={index}>{part}</span>)}</span></button>)}</div><p className="yu-count-help">画幅数由模型按原文和详略编排，审核时可增减；文字稿稳定后再生成图片。</p>{recommendation&&<p className="yu-count-help">初步估计 {recommendation.count} 幅，最终数量以编排和审核结果为准。</p>}</section>}
  {onRecommend&&(tab==='count'||tab==='requirements')&&<><StoryFlowAction onClick={onRecommend}>按当前要求重新准备</StoryFlowAction><p className="yu-count-help">保存设置并核对原文；审核通过前不会绘图。</p></>}
 </fieldset>;
}
