import type {
  IssueSeverity,
  Registry,
  ShioriAnnotation,
  VerifyIssue,
  VerifyIssueType,
  VerifyResult,
} from '../core/types.ts';
import { isValidRef } from './registry-generator.ts';

export type OutputFormat = 'json' | 'markdown';

export interface VerifyOptions {
  /** Shiori annotations from scan */
  records: ShioriAnnotation[];
  /** Registry data */
  registry: Registry;
  /** Issue types that cause exit code 1 */
  failOn: VerifyIssueType[];
  /** Issue types reported as warnings */
  warnOn: VerifyIssueType[];
  /** Reference date for expiry checks (default: now, injectable for tests) */
  now?: Date;
}

function determineSeverity(
  type: VerifyIssueType,
  failOn: VerifyIssueType[],
  warnOn: VerifyIssueType[],
): IssueSeverity {
  if (failOn.includes(type)) return 'error';
  if (warnOn.includes(type)) return 'warning';
  return 'warning';
}

function buildSummary(issues: VerifyIssue[]): VerifyResult['summary'] {
  const byType: Record<VerifyIssueType, number> = {
    'missing-in-registry': 0,
    'unused-in-source': 0,
    expired: 0,
    'syntax-error': 0,
    'ref-format': 0,
  };
  let errors = 0;
  let warnings = 0;

  for (const issue of issues) {
    byType[issue.type]++;
    if (issue.severity === 'error') errors++;
    else warnings++;
  }

  return { total: issues.length, errors, warnings, byType };
}

/**
 * Normalize expires for comparison.
 * YYYY-MM → YYYY-MM-99 to treat month-only as "end of month".
 */
function normalizeExpires(expires: string): string {
  return expires.length === 7 ? expires + '-99' : expires;
}

/**
 * Verify scan results against registry, detecting issues.
 */
export function verify(options: VerifyOptions): VerifyResult {
  const { records, registry, failOn, warnOn } = options;
  const now = options.now ?? new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const issues: VerifyIssue[] = [];

  // Collect source refs (excluding empty refs and ignored annotations)
  const sourceRefs = new Set<string>();
  for (const record of records) {
    if (record.ref !== '' && !record.ignored) {
      sourceRefs.add(record.ref);
    }
  }

  // Check syntax-error (annotation marker present but parse errors exist)
  for (const record of records) {
    if (record.ignored) continue;
    if (
      record.tagged &&
      record.syntaxErrors &&
      record.syntaxErrors.length > 0
    ) {
      issues.push({
        type: 'syntax-error',
        severity: determineSeverity('syntax-error', failOn, warnOn),
        ref: record.ref,
        message: `Syntax error: ${record.syntaxErrors.join('; ')}`,
        file: record.location.file,
        line: record.location.line,
      });
    }
  }

  // Check ref-format (ADR 015-B: warn about invalid ref formats, deduplicate by ref)
  const reportedRefFormat = new Set<string>();
  for (const record of records) {
    if (record.ref === '' || record.ignored) continue;
    if (reportedRefFormat.has(record.ref)) continue;
    if (!isValidRef(record.ref)) {
      reportedRefFormat.add(record.ref);
      issues.push({
        type: 'ref-format',
        severity: determineSeverity('ref-format', failOn, warnOn),
        ref: record.ref,
        message: `Invalid ref format "${record.ref}": expected uppercase prefix with alphanumeric segments (e.g. SUP-1234, ADR:0007)`,
        file: record.location.file,
        line: record.location.line,
      });
    }
  }

  // Check missing-in-registry (deduplicate by ref)
  const reportedMissing = new Set<string>();
  for (const record of records) {
    if (record.ref === '' || record.ignored) continue;
    if (reportedMissing.has(record.ref)) continue;
    if (!(record.ref in registry)) {
      reportedMissing.add(record.ref);
      issues.push({
        type: 'missing-in-registry',
        severity: determineSeverity('missing-in-registry', failOn, warnOn),
        ref: record.ref,
        message: `ID "${record.ref}" found in source but not in registry`,
        file: record.location.file,
        line: record.location.line,
      });
    }
  }

  // Check unused-in-source
  for (const ref of Object.keys(registry)) {
    if (!sourceRefs.has(ref)) {
      issues.push({
        type: 'unused-in-source',
        severity: determineSeverity('unused-in-source', failOn, warnOn),
        ref,
        message: `ID "${ref}" exists in registry but not found in source`,
        file: undefined,
        line: undefined,
      });
    }
  }

  // Check expired (registry entries)
  for (const [ref, entry] of Object.entries(registry)) {
    if (entry.expires) {
      const norm = normalizeExpires(entry.expires);
      if (norm < todayStr) {
        issues.push({
          type: 'expired',
          severity: determineSeverity('expired', failOn, warnOn),
          ref,
          message: `ID "${ref}" expired on ${entry.expires}`,
          file: undefined,
          line: undefined,
        });
      }
    }
  }

  return {
    timestamp: now.toISOString(),
    issues,
    summary: buildSummary(issues),
    scannedRecords: records.length,
    registryEntries: Object.keys(registry).length,
  };
}

/**
 * Format VerifyResult as Markdown.
 */
export function formatVerifyResultAsMarkdown(result: VerifyResult): string {
  const lines: string[] = [];

  lines.push('# Annotation Registry Verification Report');
  lines.push('');
  lines.push(`**Date:** ${result.timestamp}`);
  lines.push(
    `**Scanned records:** ${result.scannedRecords} | **Registry entries:** ${result.registryEntries}`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('|------|-------|');
  for (const [type, count] of Object.entries(result.summary.byType)) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push('');
  lines.push(
    `**Errors:** ${result.summary.errors} | **Warnings:** ${result.summary.warnings}`,
  );

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    lines.push('');
    lines.push('| Ref | Type | File | Line | Message |');
    lines.push('|-----|------|------|------|---------|');
    for (const issue of errors) {
      lines.push(
        `| ${issue.ref || '(none)'} | ${issue.type} | ${issue.file ?? '-'} | ${issue.line ?? '-'} | ${issue.message} |`,
      );
    }
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    lines.push('| Ref | Type | File | Line | Message |');
    lines.push('|-----|------|------|------|---------|');
    for (const issue of warnings) {
      lines.push(
        `| ${issue.ref || '(none)'} | ${issue.type} | ${issue.file ?? '-'} | ${issue.line ?? '-'} | ${issue.message} |`,
      );
    }
  }

  if (result.issues.length === 0) {
    lines.push('');
    lines.push('No issues found.');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate action hints based on verify result issue types.
 * Intended for stderr output to guide users on next steps.
 */
export function formatActionHints(result: VerifyResult): string[] {
  const hints: string[] = [];
  const { byType } = result.summary;

  if (result.summary.total === 0) {
    hints.push('All checks passed. Registry is in sync with source.');
    return hints;
  }

  hints.push('');
  hints.push('Action hints:');

  if (byType['missing-in-registry'] > 0) {
    hints.push(
      `  missing-in-registry (${byType['missing-in-registry']}): Run "shiori update" to add new refs, then fill in reason/owner/expires.`,
    );
  }
  if (byType['unused-in-source'] > 0) {
    hints.push(
      `  unused-in-source (${byType['unused-in-source']}): Remove stale entries from the registry, or re-add the annotation in source.`,
    );
  }
  if (byType['expired'] > 0) {
    hints.push(
      `  expired (${byType['expired']}): Resolve the underlying issue and remove the annotation, or extend expires in the registry.`,
    );
  }
  if (byType['syntax-error'] > 0) {
    hints.push(
      `  syntax-error (${byType['syntax-error']}): Fix annotation syntax. Expected: "shiori: <ref> [key=value ...]"`,
    );
  }
  if (byType['ref-format'] > 0) {
    hints.push(
      `  ref-format (${byType['ref-format']}): Fix ref format. Expected: uppercase prefix with alphanumeric segments (e.g. SUP-1234, ADR:0007)`,
    );
  }

  return hints;
}
