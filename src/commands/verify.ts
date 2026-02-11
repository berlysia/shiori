import type {
  IssueSeverity,
  Registry,
  ShioriAnnotation,
  VerifyIssue,
  VerifyIssueType,
  VerifyResult,
} from '../core/types.ts';

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
    malformed: 0,
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

  // Collect source refs (excluding empty = malformed)
  const sourceRefs = new Set<string>();
  for (const record of records) {
    if (record.ref !== '') {
      sourceRefs.add(record.ref);
    }
  }

  // Check malformed (empty ref without shiori: marker; drafts are excluded)
  for (const record of records) {
    if (record.ref === '' && !record.tagged) {
      issues.push({
        type: 'malformed',
        severity: determineSeverity('malformed', failOn, warnOn),
        ref: '',
        message: 'Annotation without tracking ID',
        file: record.location.file,
        line: record.location.line,
      });
    }
  }

  // Check missing-in-registry (deduplicate by ref)
  const reportedMissing = new Set<string>();
  for (const record of records) {
    if (record.ref === '') continue;
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
