import {
  assertNever,
  type DeltaOutputFormat,
  type DeltaResult,
  type Registry,
  type ShioriAnnotation,
  type ShioriCandidate,
  type VerifyResult,
} from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { formatVerifyResultAsMarkdown } from './markdown.ts';
import { formatDeltaAsMarkdown } from './delta-markdown.ts';
import { formatAsDiagnostic } from './diagnostic.ts';
import { formatAsJsonl } from './jsonl.ts';
import { formatAsSarif } from './sarif.ts';
import { formatAsSummary } from './summary.ts';
import { formatVerifyAsGitHubSummary } from './github-summary-formatter.ts';
import type { OutputFormat } from './types.ts';

export type { OutputFormat } from './types.ts';
export { formatAsDiagnostic } from './diagnostic.ts';
export { formatAsJsonl } from './jsonl.ts';
export { formatAsSarif } from './sarif.ts';
export { formatAsSummary, type SummaryInput } from './summary.ts';
export { formatDeltaAsMarkdown } from './delta-markdown.ts';
export {
  formatReportAsMarkdown,
  formatReportAsBadge,
  formatReportOutput,
  type ShieldsBadge,
  type FormatReportOptions,
} from './report-formatter.ts';
export {
  formatVerifyAsGitHubSummary,
  formatReportAsGitHubSummary,
} from './github-summary-formatter.ts';
export {
  formatAnnotateAsJson,
  type AnnotateJsonOutput,
} from './annotate-formatter.ts';
export {
  formatResolveOutput,
  type ResolveOutputFormat,
  type ResolveJsonOutput,
  type ResolveJsonRefSummary,
  type FormatResolveOutputOptions,
} from './resolve-formatter.ts';
export {
  formatFixPlan,
  formatFixPlanJson,
  formatFixPlanMarkdown,
  formatFixApplyResult,
  formatFixApplyResultJson,
} from './fix-formatter.ts';
export {
  formatWeeklyReport,
  formatWeeklyReportAsMarkdown,
  formatWeeklyReportAsHtml,
} from './weekly-report-formatter.ts';

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
    case 'diagnostic':
      return formatAsDiagnostic(verifyResult);
    case 'github-summary':
      return formatVerifyAsGitHubSummary(verifyResult);
    case 'json':
      return wrapOutputJson(verifyResult, {
        command: 'verify',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
}

export { DELTA_OUTPUT_FORMATS, type DeltaOutputFormat } from '../core/types.ts';

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
    case 'json':
      return wrapOutputJson(deltaResult, {
        command: 'delta',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
}
