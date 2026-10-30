// Pause and resume are the only reader-facing controls for durable whole-story production.
import type {ProductionAction,SessionView} from '@/lib/reader-model';

type Props={session:SessionView;busy:boolean;onControl:(id:string,action:ProductionAction)=>Promise<void>};
export default function StoryGenerationControl({session,busy,onControl}:Props){
 if(session.state==='completed')return null;
 const manual=!!session.generationControl&&session.generationControl!=='active';
 return <button type="button" className="yu-generation-control" disabled={busy} aria-busy={busy} onClick={()=>void onControl(session.id,manual?'resume':'pause')}>{manual?'恢复生成':'暂停生成'}</button>;
}
