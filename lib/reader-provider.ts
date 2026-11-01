// Keep reader routes independent of provider credentials and process execution.
import type {Selection} from './reader-model.ts';
import type {StoryGenerator} from './reader-engine.ts';
import type {SuggestionBatch,SuggestionProgress} from './reader-suggestions.ts';
import type {WholeBookInput,LocalScanResult,LocalSourceReference} from './reader-local-contract.ts';
import type {ArtRecommendation} from './reader-art-recommendation.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {TaskReasoningEfforts} from './reader-reasoning.ts';
export type ProviderStatus={configured:boolean;provider:'gemini'|'codex'|'openai'|'readonly';models:{text:string;image:string};voiceEnabled:false;reason?:string;message?:string;taskReasoningEfforts?:TaskReasoningEfforts};
export interface ReaderProvider {
 status():Promise<ProviderStatus>;
 suggestions(selection:Selection,excluded:string[],localBook?:WholeBookInput,reading?:{signal:AbortSignal;onProgress:(progress:SuggestionProgress)=>void;drain?:boolean;maxStories?:1},excludedSources?:LocalSourceReference[]):Promise<SuggestionBatch&{scan?:LocalScanResult}>;
 recommendArt?(selection:Selection,original?:OriginalSource):Promise<ArtRecommendation>;
 generator():StoryGenerator;
 safeError(error:unknown):string;
}
