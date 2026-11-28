// Flow actions are real links with guarded disabled/busy states; shared controls can keep
// their existing button presentation outside the production flow.
// 次要操作统一用 story-flow-link；深色画面上加 tone="dark"，沿用同一类名并换浅色。
import type {ComponentProps} from 'react';
import './story-flow-action.css';

type Props=Pick<ComponentProps<'button'>,'children'|'className'|'disabled'|'title'|'aria-label'|'aria-busy'|'aria-current'|'aria-expanded'|'aria-controls'>&{onClick:()=>void|Promise<void>;asLink?:boolean;type?:'button';tone?:'dark';intent?:'danger'};
export default function StoryFlowAction({asLink=true,disabled=false,onClick,className,type='button',tone,intent,...props}:Props){
 if(!asLink)return <button {...props} type={type} className={className} disabled={disabled} onClick={()=>void onClick()}/>;
 return <a {...props} href="#" className={`story-flow-link${tone==='dark'?' story-flow-link--dark':''}${intent==='danger'?' story-flow-link--danger':''}`} aria-disabled={disabled||undefined} tabIndex={disabled?-1:undefined} onClick={event=>{event.preventDefault();if(!disabled&&!event.currentTarget.closest('fieldset[disabled]'))void onClick();}}/>;
}
