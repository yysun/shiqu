'use client';
// Explain saved-content recovery and show the server's cooldown deadline.
import {useEffect,useState} from 'react';
import type {SessionView} from '@/lib/reader-model';

export default function StoryRetry({session,busy,onRetry,primary=false}:{session:SessionView;busy:boolean;onRetry:()=>void;primary?:boolean}){
 const [now,setNow]=useState(Date.now);
 const retryAt=session.retryAt||0;
 useEffect(()=>{
  if(retryAt<=Date.now())return;
  const timer=setInterval(()=>{const time=Date.now();setNow(time);if(time>=retryAt)clearInterval(timer);},250);
  return()=>clearInterval(timer);
 },[retryAt]);
 if(!session.retryAllowed)return null;
 const seconds=Math.max(0,Math.ceil((retryAt-now)/1000));
 return <div className="yu-retry-control"><small>{session.retryMayCharge?'已完成的内容会保留，仅继续生成未完成的部分。':'故事编排已保留，可重新检索原文。'}</small><button className={primary?'yu-primary':undefined} disabled={busy||seconds>0} onClick={onRetry}>{seconds>0?`${seconds} 秒后可继续生成`:session.retryMayCharge?'继续生成':'重试原文检索'}</button></div>;
}
