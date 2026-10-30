// Share compact, grouped native radio choices between story creation and revision drafts.
// Show the selected description once; choice changes never submit or start generation.
import {useId} from 'react';
import {Check} from 'lucide-react';
import {artStyleGroups,getArtStyle} from '@/lib/reader-styles';
import type {ArtStyleId} from '@/lib/reader-styles';
export default function StoryArtStylePicker({value,disabled,onChange}:{value:ArtStyleId;disabled:boolean;onChange:(style:ArtStyleId)=>void}){
 const name=useId(),selected=getArtStyle(value);
 return <fieldset className="yu-style-picker" disabled={disabled}>
  <legend className="yu-choice-label">画风</legend>
  <p className="yu-style-selection" role="status"><span>已选：<strong>{selected.label}</strong></span><span>{selected.description}</span></p>
  <div className="yu-style-groups">{artStyleGroups.map(group=><section className="yu-style-group" key={group.label} aria-label={group.label}>
   <h4>{group.label}</h4><div className="yu-style-grid">{group.ids.map(id=>getArtStyle(id)).map(style=><label key={style.id} className={'yu-style-card'+(value===style.id?' selected':'')} title={style.description}>
    <input type="radio" name={name} value={style.id} aria-label={style.label} aria-description={style.description} checked={value===style.id} onChange={()=>onChange(style.id)}/>
    <span className="yu-style-name">{style.label}</span><Check className="yu-style-check" size={12} aria-hidden="true"/>
   </label>)}</div>
  </section>)}</div>
  <p className="yu-style-note">整篇沿用同一画风；3D 与定格生成的是静态画面。</p>
 </fieldset>;
}
