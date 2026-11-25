// Keep user recovery intent separate from demand heartbeats and from mutable session errors.
import {z} from 'zod';
export const recoveryRequestSchema=z.object({requestId:z.string().uuid(),faultId:z.string().min(1).max(100)}).strict();
export const reviewOverrideSchema=recoveryRequestSchema.extend({ending:z.union([z.literal('default'),z.number().int().min(1).max(3),
 z.object({title:z.string().trim().min(1).max(40),reflection:z.string().trim().min(1).max(100)}).strict()]).optional()});
export type ReviewOverride=z.infer<typeof reviewOverrideSchema>;
export type ReviewOverrideOffer={faultId:string;title:string;reflection:string;needsEnding:boolean};
export type RecoveryRequest=z.infer<typeof recoveryRequestSchema>;
export type FaultView={id:string;message:string;page:number|null;stage:'source'|'prepare'|'generation'|'publication'|'review'|'redraw';state:'pending'|'recovering'|'awaiting-match';retryAllowed:boolean;retryReview?:true};
export type RecoveryReceiptView={requestId:string;status:'queued'|'running'|'succeeded'|'failed';error:string|null};
