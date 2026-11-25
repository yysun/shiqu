// 图片快照只记录绘图服务和模型。由当前配置取凭据；文字任务使用当时的全局设置。
import type {ModelSnapshot} from '../lib/production-dag/document.ts';
import type {MediaStore} from '../lib/services.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {runtimeConfiguration} from './provider-runtime.ts';
import {createReaderProvider} from './generation.ts';

type Variables=Record<string,string|undefined>;
export type {ModelSnapshot};

const imageModelVariable:Record<string,string>={gemini:'GEMINI_IMAGE_MODEL',openai:'OPENAI_IMAGE_MODEL',codex:'CODEX_MODEL'};

/** 记录当前设置的快照，供制作确认与旧故事转换使用。 */
export function currentSnapshot(variables:Variables):ModelSnapshot{
 const {provider,imageProvider,models}=runtimeConfiguration(variables);
 const imageSide=imageProvider||provider;
 const image=imageSide==='codex'?variables.CODEX_MODEL?.trim()||null:models.image||null;
 return {provider:imageSide,models:{image}};
}

/** 构造独立绘图服务，避免文字侧凭据缺失影响本版成图。 */
export function snapshotVariables(snapshot:ModelSnapshot,variables:Variables):Variables{
 const imageSide=('imageProvider'in snapshot?snapshot.imageProvider:undefined)||snapshot.provider;
 const model=imageSide==='codex'&&snapshot.provider==='codex'&&'text'in snapshot.models?snapshot.models.text:snapshot.models.image;
 const next:Variables={...variables,SHIQU_AI_PROVIDER:imageSide,SHIQU_IMAGE_PROVIDER:''};
 const name=imageModelVariable[imageSide];
 if(name)next[name]=model??undefined;
 return next;
}

export type SnapshotProvider={available:true;provider:ReaderProvider}|{available:false;reason:'snapshot-unavailable'};

/** 按快照构造提供方；快照指定的服务在当前设置中缺少凭据时返回不可用，由故事显示「快照服务不可用」。 */
export function providerForSnapshot(snapshot:ModelSnapshot,variables:Variables,media:MediaStore,transport:typeof fetch=fetch):SnapshotProvider{
 const merged=snapshotVariables(snapshot,variables);
 if(!imageModelVariable[merged.SHIQU_AI_PROVIDER??'']||runtimeConfiguration(merged).configured===false)return {available:false,reason:'snapshot-unavailable'};
 return {available:true,provider:createReaderProvider(merged,media,transport)};
}
