// 分层命令按显式元数据选测；手动组从 unit/flows 中排除，原著套件只由显式命令选择。
import {loadMetadata,supported} from './test-metadata.mjs';
export async function tierTests(tier,root=process.cwd()){
 if(!['unit','flows','books'].includes(tier))throw Error('Test tier must be unit, flows or books');
 return loadMetadata(root).tests.filter(entry=>entry.suite===tier&&(tier==='books'||!entry.manualOnly)&&supported(entry)).map(entry=>entry.file);
}
export async function automaticRegressionTests(root=process.cwd(),platform=process.platform){
 return loadMetadata(root).tests.filter(entry=>['unit','flows'].includes(entry.suite)&&!entry.manualOnly&&supported(entry,platform)).map(entry=>entry.file);
}
