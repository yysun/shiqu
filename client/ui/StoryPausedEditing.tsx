// A paused production keeps edits in its timeline and applies them only on explicit resume.
import type {ComponentProps} from 'react';
import StoryGenerationStatus from './StoryGenerationStatus';
import {StoryRevisionActions} from './StoryRevisionEditor';
import type {StoryRevisionEditorState} from './useStoryRevision';

type Props=Omit<ComponentProps<typeof StoryGenerationStatus>,'timeline'|'stages'|'draft'|'control'|'onEditStyle'>&{editor:StoryRevisionEditorState;onReselect:()=>void};
export default function StoryPausedEditing({editor,onReselect,...props}:Props){
 const {session,busy,controlBusy}=props;
 if(!session.generationControl||session.generationControl==='active')return null;
 const changed=!!editor.impact?.changed,locked=busy||controlBusy||editor.busy;
 const draft=changed&&editor.base?{base:editor.base,changes:editor.changes}:undefined;
 const edit=(tab:Parameters<typeof editor.open>[0])=>{if(!locked)editor.open(tab);};
 return <StoryGenerationStatus {...props} controlBusy={locked} draft={draft} onEditStyle={()=>edit('style')} navigation={{...props.navigation,source:props.navigation?.source?{...props.navigation.source,disabled:props.navigation.source.disabled||locked}:undefined,reselect:{label:'替换选题',onClick:onReselect,disabled:locked},reselecting:props.navigation?.reselecting}} timeline={{
  links:{source:[{label:'制作要求',onClick:()=>edit('requirements')},{label:'验收要求',onClick:()=>edit('acceptance')}]},
  actions:{count:{label:'修改叙事详略',onClick:()=>edit('count')},...(session.story?{plan:{label:'修改分镜',onClick:()=>edit('script')}}:{})}
 }} control={changed?<StoryRevisionActions editor={{...editor,busy:locked}} resuming link/>:undefined}/>;
}
