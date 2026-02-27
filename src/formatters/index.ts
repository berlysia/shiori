import type {
  DeltaResult,
  Registry,
  ShioriAnnotation,
  ShioriCandidate,
  VerifyResult,
} from '../core/types.ts';
import { formatVerifyResultAsMarkdown } from './markdown.ts';
import { formatDeltaAsMarkdown } from './delta-markdown.ts';
import { formatAsJsonl } from './jsonl.ts';
import { formatAsSarif } from './sarif.ts';
import { formatAsSummary } from './summary.ts';
import type { OutputFormat } from './types.ts';

export type { OutputFormat } from './types.ts';
export { formatAsJsonl } from './jsonl.ts';
export { formatAsSarif } from './sarif.ts';
export { formatAsSummary, type SummaryInput } from './summary.ts';
export { formatDeltaAsMarkdown } from './delta-markdown.ts';

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
      return formatAsSummary({
        verifyResult,
        annotations,
        candidates,
        registry,
      });
    case 'jsonl':
      return formatAsJsonl(verifyResult);
    default:
      return JSON.stringify(verifyResult, null, 2);
  }
}

/** Delta output format — currently json and markdown */
export type DeltaOutputFormat = 'json' | 'markdown';

export interface FormatDeltaOutputOptions {
  format: DeltaOutputFormat;
  deltaResult: DeltaResult;
  maxIncrease?: number;
}

export function formatDeltaOutput(options: FormatDeltaOutputOptions): string {
  const { format, deltaResult, maxIncrease } = options;
  switch (format) {
    case 'markdown':
      return formatDeltaAsMarkdown(deltaResult, { maxIncrease });
    default:
      return JSON.stringify(deltaResult, null, 2);
  }
}
