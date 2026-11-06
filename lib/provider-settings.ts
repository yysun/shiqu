// 浏览器设置复用桌面协议；只返回密钥存在与启动来源，不暴露路径或凭据原文。
import {z} from 'zod';
import {systemSettingsSchema,effectiveImageProvider,isApiProvider} from './system-settings.ts';
import type {ProviderStatus} from './reader-provider.ts';
import {taskReasoningSchema} from './reader-reasoning.ts';

export const providerSettingsPath='/api/local/provider-settings';
export const providerSettingsProofHeader='x-shiqu-local-settings-proof';
export const providerSettingsSchema=systemSettingsSchema.innerType().pick({provider:true,imageProvider:true,textModel:true,imageModel:true,openaiTextModel:true,openaiImageModel:true,codexModel:true,codexReasoningEffort:true,taskReasoningEfforts:true}).strict();
export type ProviderSettings=z.infer<typeof providerSettingsSchema>;
const providerSettingsPatchSchema=providerSettingsSchema.partial().extend({taskReasoningEfforts:taskReasoningSchema.removeDefault().partial().optional()});
export const providerSettingsSaveSchema=z.object({settings:providerSettingsPatchSchema,expectedRevision:z.number().int().nonnegative(),keyAction:z.enum(['keep','replace','remove']),key:z.string().max(4096).default(''),imageKeyAction:z.enum(['keep','replace','remove']).default('keep'),imageKey:z.string().max(4096).default('')}).strict();
export type ProviderSettingsSave=z.infer<typeof providerSettingsSaveSchema>;
export type ProviderSettingsView={settings:ProviderSettings;revision:number;keyPresent:{gemini:boolean;openai:boolean};keyOverrides?:{gemini:boolean;openai:boolean};appliesToNewJobs?:boolean;runtime:Pick<ProviderStatus,'provider'|'imageProvider'|'models'|'taskReasoningEfforts'>&{configured?:boolean};overrides:string[];restartRequired:boolean;platform:string};
export function loopbackAddress(address:string|undefined){return address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';}

type ProviderSelection=Pick<ProviderSettings,'provider'|'imageProvider'>;
type ImageKeyDraft=Pick<ProviderSettingsSave,'imageKeyAction'|'imageKey'>;
// 图片密钥输入和操作只属于独立的 API 服务；切换为共用、只读或其他服务时一起清空。
export function imageKeyDraftForProviderChange(current:ProviderSelection,next:ProviderSelection,draft:ImageKeyDraft):ImageKeyDraft{
 const image=effectiveImageProvider(next);
 return isApiProvider(image)&&image!==next.provider&&image===effectiveImageProvider(current)&&image!==current.provider?draft:{imageKeyAction:'keep',imageKey:''};
}
