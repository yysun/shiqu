// 布局切换会重新挂载组件；用户输入按 key 存在模块级表里，重新挂载时取回。
// 未传 key 时与 useState 相同。Reader 在今天会丢弃草稿的处理函数里同步清除对应 key，因此手机行为不变。
// 只用 useState，避免依赖测试中被替换的 React 接口。
import {useState,type SetStateAction} from 'react';

const retained=new Map<string,unknown>();
export const hasRetained=(key:string|undefined)=>key!==undefined&&retained.has(key);
export const retainedValue=<T,>(key:string)=>retained.get(key) as T;
export function retain(key:string|undefined,value:unknown){if(key!==undefined)retained.set(key,value);}
// 清除一个 key，或所有以 prefix 开头的 key（例如 'setup:'）。
export function clearRetained(prefix:string){for(const key of [...retained.keys()])if(key===prefix||key.startsWith(prefix))retained.delete(key);}

export function useRetainedState<T>(key:string|undefined,init:T|(()=>T)){
 const [value,setValue]=useState<T>(()=>hasRetained(key)?retainedValue<T>(key!):init instanceof Function?init():init);
 const set=(next:SetStateAction<T>)=>setValue(old=>{const value=next instanceof Function?next(old):next;retain(key,value);return value;});
 return [value,set] as const;
}
