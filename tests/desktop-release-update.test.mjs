// 覆盖正式版版本比较与 GitHub 失败边界，测试不访问网络。
import test from 'node:test';
import assert from 'node:assert/strict';
import {newerDesktopRelease} from '../desktop/release-update.ts';

test('only a numerically newer stable GitHub release is announced',async()=>{
 for(const [tag,expected,flags] of [
  ['v0.10.0','0.10.0'],['v0.9.9',null],['v0.9.8',null],
  ['v1.0.0',null,{draft:true}],['v1.0.0-rc.1',null,{prerelease:true}],
 ]){
  const result=await newerDesktopRelease('0.9.9',async(url,options)=>{
   assert.equal(url,'https://api.github.com/repos/yysun/shiqu/releases/latest');
   assert.equal(options.credentials,'omit');
   assert.equal(options.redirect,'error');
   assert.ok(options.signal instanceof AbortSignal);
   return Response.json({tag_name:tag,draft:false,prerelease:false,...flags,html_url:'https://example.com'});
  });
  assert.equal(result,expected,tag);
 }
});

test('failed and malformed responses do not report that the app is up to date',async()=>{
 await assert.rejects(newerDesktopRelease('0.11.0',async()=>new Response(null,{status:429})));
 await assert.rejects(newerDesktopRelease('0.11.0',async()=>Response.json({tag_name:'v0.12.0'})));
 await assert.rejects(newerDesktopRelease('0.11.0',async()=>Response.json({tag_name:'v0.12.0/elsewhere',draft:false,prerelease:false})));
});
