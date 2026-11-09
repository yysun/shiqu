// 书架只保留卡片与制作状态所需的数据；阅读和编辑使用单篇会话。
import type {GeneratedStory,SessionView} from './reader-model.ts';

export type ShelfStory=Pick<GeneratedStory,'id'|'title'|'bookId'|'theme'|'revision'|'artStyleLabel'>&{
 cover:string;resumeImage:string;resumePage:number;frameCount:number;
};
export type ShelfSession=Pick<SessionView,'id'|'state'|'generationMode'|'generationControl'|'productionState'|'error'|'retryAllowed'|'stage'|'awaitingFrameCount'|'ready'|'page'|'saved'|'lastReadAt'|'createdAt'>&{
 selection:Pick<SessionView['selection'],'bookId'|'customBook'|'theme'|'artStyle'|'displayTitle'|'storyTitle'>;
 intake?:{phase:NonNullable<SessionView['intake']>['phase'];selected:boolean;hasCandidates:boolean;searchState:NonNullable<SessionView['intake']>['search']['state'];artStyle?:SessionView['selection']['artStyle']};
 revision?:Pick<NonNullable<SessionView['revision']>,'rootId'|'number'>;
 story:ShelfStory|null;
 version?:string;
};
export type ShelfChanges={changed:ShelfSession[];removed:string[]};

export function summarizeShelfSession(session:SessionView):ShelfSession{
 const {id,state,generationMode,generationControl,productionState,error,retryAllowed,stage,awaitingFrameCount,ready,page,saved,lastReadAt,createdAt,selection,intake,revision,story}=session;
 const {bookId,customBook,theme,artStyle,displayTitle,storyTitle}=selection;
 const resumePage=story?Math.max(0,Math.min(page,story.pages.length-1)):0;
 return {id,state,generationMode,generationControl,productionState,error,retryAllowed,stage,awaitingFrameCount,ready,page,saved,lastReadAt,createdAt,
  selection:{bookId,customBook,theme,artStyle,displayTitle,storyTitle},
  ...(intake?{intake:{phase:intake.phase,selected:!!intake.selected,hasCandidates:!!intake.batches?.length,searchState:intake.search?.state||'idle',artStyle:intake.draft?.artStyle}}:{}),
  ...(revision?{revision:{rootId:revision.rootId,number:revision.number}}:{}),
  story:story?{id:story.id,title:story.title,bookId:story.bookId,theme:story.theme,revision:story.revision,artStyleLabel:story.artStyleLabel,
   cover:story.pages[0]?.image||'',resumeImage:story.pages[resumePage]?.image||story.pages.find(frame=>frame.image)?.image||'',resumePage,frameCount:story.pages.length}:null};
}
