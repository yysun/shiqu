// 用真实 Vite 控制台验证提醒交互，隔离 GitHub 响应和原生 IPC。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer as createTcpServer} from 'node:net';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {defaultSystemSettings} from '../lib/system-settings.ts';

test('desktop release notice checks once at startup and opens the official page on demand',{timeout:30000},async t=>{
 const probe=createTcpServer();
 const port=await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',()=>{
  const {port}=probe.address();
  probe.close(error=>error?reject(error):resolve(port));
 }));
 const cacheDir=await mkdtemp(path.join(tmpdir(),'shiqu-release-preview-'));
 const preview=await createServer({
  configFile:path.resolve('desktop/vite.config.ts'),
  cacheDir,
  optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','@tauri-apps/api/app','@tauri-apps/api/core','qrcode','lucide-react','zod']},
  server:{port},
 });
 t.after(async()=>{try{await preview.close();}finally{await rm(cacheDir,{recursive:true,force:true});}});await preview.listen();
 const url=preview.resolvedUrls.local[0],browser=await chromium.launch();
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:390,height:820}});
 page.setDefaultTimeout(6000);
 const api='https://api.github.com/repos/yysun/shiqu/releases/latest';
 let checks=0,tag='v0.12.0',offline=false;
 await page.route(api,async route=>{
  checks++;
  if(offline)await route.abort();
  else await route.fulfill({json:{tag_name:tag,draft:false,prerelease:false,html_url:'https://example.com'}});
 });
 await page.goto(url);
 await page.getByText('浏览器预览',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'检查更新'}).count(),0);
 assert.equal(checks,0);
 await page.addInitScript(settings=>{
  window.isTauri=true;
  window.releaseCommands=[];
  window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
   window.releaseCommands.push({cmd,args});
   switch(cmd){
    case 'plugin:app|version':return '0.11.0';
    case 'get_settings':return {settings,revision:0};
    case 'detect_node':return {version:'24.22.1'};
    case 'server_status':return {running:false,state:'stopped',phoneUrls:[]};
    case 'open_release_download':return;
    default:throw Error('Unexpected command: '+cmd);
   }
  }};
 },defaultSystemSettings('/tmp/isolated-console/library'));
 await page.reload();
 await page.getByText('拾趣 0.12.0 已发布。',{exact:true}).waitFor();
 await page.getByText('当前版本 0.11.0',{exact:true}).waitFor();
 assert.equal(checks,1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'打开官方下载页'}).click();
 const opens=await page.evaluate(()=>window.releaseCommands.filter(c=>c.cmd==='open_release_download'));
 assert.equal(opens.length,1);
 assert.deepEqual(opens[0].args,{}); // IPC 只调用固定入口。

 tag='v0.11.0';
 await page.reload();
 const check=page.getByRole('button',{name:'检查更新',exact:true});
 await check.click();
 await page.getByText('已是最新版本。',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'打开官方下载页'}).count(),0);

 offline=true;
 await page.reload();
 await check.waitFor();
 assert.equal(await page.getByText('暂时无法检查更新，请稍后重试。',{exact:true}).count(),0);
 await check.click();
 await page.getByText('暂时无法检查更新，请稍后重试。',{exact:true}).waitFor();
 assert.ok(await page.getByRole('button',{name:'启动服务',exact:true}).isEnabled());
 offline=false;tag='v0.12.0';
 await check.click();
 await page.getByText('拾趣 0.12.0 已发布。',{exact:true}).waitFor();
});
