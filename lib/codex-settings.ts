// Share explicit Codex effort choices; an empty value preserves the CLI's inherited default.
import {z} from 'zod';

export const codexReasoningEfforts=['low','medium','high','xhigh','max'] as const;
export const codexReasoningEffortSchema=z.union([z.literal(''),z.enum(codexReasoningEfforts)]).default('');
export type CodexReasoningEffort=z.infer<typeof codexReasoningEffortSchema>;
