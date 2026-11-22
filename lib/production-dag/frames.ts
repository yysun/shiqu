// 画幅身份与入画人物的纯规则：结构变化时如何保留或分配身份，按名字和别名匹配人物。
// 合并沿用第一幅身份，拆分的第一段沿用原身份；候选人物来自叙事文字，入画人物来自画面描述。

export type StructureStep=
 |{op:'insert';at:number}
 |{op:'delete';id:string}
 |{op:'move';id:string;to:number}
 |{op:'merge';ids:string[]}
 |{op:'split';id:string;parts:number};

/** 按步骤更新画幅身份序列；新身份由 newId 提供。 */
export function applyStructure(order:readonly string[],steps:readonly StructureStep[],newId:()=>string):string[]{
 let next=[...order];
 for(const step of steps){
  if(step.op==='insert')next.splice(step.at,0,newId());
  else if(step.op==='delete')next=next.filter(id=>id!==step.id);
  else if(step.op==='move'){next=next.filter(id=>id!==step.id);next.splice(step.to,0,step.id);}
  else if(step.op==='merge'){
   const [keep,...rest]=step.ids;
   next=next.filter(id=>!rest.includes(id));
   if(!next.includes(keep))throw Error('MERGE_TARGET_MISSING');
  }else{
   const at=next.indexOf(step.id);
   if(at<0)throw Error('SPLIT_TARGET_MISSING');
   next.splice(at+1,0,...Array.from({length:step.parts-1},newId));
  }
 }
 return next;
}

export type CharacterEntry={id:string;name:string;aliases?:string[]};

/** 在文字中按名字与别名匹配人物，保持人物设定中的顺序。 */
export function castFrom(text:string,entries:readonly CharacterEntry[]):string[]{
 return entries.filter(e=>[e.name,...(e.aliases||[])].some(n=>n.trim()&&text.includes(n.trim()))).map(e=>e.id);
}
