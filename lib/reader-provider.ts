// Keep reader routes independent of provider credentials and process execution.
import type {Selection,GenerationProgress} from './reader-model.ts';
import type {StoryGenerator} from './reader-engine.ts';
import type {SuggestionBatch,SuggestionProgress} from './reader-suggestions.ts';
import type {WholeBookInput,LocalScanResult,LocalSourceReference} from './reader-local-contract.ts';
import type {ArtRecommendation} from './reader-art-recommendation.ts';
import type {OriginalSource} from './reader-source-types.ts';
import type {TaskReasoningEfforts} from './reader-reasoning.ts';
import type {DiscoveryContext} from './reader-discovery-call.ts';
import type {ThemeStory,ThemeMatches,VerifiedThemeMatches} from './reader-theme-match.ts';
export type StoryReading={signal:AbortSignal;onProgress:(progress:SuggestionProgress)=>void;drain?:boolean;maxStories?:1;cycleId?:string;onCall?:DiscoveryContext['onCall']};
export type ProviderStatus={configured:boolean;provider:'gemini'|'codex'|'claude'|'openai'|'deepseek'|'readonly';imageProvider?:'gemini'|'codex'|'openai';models:{text:string;image:string};voiceEnabled:false;reason?:string;message?:string;taskReasoningEfforts?:TaskReasoningEfforts;themeMatching?:{model:string;reasoningEffort:string}};
export interface ReaderProvider {
 // 动态服务在任务入口捕获不可变实例；只读或缺少凭据时不允许派发新的付费任务。
 capture?():ReaderProvider|null;
 // Per-call limit for the active production step; local work has no provider deadline.
 generationTimeoutMs?:(phase:GenerationProgress['phase'])=>number|null;
 status():Promise<ProviderStatus>;
 suggestions(selection:Selection,excluded:string[],localBook?:WholeBookInput,reading?:StoryReading,excludedSources?:LocalSourceReference[]):Promise<SuggestionBatch&{scan?:LocalScanResult}>;
 matchStories?(theme:string,stories:ThemeStory[],context?:DiscoveryContext):Promise<ThemeMatches>;
 verifyThemeStories?(theme:string,stories:ThemeStory[],context?:DiscoveryContext):Promise<VerifiedThemeMatches>;
 recommendArt?(selection:Selection,original?:OriginalSource):Promise<ArtRecommendation>;
 generator():StoryGenerator;
 safeError(error:unknown):string;
 discoveryBusy?():boolean;
 settleDiscovery?():Promise<void>;
}
