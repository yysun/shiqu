// 样式作用域守卫：桌面样式全部在 .yu-desktop 之下，宽屏手机样式全部在其媒体条件之内，
// 手机样式不再出现 max-width:540px，且 compact.css 是 Reader 最后加载的样式。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

// 简单的 CSS 解析：返回 {selector, atRules:[...外层 at-rule]} 列表
function rules(source){
 const text=source.replace(/\/\*[\s\S]*?\*\//g,''),out=[],stack=[];let start=0;
 for(let i=0;i<text.length;i++){
  if(text[i]==='{'){const head=text.slice(start,i).trim();stack.push(head);start=i+1;}
  else if(text[i]==='}'){const head=stack.pop();if(head&&!head.startsWith('@')&&text.slice(start,i).includes(':'))out.push({selector:head,atRules:stack.filter(h=>h.startsWith('@'))});start=i+1;}
 }
 return out;
}
const desktopFiles=['client/ui/desktop.css','client/ui/StoryWorkspace.css','client/ui/ShelfStoryDetail.css'].filter(existsSync);

test('every desktop rule is scoped under .yu-desktop',()=>{
 assert.ok(desktopFiles.includes('client/ui/desktop.css'));
 const unscoped=[];
 for(const file of desktopFiles)for(const rule of rules(readFileSync(file,'utf8'))){
  if(rule.atRules.some(at=>at.startsWith('@keyframes')))continue;
  for(const part of rule.selector.split(/,(?![^(]*\))/).map(p=>p.trim()))
   if(!part.startsWith('.yu-desktop')&&!part.startsWith(':root:has(.yu-desktop)'))unscoped.push(`${file}: ${part}`);
 }
 assert.deepEqual(unscoped,[]);
});

test('every compact.css rule sits inside its wide-phone media condition',()=>{
 const outside=rules(readFileSync('client/ui/compact.css','utf8')).filter(rule=>!rule.atRules.some(at=>/^@media\s*\(min-width:541px\)/.test(at)));
 assert.deepEqual(outside.map(rule=>rule.selector),[]);
});

test('no phone stylesheet keeps the old max-width:540px condition, and compact.css loads last',()=>{
 const files=['client/styles.css',...['reader','ProviderSettings','ReaderShelf','production-timeline','story-discovery','story-flow-action','story-flow-header','story-publication','story-review-history','story-revision'].map(name=>`client/ui/${name}.css`)];
 for(const file of files)assert.doesNotMatch(readFileSync(file,'utf8'),/max-width:\s*540px/,file);
 const imports=[...readFileSync('client/ui/Reader.tsx','utf8').matchAll(/^import\s+(?:.+\s+from\s+)?'([^']+)';/gm)].map(match=>match[1]);
 assert.equal(imports.at(-1),'./compact.css');
});
