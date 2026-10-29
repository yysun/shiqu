// Loopback-only desktop preview: summaries plus explicit, reversible story deletion; no credential access.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';
import {developmentLibraryDirectory} from '../server/library-directory.ts';

const librarySummaryFile=new URL('./library.sql',import.meta.url);
const deleteStorySql=readFileSync(new URL('./library-delete.sql',import.meta.url),'utf8');
const restoreStorySql=readFileSync(new URL('./library-restore.sql',import.meta.url),'utf8');
export function setLibraryStoryDeleted(directory:string,id:string,deleted:boolean){
 const filename=path.join(directory,'shiqu.sqlite');
 if(!existsSync(filename))throw Error('这篇故事不在书架里。');
 const database=new DatabaseSync(filename);
 try{
  database.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  if(!database.prepare('SELECT id FROM reader_sessions WHERE id=?').get(id))throw Error('这篇故事不在书架里。');
  database.prepare(deleted?deleteStorySql:restoreStorySql).run(id);
  database.exec('COMMIT');
 }catch(error){if(database.isTransaction)database.exec('ROLLBACK');throw error;}
 finally{database.close();}
}
export function readLibrarySummary(directory:string){
 const filename=path.join(directory,'shiqu.sqlite');
 if(!existsSync(filename))return {stories:[]};
 const database=new DatabaseSync(filename,{readOnly:true});
 try{
  database.exec('PRAGMA busy_timeout=1000');
  const row=database.prepare(readFileSync(librarySummaryFile,'utf8')).get() as Record<string,string>;
  return JSON.parse(Object.values(row)[0]);
 }finally{database.close();}
}
export function desktopPreview():Plugin{
 return {name:'shiqu-desktop-preview',configureServer(server){
  server.middlewares.use('/__desktop/library',(request,response)=>{
   const origin=`http://${request.headers.host}`;
   const route=new URL(request.url||'/',origin).pathname;
   const mutation=request.method==='DELETE'||request.method==='PUT';
   if(request.headers['sec-fetch-site']==='cross-site'||request.headers.origin&&request.headers.origin!==origin||mutation&&request.headers.origin!==origin){response.statusCode=403;response.end();return;}
   response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
   try{
    if(request.method==='GET'&&route==='/'){response.end(JSON.stringify(readLibrarySummary(developmentLibraryDirectory())));return;}
    const match=route.match(/^\/([^/]{1,200})$/);
    if(!mutation||!match){response.statusCode=404;response.end(JSON.stringify({error:'书架操作不存在。'}));return;}
    setLibraryStoryDeleted(developmentLibraryDirectory(),decodeURIComponent(match[1]),request.method==='DELETE');
    response.end(JSON.stringify({ok:true}));
   }catch{response.statusCode=500;response.end(JSON.stringify({error:mutation?'故事暂时无法更新，请重试。':'无法读取本地书架，请检查数据目录及数据库版本。'}));}
  });
 }};
}
