// Keep the browser contract independent of the server scheduler and future media handlers.
import type {SessionRow,SessionView,ProductionAction,GenerationControl} from './reader-model.ts';
import type {ProductionService} from './production-lifecycle.ts';
import type {RecoveryRequest,ReviewOverride} from './reader-recovery.ts';
export const productionReadAhead=6;
export const productionViewerLeaseMs=30000;
export type LandscapeStatus={state:'idle'|'running'|'partial'|'completed';available:boolean;total:number;ready:number;images:string[];failed:number[];startToken?:string;retryToken?:string;error?:string;service?:ProductionService;control?:GenerationControl};
export interface ReaderProduction{
 referencesChanged?():void;
 wake():void;
 control(ownerId:string,id:string,action:ProductionAction,requestId?:string):Promise<SessionView>;
 overrideReview(ownerId:string,id:string,command?:ReviewOverride):Promise<SessionView>;
 request(ownerId:string,id:string,viewerId:string,page:number,retry?:boolean):Promise<SessionView>;
 leave(ownerId:string,id:string,viewerId:string):Promise<void>;
 managed(ownerId:string,id:string):Promise<boolean>;
 advance(ownerId:string,id:string,throughPage:number,retry:boolean):Promise<SessionView>;
 shelfSnapshot(row:SessionRow,saved:SessionView,includeTimings?:boolean,replacementOpen?:boolean):Promise<SessionView>;
 snapshot(ownerId:string,id:string):Promise<SessionView>;
 recover(ownerId:string,id:string,command:RecoveryRequest,requirePaidService?:()=>Promise<unknown>):Promise<SessionView>;
 checkImage(ownerId:string,id:string,page:number,image:string):Promise<SessionView>;
 landscapeStatus(ownerId:string,id:string):Promise<LandscapeStatus>;
 /** 制作 DAG 故事的审片状态：approved 可绘图，attention 需读者处理，pending 仍在审片；非 DAG 故事为 null。 */
 /** 这个编号已作为本篇的「继续制作」被接受；重放无需再检查服务配置。 */
 continueAccepted?(ownerId:string,id:string,requestId:string):Promise<boolean>;
 reviewState?(ownerId:string,id:string):Promise<'approved'|'attention'|'pending'|null>;
 startLandscape(ownerId:string,id:string,command:{startToken?:string;retryToken?:string}):Promise<LandscapeStatus>;
}
