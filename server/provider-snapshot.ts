// 模型快照：制作确认时记录提供方、模型与推理强度，不含凭据；之后的调用按快照选择模型。
// 构造时以快照覆盖当前设置中的提供方与模型变量，凭据仍取当前设置；快照服务缺少凭据时视为不可用。
import type {ProviderSettingsView} from '../lib/provider-settings.ts';
import type {MediaStore} from '../lib/services.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {runtimeConfiguration} from './provider-runtime.ts';
import {createReaderProvider} from './generation.ts';

type Variables=Record<string,string|undefined>;
/** models 中 null 表示沿用该服务自身的默认模型（例如命令行订阅的默认值），不把界面显示名当作模型名。 */
export type ModelSnapshot=Pick<ProviderSettingsView['runtime'],'provider'|'imageProvider'|'taskReasoningEfforts'>&{models:{text:string|null;image:string|null}};

const textModelVariable:Record<string,string>={gemini:'GEMINI_TEXT_MODEL',openai:'OPENAI_TEXT_MODEL',codex:'CODEX_MODEL',claude:'CLAUDE_MODEL',deepseek:'DEEPSEEK_TEXT_MODEL'};
const imageModelVariable:Record<string,string>={gemini:'GEMINI_IMAGE_MODEL',openai:'OPENAI_IMAGE_MODEL'};
// 运行配置在变量缺省时只给出的显示名，不是可调用的模型名。
const displayOnly=new Set(['codex-default','codex-image-generation']);

/** 记录当前设置的快照，供制作确认与旧故事转换使用。 */
export function currentSnapshot(variables:Variables):ModelSnapshot{
 const {provider,imageProvider,models,taskReasoningEfforts}=runtimeConfiguration(variables);
 const imageSide=imageProvider||provider;
 // 有对应变量的服务记录实际模型（变量缺省时运行配置给出的即该服务的真实默认模型名）；
 // 没有对应变量或运行配置只给出显示名的服务记为 null，调用时沿用其默认模型。
 const text=textModelVariable[provider]&&!displayOnly.has(models.text)?models.text:null;
 const image=imageModelVariable[imageSide]&&!displayOnly.has(models.image)?models.image:null;
 return {provider,...(imageProvider?{imageProvider}:{}),models:{text,image},...(taskReasoningEfforts?{taskReasoningEfforts}:{})};
}

/** 以快照覆盖提供方、模型与推理强度变量；凭据与其他变量保持当前值。 */
export function snapshotVariables(snapshot:ModelSnapshot,variables:Variables):Variables{
 const next:Variables={...variables,SHIQU_AI_PROVIDER:snapshot.provider,SHIQU_IMAGE_PROVIDER:snapshot.imageProvider||''};
 const imageSide=snapshot.imageProvider||snapshot.provider;
 const setModel=(name:string|undefined,value:string|null)=>{if(!name)return;if(value===null)delete next[name];else next[name]=value;};
 setModel(textModelVariable[snapshot.provider],snapshot.models.text);
 setModel(imageModelVariable[imageSide],snapshot.models.image);
 for(const key of Object.keys(next))if(key.startsWith('SHIQU_REASONING_'))delete next[key];
 for(const [task,effort] of Object.entries(snapshot.taskReasoningEfforts||{}))next['SHIQU_REASONING_'+task.toUpperCase()]=effort;
 return next;
}

export type SnapshotProvider={available:true;provider:ReaderProvider}|{available:false;reason:'snapshot-unavailable'};

/** 按快照构造提供方；快照指定的服务在当前设置中缺少凭据时返回不可用，由故事显示「快照服务不可用」。 */
export function providerForSnapshot(snapshot:ModelSnapshot,variables:Variables,media:MediaStore,transport:typeof fetch=fetch):SnapshotProvider{
 const merged=snapshotVariables(snapshot,variables);
 if(snapshot.provider==='readonly'||runtimeConfiguration(merged).configured===false)return {available:false,reason:'snapshot-unavailable'};
 return {available:true,provider:createReaderProvider(merged,media,transport)};
}
