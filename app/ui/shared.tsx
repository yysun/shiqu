'use client';
import {useState} from 'react';
import {BookOpen,ArrowUpRight,Loader2} from 'lucide-react';
export async function request(path:string,method='GET',data?:unknown){const r=await fetch('/api/'+path,{method,headers:data instanceof FormData?{}:data?{'Content-Type':'application/json'}:{},body:data instanceof FormData?data:data?JSON.stringify(data):undefined});const value:any=await r.json();if(!r.ok)throw new Error(value.error||'请求失败');return value;}
export function Brand({light=false}:{light?:boolean}){return <div className={'brand '+(light?'light':'')}><span className="brand-symbol"><BookOpen size={23}/></span><div><strong>拾趣</strong><small>古典故事实验室</small></div></div>;}
export function Spinner(){return <Loader2 size={18} className="spin"/>;}
export function Badge({status}:{status:string}){return <span className={'badge '+status}>{({published:'已发布',review:'待审核',draft:'草稿',running:'生成中',failed:'失败',succeeded:'已完成'} as any)[status]||status}</span>;}
export function Empty({title,detail,children}:{title:string;detail?:string;children?:React.ReactNode}){return <div className="empty"><BookOpen size={30}/><h3>{title}</h3><p>{detail}</p>{children}</div>;}
export function DateText({date}:{date:string}){return <span>{new Date(date).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>;}

export function randomId(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
