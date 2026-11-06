// 订阅一条媒体查询；服务端与无 matchMedia 的环境（静态渲染测试）恒为 false，因此得到手机布局。
import {useSyncExternalStore} from 'react';

export function useMediaQuery(query:string){
 return useSyncExternalStore(
  notify=>{if(typeof matchMedia!=='function')return()=>{};const list=matchMedia(query);list.addEventListener('change',notify);return()=>list.removeEventListener('change',notify);},
  ()=>typeof matchMedia==='function'&&matchMedia(query).matches,
  ()=>false,
 );
}
