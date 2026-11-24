// 在调度与领取事务内采用已确定的绘图指纹；来源记录和逐幅故障分别保留。
import {randomUUID} from 'node:crypto';
import {matchImageLoss} from '../lib/production-dag/faults.ts';
import {stateOf,type DagStory} from '../lib/production-dag/runner.ts';
import type {Fault} from '../lib/production-dag/engine.ts';
import type {SyncStatements} from '../lib/reader-repository.ts';
import {lostImageMessage} from '../lib/reader-image-assets.ts';
import type {ReaderFault} from './reader-commands.ts';

export function reconcileImageFaults(db:SyncStatements,ownerId:string,story:DagStory,now:number){
 const rows=db.all<ReaderFault>("SELECT * FROM reader_faults WHERE session_id=? AND owner_id=? AND kind='image-loss' AND node='frameImage'",
  story.id,ownerId);
 if(!rows.length)return;
 const asFault=(row:ReaderFault):Fault=>({id:row.id,node:'frameImage',key:row.node_key,
  state:row.state==='replaced'||row.state==='resolved'?'resolved':row.state,inputHash:row.input_hash??undefined,origin:row.origin_fault_id??undefined});
 const sources=rows.filter(row=>row.state==='awaiting-match').map(asFault);
 const instances=rows.filter(row=>row.node_key&&row.state!=='awaiting-match').map(asFault);
 const {close,additions,finished}=matchImageLoss(stateOf(story),sources,instances);
 for(const {id,state} of [...close,...finished])db.run("UPDATE reader_faults SET state=?,updated_at=? WHERE id=? AND session_id=? AND owner_id=?",state,now,id,story.id,ownerId);
 for(const {source,key,inputHash} of additions){
  const page=story.dag.order.indexOf(key);
  db.run(`INSERT OR IGNORE INTO reader_faults(id,session_id,owner_id,kind,node,node_key,input_hash,origin_fault_id,version,message,created_at,updated_at)
   VALUES(?,?,?,'image-loss','frameImage',?,?,?,'dag',?,?,?)`,randomUUID(),story.id,ownerId,key,inputHash,source.id,lostImageMessage(page),now,now);
 }
}
