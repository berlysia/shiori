import type {
  IssueSeverity,
  Registry,
  AnnotationRecord,
  VerifyIssue,
  VerifyIssueType,
  VerifyResult,
} from '../core/types.ts';

export type OutputFormat = 'json' | 'markdown';

export interface VerifyOptions {
  /** Annotation records from scan */
  records: AnnotationRecord[];
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
 * Verify scan results against registry, detecting issues.
 */
export function verify(options: VerifyOptions): VerifyResult {
  const { records, registry, failOn, warnOn } = options;
  const now = options.now ?? new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const issues: VerifyIssue[] = [];

  // Collect source IDs (excluding empty = malformed)
  const sourceIds = new Set<string>();
  for (const record of records) {
    if (record.id !== '') {
      sourceIds.add(record.id);
    }
  }

  // Check malformed (empty ID)
  for (const record of records) {
    if (record.id === '') {
      issues.push({
        type: 'malformed',
        severity: determineSeverity('malformed', failOn, warnOn),
        id: '',
        message: 'Annotation without tracking ID',
        file: record.file,
        line: record.line,
      });
    }
  }

  // Check missing-in-registry (deduplicate by ID)
  const reportedMissing = new Set<string>();
  for (const record of records) {
    if (record.id === '') continue;
    if (reportedMissing.has(record.id)) continue;
    if (!(record.id in registry)) {
      reportedMissing.add(record.id);
      issues.push({
        type: 'missing-in-registry',
        severity: determineSeverity('missing-in-registry', failOn, warnOn),
        id: record.id,
        message: `ID "${record.id}" found in source but not in registry`,
        file: record.file,
        line: record.line,
      });
    }
  }

  // Check unused-in-source
  for (const id of Object.keys(registry)) {
    if (!sourceIds.has(id)) {
      issues.push({
        type: 'unused-in-source',
        severity: determineSeverity('unused-in-source', failOn, warnOn),
        id,
        message: `ID "${id}" exists in registry but not found in source`,
        file: undefined,
        line: undefined,
      });
    }
  }

  // Check expired (registry entries)
  for (const [id, entry] of Object.entries(registry)) {
    if (entry.expires && entry.expires < todayStr) {
      issues.push({
        type: 'expired',
        severity: determineSeverity('expired', failOn, warnOn),
        id,
        message: `ID "${id}" expired on ${entry.expires}`,
        file: undefined,
        line: undefined,
      });
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
    lines.push('| ID | Type | File | Line | Message |');
    lines.push('|----|------|------|------|---------|');
    for (const issue of errors) {
      lines.push(
        `| ${issue.id || '(none)'} | ${issue.type} | ${issue.file ?? '-'} | ${issue.line ?? '-'} | ${issue.message} |`,
      );
    }
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    lines.push('| ID | Type | File | Line | Message |');
    lines.push('|----|------|------|------|---------|');
    for (const issue of warnings) {
      lines.push(
        `| ${issue.id || '(none)'} | ${issue.type} | ${issue.file ?? '-'} | ${issue.line ?? '-'} | ${issue.message} |`,
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
