// Keep reader routes independent of provider credentials and process execution.
import type {Selection} from './reader-model.ts';
import type {StoryGenerator} from './reader-engine.ts';
import type {SuggestionBatch} from './reader-suggestions.ts';
export type ProviderStatus={configured:boolean;provider:'gemini'|'codex';models:{text:string;image:string};voiceEnabled:false;reason?:string;message?:string};
export interface ReaderProvider {
 status():Promise<ProviderStatus>;
 suggestions(selection:Selection,excluded:string[]):Promise<SuggestionBatch>;
 generator():StoryGenerator;
 safeError(error:unknown):string;
}
