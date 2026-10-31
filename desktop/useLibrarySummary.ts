// Share read-only summary polling between overview and queue; stale/error data is never a fake empty library.
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {LibrarySummary} from './library-summary';

export function useLibrarySummary(native:boolean,revision:string){
 const [summary,setSummary]=useState<LibrarySummary|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
 useEffect(()=>{
  let active=true,inFlight=false;
  setSummary(null);setLoading(true);setError('');
  async function load(){
   if(inFlight)return;inFlight=true;
   try{
    const data=native?await invoke<LibrarySummary>('library_summary'):await fetch('/__desktop/library',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('无法读取本地书架，请检查数据目录及数据库版本。');return response.json() as Promise<LibrarySummary>;});
    if(active){setSummary(data);setError('');}
   }catch(e){if(active){setSummary(null);setError(String(e instanceof Error?e.message:e));}}
   finally{inFlight=false;if(active)setLoading(false);}
  }
  void load();const timer=setInterval(()=>void load(),4000);
  return()=>{active=false;clearInterval(timer);};
 },[native,revision,version]);
 return {summary,error,loading,refresh:()=>setVersion(value=>value+1)};
}
