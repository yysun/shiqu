// Keep reader routes independent of provider credentials and process execution.
import type {Selection} from './reader-model.ts';
import type {StoryGenerator} from './reader-engine.ts';
import type {SuggestionBatch,SuggestionProgress} from './reader-suggestions.ts';
import type {WholeBookInput,LocalScanResult,LocalSourceReference} from './reader-local-contract.ts';
import type {ArtRecommendation} from './reader-art-recommendation.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {TaskReasoningEfforts} from './reader-reasoning.ts';
import type {ThemeStory,ThemeMatches} from './reader-theme-match.ts';
export type StoryReading={signal:AbortSignal;onProgress:(progress:SuggestionProgress)=>void;drain?:boolean;maxStories?:1};
export type ProviderStatus={configured:boolean;provider:'gemini'|'codex'|'openai'|'readonly';models:{text:string;image:string};voiceEnabled:false;reason?:string;message?:string;taskReasoningEfforts?:TaskReasoningEfforts};
export interface ReaderProvider {
 status():Promise<ProviderStatus>;
 suggestions(selection:Selection,excluded:string[],localBook?:WholeBookInput,reading?:StoryReading,excludedSources?:LocalSourceReference[]):Promise<SuggestionBatch&{scan?:LocalScanResult}>;
 matchStories?(theme:string,stories:ThemeStory[]):Promise<ThemeMatches>;
 recommendArt?(selection:Selection,original?:OriginalSource):Promise<ArtRecommendation>;
 generator():StoryGenerator;
 safeError(error:unknown):string;
}
