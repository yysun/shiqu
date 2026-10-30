// Share production fields across creation drafts and immutable story revisions.
// Callbacks only update their owner's local draft; recommending and submitting stay explicit.
import StoryArtStylePicker from './StoryArtStylePicker';
import {StoryFrameCountInput} from './StoryFrameCount';
import {StoryArtRecommendation} from './StoryArtRecommendation';
import type {ArtStyleId} from '@/lib/reader-styles';
import type {FrameRecommendation} from '@/lib/reader-frame-recommendation';
import type {ArtRecommendation} from '@/lib/reader-art-recommendation';
export type StoryEditorTab='requirements'|'style'|'count'|'script';
export type ProductionSettings={artStyle:ArtStyleId;productionPrompt:string;length:number};
const tabs:{id:StoryEditorTab;label:string}[]=[{id:'requirements',label:'制作要求'},{id:'style',label:'画风'},{id:'count',label:'画幅数'},{id:'script',label:'分镜'}];
export function StoryEditorTabs({tab,onChange,script=false,disabled=false}:{tab:StoryEditorTab;onChange:(tab:StoryEditorTab)=>void;script?:boolean;disabled?:boolean}){
 return <nav className="yu-revision-tabs" aria-label="修改内容">{tabs.filter(t=>script||t.id!=='script').map(t=><button type="button" key={t.id} disabled={disabled} aria-pressed={tab===t.id} onClick={()=>onChange(t.id)}>{t.label}</button>)}</nav>;
}
export default function StoryProductionEditor({tab,settings,disabled,onChange,creation=false,recommendation,artRecommendation,onRecommend}:{tab:Exclude<StoryEditorTab,'script'>;settings:ProductionSettings;disabled:boolean;onChange:(patch:Partial<ProductionSettings>)=>void;creation?:boolean;recommendation?:FrameRecommendation|null;artRecommendation?:ArtRecommendation;onRecommend?:()=>void}){
 return <fieldset className="yu-revision-fields" disabled={disabled}>
  {tab==='requirements'&&<label className="yu-revision-field">制作要求<textarea rows={7} maxLength={1200} value={settings.productionPrompt} onChange={e=>onChange({productionPrompt:e.target.value})}/><small>{creation?'确认制作后，按这些要求编排分镜和生成画面。':'修改制作要求会重新编排故事和生成画面，原文保持不变。'}</small></label>}
  {tab==='style'&&<>
   {artRecommendation&&<StoryArtRecommendation recommendation={artRecommendation} selected={settings.artStyle} disabled={disabled} onApply={()=>onChange({artStyle:artRecommendation.artStyle})}/>}
   <StoryArtStylePicker value={settings.artStyle} disabled={disabled} onChange={artStyle=>onChange({artStyle})}/>
  </>}
  {tab==='count'&&<section><h3>画幅数</h3>{recommendation&&<p className="yu-count-help">建议 {recommendation.count} 幅 · {recommendation.reason}</p>}<StoryFrameCountInput count={settings.length} disabled={disabled} onChange={length=>onChange({length})}/><p className="yu-count-help">{creation?'确认制作后按所选幅数编排完整故事。':'修改幅数后重新编排完整故事，原图按新分镜的实际输入判断是否复用。'}</p></section>}
  {onRecommend&&(tab==='count'||tab==='requirements')&&<><button type="button" className="yu-revision-open" onClick={onRecommend}>按当前要求重新推荐幅数</button><p className="yu-count-help">会保存当前设置并进入推荐队列；也可直接确认自行选择的幅数。</p></>}
 </fieldset>;
}
