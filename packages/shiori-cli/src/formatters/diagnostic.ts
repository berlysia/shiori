import type { VerifyIssue, VerifyResult } from '../core/types.ts';

/**
 * Format a single VerifyIssue as a GCC-compatible diagnostic line.
 *
 * Format: `file:line:column: severity: message [type]`
 *
 * Issues without file/line use `<unknown>:0:1` so every issue produces output
 * and the VS Code `$gcc` Problem Matcher can still parse the severity/message.
 */
function formatIssueLine(issue: VerifyIssue): string {
  const file = issue.file ?? '<unknown>';
  const line = issue.line ?? 0;
  const column = 1;
  return `${file}:${line}:${column}: ${issue.severity}: ${issue.message} [${issue.type}]`;
}

/**
 * Format VerifyResult as GCC-compatible diagnostic text.
 *
 * Each issue becomes one line in the format recognized by VS Code's
 * built-in `$gcc` Problem Matcher:
 *
 *   file:line:column: severity: message [type]
 *
 * Returns empty string when there are no issues.
 */
export function formatAsDiagnostic(result: VerifyResult): string {
  if (result.issues.length === 0) return '';
  return result.issues.map(formatIssueLine).join('\n');
}
