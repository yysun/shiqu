// Keep reader routes independent of provider credentials and process execution.
import type {Selection} from './reader-model.ts';
import type {StoryGenerator} from './reader-engine.ts';
import type {SuggestionBatch,SuggestionProgress} from './reader-suggestions.ts';
import type {WholeBookInput} from './reader-local-contract.ts';
export type ProviderStatus={configured:boolean;provider:'gemini'|'codex';models:{text:string;image:string};voiceEnabled:false;reason?:string;message?:string};
export interface ReaderProvider {
 status():Promise<ProviderStatus>;
 suggestions(selection:Selection,excluded:string[],localBook?:WholeBookInput,reading?:{signal:AbortSignal;onProgress:(progress:SuggestionProgress)=>void}):Promise<SuggestionBatch>;
 generator():StoryGenerator;
 safeError(error:unknown):string;
}
