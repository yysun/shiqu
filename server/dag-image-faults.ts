// 只在发生核对的版本内解除已经恢复或不再匹配的图片故障。
import {closedImageFaults} from '../lib/production-dag/faults.ts';
import {stateOf,type DagStory} from '../lib/production-dag/runner.ts';
import type {Fault} from '../lib/production-dag/engine.ts';
import type {SyncStatements} from '../lib/reader-repository.ts';
import type {ReaderFault} from './reader-commands.ts';

export function reconcileImageFaults(db:SyncStatements,ownerId:string,story:DagStory,now:number){
 const rows=db.all<ReaderFault>("SELECT * FROM production_faults WHERE session_id=? AND owner_id=? AND kind='image-loss' AND node='frameImage' AND state IN ('pending','recovering')",
  story.id,ownerId);
 if(!rows.length)return;
 const instances=rows.map((row):Fault=>({id:row.id,node:'frameImage',key:row.node_key,
  state:row.state==='recovering'?'recovering':'pending',inputHash:row.input_hash??undefined}));
 for(const {id,state} of closedImageFaults(stateOf(story),instances))
  db.run("UPDATE production_faults SET state=?,updated_at=? WHERE id=? AND session_id=? AND owner_id=?",state,now,id,story.id,ownerId);
}
