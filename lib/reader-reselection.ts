// Share explicit draft selection commands; browsing never commits a bookshelf version.
import {z} from 'zod';
import {setupSettingsSchema} from './reader-intake.ts';
export const replacementChoiceSchema=z.object({requestId:z.string().uuid(),batch:z.number().int().nonnegative(),index:z.number().int().min(0).max(4),settings:setupSettingsSchema.optional()}).strict();
export type ReplacementChoice=z.infer<typeof replacementChoiceSchema>;
