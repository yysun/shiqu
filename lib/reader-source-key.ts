// Compare receipts canonically, including every continuation, without importing model contracts.
import type {LocalSourceReference,LocalPassage} from './reader-local-contract.ts';
export function sourceRanges(source:LocalPassage){return [{sectionId:source.sectionId,firstUnit:source.firstUnit,lastUnit:source.lastUnit},...(source.continuations||[])];}
export function localSourceKey(source:LocalSourceReference){return JSON.stringify([source.edition,...sourceRanges(source).map(r=>[r.sectionId,r.firstUnit,r.lastUnit])]);}
