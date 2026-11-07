// 测试入口的 Node 主版本提示：与 package.json engines 不符时只警告并继续；发布 hook 另行精确校验 .nvmrc。
import {readFileSync} from 'node:fs';
import path from 'node:path';
export function nodeVersionWarning(root=process.cwd(),version=process.versions.node){
 let range='';
 try{range=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).engines?.node??'';}catch{return '';}
 const major=range.match(/\d+/)?.[0];
 return major&&version.split('.')[0]!==major?`提示：当前 Node ${version}，项目要求 ${range}（见 .nvmrc）。先运行 nvm use，否则部分测试会误报失败。`:'';
}
export function warnNodeVersion(root){const warning=nodeVersionWarning(root);if(warning)console.error(warning);}
