// Persist book/theme intent and user confirmation gates before any storyboard is commissioned.
// Search keeps its own state beside the selection: finding more stories never changes the chosen one.
import {z} from 'zod';
import {artStyleIds} from './reader-styles.ts';
import {narrativeDetailSchema} from './reader-frame-recommendation.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import type {Document,Selection} from './reader-model.ts';
import {localSourceKey} from './reader-source-key.ts';
import type {SuggestionBatch,SuggestionProgress} from './reader-suggestions.ts';
export type IntakeSearch={round:number;state:'idle'|'searching'|'failed';error?:string|null;requestId?:string};
export const setupSettingsSchema=z.object({artStyle:z.enum(artStyleIds),productionPrompt:z.string().max(1200),narrativeDetail:narrativeDetailSchema});
const productionSettingsSchema=setupSettingsSchema.extend({length:z.number().int().min(readerMinFrames).max(readerMaxFrames)});
export type IntakeDraft=z.infer<typeof productionSettingsSchema>;
export type StoryIntake={phase:'discovering'|'choosing'|'preparing'|'confirming'|'confirmed';generation:number;creationHash:string;batches:SuggestionBatch[];selected?:{batch:number;index:number};search?:IntakeSearch|null;draft?:IntakeDraft;manualArt?:boolean;lastAction?:{id:string;hash:string}};
export type IntakeView=Omit<StoryIntake,'creationHash'|'lastAction'|'search'>&{search:Pick<IntakeSearch,'state'|'error'>;progress?:SuggestionProgress};
// A discovering record without search state came from a release that kept search in the phase.
export function intakeSearch(intake:StoryIntake):IntakeSearch{return intake.search||{round:0,state:intake.phase==='discovering'?'searching':'idle'};}
const common={requestId:z.string().uuid(),generation:z.number().int().min(0)};
export const intakeActionSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('choose'),settings:setupSettingsSchema.optional(),batch:z.number().int().min(0).max(39),index:z.number().int().min(0).max(4)}).strict(),
 z.object({...common,action:z.literal('more'),automatic:z.boolean().optional(),settings:setupSettingsSchema.optional()}).strict(),
 z.object({...common,action:z.literal('recommend'),settings:setupSettingsSchema}).strict(),
 z.object({...common,action:z.literal('confirm'),settings:productionSettingsSchema}).strict(),
 z.object({...common,action:z.literal('draft'),settings:productionSettingsSchema}).strict(),
]);
export type IntakeAction=z.infer<typeof intakeActionSchema>;

type Command<T>=T extends unknown?Omit<T,'requestId'|'generation'>:never;
export type IntakeCommand=Command<IntakeAction>;

// Older discovery receipts kept the selected/prepared story but wrote the choice gate again.
// Recover only that complete, matching checkpoint; reads must never commission preparation.
export function effectiveIntakePhase(doc:Document,selection:Selection){
 const intake=doc.intake,phase=intake?.phase;
 if(phase!=='choosing'||!intake?.selected||doc.plan)return phase;
 const candidate=intake.batches[intake.selected.batch]?.stories[intake.selected.index],count=doc.frameRecommendation?.count;
 if(!candidate||candidate.title!==selection.storyTitle||typeof doc.original?.text!=='string'||!doc.original.text.trim()||typeof count!=='number'||!Number.isInteger(count)||count<readerMinFrames||count>readerMaxFrames||typeof doc.frameRecommendation?.reason!=='string'||!doc.frameRecommendation.reason.trim())return phase;
 try{
  const sources=[candidate.source,selection.source,doc.original.localSource].map(source=>source?localSourceKey(source):null);
  if(sources.some(source=>source!==sources[0]))return phase;
 }catch{return phase;}
 return 'confirming' as const;
}
