// 控制台状态与只读配置摘要不依赖书库查询；未知状态禁止本机写入。
import {effectiveImageProvider,isApiProvider} from '../lib/system-settings.ts';
import type {SystemSettings} from '../lib/system-settings.ts';
import type {ProviderSettingsView} from '../lib/provider-settings';
export type ServiceState='loading'|'unavailable'|'stopped'|'running'|'starting'|'upgrading'|'failed'|'preview';
export type Status={running:boolean;state?:ServiceState;url?:string;phoneUrls:string[];publicUrl?:string;internetError?:string;error?:string;backup?:string;provider?:ProviderSettingsView['runtime'];restartRequired?:boolean;generating?:boolean;settingsError?:string;agentSkill?:{status:string;message?:string}};
export const stateLabels:Record<ServiceState,string>={loading:'读取中',unavailable:'状态未知',stopped:'已停止',running:'运行中',starting:'正在启动',upgrading:'正在升级书库',failed:'启动失败',preview:'浏览器预览'};
export function savedProvider(settings:SystemSettings,keys?:{gemini:boolean;openai:boolean}):ProviderSettingsView['runtime']{
 const provider=settings.provider,image=effectiveImageProvider(settings);
 return {provider,configured:settings.providerConfigured&&(!isApiProvider(provider)||!!keys?.[provider])&&(!isApiProvider(image)||!!keys?.[image]),models:{text:provider==='readonly'?'':provider==='codex'?settings.codexModel||'Codex 默认模型':provider==='openai'?settings.openaiTextModel:settings.textModel,image:!image?'':image==='codex'?'Codex 图片生成':image==='openai'?settings.openaiImageModel:settings.imageModel},...(image&&image!==provider?{imageProvider:image}:{})};
}
