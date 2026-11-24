// Own the placement and labels of story-level navigation across creation, editing and settings.
// Callers supply existing actions and locks; this header never starts production on its own.
import StoryFlowAction from './StoryFlowAction';
import './story-flow-header.css';

type FlowAction={label?:string;onClick:()=>void;disabled?:boolean;title?:string};
export type StoryFlowNavigation={source?:FlowAction;reselect?:FlowAction;reselecting?:boolean};
export default function StoryFlowHeader({title='制作流程',status,source,reselect,reselecting=false}:StoryFlowNavigation&{title?:string;status?:string}){
 return <div className="yu-flow-header"><h3 className="yu-flow-title">{title}{status&&<span className="yu-flow-status" role="status"> · {status}</span>}</h3>{(source||reselect)&&<nav aria-label="制作流程导航">
  {source&&<StoryFlowAction type="button" onClick={source.onClick} disabled={source.disabled} title={source.title}>原文</StoryFlowAction>}
  {reselect&&<StoryFlowAction type="button" onClick={reselect.onClick} disabled={reselect.disabled||reselecting} title={reselect.title}>{reselecting?'正在打开…':reselect.label||'重新选择故事'}</StoryFlowAction>}
 </nav>}</div>;
}
