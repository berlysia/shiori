import type {
  ReportResult,
  ReportFormat,
  HealthLevel,
  MaturityLevel,
  MaturityStage,
} from '../core/types.ts';
import { maturityStageFromLevel } from '../core/types.ts';
import { healthEmoji, insightIcon } from '../core/emoji.ts';
import {
  formatReportAsHtml,
  type HtmlReportOptions,
} from './report-html-formatter.ts';
import { formatReportAsGitHubSummary } from './github-summary-formatter.ts';

/**
 * Shields.io endpoint badge JSON structure.
 * @see https://shields.io/endpoint
 */
export interface ShieldsBadge {
  /** Must be 1 */
  schemaVersion: 1;
  /** Left side text */
  label: string;
  /** Right side text (score display) */
  message: string;
  /** Badge color based on health level */
  color: 'brightgreen' | 'yellow' | 'red';
  /** Governance maturity stage (present when maturity level is available) */
  stage?: MaturityStage;
}

/**
 * Map health level to shields.io color.
 */
function healthColor(level: HealthLevel): ShieldsBadge['color'] {
  switch (level) {
    case 'healthy':
      return 'brightgreen';
    case 'warning':
      return 'yellow';
    case 'critical':
      return 'red';
  }
}

/**
 * Format report as Markdown.
 */
export function formatReportAsMarkdown(result: ReportResult): string {
  const lines: string[] = [];

  // Header
  lines.push('# Shiori Governance Report');
  lines.push('');
  lines.push(`**Generated:** ${result.timestamp}`);
  lines.push('');

  // Health
  const emoji = healthEmoji(result.health.level);
  lines.push(`## Health: ${emoji} ${result.health.score}/100`);
  lines.push('');
  lines.push(result.health.summary);
  lines.push('');

  // Totals
  lines.push('## Overview');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Tracked annotations | ${result.totals.annotations} |`);
  lines.push(`| Untracked candidates | ${result.totals.candidates} |`);
  lines.push(`| Registry entries | ${result.totals.registryEntries} |`);
  lines.push(`| Issues (errors) | ${result.totals.errors} |`);
  lines.push(`| Issues (warnings) | ${result.totals.warnings} |`);
  lines.push('');

  // Insights
  if (result.insights.length > 0) {
    lines.push('## Insights');
    lines.push('');
    for (const insight of result.insights) {
      const icon = insightIcon(insight.level);
      lines.push(`- ${icon} **${insight.label}**: ${insight.message}`);
    }
    lines.push('');
  }

  // Issue breakdown
  const issueEntries = Object.entries(result.byType).filter(
    ([, count]) => count > 0,
  );
  if (issueEntries.length > 0) {
    lines.push('## Issues by Type');
    lines.push('');
    lines.push('| Type | Count |');
    lines.push('|------|-------|');
    for (const [type, count] of issueEntries) {
      lines.push(`| ${type} | ${count} |`);
    }
    lines.push('');
  }

  // Breakdowns
  if (result.byRule.length > 0) {
    lines.push('## Annotations by Rule');
    lines.push('');
    lines.push('| Rule | Count |');
    lines.push('|------|-------|');
    for (const { key, count } of result.byRule) {
      lines.push(`| ${key} | ${count} |`);
    }
    lines.push('');
  }

  if (result.byOwner.length > 0) {
    lines.push('## Ownership');
    lines.push('');
    lines.push('| Owner | Count |');
    lines.push('|-------|-------|');
    for (const { key, count } of result.byOwner) {
      lines.push(`| ${key} | ${count} |`);
    }
    lines.push('');
  }

  if (result.byKind.length > 0) {
    lines.push('## Annotation Kinds');
    lines.push('');
    lines.push('| Kind | Count |');
    lines.push('|------|-------|');
    for (const { key, count } of result.byKind) {
      lines.push(`| ${key} | ${count} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format a ReportResult as shields.io endpoint badge JSON.
 * When `maturityLevel` is provided, includes the derived stage in the output.
 * Pure function — no I/O.
 */
export function formatReportAsBadge(
  result: ReportResult,
  maturityLevel?: MaturityLevel,
): string {
  const badge: ShieldsBadge = {
    schemaVersion: 1,
    label: 'governance',
    message: `${result.health.score}/100`,
    color: healthColor(result.health.level),
  };
  if (maturityLevel !== undefined) {
    badge.stage = maturityStageFromLevel(maturityLevel);
  }
  return JSON.stringify(badge, null, 2);
}

/** Options for formatReportOutput beyond the format itself */
export interface FormatReportOptions extends HtmlReportOptions {
  /** Maturity level for badge format (adds stage field when provided) */
  maturityLevel?: MaturityLevel;
}

/**
 * Format report result for output.
 *
 * HTML-specific options are forwarded to the HTML formatter.
 * When `format` is `'badge'` and `options.maturityLevel` is provided,
 * the badge JSON includes a `stage` field.
 */
export function formatReportOutput(
  result: ReportResult,
  format: ReportFormat,
  options?: FormatReportOptions,
): string {
  switch (format) {
    case 'markdown':
      return formatReportAsMarkdown(result);
    case 'badge':
      return formatReportAsBadge(result, options?.maturityLevel);
    case 'html':
      return formatReportAsHtml(result, options);
    case 'github-summary':
      return formatReportAsGitHubSummary(result);
    default:
      return JSON.stringify(result, null, 2);
  }
}
