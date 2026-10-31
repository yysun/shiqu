// Share the non-secret settings wire format between CLI, desktop and their private runtime bridge.
// Provider-specific model slots survive switching; credentials always live in a separate table.
import {z} from 'zod';
import {codexReasoningEffortSchema} from './codex-settings.ts';
import {taskReasoningSchema,reasoningTasks,geminiReasoningEfforts} from './reader-reasoning.ts';
export const providerNames=['gemini','codex','openai','readonly'] as const;
export type ProviderName=typeof providerNames[number];
export const openaiDefaultModels={text:'gpt-6.1-sol',image:'gpt-image-2.5-sunburst'};
const model=z.string().regex(/^[\w.-]{1,100}$/);
export const systemSettingsSchema=z.object({
 libraryConfigured:z.boolean().default(false),nodePath:z.string().max(4096).default(''),dataDirectory:z.string().min(1).max(4096),port:z.number().int().min(1024).max(65535).default(3000),
 lanEnabled:z.boolean().optional(),internetEnabled:z.boolean().default(false),cloudflaredPath:z.string().max(4096).default(''),
 provider:z.enum(providerNames).default('gemini'),providerConfigured:z.boolean().default(false),
 textModel:model.default('gemini-3.8-flash'),imageModel:model.default('gemini-nano-banana-2.1'),
 openaiTextModel:model.default(openaiDefaultModels.text),openaiImageModel:model.default(openaiDefaultModels.image),
 codexPath:z.string().max(4096).default(''),codexModel:z.string().regex(/^[\w.-]{0,100}$/).default('gpt-6.1-sol'),codexHome:z.string().max(4096).default(''),codexReasoningEffort:codexReasoningEffortSchema,
 taskReasoningEfforts:taskReasoningSchema,
}).strict().superRefine((settings,ctx)=>{
 if(settings.provider==='gemini')for(const task of reasoningTasks)if(!(geminiReasoningEfforts as readonly string[]).includes(settings.taskReasoningEfforts[task]))ctx.addIssue({code:z.ZodIssueCode.custom,path:['taskReasoningEfforts',task],message:'Gemini 仅支持 low、medium、high'});
 for(const field of ['dataDirectory','nodePath','cloudflaredPath','codexPath','codexHome'] as const)if(/[\0\r\n]/.test(settings[field]))ctx.addIssue({code:z.ZodIssueCode.custom,path:[field],message:'路径不能包含控制字符'});
});
export type SystemSettings=z.infer<typeof systemSettingsSchema>;
export function defaultSystemSettings(library:string){return systemSettingsSchema.parse({dataDirectory:library});}
export function settingsVariables(settings:SystemSettings,key:string){
 return {SHIQU_AI_PROVIDER:settings.provider,...(settings.provider==='gemini'?{GEMINI_API_KEY:key}:{}),...(settings.provider==='openai'?{OPENAI_API_KEY:key}:{}),
 GEMINI_TEXT_MODEL:settings.textModel,GEMINI_IMAGE_MODEL:settings.imageModel,OPENAI_TEXT_MODEL:settings.openaiTextModel,OPENAI_IMAGE_MODEL:settings.openaiImageModel,
 CODEX_BIN:settings.codexPath||'codex',CODEX_MODEL:settings.codexModel,SHIQU_CODEX_HOME:settings.codexHome,CODEX_REASONING_EFFORT:settings.codexReasoningEffort,
 ...Object.fromEntries(reasoningTasks.map(task=>['SHIQU_REASONING_'+task.toUpperCase(),settings.taskReasoningEfforts[task]]))};
}
export function validApiKey(value:string){const key=value.trim();if(!key||new TextEncoder().encode(key).length>4096||/[\0\r\n]/.test(value))throw Error('API 密钥必须为非空单行且不超过 4096 字节。');return key;}
export function resetProviderSettings(settings:SystemSettings):SystemSettings{
 const defaults=defaultSystemSettings(settings.dataDirectory);
 return {...settings,provider:defaults.provider,providerConfigured:false,textModel:defaults.textModel,imageModel:defaults.imageModel,openaiTextModel:defaults.openaiTextModel,openaiImageModel:defaults.openaiImageModel,codexPath:'',codexHome:'',codexModel:defaults.codexModel,codexReasoningEffort:'',taskReasoningEfforts:defaults.taskReasoningEfforts};
}
