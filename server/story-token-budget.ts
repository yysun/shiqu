// Estimate complete reading requests locally; reserve space for hidden instructions and outputs.
// GPT-6 has no published tiktoken mapping: o200k_base is a capacity estimate, not provider usage.
import {get_encoding} from 'tiktoken';
import {localReadingPrompt,localSuggestionPayload,localScanJson} from '../lib/reader-local-contract.ts';
import type {WholeBookInput} from '../lib/reader-local-contract.ts';
const encoding=get_encoding('o200k_base');
export const wholeInputTokens=400000,chapterInputTokens=50000;
export function readingTokens(text:string,provider='codex'){return provider==='gemini'?Buffer.byteLength(text,'utf8'):encoding.encode(text,'all').length;}
export function requestTokens(input:WholeBookInput,theme:string,excluded:string[],provider='codex'){
 return readingTokens(localReadingPrompt(input),provider)+readingTokens(JSON.stringify(localSuggestionPayload(input.title,theme,excluded,input)),provider)+readingTokens(JSON.stringify(localScanJson),provider);
}
