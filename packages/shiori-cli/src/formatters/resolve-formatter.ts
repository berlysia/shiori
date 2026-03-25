import { assertNever } from '../core/types.ts';
import type { BulkResolveResult, ResolveOutputFormat } from '../core/types.ts';
import { VERSION } from '../core/version.ts';

export {
  RESOLVE_OUTPUT_FORMATS,
  type ResolveOutputFormat,
} from '../core/types.ts';

/** JSON output schema for resolve --closed (EP-0075, ADR 028) */
export interface ResolveJsonOutput {
  meta: {
    /** Command that produced this output */
    command: 'resolve';
    /** Schema version for compatibility checks (ADR 028) */
    schemaVersion: number;
    /** Resolve mode: "closed" (bulk auto-detect) */
    mode: 'closed';
    /** Whether --apply was used */
    applied: boolean;
    /** ISO 8601 timestamp */
    timestamp: string;
    /** shiori CLI version */
    version: string;
  };
  data: {
    /** Per-ref summary (deduplicated from perRef) */
    refs: ResolveJsonRefSummary[];
    /** Aggregated totals */
    summary: {
      totalRefs: number;
      totalActions: number;
      totalFilesAffected: number;
      totalRegistryRemovals: number;
      totalSkipped: number;
    };
  };
}

/** Per-ref summary in JSON output */
export interface ResolveJsonRefSummary {
  ref: string;
  actions: number;
  filesAffected: number;
  registryRemoval: boolean;
  skipped: number;
}

/** Options for formatResolveOutput */
export interface FormatResolveOutputOptions {
  format: ResolveOutputFormat;
  bulkResult: BulkResolveResult;
  applied: boolean;
  /** Human-readable text (pre-formatted by formatBulkResolvePreview) */
  textOutput: string;
}

/**
 * Format resolve --closed output in the requested format.
 *
 * - `text`: Returns the pre-formatted human-readable preview
 * - `json`: Returns structured JSON with meta + data envelope (EP-0075)
 */
export function formatResolveOutput(
  options: FormatResolveOutputOptions,
): string {
  const { format, bulkResult, applied, textOutput } = options;

  switch (format) {
    case 'json':
      return formatResolveAsJson(bulkResult, applied);
    case 'text':
      return textOutput;
    default:
      return assertNever(format);
  }
}

function formatResolveAsJson(
  bulkResult: BulkResolveResult,
  applied: boolean,
): string {
  const output: ResolveJsonOutput = {
    meta: {
      command: 'resolve',
      schemaVersion: 1,
      mode: 'closed',
      applied,
      timestamp: new Date().toISOString(),
      version: VERSION,
    },
    data: {
      refs: bulkResult.perRef.map((entry) => ({
        ref: entry.ref,
        actions: entry.result.actions.length,
        filesAffected: entry.result.filesAffected,
        registryRemoval: entry.result.registryRemovals.length > 0,
        skipped: entry.result.skipped.length,
      })),
      summary: {
        totalRefs: bulkResult.perRef.length,
        totalActions: bulkResult.allActions.length,
        totalFilesAffected: bulkResult.totalFilesAffected,
        totalRegistryRemovals: bulkResult.allRegistryRemovals.length,
        totalSkipped: bulkResult.allSkipped.length,
      },
    },
  };

  return JSON.stringify(output, null, 2);
}
