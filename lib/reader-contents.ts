// Contents expose source identity and a short preview without shipping whole book bodies.
import type {LocalSourceReference} from './reader-local-contract.ts';
export type BookContentEntry={id:string;title:string;chapter:string;excerpt:string;source?:LocalSourceReference;unavailable?:string};
export type BookContents={bookId:string;title:string;entries:BookContentEntry[]};
