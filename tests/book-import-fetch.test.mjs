// 覆盖导入网页的地址边界、超时与 DNS 截止后不得连接。
import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchImportUrl,requestImportPage,isPublicImportAddress,BookImportFetchError} from '../server/book-import-fetch.ts';

test('URL imports reject private and non-HTTP destinations before connecting',async()=>{
 for(const address of ['127.0.0.1','10.0.0.2','100.64.0.1','172.20.0.1','192.168.1.1','192.0.2.1','198.51.100.1','203.0.113.1','169.254.1.1','::1','fc00::1','fe80::1','64:ff9b::c0a8:101','64:ff9b:1::a00:1','2001:db8::1','2001:2::1','2002:7f00:1::','3fff::1'])assert.equal(isPublicImportAddress(address),false,address);
 assert.equal(isPublicImportAddress('8.8.8.8'),true);assert.equal(isPublicImportAddress('2606:4700:4700::1111'),true);
 await assert.rejects(fetchImportUrl('http://127.0.0.1/private'),error=>error instanceof BookImportFetchError&&error.message==='PRIVATE_ADDRESS');
 await assert.rejects(fetchImportUrl('file:///etc/passwd'),error=>error instanceof BookImportFetchError&&error.message==='URL_INVALID');
 await assert.rejects(fetchImportUrl('https://user:pass@example.com/book.txt'),error=>error instanceof BookImportFetchError&&error.message==='URL_INVALID');
});

test('a DNS answer arriving after the request deadline cannot start a connection',async()=>{
 let resolveDns,connections=0;const pendingDns=new Promise(resolve=>{resolveDns=resolve;});
 const request=()=>{connections++;return {on(){return this;},end(){},destroy(){}};};
 const pending=requestImportPage(new URL('http://example.com/book.txt'),Date.now()+10,undefined,()=>pendingDns,request);
 await assert.rejects(pending,error=>error instanceof BookImportFetchError&&error.message==='TOTAL_TIMEOUT');resolveDns({address:'8.8.8.8',family:4});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(connections,0);
});
