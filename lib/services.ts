// Application dependencies are supplied by the server, never by hosting globals.
import type {SqliteRemoteDatabase} from 'drizzle-orm/sqlite-proxy';
import type * as schema from '../db/schema.ts';
import type {ReaderProvider} from './reader-provider.ts';
import type {Database} from './reader-repository.ts';
import type {LocalBooks} from '../server/local-books.ts';
import type {ReaderProduction} from './reader-production.ts';

export interface MediaObject {body:Uint8Array<ArrayBuffer>;contentType:string;arrayBuffer():Promise<ArrayBuffer>}
export interface MediaStore {
 remove(key:string):Promise<void>;
 get(key:string):Promise<MediaObject|null>;
 put(key:string,value:ArrayBuffer|Uint8Array,options:{contentType:string}):Promise<unknown>;
 delete(key:string):Promise<void>;
}
export interface Services {
 commandOnly?:boolean;
 /** 登记进行中的请求或流式任务；cancel 在停服等候时取消可续跑的流式任务。 */
 trackWork?<T>(work:Promise<T>,cancel?:()=>void):Promise<T>;
 db:SqliteRemoteDatabase<typeof schema>;
 database:Database;
 media:MediaStore;
 variables:Record<string,string|undefined>;
 ownerId:string;
 transport:typeof fetch;
 generation:ReaderProvider;
 localBooks?:LocalBooks;
 production?:ReaderProduction;
}
