// 测试注册表是执行范围的唯一来源；校验完整性失败时终止，避免悄悄漏跑新增文件。
// pr 只有 always（无条件冒烟）与 affected（按责任域或覆盖关系选入）两种。
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';

export const groups=['safety','books','discovery','preparation','review','production','reader','storage','startup','providers','media','desktop','tooling'];
const levels=['contract','integration','service-e2e','browser-e2e','native'];
const platforms=['darwin','linux','win32'];
const gates=['user-flows','extended','release','npm'];
function values(value,allowed,label){
 if(!Array.isArray(value)||new Set(value).size!==value.length||value.some(v=>!allowed.includes(v)))throw Error(`Invalid metadata ${label}`);
}
function nativeModules(directory){
 if(!existsSync(directory))return [];
 return readdirSync(directory,{withFileTypes:true}).flatMap(item=>{
  const file=path.join(directory,item.name);
  return item.isDirectory()?nativeModules(file):item.name.endsWith('.rs')&&/#\[(?:test|tokio::test)\]/.test(readFileSync(file,'utf8'))?[file]:[];
 });
}
export function loadMetadata(root=process.cwd()){
 const metadata=JSON.parse(readFileSync(path.join(root,'tests/manifest.json'),'utf8'));
 if(metadata.version!==1||!Array.isArray(metadata.tests))throw Error('Invalid test manifest version/tests');
 values(metadata.groups,groups,'groups');
 if(metadata.groups.length!==groups.length)throw Error('Incomplete test groups');
 const seen=new Set();
 for(const entry of metadata.tests){
  if(typeof entry.file!=='string'||!(/^(?:tests\/[\w.-]+\.(?:test|e2e)\.mjs|src-tauri\/src\/[\w/.-]+\.rs)$/).test(entry.file)||entry.file.includes('..')||seen.has(entry.file))throw Error(`Invalid/duplicate test file: ${entry.file}`);
  seen.add(entry.file);
  if(!Array.isArray(entry.covers)||new Set(entry.covers).size!==entry.covers.length||entry.covers.some(file=>typeof file!=='string'||!file||file.startsWith('/')||file.includes('\\')||file.split('/').includes('..')||path.posix.normalize(file)!==file||[...file].some(char=>char.charCodeAt(0)<32)))throw Error(`Invalid source ownership: ${entry.file}`);
  values(entry.groups,groups,entry.file+' groups');values(entry.platforms,platforms,entry.file+' platforms');values(entry.gates,gates,entry.file+' gates');
  if(!entry.groups.length||!entry.platforms.length||!levels.includes(entry.level)||!['fast','standard','heavy'].includes(entry.cost)||!['unit','flows','books','e2e','native'].includes(entry.suite)||!['always','affected'].includes(entry.pr))throw Error(`Invalid metadata: ${entry.file}`);
  if(entry.manualOnly!==undefined&&typeof entry.manualOnly!=='boolean')throw Error(`Invalid manual-only metadata: ${entry.file}`);
  if(entry.modelRelated!==undefined&&typeof entry.modelRelated!=='boolean')throw Error(`Invalid model-related metadata: ${entry.file}`);
  if(entry.modelRelated&&!entry.manualOnly)throw Error(`Model-related tests must be manual-only: ${entry.file}`);
  if(entry.requiresLoopback!==undefined&&typeof entry.requiresLoopback!=='boolean')throw Error(`Invalid loopback metadata: ${entry.file}`);
  if(entry.requiresLoopback&&!entry.manualOnly)throw Error(`Loopback tests must be manual-only: ${entry.file}`);
  if(entry.relatedPathLiterals!==undefined&&typeof entry.relatedPathLiterals!=='boolean')throw Error(`Invalid related path-literal metadata: ${entry.file}`);
  if((entry.level==='native')!==(entry.suite==='native')||(entry.suite==='native')!==entry.file.endsWith('.rs'))throw Error(`Invalid native metadata: ${entry.file}`);
  if(entry.file.endsWith('.e2e.mjs')!==['service-e2e','browser-e2e'].includes(entry.level))throw Error(`Invalid E2E metadata: ${entry.file}`);
  if(entry.file.endsWith('.e2e.mjs')!==(entry.suite==='e2e'))throw Error(`Invalid E2E suite: ${entry.file}`);
  if(entry.suite==='e2e'&&!entry.gates.length)throw Error(`Unowned E2E: ${entry.file}`);
  if(!existsSync(path.join(root,entry.file)))throw Error(`Missing registered test: ${entry.file}`);
 }
 const smoke=metadata.tests.find(entry=>entry.file==='tests/book-integrity-smoke.test.mjs');
 if(!smoke||smoke.pr!=='affected'||smoke.manualOnly!==true||smoke.platforms.length!==platforms.length)throw Error('Missing manual integrity smoke');
 const actual=readdirSync(path.join(root,'tests')).filter(name=>/\.(?:test|e2e)\.mjs$/.test(name)).map(name=>'tests/'+name);
 actual.push(...nativeModules(path.join(root,'src-tauri/src')).map(file=>path.relative(root,file).split(path.sep).join('/')));
 for(const file of actual)if(!seen.has(file))throw Error(`Unregistered test: ${file}`);
 return metadata;
}
export function supported(entry,platform=process.platform){return entry.platforms.includes(platform);}
