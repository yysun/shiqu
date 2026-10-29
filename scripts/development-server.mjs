// Keep LAN development available without serving private libraries through Vite's file paths.
import path from 'node:path';
import {normalizePath} from 'vite';
export function developmentServerOptions({port,apiPort,library}){
 const directory=normalizePath(path.resolve(library)).replace(/[()[\]{}!*?+@|]/g,'\\$&');
 return {host:'0.0.0.0',port,strictPort:true,
  fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.data/**','**/backups/**','**/*-backups/**','**/*.{sqlite,sqlite-wal,sqlite-shm,db,db-wal,db-shm}','**/media/**','**/reader-cache/**','**/.desktop*',directory,directory+'/**']},
  proxy:{'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:false},'/desktop':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:false}},
 };
}
