// Persist book/theme intent and user confirmation gates before any storyboard is commissioned.
import {z} from 'zod';
import {artStyleIds} from './reader-styles.ts';
import {narrativeDetailSchema} from './reader-frame-recommendation.ts';
import {readerMinFrames,readerMaxFrames} from './reader-limits.ts';
import type {SuggestionBatch,SuggestionProgress} from './reader-suggestions.ts';
export type StoryIntake={phase:'discovering'|'choosing'|'preparing'|'confirming'|'confirmed';generation:number;creationHash:string;batches:SuggestionBatch[];selected?:{batch:number;index:number};progress?:SuggestionProgress;manualArt?:boolean;lastAction?:{id:string;hash:string}};
export type IntakeView=Omit<StoryIntake,'creationHash'|'lastAction'>;
export const setupSettingsSchema=z.object({artStyle:z.enum(artStyleIds),productionPrompt:z.string().max(1200),narrativeDetail:narrativeDetailSchema});
const common={requestId:z.string().uuid(),generation:z.number().int().min(0)};
export const intakeActionSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('choose'),settings:setupSettingsSchema.optional(),batch:z.number().int().min(0).max(39),index:z.number().int().min(0).max(4)}).strict(),
 z.object({...common,action:z.literal('more'),settings:setupSettingsSchema.optional()}).strict(),
 z.object({...common,action:z.literal('recommend'),settings:setupSettingsSchema}).strict(),
 z.object({...common,action:z.literal('confirm'),settings:setupSettingsSchema.extend({length:z.number().int().min(readerMinFrames).max(readerMaxFrames)})}).strict(),
]);
export type IntakeAction=z.infer<typeof intakeActionSchema>;

type Command<T>=T extends unknown?Omit<T,'requestId'|'generation'>:never;
export type IntakeCommand=Command<IntakeAction>;
