// Explain the selected story's recommendation without overriding manual changes.
import {getArtStyle} from '@/lib/reader-styles';
import type {ArtStyleId} from '@/lib/reader-styles';
import type {ArtRecommendation} from '@/lib/reader-art-recommendation';

export function StoryArtRecommendation({recommendation,selected,onApply,disabled=false}:{recommendation:ArtRecommendation;selected:ArtStyleId;onApply:()=>void;disabled?:boolean}){
 const applied=selected===recommendation.artStyle;
 return <aside className="yu-style-recommendation" aria-label="画风推荐" role="status">
  <strong>推荐：{getArtStyle(recommendation.artStyle).label}</strong>
  <p>{recommendation.reason}</p>
  <div><small>{applied?'已采用推荐，也可以手动选择其他画风。':`当前选择：${getArtStyle(selected).label}`}</small>{!applied&&<button type="button" disabled={disabled} onClick={onApply}>采用推荐</button>}</div>
 </aside>;
}
