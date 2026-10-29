// Refresh shell assets independently of the reader's explicitly saved offline stories.
const SHELL='yiyu-shell-v9';
const OFFLINE='yiyu-offline-v1';
const ICONS=['/icon.svg','/shiqu-home-180.png','/shiqu-home-192.png','/shiqu-home-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(['/offline.html',...ICONS])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('yiyu-shell-')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==location.origin)return;
 if(req.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/read'||url.pathname==='/offline.html')){
  event.respondWith(fetch(req).catch(()=>caches.open(SHELL).then(c=>c.match('/offline.html'))));return;
 }
 if(url.pathname.startsWith('/art/')||url.pathname.startsWith('/api/media/')||url.pathname.startsWith('/api/reader/media/')){
  event.respondWith(caches.open(OFFLINE).then(async c=>(await c.match(req))||fetch(req)));return;
 }
 if(ICONS.includes(url.pathname))event.respondWith(caches.match(req).then(r=>r||fetch(req)));
});
