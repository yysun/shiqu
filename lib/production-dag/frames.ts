// 按人物设定的名字与别名匹配候选人物和入画人物。

export type CharacterEntry={id:string;name:string;aliases?:string[]};

/** 在文字中按名字与别名匹配人物，保持人物设定中的顺序。 */
export function castFrom(text:string,entries:readonly CharacterEntry[]):string[]{
 return entries.filter(e=>[e.name,...(e.aliases||[])].some(n=>n.trim()&&text.includes(n.trim()))).map(e=>e.id);
}
