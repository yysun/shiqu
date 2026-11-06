// 本机与可信局域网的生成设置共用原生设置库；只信任真实套接字及实际接口 Host。
// 保存、重置和检查采用已保存配置与启动覆盖；密钥仅在服务内使用。
import {z} from 'zod';
import {SystemSettingsStore} from './system-settings.ts';
import {desktopLibraryPaths} from './library-directory.ts';
import {effectiveProviderVariables} from './cli-setup.ts';
import {systemSettingsSchema,validApiKey,effectiveImageProvider,isApiProvider} from '../lib/system-settings.ts';
import type {KeyChange} from './system-settings.ts';
import {loopbackAddress,providerSettingsSchema,providerSettingsSaveSchema,providerSettingsProofHeader,providerSettingsPath} from '../lib/provider-settings.ts';
import type {ProviderSettingsView} from '../lib/provider-settings.ts';
import type {HttpPeer} from './http.ts';
import {providerSignature,runtimeConfiguration,providerOverrideNames,checkProviderVariables} from './provider-runtime.ts';
import {providerSettingsNetworkAccess} from './provider-settings-access.ts';
type Variables=Record<string,string|undefined>;

export function browserProviderSettings(options:{variables:Variables;overrides:Variables;ports:number[];live?:boolean;locations?:Pick<ReturnType<typeof desktopLibraryPaths>,'settings'|'library'>;proxyToken?:string;existingOnly?:boolean;transport?:typeof fetch}){
 const runtimeSignature=providerSignature(options.variables),locations=options.locations||desktopLibraryPaths(),networkAccess=providerSettingsNetworkAccess(options.ports);
 const runtime=runtimeConfiguration(options.variables);
 const overrides=providerOverrideNames.filter(name=>typeof options.overrides[name]==='string');
 const keyNames={gemini:'GEMINI_API_KEY',openai:'OPENAI_API_KEY'} as const;
 function validKey(value:string|undefined){try{validApiKey(value||'');return true;}catch{return false;}}
 const keyOverrides={gemini:validKey(options.overrides.GEMINI_API_KEY),openai:validKey(options.overrides.OPENAI_API_KEY)};
 // 显式空值同样覆盖已存密钥；保留操作按实际优先级校验，不把启动凭据写入数据库。
 function usableKey(store:SystemSettingsStore,provider:keyof typeof keyNames){
  const override=options.overrides[keyNames[provider]];
  return validKey(typeof override==='string'?override:store.key(provider));
 }
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
 // 只热更新生成配置，路径、端口及子进程登录目录继续使用本次启动值。
 function variables(store:SystemSettingsStore){
  const effective=effectiveProviderVariables(store,options.overrides),next={...options.variables};
  for(const name of providerOverrideNames){
   if(['CODEX_BIN','SHIQU_CODEX_HOME','CLAUDE_BIN','CLAUDE_CONFIG_DIR'].includes(name))continue;
   if(effective[name]===undefined)delete next[name];else next[name]=effective[name];
  }
  return next;
 }
 function snapshot(store:SystemSettingsStore){
  const saved=store.snapshot(),effective=variables(store);
  return {settings:providerSettingsSchema.strip().parse(saved.settings),revision:saved.revision,keyPresent:saved.keyPresent,keyOverrides,appliesToNewJobs:!!options.live,runtime:options.live?runtimeConfiguration(effective):runtime,overrides,restartRequired:!options.live&&providerSignature(effective)!==runtimeSignature,platform:process.platform} satisfies ProviderSettingsView;
 }
 const openStore=()=>new SystemSettingsStore(locations.settings,locations.library,{existingOnly:options.existingOnly});
 const handler=async(request:Request,peer:HttpPeer)=>{
  const url=new URL(request.url),origin=request.headers.get('origin');
  const proxyVerified=options.proxyToken===undefined||!!options.proxyToken&&loopbackAddress(peer.remoteAddress)&&request.headers.get(providerSettingsProofHeader)===options.proxyToken;
  if(peer.rawPath!==undefined&&peer.rawPath!==providerSettingsPath)return json({error:'生成服务设置仅接受固定本机路径。'},403);
  if(!proxyVerified||!networkAccess(peer.remoteAddress,url.host)||request.headers.get('sec-fetch-site')==='cross-site'||origin&&origin!==url.origin||request.method!=='GET'&&origin!==url.origin)return json({error:'请通过本机或可信局域网地址，在同源页面中访问生成服务设置。'},403);
  if(!['GET','POST'].includes(request.method))return json({error:'不支持的设置操作。'},405);
  let store:SystemSettingsStore|undefined;
  try{
   store=openStore();
   if(request.method==='POST'){
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json({error:'请使用 JSON 保存设置。'},415);
    const body=await request.text();if(body.length>16384)return json({error:'设置内容过长。'},413);
    const raw=JSON.parse(body);
    if(raw.action==='check'||raw.action==='reset'){
     const input=z.object({action:z.enum(['check','reset']),expectedRevision:z.number().int().nonnegative()}).strict().parse(raw);
     if(input.expectedRevision!==store.revision())return json({error:'设置已由另一入口修改，请重新读取后保存。'},409);
     if(input.action==='check')return json(await checkProviderVariables(effectiveProviderVariables(store,options.overrides),options.transport));
     store.resetProviders(input.expectedRevision,true);return json(snapshot(store));
    }
    const input=providerSettingsSaveSchema.parse(raw);
    if(input.expectedRevision!==store.revision())return json({error:'设置已由另一入口修改，请重新读取后保存。'},409);
    const current=store.settings(),merged=systemSettingsSchema.parse({...current,...input.settings,taskReasoningEfforts:{...current.taskReasoningEfforts,...input.settings.taskReasoningEfforts},providerConfigured:true});
    const provider=merged.provider,api=provider==='gemini'||provider==='openai',image=effectiveImageProvider(merged),imageApi=image!==provider&&isApiProvider(image)?image:null;
    if(!api&&(input.keyAction!=='keep'||input.key))return json({error:'当前提供方不使用 API 密钥。'},400);
    if(!imageApi&&(input.imageKeyAction!=='keep'||input.imageKey))return json({error:'图片服务与文本服务相同或不使用 API 密钥。'},400);
    if(input.keyAction!=='replace'&&input.key||input.imageKeyAction!=='replace'&&input.imageKey)return json({error:'请选择替换密钥，或清空输入以保留现有密钥。'},400);
    const keys:KeyChange[]=[];
    if(api&&input.keyAction!=='keep')keys.push({provider,value:input.keyAction==='remove'?null:validApiKey(input.key)});
    if(imageApi&&input.imageKeyAction!=='keep')keys.push({provider:imageApi,value:input.imageKeyAction==='remove'?null:validApiKey(input.imageKey)});
    for(const [name,action,purpose] of [[api?provider:null,input.keyAction,'文本服务'],[imageApi,input.imageKeyAction,'图片服务']] as const){
     if(!name||action!=='keep'||usableKey(store,name))continue;
     const overridden=typeof options.overrides[keyNames[name]]==='string';
     return json({error:overridden?`${purpose}的启动密钥为空或格式不正确，请修正启动配置并重启，或移除对应覆盖。`:`请先为${purpose}填写 API 密钥，或选择其他服务。`},400);
    }
    // 未指定图片服务时显式清空旧值，避免保留之前的独立配置。
    store.save({...providerSettingsSchema.strip().parse(merged),imageProvider:merged.imageProvider??null,providerConfigured:true} as Partial<typeof merged>,keys,input.expectedRevision);
   }
   return json(snapshot(store));
  }catch(error){
   if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'请检查提供方、模型名称、推理档位和保存内容。'},400);
   if(error instanceof Error&&error.message.startsWith('设置已由另一入口'))return json({error:error.message},409);
   if(error instanceof Error&&error.message.startsWith('API 密钥'))return json({error:'API 密钥必须为非空单行且不超过 4096 字节。'},400);
   return json({error:'暂时无法读取或保存共享生成设置，请检查本机配置后重新读取。'},503);
  }finally{store?.close();}
 };
 return Object.assign(handler,{snapshot(){const store=openStore();try{return snapshot(store);}finally{store.close();}},variables(){const store=new SystemSettingsStore(locations.settings,locations.library,{existingOnly:true});try{return variables(store);}finally{store.close();}}});
}
