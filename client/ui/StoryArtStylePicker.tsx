// Share the same art options and visual treatment between new stories and revisions.
import {Check,Feather} from 'lucide-react';
import {artStyleGroups,getArtStyle} from '@/lib/reader-styles';
import type {ArtStyleId} from '@/lib/reader-styles';
export default function StoryArtStylePicker({value,disabled,onChange}:{value:ArtStyleId;disabled:boolean;onChange:(style:ArtStyleId)=>void}){
 return <fieldset className="yu-style-picker" disabled={disabled}><legend className="yu-choice-label">图片样式</legend><div className="yu-style-groups">{artStyleGroups.map(group=><section className="yu-style-group" key={group.label} aria-label={group.label}><h4>{group.label}</h4><div className="yu-style-grid">{group.ids.map(id=>getArtStyle(id)).map(style=><label key={style.id} className={'yu-style-card style-'+style.id+(value===style.id?' selected':'')}><input type="radio" name="art-style" value={style.id} checked={value===style.id} onChange={()=>onChange(style.id)}/><span className="yu-style-swatch" aria-hidden="true"><Feather size={25} strokeWidth={1.2}/><i/><i/><i/></span><span className="yu-style-name">{style.label}<Check size={14}/></span><span className="yu-style-description">{style.description}</span></label>)}</div></section>)}</div><p className="yu-style-note">整篇沿用同一画风；3D 与定格生成的是静态画面。</p></fieldset>;
}
