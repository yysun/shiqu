// Keep one submitted version per story family, even when an old direct link is inspected later.
import type {SessionView} from './reader-model.ts';
export const storyFamily=(session:SessionView)=>session.revision?.rootId||session.id;
export function latestStoryVersions(sessions:SessionView[]){
 const latest=new Map<string,SessionView>();
 for(const session of sessions){
  const family=storyFamily(session),old=latest.get(family);
  if(!old||(session.revision?.number||1)>(old.revision?.number||1))latest.set(family,session);
 }
 return [...latest.values()];
}
