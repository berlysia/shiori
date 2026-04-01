import type {
  VerifyResult,
  ReportResult,
  HealthResult,
} from '../core/types.ts';
import { formatAxisSuffix } from '../core/types.ts';
import { healthEmoji, insightIcon, trendArrow } from '../core/emoji.ts';
import { MATURITY_STAGE_LABELS } from '../commands/health.ts';

/**
 * Format VerifyResult as GitHub Actions Step Summary markdown.
 *
 * Optimised for $GITHUB_STEP_SUMMARY rendering:
 * - Collapsible details for issue lists
 * - Status badges via emoji
 * - Compact tables
 */
export function formatVerifyAsGitHubSummary(result: VerifyResult): string {
  const lines: string[] = [];

  // Header with status indicator
  const statusEmoji = result.summary.errors > 0 ? '❌' : '✅';
  lines.push(
    `### ${statusEmoji} Shiori Verify: ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`,
  );
  lines.push('');

  // Summary table
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Scanned records | ${result.scannedRecords} |`);
  lines.push(`| Registry entries | ${result.registryEntries} |`);
  lines.push(`| Errors | ${result.summary.errors} |`);
  lines.push(`| Warnings | ${result.summary.warnings} |`);
  lines.push('');

  // Issue type breakdown (non-zero only)
  const nonZeroTypes = Object.entries(result.summary.byType).filter(
    ([, count]) => count > 0,
  );
  if (nonZeroTypes.length > 0) {
    lines.push('| Issue Type | Count |');
    lines.push('|------------|-------|');
    for (const [type, count] of nonZeroTypes) {
      lines.push(`| \`${type}\` | ${count} |`);
    }
    lines.push('');
  }

  // Collapsible issue details
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    lines.push(`<details><summary>❌ Errors (${errors.length})</summary>`);
    lines.push('');
    lines.push('| Ref | Type | Location | Message |');
    lines.push('|-----|------|----------|---------|');
    for (const issue of errors) {
      const loc =
        issue.file != null ? `\`${issue.file}:${issue.line ?? '-'}\`` : '-';
      lines.push(
        `| ${issue.ref || '(none)'} | \`${issue.type}\` | ${loc} | ${issue.message} |`,
      );
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`<details><summary>⚠️ Warnings (${warnings.length})</summary>`);
    lines.push('');
    lines.push('| Ref | Type | Location | Message |');
    lines.push('|-----|------|----------|---------|');
    for (const issue of warnings) {
      const loc =
        issue.file != null ? `\`${issue.file}:${issue.line ?? '-'}\`` : '-';
      lines.push(
        `| ${issue.ref || '(none)'} | \`${issue.type}\` | ${loc} | ${issue.message} |`,
      );
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  if (result.issues.length === 0) {
    lines.push('> No issues found. 🎉');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format ReportResult as GitHub Actions Step Summary markdown.
 *
 * Includes health score, insights, and breakdowns in a compact
 * layout suitable for $GITHUB_STEP_SUMMARY.
 */
export function formatReportAsGitHubSummary(result: ReportResult): string {
  const lines: string[] = [];

  // Health header
  const emoji = healthEmoji(result.health.level);
  lines.push(
    `### ${emoji} Shiori Governance: ${result.health.score}/100 (${result.health.level})`,
  );
  lines.push('');
  lines.push(`> ${result.health.summary}`);
  lines.push('');

  // Overview table
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Tracked annotations | ${result.totals.annotations} |`);
  lines.push(`| Untracked candidates | ${result.totals.candidates} |`);
  lines.push(`| Registry entries | ${result.totals.registryEntries} |`);
  lines.push(`| Errors | ${result.totals.errors} |`);
  lines.push(`| Warnings | ${result.totals.warnings} |`);
  lines.push('');

  // Insights
  if (result.insights.length > 0) {
    lines.push('#### Insights');
    lines.push('');
    for (const insight of result.insights) {
      const icon = insightIcon(insight.level);
      lines.push(`- ${icon} **${insight.label}**: ${insight.message}`);
    }
    lines.push('');
  }

  // Issue breakdown (collapsible if present)
  const nonZeroTypes = Object.entries(result.byType).filter(
    ([, count]) => count > 0,
  );
  if (nonZeroTypes.length > 0) {
    lines.push('<details><summary>Issues by Type</summary>');
    lines.push('');
    lines.push('| Type | Count |');
    lines.push('|------|-------|');
    for (const [type, count] of nonZeroTypes) {
      lines.push(`| \`${type}\` | ${count} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // Rule breakdown (collapsible)
  if (result.byRule.length > 0) {
    lines.push('<details><summary>Annotations by Rule</summary>');
    lines.push('');
    lines.push('| Rule | Count |');
    lines.push('|------|-------|');
    for (const { key, count } of result.byRule) {
      lines.push(`| \`${key}\` | ${count} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format HealthResult as GitHub Actions Step Summary markdown.
 *
 * Renders a compact health card with score, issue counts, expiration
 * warnings, trend, prescriptions, and insights — optimised for
 * $GITHUB_STEP_SUMMARY rendering.
 */
export function formatHealthAsGitHubSummary(result: HealthResult): string {
  const lines: string[] = [];

  // Health score header
  const emoji = healthEmoji(result.health.level);
  lines.push(
    `### ${emoji} Shiori Health: ${result.health.score}/100 (${result.health.level})`,
  );
  lines.push('');
  lines.push(`> ${result.health.summary}`);
  lines.push('');

  // Issue and expiration overview table
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Coverage | ${result.health.coverage}/100 |`);
  lines.push(`| Hygiene | ${result.health.hygiene}/100 |`);
  if (result.maturityStage) {
    lines.push(
      `| Stage | ${result.maturityStage} — ${MATURITY_STAGE_LABELS[result.maturityStage]} |`,
    );
  }
  lines.push(`| Issues | ${result.issues.total} |`);
  lines.push(`| Errors | ${result.issues.errors} |`);
  lines.push(`| Warnings | ${result.issues.warnings} |`);

  if (result.expiring.expired > 0 || result.expiring.expiringSoon > 0) {
    lines.push(`| Expired | ${result.expiring.expired} |`);
    lines.push(`| Expiring soon | ${result.expiring.expiringSoon} |`);
  }
  lines.push('');

  // Trend (when history is available)
  if (result.trend) {
    const arrow = trendArrow(result.trend.direction);
    const sign = result.trend.scoreChange >= 0 ? '+' : '';
    lines.push(
      `**Trend:** ${arrow} ${result.trend.direction} (${sign}${result.trend.scoreChange}) over ${result.trend.count} snapshot(s)`,
    );
    lines.push('');
  }

  // Insights
  if (result.insights.length > 0) {
    lines.push('#### Insights');
    lines.push('');
    for (const insight of result.insights) {
      const icon = insightIcon(insight.level);
      lines.push(`- ${icon} **${insight.label}**: ${insight.message}`);
    }
    lines.push('');
  }

  // Prescriptions (collapsible when present)
  if (result.prescriptions && result.prescriptions.length > 0) {
    lines.push(
      `<details><summary>💊 Prescriptions (${result.prescriptions.length})</summary>`,
    );
    lines.push('');
    lines.push('| Urgency | Impact | Command |');
    lines.push('|---------|--------|---------|');
    for (const rx of result.prescriptions) {
      const urgencyMark =
        rx.urgency === 'critical'
          ? '🔴'
          : rx.urgency === 'recommended'
            ? '🟡'
            : '⚪';
      lines.push(
        `| ${urgencyMark} ${rx.urgency} | +${rx.scoreImpact}${formatAxisSuffix(rx.axis)} | \`${rx.command}\` |`,
      );
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}
