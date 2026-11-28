// 控制台状态与只读配置摘要不依赖书库查询；未知状态禁止本机写入。
import {effectiveImageProvider,isApiProvider} from '../lib/system-settings.ts';
import type {SystemSettings} from '../lib/system-settings.ts';
import type {ProviderSettingsView} from '../lib/provider-settings';
export type ServiceState='loading'|'unavailable'|'stopped'|'running'|'starting'|'upgrading'|'stopping'|'failed'|'preview';
export type Status={running:boolean;state?:ServiceState;url?:string;phoneUrls:string[];publicUrl?:string;internetError?:string;error?:string;backup?:string;provider?:ProviderSettingsView['runtime'];restartRequired?:boolean;generating?:boolean;quitting?:boolean;settingsError?:string;agentSkill?:{status:string;message?:string}};
export const stateLabels:Record<ServiceState,string>={loading:'读取中',unavailable:'状态未知',stopped:'已停止',running:'运行中',starting:'正在启动',upgrading:'正在升级书库',stopping:'正在停止',failed:'启动失败',preview:'浏览器预览'};
/** 等待重启时的下一步：退出或停止失败时放弃重启；控制台忙或仍在停止时保留意图；停止完成后启动。 */
export function restartStep(status:Pick<Status,'running'|'state'|'quitting'|'error'>,busy:boolean):'start'|'wait'|'cancel'{
 if(status.quitting||!status.running&&(status.state==='failed'||!!status.error))return 'cancel';
 if(busy||status.running||status.state==='stopping')return 'wait';
 return 'start';
}
export function savedProvider(settings:SystemSettings,keys?:{gemini:boolean;openai:boolean}):ProviderSettingsView['runtime']{
 const provider=settings.provider,image=effectiveImageProvider(settings);
 return {provider,configured:settings.providerConfigured&&(!isApiProvider(provider)||!!keys?.[provider])&&(!isApiProvider(image)||!!keys?.[image]),models:{text:provider==='readonly'?'':provider==='codex'?settings.codexModel||'Codex 默认模型':provider==='openai'?settings.openaiTextModel:settings.textModel,image:!image?'':image==='codex'?'Codex 图片生成':image==='openai'?settings.openaiImageModel:settings.imageModel},...(image&&image!==provider?{imageProvider:image}:{})};
}
