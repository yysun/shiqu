// Flow actions are real links with guarded disabled/busy states; shared controls can keep
// their existing button presentation outside the production flow.
import type {ComponentProps} from 'react';
import './story-flow-action.css';

type Props=Pick<ComponentProps<'button'>,'children'|'className'|'disabled'|'title'|'aria-label'|'aria-busy'|'aria-current'>&{onClick:()=>void|Promise<void>;asLink?:boolean;type?:'button'};
export default function StoryFlowAction({asLink=true,disabled=false,onClick,className,type='button',...props}:Props){
 if(!asLink)return <button {...props} type={type} className={className} disabled={disabled} onClick={()=>void onClick()}/>;
 return <a {...props} href="#" className="story-flow-link" aria-disabled={disabled||undefined} tabIndex={disabled?-1:undefined} onClick={event=>{event.preventDefault();if(!disabled&&!event.currentTarget.closest('fieldset[disabled]'))void onClick();}}/>;
}
