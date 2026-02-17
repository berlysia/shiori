import type {
  Registry,
  ShioriAnnotation,
  ShioriCandidate,
  VerifyResult,
} from '../core/types.ts';
import { formatVerifyResultAsMarkdown } from '../commands/verify.ts';
import { formatAsJsonl } from './jsonl.ts';
import { formatAsSarif } from './sarif.ts';
import { formatAsSummary } from './summary.ts';
import type { OutputFormat } from './types.ts';

export type { OutputFormat } from './types.ts';
export { formatAsJsonl } from './jsonl.ts';
export { formatAsSarif } from './sarif.ts';
export { formatAsSummary, type SummaryInput } from './summary.ts';

export interface FormatVerifyOutputOptions {
  format: OutputFormat;
  verifyResult: VerifyResult;
  annotations: ShioriAnnotation[];
  candidates: ShioriCandidate[];
  registry: Registry;
}

export function formatVerifyOutput(options: FormatVerifyOutputOptions): string {
  const { format, verifyResult, annotations, candidates, registry } = options;
  switch (format) {
    case 'markdown':
      return formatVerifyResultAsMarkdown(verifyResult);
    case 'sarif':
      return formatAsSarif(verifyResult);
    case 'summary':
      return formatAsSummary({ verifyResult, annotations, candidates, registry });
    case 'jsonl':
      return formatAsJsonl(verifyResult);
    default:
      return JSON.stringify(verifyResult, null, 2);
  }
}
