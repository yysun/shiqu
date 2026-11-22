// 产物与输入的指纹：先规范化再计算 SHA-256，使空白与键顺序差异不改变指纹。
// 显示名、署名、收藏和阅读位置不属于生成输入，规范化时剔除。
// 「采用默认值」须由调用方先展开为实际值再计算，避免默认值与显式填写得到不同指纹。
import {createHash} from 'node:crypto';

/** 永不进入指纹的展示与阅读字段。 */
export const excludedFields=new Set(['displayTitle','credit','favorite','page','lastReadAt']);

export function normalize(value:unknown):unknown{
 if(typeof value==='string')return value.trim();
 if(Array.isArray(value))return value.map(normalize);
 if(value&&typeof value==='object'){
  const out:Record<string,unknown>={};
  for(const key of Object.keys(value).sort()){
   const item=(value as Record<string,unknown>)[key];
   if(item===undefined||excludedFields.has(key))continue;
   out[key]=normalize(item);
  }
  return out;
 }
 return value===undefined?null:value;
}

export function fingerprint(value:unknown):string{
 return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

/** 多个输入合成一个指纹；任一项尚未就绪（undefined）时整体未就绪。 */
export function combine(parts:readonly (readonly [string,string|undefined])[]):string|undefined{
 if(parts.some(([,hash])=>hash===undefined))return undefined;
 return fingerprint(parts.map(([key,hash])=>[key,hash]));
}
