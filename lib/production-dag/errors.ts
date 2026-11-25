// 生成失败的结构化错误码：写入任务记录，决定故障类型与是否自动重试。
// 内容被拦截不自动重试；密钥、登录、额度与限流属于服务级故障，不写入各篇步骤故障；超时按中断处理。

export type ErrorCode='SNAPSHOT_UNAVAILABLE'|'CONTENT_BLOCKED'|'SERVICE_AUTH'|'SERVICE_QUOTA'|'RATE_LIMITED'|'TIMEOUT'|'GENERIC';

const blocked=/CONTENT_BLOCKED|moderation|content[_ ]policy|safety_violation|IMAGE_SAFETY|PROHIBITED_CONTENT/i;
const auth=/KEY_REQUIRED|LOGIN_REQUIRED|authentication_failed|UNAUTHENTICATED|PERMISSION_DENIED/i;
const timeout=/TIMEOUT|ETIMEDOUT|AbortError|deadline/i;

export function errorCode(error:unknown):ErrorCode{
 const e=error as {message?:string;name?:string;code?:string;status?:number}|undefined;
 const text=[e?.message,e?.name,e?.code].filter(Boolean).join(' ');
 if(/SNAPSHOT_UNAVAILABLE/.test(text))return 'SNAPSHOT_UNAVAILABLE';
 if(blocked.test(text))return 'CONTENT_BLOCKED';
 if(e?.status===401||e?.status===403||auth.test(text))return 'SERVICE_AUTH';
 if(e?.status===402)return 'SERVICE_QUOTA';
 if(e?.status===429||/RATE_LIMITED|RESOURCE_EXHAUSTED/i.test(text))return 'RATE_LIMITED';
 if(timeout.test(text))return 'TIMEOUT';
 return 'GENERIC';
}

/** 服务级故障：所有使用该服务的故事显示同一原因，不写入各篇的步骤故障。 */
export const serviceLevel=(code:ErrorCode):code is 'SERVICE_AUTH'|'SERVICE_QUOTA'|'RATE_LIMITED'=>code==='SERVICE_AUTH'||code==='SERVICE_QUOTA'||code==='RATE_LIMITED';
/** 中断恢复可以自动重试的错误：内容拦截与服务级故障不自动重试。 */
export const autoRetryable=(code:ErrorCode)=>code==='TIMEOUT';
