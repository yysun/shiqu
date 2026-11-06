// 通过本机或局域网地址提供书架，拒绝外来 Host/Origin 和原生专属路由。
// 生成设置单独校验真实套接字与实际私有接口地址。
export function desktopAccess(handle:(request:Request)=>Promise<Response>,options:{hosts:string[]}){
 const hosts=new Set(options.hosts);
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
 function denied(status=403){return new Response(JSON.stringify({error:status===404?'页面不存在。':'请使用本机或局域网地址访问书架。'}),{status,headers});}
 return {async handle(request:Request){
  const url=new URL(request.url);
  if(!hosts.has(url.host))return denied();
  const origin=request.headers.get('origin');
  if((origin&&origin!==url.origin)||(!['GET','HEAD'].includes(request.method)&&origin!==url.origin))return denied();
  if(url.pathname==='/desktop'||url.pathname.startsWith('/desktop/'))return denied(404);
  const response=await handle(request);
  response.headers.set('Referrer-Policy','no-referrer');return response;
 }};
}
