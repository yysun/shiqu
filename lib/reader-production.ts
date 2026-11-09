// Keep the browser contract independent of the server scheduler and future media handlers.
import type {SessionRow,SessionView,ProductionAction} from './reader-model.ts';
import type {RecoveryRequest} from './reader-recovery.ts';
export const productionReadAhead=6;
export const productionViewerLeaseMs=30000;
export interface ReaderProduction{
 wake():void;
 control(ownerId:string,id:string,action:ProductionAction,handoffOnly?:boolean,requestId?:string):Promise<SessionView>;
 overrideReview(ownerId:string,id:string,command?:RecoveryRequest):Promise<SessionView>;
 request(ownerId:string,id:string,viewerId:string,page:number,retry?:boolean):Promise<SessionView>;
 leave(ownerId:string,id:string,viewerId:string):Promise<void>;
 managed(ownerId:string,id:string):Promise<boolean>;
 advance(ownerId:string,id:string,throughPage:number,retry:boolean):Promise<SessionView>;
 shelfSnapshot(row:SessionRow,saved:SessionView):Promise<SessionView>;
 snapshot(ownerId:string,id:string):Promise<SessionView>;
 recover(ownerId:string,id:string,command:RecoveryRequest):Promise<SessionView>;
 checkImage(ownerId:string,id:string,page:number,image:string):Promise<SessionView>;
}
