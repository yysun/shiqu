// Estimate complete reading requests locally; reserve space for hidden instructions and outputs.
// GPT-6 has no published tiktoken mapping: o200k_base is a capacity estimate, not provider usage.
import {get_encoding} from 'tiktoken';
import {localReadingPrompt,localSuggestionPayload,localScanJson,localCardsJson,localCatalogOutputJson} from '../lib/reader-local-contract.ts';
import type {WholeBookInput} from '../lib/reader-local-contract.ts';
import {formatSystemPrompt} from '../lib/reader-prompt-format.ts';
import {geminiOutputSchema} from '../lib/reader-gemini-schema.ts';
import {strictOpenAISchema} from '../lib/reader-openai-schema.ts';
const encoding=get_encoding('o200k_base');
export const wholeInputTokens=400000,chapterInputTokens=12000;
export const cardsStoryLimit=5;
export function readingTokens(text:string,_provider='codex'){return encoding.encode(text,'all').length;}
export function requestTokens(input:WholeBookInput,theme:string,excluded:string[],provider='codex',maxStories=input.purpose==='cards'?cardsStoryLimit:undefined){
 const schema=input.purpose==='catalog'?localCatalogOutputJson(input):input.purpose==='cards'?localCardsJson:localScanJson;
 const prompt=localReadingPrompt(input);
 const output=provider==='gemini'?geminiOutputSchema(schema):provider==='openai'||provider==='deepseek'?strictOpenAISchema(schema):schema;
 return readingTokens(input.purpose==='cards'?formatSystemPrompt(prompt):prompt,provider)+readingTokens(JSON.stringify(localSuggestionPayload(input.title,theme,excluded,input,maxStories)),provider)+readingTokens(JSON.stringify(output),provider);
}
