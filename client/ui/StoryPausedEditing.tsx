// Settings remain reachable before the first complete storyboard; saving never resumes production.
import type {SessionView} from '@/lib/reader-model';
import type {StoryEditorTab} from './StoryProductionEditor';
export default function StoryPausedEditing({session,busy,onEdit,onReselect}:{session:SessionView;busy:boolean;onEdit:(tab:StoryEditorTab)=>void;onReselect:()=>void}){
 if(!session.generationControl||session.generationControl==='active')return null;
 return <section className="yu-review-tools" aria-label="暂停后修改">
  <p>可以调整制作内容；保存后仍暂停，恢复生成时应用新设置。</p>
  <div className="yu-revision-buttons">
   <button type="button" disabled={busy} onClick={onReselect}>重新选择故事</button>
   <button type="button" disabled={busy} onClick={()=>onEdit('requirements')}>修改制作要求</button>
   <button type="button" disabled={busy} onClick={()=>onEdit('style')}>修改画风</button>
   <button type="button" disabled={busy} onClick={()=>onEdit('count')}>修改画幅数</button>
  </div>
 </section>;
}
