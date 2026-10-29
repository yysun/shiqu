// Authenticate every desktop-hosted reader route without exposing the native settings bridge.
// Pairing secrets live in URL fragments and are exchanged for a separate HttpOnly cookie.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const pairScript=`(async()=>{const token=location.hash.slice(1);history.replaceState(null,'','/desktop/pair');const status=document.getElementById('status');try{const response=await fetch('/desktop/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw Error();location.replace('/');}catch{status.textContent='配对链接已失效，请在桌面应用中重新打开或扫描二维码。';}})();`;
const pairPage=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接拾趣</title><body><h1>拾趣</h1><p id="status" role="status">正在连接桌面书架…</p><script>${pairScript}</script></body></html>`;
function matches(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export function desktopAccess(handle:(request:Request)=>Promise<Response>,options:{hosts:string[];port:number;token?:string}){
 const pairing=options.token||randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex');
 const cookieName=`shiqu_desktop_${options.port}`,hosts=new Set(options.hosts);
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 function denied(status=401){return Response.json({error:'请通过桌面应用的链接或二维码配对。'},{status,headers});}
 return {pairing,async handle(request:Request){
  const url=new URL(request.url);
  if(!hosts.has(url.host))return denied(403);
  const origin=request.headers.get('origin');
  if((origin&&origin!==url.origin)||(!['GET','HEAD'].includes(request.method)&&origin!==url.origin))return denied(403);
  if(url.pathname==='/desktop/pair'&&request.method==='GET')return new Response(pairPage,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'sha256-${createHash('sha256').update(pairScript).digest('base64')}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`}});
  if(url.pathname==='/desktop/session'&&request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>200)return denied(413);
   try{const body=await request.text();if(body.length>200)return denied(413);const value=JSON.parse(body);if(typeof value.token!=='string'||!matches(value.token,pairing))return denied();}
   catch{return denied();}
   return Response.json({ok:true},{headers:{...headers,'Set-Cookie':`${cookieName}=${session}; Path=/; HttpOnly; SameSite=Strict`}});
  }
  // No native settings API exists on this listener, even for paired clients.
  if(url.pathname.startsWith('/desktop/'))return denied(404);
  const cookies=(request.headers.get('cookie')||'').split(';').map(value=>value.trim());
  if(!cookies.some(value=>matches(value,`${cookieName}=${session}`)))return denied();
  const response=await handle(request);
  response.headers.set('Referrer-Policy','no-referrer');return response;
 }};
}
