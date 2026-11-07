// 从原文单元和可选排版提示分割连续条目。语义判断只决定边界，程序保留原文、顺序和完整覆盖。
export type SegmentationUnit={id:string;text:string};
export type SegmentationSection<T extends SegmentationUnit=SegmentationUnit>={
 id:string;
 units:T[];
 layoutStarts?:string[];
};
export type BoundaryCandidate={id:string;before:string;after:string;layout:'start'|'continue'|'unknown';openClause:boolean};

export function layoutStoryStarts(units:SegmentationUnit[],lines:string[]){
 const matching=lines.flatMap((line,index)=>line.trim()===units[0]?.text&&
  units.every((unit,offset)=>lines[index+offset]?.trim()===unit.text)?[index]:[]);
 if(matching.length!==1)return undefined;
 const start=matching[0];
 const result=units.flatMap((unit,index)=>/^\s/u.test(lines[start+index])?[]:[unit.id]);
 return result[0]===units[0]?.id?result:undefined;
}

export function boundaryCandidates(sections:SegmentationSection[]){
 const ids=new Set<string>();
 const result:BoundaryCandidate[]=[];
 for(const {id,units,layoutStarts} of sections){
  const starts=layoutStarts&&new Set(layoutStarts);
  if(starts&&(!starts.has(units[0]?.id)||starts.size!==layoutStarts?.length))throw Error('排版起点无效 '+id);
  if(starts&&layoutStarts?.some(start=>!units.some(unit=>unit.id===start)))throw Error('排版起点不在原文中 '+id);
  for(const [index,unit] of units.entries()){
   if(!unit.id||!unit.text.trim()||ids.has(unit.id))throw Error('原文单元缺失或重复 '+unit.id);
   ids.add(unit.id);
   if(index===0)continue;
   const layout=starts?(starts.has(unit.id)?'start':'continue'):'unknown';
   result.push({id:unit.id,layout,openClause:/[其于於以為爲與与向欲將将使令所]$/u.test(units[index-1].text.trim()),
    before:units.slice(Math.max(0,index-3),index).map(item=>item.text).join('\n').slice(-170),
    after:units.slice(index,index+3).map(item=>item.text).join('\n').slice(0,170)});
  }
 }
 return result;
}

// 窗口只负责自己范围内的单元，前后邻文用于判断延续，不生成额外边界。
export function semanticBoundaryWindows(sections:SegmentationSection[],maxUnits=80,maxChars=2600){
 const windows:{units:SegmentationUnit[];ids:string[];before:string;after:string}[]=[];
 if(maxUnits<1||maxChars<1)throw Error('语义窗口大小无效');
 for(const {units} of sections){
  for(let start=0;start<units.length;){
   let end=start+1,chars=units[start].text.length;
   while(end<units.length&&end-start<maxUnits&&chars+units[end].text.length<=maxChars){
    chars+=units[end++].text.length;
   }
   const core=units.slice(start,end);
   const ids=core.slice(start===0?1:0).map(unit=>unit.id);
   if(ids.length)windows.push({units:core,ids,
    before:units.slice(Math.max(0,start-4),start).map(unit=>unit.text).join('\n').slice(-250),
    after:units.slice(end,end+4).map(unit=>unit.text).join('\n').slice(0,250)});
   start=end;
  }
 }
 return windows;
}

export function validateSemanticStarts(ids:string[],value:unknown){
 if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!ids.includes(id))||new Set(value).size!==value.length)
  throw Error('语义起点不在当前原文窗口中，或有重复');
 const starts=new Set(value);
 return new Map(ids.map(id=>[id,starts.has(id)]));
}

// 两次语义判断分歧时，断开的语法结构支持保留长窗口的续接判断。
export function reconcileBoundaryReviews(
 initial:Map<string,boolean>,candidates:BoundaryCandidate[],reviewed:Map<string,boolean>,
){
 const decisions=new Map(initial);
 for(const {id,openClause} of candidates){
  const decision=reviewed.get(id);
  if(decision===undefined)continue;
  if(decision&&initial.get(id)===false&&openClause)continue;
  decisions.set(id,decision);
 }
 return decisions;
}

export function validateBoundaryDecisions(candidates:BoundaryCandidate[],value:unknown):Map<string,boolean>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('边界判断必须是 JSON 对象');
 const decisions=value as Record<string,unknown>;
 if(Object.keys(decisions).length!==candidates.length)throw Error('边界判断数量与候选不一致');
 return new Map(candidates.map(({id})=>{
  if(decisions[id]!==0&&decisions[id]!==1)throw Error('缺少有效边界判断 '+id);
  return [id,decisions[id]===1];
 }));
}

export function partitionStoryUnits<T extends SegmentationUnit>(sections:SegmentationSection<T>[],decisions:Map<string,boolean>){
 return sections.map(section=>{
  const {units}=section,layout=new Set(section.layoutStarts);
  const groups:T[][]=[];
  for(const [index,unit] of units.entries()){
   if(index===0||(decisions.get(unit.id)??layout.has(unit.id)))groups.push([]);
   groups.at(-1)!.push(unit);
  }
  return {id:section.id,groups};
 });
}
