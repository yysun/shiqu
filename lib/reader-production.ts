// Keep the browser contract independent of the server scheduler and future media handlers.
import type {SessionView,ProductionAction} from './reader-model.ts';
export const productionReadAhead=6;
export const productionViewerLeaseMs=30000;
export interface ReaderProduction{
 control(ownerId:string,id:string,action:ProductionAction,handoffOnly?:boolean):Promise<SessionView>;
 overrideReview(ownerId:string,id:string):Promise<SessionView>;
 request(ownerId:string,id:string,viewerId:string,page:number,retry?:boolean):Promise<SessionView>;
 leave(ownerId:string,id:string,viewerId:string):Promise<void>;
 managed(ownerId:string,id:string):Promise<boolean>;
 advance(ownerId:string,id:string,throughPage:number,retry:boolean):Promise<SessionView>;
 snapshot(ownerId:string,id:string):Promise<SessionView>;
}
