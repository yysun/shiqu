// 组件测试直接导入前端 TSX：仅为 client/ 与 desktop/ 下的导入方解析 @/ 别名并补全扩展名，
// .tsx/.jsx 按 tsconfig 的 automatic JSX 转译，.css 为空模块。
// .ts 仍交给 Node 原生类型剥离，server/ 与 lib/ 的解析保持生产行为，避免掩盖生产中会失败的导入。
import {registerHooks} from 'node:module';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {transformSync} from 'esbuild';

const root=fileURLToPath(new URL('../..',import.meta.url));
const frontend=['client','desktop'].map(directory=>path.join(root,directory)+path.sep);
const suffixes=['','.tsx','.ts','.jsx','.js','/index.tsx','/index.ts'];
const complete=base=>suffixes.map(suffix=>base+suffix).find(file=>existsSync(file)&&statSync(file).isFile());

registerHooks({
 resolve(specifier,context,next){
  const parent=context.parentURL?.startsWith('file:')?fileURLToPath(context.parentURL):'';
  if(frontend.some(directory=>parent.startsWith(directory))&&(specifier.startsWith('@/')||specifier.startsWith('.'))){
   const file=complete(specifier.startsWith('@/')?path.join(root,specifier.slice(2)):path.resolve(path.dirname(parent),specifier));
   if(file)return {url:pathToFileURL(file).href,shortCircuit:true};
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(url.startsWith('file:')&&url.endsWith('.css'))return {format:'module',source:'',shortCircuit:true};
  if(url.startsWith('file:')&&/\.[jt]sx$/.test(url)){
   const file=fileURLToPath(url);
   return {format:'module',source:transformSync(readFileSync(file,'utf8'),{loader:path.extname(file).slice(1),jsx:'automatic',format:'esm',sourcefile:file}).code,shortCircuit:true};
  }
  return next(url,context);
 },
});
