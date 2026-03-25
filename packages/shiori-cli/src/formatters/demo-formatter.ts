/**
 * Formatters for scan --demo output (EP-0174: Demo as Shareable Artifact).
 *
 * Converts DemoResult into shareable formats (markdown, github-summary)
 * so users can export and share demo results with their team.
 */

import type { DemoResult } from '../core/types.ts';
import { healthEmoji } from '../core/emoji.ts';

/**
 * Format DemoResult as portable Markdown suitable for
 * sharing via gist, PR comment, or documentation.
 */
export function formatDemoResultAsMarkdown(result: DemoResult): string {
  const lines: string[] = [];

  const emoji = healthEmoji(result.healthLevel);

  lines.push('# shiori scan --demo');
  lines.push('');
  lines.push(
    'shiori はソースコード中の lint disable コメントや設計判断を構造化アノテーションとして追跡し、技術的負債を可視化します。',
  );
  lines.push('');

  // Scan summary
  lines.push('## Scan Results');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Files scanned | ${result.scanResult.filesScanned} |`);
  lines.push(`| Annotations | ${result.scanResult.annotations.length} |`);
  lines.push(`| Candidates | ${result.scanResult.candidates.length} |`);
  lines.push('');

  // Annotation details
  if (result.scanResult.annotations.length > 0) {
    lines.push('### Annotations');
    lines.push('');
    lines.push('| Ref | Location | Rule | Expires |');
    lines.push('|-----|----------|------|---------|');
    for (const a of result.scanResult.annotations) {
      const ref = a.ref || '(draft)';
      const loc = `\`${a.location.file}:${a.location.line}\``;
      const rule = a.rule ? `\`${a.rule}\`` : '-';
      const expires = a.expires ?? '-';
      lines.push(`| ${ref} | ${loc} | ${rule} | ${expires} |`);
    }
    lines.push('');
  }

  // Verify issues
  if (result.verifyResult.issues.length > 0) {
    lines.push('## Verify Issues');
    lines.push('');
    lines.push('| Severity | Type | Ref | Message |');
    lines.push('|----------|------|-----|---------|');
    for (const issue of result.verifyResult.issues) {
      const severity = issue.severity === 'error' ? '❌' : '⚠️';
      lines.push(
        `| ${severity} | \`${issue.type}\` | ${issue.ref} | ${issue.message} |`,
      );
    }
    lines.push('');
  }

  // Health score
  lines.push('## Health');
  lines.push('');
  lines.push(
    `${emoji} **Score: ${result.healthScore}/100** (${result.healthLevel})`,
  );
  lines.push('');

  // CTA
  lines.push('## Next Steps');
  lines.push('');
  lines.push('```bash');
  lines.push('shiori init            # プロジェクトにレジストリを作成');
  lines.push('shiori scan            # 実際のソースコードをスキャン');
  lines.push('shiori health          # ガバナンス健全性を確認');
  lines.push('```');
  lines.push('');
  lines.push(
    '📖 [Getting Started](https://github.com/berlysia/shiori/blob/master/docs/getting-started.md) | [Repository](https://github.com/berlysia/shiori)',
  );

  return lines.join('\n');
}

/**
 * Format DemoResult as GitHub Actions Step Summary markdown.
 *
 * Optimised for $GITHUB_STEP_SUMMARY rendering with
 * collapsible sections and compact tables.
 */
export function formatDemoResultAsGitHubSummary(result: DemoResult): string {
  const lines: string[] = [];

  const emoji = healthEmoji(result.healthLevel);

  lines.push(
    `### ${emoji} Shiori Demo: ${result.healthScore}/100 (${result.healthLevel})`,
  );
  lines.push('');
  lines.push(
    '> `shiori scan --demo` の結果 — 3 つのサンプルファイルによるガバナンス体験',
  );
  lines.push('');

  // Overview table
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Files scanned | ${result.scanResult.filesScanned} |`);
  lines.push(`| Annotations | ${result.scanResult.annotations.length} |`);
  lines.push(`| Verify errors | ${result.verifyResult.summary.errors} |`);
  lines.push(`| Verify warnings | ${result.verifyResult.summary.warnings} |`);
  lines.push('');

  // Collapsible annotation details
  if (result.scanResult.annotations.length > 0) {
    lines.push(
      `<details><summary>📋 Annotations (${result.scanResult.annotations.length})</summary>`,
    );
    lines.push('');
    lines.push('| Ref | Location | Rule | Expires |');
    lines.push('|-----|----------|------|---------|');
    for (const a of result.scanResult.annotations) {
      const ref = a.ref || '(draft)';
      const loc = `\`${a.location.file}:${a.location.line}\``;
      const rule = a.rule ? `\`${a.rule}\`` : '-';
      const expires = a.expires ?? '-';
      lines.push(`| ${ref} | ${loc} | ${rule} | ${expires} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // Collapsible verify issues
  if (result.verifyResult.issues.length > 0) {
    lines.push(
      `<details><summary>🔍 Verify Issues (${result.verifyResult.issues.length})</summary>`,
    );
    lines.push('');
    lines.push('| Severity | Type | Ref | Message |');
    lines.push('|----------|------|-----|---------|');
    for (const issue of result.verifyResult.issues) {
      const severity = issue.severity === 'error' ? '❌' : '⚠️';
      lines.push(
        `| ${severity} | \`${issue.type}\` | ${issue.ref} | ${issue.message} |`,
      );
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // Next steps
  lines.push('**Next:** `shiori init` → `shiori scan` → `shiori health`');
  lines.push('');

  return lines.join('\n');
}
