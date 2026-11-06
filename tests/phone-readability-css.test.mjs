// 静态守卫：手机界面样式表中不允许声明小于 12px 的字号，覆盖 E2E 无法稳定到达的状态（如自动恢复中的错误详情）。
// 唯一例外是发现页书封上绘制的年代、作者与体裁字样，它们属于封面图案；已删除的制作要求面板样式不得回来。
// 字号只接受 px，或下限不小于 12px 的 clamp()/max()；var() 的取值不在此检查，由 E2E 的计算字号覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';

const exempt=new Set(['.yu-book-cover>small','.yu-book-cover>i']);
function stylesheets(directory){
 return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const file=path.join(directory,entry.name);return entry.isDirectory()?stylesheets(file):entry.name.endsWith('.css')?[file]:[];});
}

test('phone stylesheets declare no font size below 12px, and only px sizes, outside book-cover lettering',()=>{
 const small=[];
 for(const file of stylesheets('client')){
  const source=readFileSync(file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  for(const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
   const selectors=rule[1].split(',').map(selector=>selector.replace(/\s+/g,' ').trim());
   if(selectors.every(selector=>exempt.has(selector)))continue;
   for(const declaration of rule[2].matchAll(/(?:^|;)\s*(font(?:-size)?)\s*:\s*([^;]+)/g)){
    // font-size 取整个值；font 简写取第一个带长度单位的记号（可在字重、字形之后）。
    const text=declaration[2].replace(/\s*!important\s*$/,'').trim();
    const value=declaration[1]==='font-size'?text:text.match(/(?:^|\s)([0-9.]+[a-z%]+)(?:\/|\s|$)/)?.[1];
    if(!value||/^(?:var\(|inherit|initial|unset|revert)/.test(value))continue;
    // 流式字号：clamp()/max() 的第一个参数是下限，必须是不小于 12 的 px。
    const fluid=value.match(/^(?:clamp|max)\(\s*([0-9.]+)px\s*,/);
    if(fluid){if(Number(fluid[1])<12)small.push(`${file}: ${selectors.join(',')} ${declaration[1]}:${value}`);continue;}
    const size=value.match(/^([0-9.]+)px$/);
    if(!size||Number(size[1])<12)small.push(`${file}: ${selectors.join(',')} ${declaration[1]}:${value}`);
   }
  }
 }
 assert.deepEqual(small,[]);
});

test('the removed 制作要求 sheet styles stay removed',()=>{
 const found=stylesheets('client').filter(file=>readFileSync(file,'utf8').includes('.yu-saved-prompt'));
 assert.deepEqual(found,[]);
});
