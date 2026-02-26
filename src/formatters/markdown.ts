import type { VerifyResult } from '../core/types.ts';

/**
 * Format VerifyResult as Markdown report.
 *
 * Extracted from verify.ts to formatters/ so that formatting
 * concerns are co-located with other output formatters (sarif,
 * summary, jsonl) rather than mixed into verification logic.
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
