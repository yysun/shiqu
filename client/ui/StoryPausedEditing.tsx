// A paused production keeps edits in its timeline and applies them only on explicit resume.
import type {ComponentProps} from 'react';
import {generationProgress} from '@/lib/generation-progress';
import {getArtStyle} from '@/lib/reader-styles';
import StoryGenerationStatus from './StoryGenerationStatus';
import {StoryRevisionActions,revisionDraftSteps} from './StoryRevisionEditor';
import type {StoryRevisionEditorState} from './useStoryRevision';

type Props=Omit<ComponentProps<typeof StoryGenerationStatus>,'timeline'|'stages'|'control'>&{editor:StoryRevisionEditorState;onReselect:()=>void};
export default function StoryPausedEditing({editor,onReselect,...props}:Props){
 const {session,busy,controlBusy}=props;
 if(!session.generationControl||session.generationControl==='active')return null;
 const changed=!!editor.impact?.changed,locked=busy||controlBusy||editor.busy;
 const stages=changed&&editor.base?revisionDraftSteps(editor.base,editor.changes):generationProgress(session,Date.now()).steps.map(step=>step.id==='source'?{...step,detail:`画风：${getArtStyle(session.selection.artStyle).label}`}:step);
 const edit=(tab:Parameters<typeof editor.open>[0])=>{if(!locked)editor.open(tab);};
 return <StoryGenerationStatus {...props} controlBusy={locked} stages={stages} timeline={{
  links:{source:[{label:'重新选择故事',onClick:()=>{if(!locked)onReselect();}},{label:'制作要求',onClick:()=>edit('requirements')}]},
  detailActions:{source:{label:'修改画风',onClick:()=>edit('style')}},
  actions:{count:{label:'修改画幅数',onClick:()=>edit('count')},...(session.story?{plan:{label:'修改分镜',onClick:()=>edit('script')}}:{})}
 }} control={changed?<StoryRevisionActions editor={{...editor,busy:locked}} resuming/>:undefined}/>;
}
