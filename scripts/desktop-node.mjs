// Bundle the pinned build-toolchain Node and license; never fetch or use a user's runtime at app launch.
import {chmod,copyFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function validateNodeTarget(version,pinned,platform,arch,environment=process.env){
 if(version!==pinned)throw Error(`Desktop Standard requires build Node ${pinned}; received ${version}. Use the pinned toolchain.`);
 const targetPlatform=environment.TAURI_ENV_PLATFORM||platform,targetArch=environment.TAURI_ENV_ARCH||arch;
 const platforms={darwin:'darwin',windows:'win32',win32:'win32',linux:'linux'},architectures={aarch64:'arm64',arm64:'arm64',x86_64:'x64',x64:'x64'};
 const triple=environment.TAURI_ENV_TARGET_TRIPLE,triplePlatform=triple?.includes('apple-darwin')?'darwin':triple?.includes('windows')?'win32':triple?.includes('linux')?'linux':undefined;
 if(!platforms[targetPlatform]||!architectures[targetArch]||platforms[targetPlatform]!==platform||architectures[targetArch]!==arch||(triple&&(triplePlatform!==platform||architectures[triple.split('-')[0]]!==arch||triple.includes('musl'))))throw Error('Bundled Node requires a matching native OS/architecture build; cross/universal staging is not supported.');
}
export async function stageNode(target=path.join(root,'desktop/resources/node')){
 const pinned=(await readFile(path.join(root,'.nvmrc'),'utf8')).trim();
 validateNodeTarget(process.versions.node,pinned,process.platform,process.arch);
 let license;
 for(const candidate of [path.join(path.dirname(process.execPath),'LICENSE'),path.resolve(path.dirname(process.execPath),'../LICENSE'),path.resolve(path.dirname(process.execPath),'../share/doc/node/LICENSE')]){
  try{const text=await readFile(candidate);if(text.toString().includes('Copyright Node.js contributors')){license=text;break;}}catch{}
 }
 if(!license)throw Error('Node license notices not found in the pinned toolchain. Install the official Node distribution before packaging.');
 const binary=await readFile(process.execPath),filename=process.platform==='win32'?'node.exe':'node';
 const manifest={version:pinned,platform:process.platform,arch:process.arch,binary:filename,source:'Pinned build-toolchain Node executable',sha256:createHash('sha256').update(binary).digest('hex'),licenseSha256:createHash('sha256').update(license).digest('hex')};
 await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});await copyFile(process.execPath,path.join(target,filename));
 if(process.platform!=='win32')await chmod(path.join(target,filename),0o755);
 await writeFile(path.join(target,'LICENSE'),license);await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await stageNode();console.log(`Bundled Node ${result.version} (${result.platform}/${result.arch}) and license notices.`);
}
