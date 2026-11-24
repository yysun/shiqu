// 暂停时保留当前制作进度，各个编辑面板直接提交修改。
import type {ComponentProps} from 'react';
import StoryGenerationStatus from './StoryGenerationStatus';
import {reviewEditingStage} from './StoryRevisionEditor';
import type {StoryRevisionEditorState} from './useStoryRevision';
import {generationProgress} from '@/lib/generation-progress';
import {offersProductionAction} from '@/lib/production-lifecycle';

type Props=Omit<ComponentProps<typeof StoryGenerationStatus>,'stages'|'control'|'onEditStyle'>&{editor:StoryRevisionEditorState;onReselect:()=>void};
export default function StoryPausedEditing({editor,onReselect,timeline,...props}:Props){
 const {session,busy,controlBusy}=props;
 if(!session.generationControl||session.generationControl==='active')return null;
 const locked=busy||controlBusy||editor.busy;
 const editingLocked=locked||!offersProductionAction(session,'edit-revision');
 const edit=(tab:Parameters<typeof editor.open>[0])=>{if(!editingLocked)editor.open(tab);};
 const viewScript=timeline?.actions?.plan;
 const reviewStage=session.story&&session.generationProgress?.reviewStatus?reviewEditingStage(generationProgress(session,Date.now()).steps):undefined;
 return <StoryGenerationStatus {...props} controlBusy={locked} onEditStyle={()=>edit('style')} navigation={{...props.navigation,source:props.navigation?.source?{...props.navigation.source,disabled:props.navigation.source.disabled||locked}:undefined,reselect:{label:'替换选题',onClick:onReselect,disabled:locked||!offersProductionAction(session,'open-reselection')},reselecting:props.navigation?.reselecting}} timeline={{
  links:{...timeline?.links,source:[{label:'制作要求',disabled:editingLocked,onClick:()=>edit('requirements')},{label:'验收要求',disabled:editingLocked,onClick:()=>edit('acceptance')}],
   ...(session.story?{plan:[...(viewScript?[viewScript]:[]),{label:'修改分镜',disabled:editingLocked,onClick:()=>edit('script')}]}:{}),
   ...(reviewStage?{[reviewStage.id]:[{label:'修改审核意见',disabled:editingLocked||!offersProductionAction(session,'edit-review-notes'),onClick:()=>edit('review')}]}:{})},
  actions:{count:{label:'修改叙事详略',disabled:editingLocked,onClick:()=>edit('count')}}
 }}/>;
}
