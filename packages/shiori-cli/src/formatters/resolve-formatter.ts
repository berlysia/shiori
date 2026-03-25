import { assertNever } from '../core/types.ts';
import type { BulkResolveResult, ResolveOutputFormat } from '../core/types.ts';
import { wrapOutput, type OutputMeta } from '../core/schema-envelope.ts';

export {
  RESOLVE_OUTPUT_FORMATS,
  type ResolveOutputFormat,
} from '../core/types.ts';

/** Extended meta for resolve command (adds mode + applied to standard OutputMeta) */
export interface ResolveOutputMeta extends OutputMeta {
  /** Resolve mode: "closed" (bulk auto-detect) */
  mode: 'closed';
  /** Whether --apply was used */
  applied: boolean;
}

/** JSON output schema for resolve --closed (EP-0075, ADR 028) */
export interface ResolveJsonOutput {
  meta: ResolveOutputMeta;
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
  const dataPayload = {
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
  };

  const base = wrapOutput(dataPayload, {
    command: 'resolve',
    schemaVersion: 1,
    includeTimestamp: true,
  });

  // Extend meta with resolve-specific fields (mode, applied)
  const output: ResolveJsonOutput = {
    meta: { ...base.meta, mode: 'closed', applied },
    data: base.data,
  };

  return JSON.stringify(output, null, 2);
}
