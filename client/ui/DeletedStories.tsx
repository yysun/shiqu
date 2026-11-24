// Present owner-scoped deletion records; restoration preserves saved checkpoints and never opens a story.
import {RotateCcw,Trash2} from 'lucide-react';
import StoryFlowAction from './StoryFlowAction';

export type DeletedStory={storyId:string;title:string;deletedAt:string;kind:'generated';canRestore?:boolean};
type Props={items:DeletedStory[];loading:boolean;error:string;busy:string;onRestore:(item:DeletedStory)=>void;onRetry:()=>void};
export default function DeletedStories({items,loading,error,busy,onRestore,onRetry}:Props){
 return <div className="yu-deleted-stories">
  <p>故事文件和阅读进度仍然保留。恢复后会回到书架，不会自动开始生成。</p>
  {error&&<div className="yu-recovery-error" role="alert">{error}<StoryFlowAction disabled={loading||!!busy} onClick={onRetry}>重新加载</StoryFlowAction></div>}
  {loading?<p role="status">正在读取已删除的故事…</p>:items.length?<ul>{items.map(item=><li key={item.storyId}><div><strong>{item.title}</strong><small>删除于 {new Date(item.deletedAt).toLocaleDateString('zh-CN')}</small></div>{item.canRestore!==false&&<button type="button" aria-label={'恢复《'+item.title+'》'} disabled={!!busy} onClick={()=>onRestore(item)}><RotateCcw size={17}/>{busy===item.storyId?'恢复中…':'恢复'}</button>}</li>)}</ul>:!error&&<div className="yu-deleted-empty"><Trash2 size={28}/><h3>没有已删除的故事</h3><p>以后从书架删除的故事，可以在这里恢复。</p></div>}
 </div>;
}
