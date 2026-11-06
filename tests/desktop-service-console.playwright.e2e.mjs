// 真正的桌面 HTTP 服务使用隔离配置；原生窗口仅用 IPC 夹具验证交互，不代表操作系统打包结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';
import {build,createServer} from 'vite';
import {startupFixture,freeStartupPort} from './fixtures/startup.mjs';
import {SystemSettingsStore} from '../server/system-settings.ts';
import {defaultSystemSettings} from '../lib/system-settings.ts';
import {startDesktop} from '../server/desktop.ts';
import {privateNetworkAddress} from '../server/provider-settings-access.ts';
const output=path.resolve(process.env.SHIQU_TEST_OUTPUT||'.data/e2e/desktop-service-console');

test('console-only desktop, lifecycle IPC and actual desktop browser settings',{timeout:120000},async t=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1040,height:820}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 try {
 const preview=await createServer({configFile:path.resolve('desktop/vite.config.ts'),optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','@tauri-apps/api/core','qrcode','lucide-react','zod']},server:{port:await freeStartupPort(),strictPort:true}});await preview.listen();t.after(()=>preview.close());const consoleUrl=preview.resolvedUrls.local[0];
 const settings=defaultSystemSettings('/tmp/isolated-console/library');
 await page.addInitScript(({settings})=>{
  const mock={settings,revision:0,calls:[],mode:'stopped',unknown:false,status:{running:false,phoneUrls:[],state:'stopped'}};
  window.consoleFixture=mock;window.isTauri=true;
  window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
   mock.calls.push({cmd,args});
   if(cmd==='get_settings')return {settings:{...mock.settings},revision:mock.revision};
   if(cmd==='detect_node')return {version:'24.22.1'};
   if(cmd==='server_status'){if(mock.unknown)throw Error('状态读取失败');return {...mock.status};}
   if(cmd==='save_settings'){if(args.expectedRevision!==mock.revision)throw Error('设置已由另一入口修改，请重新读取后保存。');Object.assign(mock.settings,args.settings);mock.revision++;return {settings:{...mock.settings},revision:mock.revision};}
   if(cmd==='choose_path')return '/tmp/isolated-console/chosen';
   if(cmd==='start_server'){
    mock.releaseStart=null;
    mock.status={running:false,state:'upgrading',phoneUrls:[]};await new Promise(resolve=>{mock.releaseStart=resolve;});
    if(mock.mode==='fail'){mock.status={running:false,state:'failed',phoneUrls:[],error:'升级失败，备份：/tmp/isolated-console/verified-backup'};throw Error(mock.status.error);}
    mock.status={running:true,state:'running',url:'http://127.0.0.1:43123',phoneUrls:['http://192.0.2.8:43123'],backup:'/tmp/isolated-console/verified-backup',provider:{provider:'gemini',configured:true,models:{text:'runtime-text',image:'runtime-image'}},restartRequired:true,generating:true};return {...mock.status};
   }
   if(cmd==='stop_server'){mock.status={running:false,state:'stopped',phoneUrls:[]};return {...mock.status};}
   if(cmd==='open_reader'&&mock.mode==='opener-fail')throw Error('无法打开浏览器');
  }};
 },{settings});
 console.log('ET: native preview');await page.goto(consoleUrl);await page.getByRole('button',{name:'启动服务',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('.service-label')?.textContent.includes('已停止'));
 assert.equal(await page.getByRole('tablist').count(),0);assert.equal(await page.locator('input[type=password]').count(),0);assert.ok(await page.getByText('已保存配置 · 未配置生成服务').isVisible());
 await page.getByRole('button',{name:'启动服务',exact:true}).click();console.log('ET: waiting upgrade');await page.getByText('正在升级书库',{exact:true}).waitFor();console.log('ET: upgrade observed');await page.evaluate(()=>window.consoleFixture.releaseStart());await page.waitForFunction(()=>!document.querySelector('button.browser-link')?.disabled);
 assert.ok(await page.getByText('runtime-text',{exact:false}).isVisible());assert.ok(await page.getByText('已校验的升级备份：/tmp/isolated-console/verified-backup').isVisible());
 assert.equal(await page.getByLabel('故事数据目录',{exact:false}).isEnabled(),false);
 await page.getByRole('button',{name:'生成服务与模型 ↗',exact:true}).click();assert.ok((await page.evaluate(()=>window.consoleFixture.calls)).some(c=>c.cmd==='open_reader'&&c.args?.generationSettings===true));
 console.log('ET: restart confirmation');const before=(await page.evaluate(()=>window.consoleFixture.calls)).filter(c=>c.cmd==='stop_server').length;
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'重启服务',exact:true}).click();assert.equal((await page.evaluate(()=>window.consoleFixture.calls)).filter(c=>c.cmd==='stop_server').length,before);
 page.once('dialog',async dialog=>{assert.match(dialog.message(),/停止当前生成.*浏览器继续/);await dialog.accept();});await page.getByRole('button',{name:'重启服务',exact:true}).click();await page.waitForFunction(()=>!!window.consoleFixture.releaseStart);await page.evaluate(()=>window.consoleFixture.releaseStart());await page.waitForFunction(()=>!document.querySelector('button.browser-link')?.disabled);
 for(const width of [1040,390]){await page.setViewportSize({width,height:820});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,`console-running-${width}.png`),fullPage:true});}
 console.log('ET: native edits and failures');await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByLabel('服务端口',{exact:true}).fill('43124');
 await page.evaluate(()=>window.consoleFixture.revision++);await page.getByRole('button',{name:'保存本机设置',exact:true}).click();await page.getByText('设置已由另一入口修改，请重新读取后保存。',{exact:false}).waitFor();
 await page.getByRole('button',{name:'重新读取设置',exact:true}).click();await page.getByLabel('服务端口',{exact:true}).fill('43125');await page.getByRole('button',{name:'保存本机设置',exact:true}).click();await page.getByText('本机设置已保存。').waitFor();
 const saved=(await page.evaluate(()=>window.consoleFixture.calls)).filter(c=>c.cmd==='save_settings').at(-1);assert.deepEqual(Object.keys(saved.args.settings).sort(),['cloudflaredPath','codexHome','codexPath','dataDirectory','internetEnabled','port']);
 await page.evaluate(()=>{window.consoleFixture.unknown=true;});await page.getByText('暂时无法读取服务状态，正在重试。').waitFor();assert.equal(await page.getByRole('button',{name:'启动服务',exact:true}).isEnabled(),false);
 await page.evaluate(()=>{window.consoleFixture.unknown=false;window.consoleFixture.mode='fail';});await page.waitForFunction(()=>document.querySelector('.service-label')?.textContent.includes('已停止'));
 await page.getByRole('button',{name:'启动服务',exact:true}).click();await page.waitForFunction(()=>!!window.consoleFixture.releaseStart);await page.evaluate(()=>window.consoleFixture.releaseStart());await page.getByText('升级失败，备份：/tmp/isolated-console/verified-backup',{exact:false}).first().waitFor();

 // 浏览器前端只构建到临时目录，正式桌面启动器提供 HTTP；没有原生资源准备或安装包构建。
 console.log('ET: actual desktop HTTP browser');const f=await startupFixture(t),file=path.join(f.root,'native-config/desktop.sqlite'),store=new SystemSettingsStore(file,path.join(f.root,'library')),native=store.save({port:await freeStartupPort(),codexPath:'/native/codex',codexHome:'/native/login'});store.close();
 await build({configFile:path.resolve('vite.config.ts'),build:{outDir:path.join(f.root,'dist/client'),emptyOutDir:true},logLevel:'silent'});
 let runtime=await startDesktop(native,'',f.root,{settingsFile:file,transport:async()=>Response.json({})});f.defer(()=>runtime.stop());
 const lan=runtime.status.phoneUrls.find(url=>privateNetworkAddress(new URL(url).hostname));
 if(!lan)t.diagnostic('No private LAN interface; browser uses loopback.');
 const reader=await browser.newPage({viewport:{width:1040,height:820}});reader.setDefaultTimeout(10000);reader.on('pageerror',error=>errors.push(error.message));await reader.goto((lan||runtime.status.url)+'/');
 await reader.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'我的',exact:true}).click();
 await reader.getByRole('button',{name:'生成服务与模型',exact:true}).click();
 await reader.getByRole('dialog',{name:'生成服务与模型'}).waitFor();assert.equal(await reader.locator('input[type=password]').count(),0);assert.equal(await reader.getByLabel('Codex 可执行文件').count(),0);
 await reader.getByRole('radiogroup',{name:'文本服务',exact:true}).getByText('OpenAI',{exact:true}).click();
 await reader.getByRole('textbox',{name:'文本模型',exact:true}).fill('lan-browser-text');
 await reader.getByRole('textbox',{name:'图片模型',exact:true}).fill('lan-browser-image');
 await reader.getByText('推理档位',{exact:true}).click();
 await reader.getByRole('radiogroup',{name:'详细分镜推理档位',exact:true}).getByText('low',{exact:true}).click();
 await reader.getByRole('radiogroup',{name:'API 密钥操作',exact:true}).getByText('输入密钥',{exact:true}).click();await reader.getByLabel('新API 密钥',{exact:true}).fill('synthetic-browser-key');await reader.getByRole('button',{name:'保存设置',exact:true}).click();
 await reader.getByText('待重启',{exact:true}).waitFor();assert.equal(await reader.locator('input[type=password]').count(),0);assert.equal((await reader.content()).includes('synthetic-browser-key'),false);assert.equal(runtime.status.restartRequired,true);assert.equal(runtime.status.provider.provider,'gemini');
 await reader.getByRole('button',{name:'重新读取设置',exact:true}).click();await reader.getByRole('textbox',{name:'文本模型',exact:true}).waitFor();
 assert.equal(await reader.getByRole('textbox',{name:'文本模型',exact:true}).inputValue(),'lan-browser-text');assert.equal(await reader.getByRole('textbox',{name:'图片模型',exact:true}).inputValue(),'lan-browser-image');
 await reader.getByRole('button',{name:'检查已保存配置的连接',exact:true}).click();await reader.getByText('连接检查通过；仅检查模型元数据或登录状态，未生成内容。').waitFor();
 reader.once('dialog',dialog=>dialog.accept());await reader.getByRole('button',{name:'重置所有生成服务配置',exact:true}).click();await reader.getByText('生成设置已重置，重启服务后生效。').waitFor();
 const after=new SystemSettingsStore(file,native.dataDirectory,{existingOnly:true});assert.equal(after.settings().codexPath,native.codexPath);assert.equal(after.settings().codexHome,native.codexHome);assert.equal(after.key('openai'),'');after.close();
 for(const width of [1040,390]){await reader.setViewportSize({width,height:820});assert.ok(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await reader.screenshot({path:path.join(output,`lan-provider-settings-${width}.png`),fullPage:true});}
 await reader.getByRole('button',{name:'关闭',exact:true}).click();await reader.getByRole('link',{name:'打开生成服务与模型',exact:true}).click();await reader.getByRole('dialog',{name:'生成服务与模型'}).waitFor();
 await rename(file,file+'.held');await reader.reload();await reader.getByRole('dialog',{name:'生成服务与模型'}).waitFor();await reader.getByText('暂时无法读取或保存共享生成设置，请检查本机配置后重新读取。').waitFor();
 assert.equal(existsSync(file),false);assert.equal(await reader.locator('input[type=password]').count(),0);
 await rename(file+'.held',file);await reader.getByRole('button',{name:'重新读取设置',exact:true}).click();await reader.getByRole('radiogroup',{name:'文本服务',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 }catch(error){await page.screenshot({path:path.join(output,'failed-console.png'),fullPage:true}).catch(()=>{});console.log(await page.locator('body').innerText().catch(()=>''));throw error;}
});
