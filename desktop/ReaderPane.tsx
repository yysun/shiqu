// Keep reader APIs/storage on their own origin and grant no native or top-navigation permissions.
import {useState} from 'react';
import {BookOpen,RefreshCw} from 'lucide-react';
import {desktopReaderSource} from './reader-frame';

export function ReaderPane({native,running,url,previewUrl,shellUrl=window.location.href}:{native:boolean;running:boolean;url?:string;previewUrl?:string;shellUrl?:string}){
 const [reload,setReload]=useState(0);
 const source=desktopReaderSource({native,running,url,previewUrl,shellUrl});
 return <section className="reader-pane">
  <div className="reader-pane-heading"><div><h2>阅读与创作</h2><p>与浏览器、手机共用同一份故事和阅读进度。</p></div>{source&&<button type="button" className="secondary" onClick={()=>setReload(value=>value+1)}><RefreshCw size={14}/>重新加载阅读端</button>}</div>
  {source?<><p className="reader-recovery">页面未显示？请确认服务正在运行，再重新加载。</p><iframe key={source+':'+reload} className="reader-frame" title="拾趣阅读与创作" src={source} sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="no-referrer"/></>:<div className="collection-empty" role="status"><BookOpen size={34} strokeWidth={1.2}/><h3>{native&&!running?'先启动故事服务':native?'阅读地址不可用':previewUrl?'预览地址不可用':'连接阅读端预览'}</h3><p>{native?running?'请停止并重新启动服务，再打开此页。':'在右侧启动服务，即可在这里阅读和创作。':previewUrl?'仅支持与桌面预览不同源的 http://127.0.0.1 阅读端根地址。':'先启动阅读端开发服务，再设置 VITE_DESKTOP_READER_URL 并重启桌面预览。'}</p>{native&&!running&&<a className="reader-start-link" href="#desktop-service-toggle">前往启动服务</a>}</div>}
 </section>;
}
