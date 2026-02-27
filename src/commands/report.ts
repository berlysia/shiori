import type {
  Registry,
  ScanResult,
  ShioriAnnotation,
  ShioriCandidate,
  VerifyResult,
  VerifyIssueType,
} from '../core/types.ts';
import { verify } from './verify.ts';
import type { RegistryDuplicateWarning } from '../core/registry.ts';
import type { RefPatternConfig } from '../core/ref-pattern.ts';

/** Input options for generating a report */
export interface ReportOptions {
  scanResult: ScanResult;
  registry: Registry;
  failOn: VerifyIssueType[];
  warnOn: VerifyIssueType[];
  /** Reference date for expiry checks (injectable for tests) */
  now?: Date;
  /** Registry duplicate warnings from multi-registry loading */
  duplicates?: RegistryDuplicateWarning[];
  /** Pattern-based ref routing configuration (ADR 012) */
  refPatterns?: RefPatternConfig[];
  /** Maps each ref to its origin registryFile (ADR 012 phase 2) */
  refOrigins?: Map<string, string | null>;
}

/** Health assessment level */
export type HealthLevel = 'healthy' | 'warning' | 'critical';

/** A single governance insight */
export interface ReportInsight {
  /** Severity of the insight */
  level: 'info' | 'warning' | 'error';
  /** Short label for the insight */
  label: string;
  /** Descriptive message */
  message: string;
}

/** Aggregated breakdown entry */
export interface BreakdownEntry {
  key: string;
  count: number;
}

/** Report output */
export interface ReportResult {
  /** ISO timestamp when report was generated */
  timestamp: string;
  /** Overall governance health assessment */
  health: {
    level: HealthLevel;
    /** Health score 0-100 (100 = fully healthy) */
    score: number;
    /** Short summary of governance state */
    summary: string;
  };
  /** Numeric totals */
  totals: {
    annotations: number;
    candidates: number;
    registryEntries: number;
    issues: number;
    errors: number;
    warnings: number;
  };
  /** Key governance insights (actionable items) */
  insights: ReportInsight[];
  /** Issue breakdown by type */
  byType: Record<VerifyIssueType, number>;
  /** Annotation breakdown by rule */
  byRule: BreakdownEntry[];
  /** Registry breakdown by kind */
  byKind: BreakdownEntry[];
  /** Registry breakdown by owner */
  byOwner: BreakdownEntry[];
  /** Underlying verify result (for downstream consumers) */
  verifyResult: VerifyResult;
}

/** Report output format */
export type ReportFormat = 'json' | 'markdown';

/**
 * Generate a governance report from scan result and registry.
 * Pure function — no I/O. Runs verify() internally.
 */
export function report(options: ReportOptions): ReportResult {
  const {
    scanResult,
    registry,
    failOn,
    warnOn,
    now,
    duplicates,
    refPatterns,
    refOrigins,
  } = options;

  const verifyResult = verify({
    records: scanResult.annotations,
    registry,
    failOn,
    warnOn,
    now,
    duplicates,
    refPatterns,
    refOrigins,
  });

  const { annotations, candidates } = scanResult;
  const byType = verifyResult.summary.byType;

  const insights = buildInsights(annotations, candidates, registry, byType);
  const score = calculateScore(annotations, candidates, byType);
  const level = scoreToLevel(score);
  const summary = buildHealthSummary(level, score, verifyResult.summary.total);

  return {
    timestamp: verifyResult.timestamp,
    health: { level, score, summary },
    totals: {
      annotations: annotations.length,
      candidates: candidates.length,
      registryEntries: Object.keys(registry).length,
      issues: verifyResult.summary.total,
      errors: verifyResult.summary.errors,
      warnings: verifyResult.summary.warnings,
    },
    insights,
    byType,
    byRule: aggregateByRule(annotations),
    byKind: aggregateByKind(registry),
    byOwner: aggregateByOwner(registry),
    verifyResult,
  };
}

/**
 * Build actionable governance insights.
 */
function buildInsights(
  annotations: ShioriAnnotation[],
  candidates: ShioriCandidate[],
  registry: Registry,
  byType: Record<VerifyIssueType, number>,
): ReportInsight[] {
  const insights: ReportInsight[] = [];

  // Expired entries need immediate attention
  if (byType['expired'] > 0) {
    insights.push({
      level: 'error',
      label: 'expired',
      message: `${byType['expired']} annotation(s) have expired. Resolve the underlying issues or extend the expiration dates.`,
    });
  }

  // Missing in registry = untracked annotations
  if (byType['missing-in-registry'] > 0) {
    insights.push({
      level: 'warning',
      label: 'unregistered',
      message: `${byType['missing-in-registry']} annotation(s) are not registered. Run "shiori update" to add them.`,
    });
  }

  // Unused in source = stale registry entries
  if (byType['unused-in-source'] > 0) {
    insights.push({
      level: 'warning',
      label: 'stale',
      message: `${byType['unused-in-source']} registry entry(ies) have no matching source annotation. Consider removing them.`,
    });
  }

  // Candidates = untracked lint disables
  if (candidates.length > 0) {
    const ratio =
      annotations.length > 0
        ? (
            (candidates.length / (annotations.length + candidates.length)) *
            100
          ).toFixed(0)
        : '100';
    insights.push({
      level: 'info',
      label: 'candidates',
      message: `${candidates.length} lint disable comment(s) detected without shiori tracking (${ratio}% untracked). Run "shiori candidates" to review.`,
    });
  }

  // Syntax errors
  if (byType['syntax-error'] > 0) {
    insights.push({
      level: 'error',
      label: 'syntax',
      message: `${byType['syntax-error']} annotation(s) have syntax errors. Fix annotation format: "shiori: <ref> [key=value ...]"`,
    });
  }

  // Ref collisions
  if (byType['ref-collision'] > 0) {
    insights.push({
      level: 'warning',
      label: 'collision',
      message: `${byType['ref-collision']} ref(s) are duplicated across registry files. Consolidate to a single registry per ref.`,
    });
  }

  // All clear
  if (insights.length === 0) {
    insights.push({
      level: 'info',
      label: 'clean',
      message:
        'All annotations are tracked, registered, and valid. No issues detected.',
    });
  }

  return insights;
}

/**
 * Calculate governance health score (0-100).
 *
 * Scoring:
 * - Start at 100
 * - Each error-level issue type deducts points proportional to severity
 * - Untracked candidates reduce score (less impact than actual issues)
 */
function calculateScore(
  annotations: ShioriAnnotation[],
  candidates: ShioriCandidate[],
  byType: Record<VerifyIssueType, number>,
): number {
  let score = 100;
  const totalTracked = annotations.length;

  // Critical deductions (10 points per issue, max 40)
  const criticalIssues = byType['expired'] + byType['syntax-error'];
  score -= Math.min(criticalIssues * 10, 40);

  // Major deductions (5 points per issue, max 30)
  const majorIssues =
    byType['missing-in-registry'] +
    byType['unused-in-source'] +
    byType['ref-collision'];
  score -= Math.min(majorIssues * 5, 30);

  // Minor deductions (2 points per issue, max 10)
  const minorIssues =
    byType['ref-format'] +
    byType['unrouted-ref'] +
    byType['registry-routing-mismatch'];
  score -= Math.min(minorIssues * 2, 10);

  // Candidate ratio penalty (max 20)
  if (totalTracked + candidates.length > 0) {
    const untrackedRatio =
      candidates.length / (totalTracked + candidates.length);
    score -= Math.round(untrackedRatio * 20);
  }

  return Math.max(0, Math.min(100, score));
}

function scoreToLevel(score: number): HealthLevel {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'warning';
  return 'critical';
}

function buildHealthSummary(
  level: HealthLevel,
  score: number,
  issueCount: number,
): string {
  switch (level) {
    case 'healthy':
      return issueCount === 0
        ? `Governance health: ${score}/100. All annotations are properly tracked.`
        : `Governance health: ${score}/100. ${issueCount} minor issue(s) detected.`;
    case 'warning':
      return `Governance health: ${score}/100. ${issueCount} issue(s) require attention.`;
    case 'critical':
      return `Governance health: ${score}/100. ${issueCount} issue(s) require immediate action.`;
  }
}

/** Aggregate annotations by rule, sorted descending by count */
function aggregateByRule(annotations: ShioriAnnotation[]): BreakdownEntry[] {
  const map = new Map<string, number>();
  for (const a of annotations) {
    if (a.rule) {
      map.set(a.rule, (map.get(a.rule) ?? 0) + 1);
    }
  }
  return sortedEntries(map);
}

/** Aggregate registry entries by kind, sorted descending by count */
function aggregateByKind(registry: Registry): BreakdownEntry[] {
  const map = new Map<string, number>();
  for (const entry of Object.values(registry)) {
    if (entry.kind) {
      map.set(entry.kind, (map.get(entry.kind) ?? 0) + 1);
    }
  }
  return sortedEntries(map);
}

/** Aggregate registry entries by owner, sorted descending by count */
function aggregateByOwner(registry: Registry): BreakdownEntry[] {
  const map = new Map<string, number>();
  for (const entry of Object.values(registry)) {
    if (entry.owner) {
      map.set(entry.owner, (map.get(entry.owner) ?? 0) + 1);
    }
  }
  return sortedEntries(map);
}

function sortedEntries(map: Map<string, number>): BreakdownEntry[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
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
  const healthEmoji =
    result.health.level === 'healthy'
      ? '🟢'
      : result.health.level === 'warning'
        ? '🟡'
        : '🔴';
  lines.push(`## Health: ${healthEmoji} ${result.health.score}/100`);
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
      const icon =
        insight.level === 'error'
          ? '❌'
          : insight.level === 'warning'
            ? '⚠️'
            : 'ℹ️';
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
 * Format report result for output.
 */
export function formatReport(
  result: ReportResult,
  format: ReportFormat,
): string {
  switch (format) {
    case 'markdown':
      return formatReportAsMarkdown(result);
    default:
      return JSON.stringify(result, null, 2);
  }
}
