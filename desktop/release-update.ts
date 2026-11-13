// 桌面控制台独立检查 GitHub 正式发行版，读版本元数据，不接触本地服务。
import {useEffect,useRef,useState} from 'react';
import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';

const latestReleaseApi='https://api.github.com/repos/yysun/shiqu/releases/latest';
const stableVersion=/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

export async function newerDesktopRelease(current:string,transport:typeof fetch=fetch):Promise<string|null>{
 if(!stableVersion.test(current))throw Error('Invalid installed version');
 const response=await transport(latestReleaseApi,{
  signal:AbortSignal.timeout(5000),credentials:'omit',redirect:'error',
  headers:{Accept:'application/vnd.github+json'},
 });
 if(!response.ok)throw Error('GitHub release unavailable');
 const release=await response.json();
 if(typeof release?.draft!=='boolean'||typeof release.prerelease!=='boolean')throw Error('Invalid release');
 if(release.draft||release.prerelease)return null;
 const tag=release.tag_name;
 if(typeof tag!=='string'||!tag.startsWith('v')||!stableVersion.test(tag.slice(1)))throw Error('Invalid release tag');
 const latest=tag.slice(1),installed=current.split('.').map(Number);
 for(const [i,part] of latest.split('.').map(Number).entries()){
  if(part!==installed[i])return part>installed[i]?latest:null;
 }
 return null;
}

export function useReleaseUpdate(native:boolean){
 const [current,setCurrent]=useState(''),[latest,setLatest]=useState<string|null>(null);
 const [checking,setChecking]=useState(false),[feedback,setFeedback]=useState(''),[openError,setOpenError]=useState('');
 const inFlight=useRef(false);
 async function check(manual=false){
  if(!native||inFlight.current)return;
  inFlight.current=true;
  setChecking(true);
  setFeedback('');
  try{
   const version=await getVersion();
   setCurrent(version);
   const next=await newerDesktopRelease(version);
   setLatest(next);
   if(!next&&manual)setFeedback('已是最新版本。');
  }catch{
   if(manual)setFeedback('暂时无法检查更新，请稍后重试。');
  }finally{
   inFlight.current=false;
   setChecking(false);
  }
 }
 useEffect(()=>{void check();},[native]);
 async function openDownload(){
  setOpenError('');
  try{await invoke('open_release_download');}
  catch{setOpenError('无法打开默认浏览器，请稍后重试。');}
 }
 return {current,latest,checking,feedback,openError,check,openDownload};
}
