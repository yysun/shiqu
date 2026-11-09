// Keep one submitted version per story family, even when an old direct link is inspected later.
import type {SessionView} from './reader-model.ts';
type FamilyMember={id:string;revision?:Pick<NonNullable<SessionView['revision']>,'rootId'|'number'>};
export const storyFamily=(session:FamilyMember)=>session.revision?.rootId||session.id;
export function latestStoryVersions<T extends FamilyMember>(sessions:T[]){
 const latest=new Map<string,T>();
 for(const session of sessions){
  const family=storyFamily(session),old=latest.get(family);
  if(!old||(session.revision?.number||1)>(old.revision?.number||1))latest.set(family,session);
 }
 return [...latest.values()];
}
