// Open a saved storyboard while no image exists, and answer a blocked review in any version of a story.
// Looking and editing start no work. Drawing past the review stays the reader's explicit choice.
import type {SessionView} from '@/lib/reader-model';

export default function StoryReviewTools({session,busy,error,onScript,onEdit,onDrawAnyway}:{session:SessionView;busy:boolean;error:string;onScript:()=>void;onEdit:()=>void;onDrawAnyway:()=>void}){
 const issues=session.reviewIssues||[];
 if(!session.story?.original||session.story.pages[0]?.image&&!issues.length)return null;
 return <section className="yu-review-tools" aria-label="分镜与审片问题">
  {issues.length>0&&<><h3>审片未解决的问题（{issues.length}）</h3><ul>{issues.map((issue,index)=><li key={index}><strong>{issue.category==='reflection'?'结语':`第 ${issue.page} 幅`}</strong><span>{issue.problem}</span><small>{issue.instruction}</small></li>)}</ul></>}
  <div className="yu-revision-buttons"><button type="button" onClick={onScript}>查看分镜</button><button type="button" onClick={onEdit}>修改故事</button></div>
  {issues.length>0&&<><button type="button" className="yu-review-override" disabled={busy} onClick={onDrawAnyway}>仍然绘制</button><p className="yu-revision-note">跳过这些问题，按当前分镜开始绘图。</p></>}
  {error&&<p className="yu-batch-error" role="alert">{error}</p>}
 </section>;
}
