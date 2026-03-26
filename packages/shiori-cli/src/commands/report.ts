import { dirname } from 'node:path/posix';
import type {
  Registry,
  ScanResult,
  ShioriAnnotation,
  ShioriCandidate,
  VerifyIssueType,
  VerifyResult,
  HealthLevel,
  ReportResult,
  ReportInsight,
  BreakdownEntry,
  FileBreakdownEntry,
  DirectoryBreakdownEntry,
} from '../core/types.ts';
import { verify, type VerifyOptions } from './verify.ts';
import {
  DEDUCTION_TIERS,
  type DeductionTier,
} from '../core/deduction-tiers.ts';

export type { DeductionTier };
export { DEDUCTION_TIERS };

/**
 * Input options for generating a report.
 * Derived from VerifyOptions — replaces `records` with `scanResult`
 * so that field additions to VerifyOptions automatically propagate.
 */
export interface ReportOptions extends Omit<VerifyOptions, 'records'> {
  scanResult: ScanResult;
}

/**
 * Generate a governance report from scan result and registry.
 * Pure function — no I/O. Runs verify() internally.
 */
export function report(options: ReportOptions): ReportResult {
  const { scanResult, ...verifyOpts } = options;
  const { registry } = verifyOpts;

  const verifyResult = verify({
    ...verifyOpts,
    records: scanResult.annotations,
  });

  const { annotations, candidates } = scanResult;
  const byType = verifyResult.summary.byType;

  const insights = buildInsights(annotations, candidates, registry, byType);
  const coverage = calculateCoverage(annotations, candidates);
  const hygiene = calculateHygiene(byType);
  const score = calculateConvenienceScore(coverage, hygiene);
  const level = scoreToLevel(score);
  const summary = buildHealthSummary(level, score, verifyResult.summary.total);

  // Heatmap aggregation: exclude ignored annotations (matching verify's behavior)
  const activeAnnotations = annotations.filter((a) => !a.ignored);
  const byFile = aggregateByFile(activeAnnotations, verifyResult);
  const byDirectory = aggregateByDirectory(byFile);

  return {
    timestamp: verifyResult.timestamp,
    health: { level, score, coverage, hygiene, summary },
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
    byFile,
    byDirectory,
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

  // Expiring soon
  if (byType['expiring-soon'] > 0) {
    insights.push({
      level: 'warning',
      label: 'expiring',
      message: `${byType['expiring-soon']} annotation(s) are approaching expiration. Extend expires or resolve the underlying issues.`,
    });
  }

  // ADR 024: intentional entries without reason
  if (byType['intentional-without-reason'] > 0) {
    const refs = Object.entries(registry)
      .filter(([, e]) => e.kind === 'intentional' && !e.reason)
      .map(([r]) => r);
    const refList =
      refs.length <= 3
        ? refs.join(', ')
        : `${refs.slice(0, 3).join(', ')} and ${refs.length - 3} more`;
    insights.push({
      level: 'warning',
      label: 'intentional-without-reason',
      message: `${byType['intentional-without-reason']} intentional entry(ies) lack a reason (${refList}). Add reason to explain why this suppression is permanent.`,
    });
  }

  // ADR 024: temporary entries without expires
  if (byType['temporary-without-expires'] > 0) {
    const refs = Object.entries(registry)
      .filter(
        ([, e]) =>
          (e.kind === 'temporary' || e.kind === undefined) && !e.expires,
      )
      .map(([r]) => r);
    const refList =
      refs.length <= 3
        ? refs.join(', ')
        : `${refs.slice(0, 3).join(', ')} and ${refs.length - 3} more`;
    insights.push({
      level: 'warning',
      label: 'temporary-without-expires',
      message: `${byType['temporary-without-expires']} temporary entry(ies) have no expiration date (${refList}). Set expires or mark as kind=intentional with a reason.`,
    });
  }

  // Kind not explicitly set on registry entries
  {
    const missingKindRefs = Object.entries(registry)
      .filter(([, e]) => e.kind === undefined)
      .map(([r]) => r);
    if (missingKindRefs.length > 0) {
      const refList =
        missingKindRefs.length <= 3
          ? missingKindRefs.join(', ')
          : `${missingKindRefs.slice(0, 3).join(', ')} and ${missingKindRefs.length - 3} more`;
      insights.push({
        level: 'info',
        label: 'missing-kind',
        message: `${missingKindRefs.length} registry entry(ies) have no explicit kind (${refList}). Consider adding kind=temporary or kind=intentional for clearer lifecycle tracking.`,
      });
    }
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
 * Calculate coverage axis: tracked / (tracked + candidates) as 0-100.
 *
 * "tracked" = all annotations with `shiori:` marker (including drafts,
 * missing-in-registry). Measures what percentage of lint disable comments
 * are under shiori management. (ADR 024 Phase 2)
 */
export function calculateCoverage(
  annotations: ShioriAnnotation[],
  candidates: ShioriCandidate[],
): number {
  const total = annotations.length + candidates.length;
  if (total === 0) return 100; // No disables at all = full coverage
  return Math.round((annotations.length / total) * 100);
}

/**
 * Calculate hygiene axis: 100 minus DEDUCTION_TIERS deductions.
 *
 * Measures lifecycle management quality of tracked annotations:
 * expired, missing-in-registry, unused-in-source, etc. (ADR 024 Phase 2)
 */
export function calculateHygiene(
  byType: Record<VerifyIssueType, number>,
): number {
  let score = 100;
  for (const tier of DEDUCTION_TIERS) {
    const tierTotal = tier.types.reduce((sum, t) => sum + byType[t], 0);
    score -= Math.min(tierTotal * tier.perIssue, tier.maxDeduction);
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate convenience score: min(coverage, hygiene).
 *
 * For display/backward compat only — CI should use per-axis thresholds.
 * min() ensures the weaker axis pulls the score down, preventing
 * one-axis-only improvement strategies. (ADR 024 Phase 2)
 */
export function calculateConvenienceScore(
  coverage: number,
  hygiene: number,
): number {
  return Math.min(coverage, hygiene);
}

/**
 * Calculate governance health score (0-100).
 *
 * @deprecated Use calculateCoverage() + calculateHygiene() + calculateConvenienceScore()
 * instead. This function delegates to the dual-axis functions for backward compat.
 */
export function calculateScore(
  annotations: ShioriAnnotation[],
  candidates: ShioriCandidate[],
  byType: Record<VerifyIssueType, number>,
): number {
  const coverage = calculateCoverage(annotations, candidates);
  const hygiene = calculateHygiene(byType);
  return calculateConvenienceScore(coverage, hygiene);
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

/**
 * Aggregate annotations by file path for heatmap visualization.
 * Classifies each annotation as expired/expiring/healthy based on ref Sets
 * derived from verifyResult issues. Sorted by annotationCount descending.
 *
 * @param annotations - Pre-filtered annotations (ignored already excluded)
 * @param verifyResult - Verify result containing issue refs for classification
 */
function aggregateByFile(
  annotations: ShioriAnnotation[],
  verifyResult: VerifyResult,
): FileBreakdownEntry[] {
  // Build ref Sets from verify issues
  const expiredRefs = new Set<string>();
  const expiringRefs = new Set<string>();
  for (const issue of verifyResult.issues) {
    if (issue.type === 'expired') {
      expiredRefs.add(issue.ref);
    } else if (issue.type === 'expiring-soon') {
      expiringRefs.add(issue.ref);
    }
  }

  // Group annotations by file
  const byFileMap = new Map<string, ShioriAnnotation[]>();
  for (const a of annotations) {
    const file = a.location.file;
    const group = byFileMap.get(file);
    if (group) {
      group.push(a);
    } else {
      byFileMap.set(file, [a]);
    }
  }

  // Build entries
  const entries: FileBreakdownEntry[] = [];
  for (const [path, group] of byFileMap) {
    let expiredCount = 0;
    let expiringCount = 0;
    for (const a of group) {
      if (expiredRefs.has(a.ref)) {
        expiredCount++;
      } else if (expiringRefs.has(a.ref)) {
        expiringCount++;
      }
    }
    const annotationCount = group.length;
    entries.push({
      path,
      annotationCount,
      expiredCount,
      expiringCount,
      healthyCount: annotationCount - expiredCount - expiringCount,
    });
  }

  // Sort by annotationCount descending, then path ascending for stability
  return entries.sort(
    (a, b) =>
      b.annotationCount - a.annotationCount || a.path.localeCompare(b.path),
  );
}

/**
 * Aggregate file-level breakdowns by directory.
 * Uses POSIX dirname for grouping. Sorted by annotationCount descending.
 */
function aggregateByDirectory(
  byFile: FileBreakdownEntry[],
): DirectoryBreakdownEntry[] {
  const dirMap = new Map<
    string,
    {
      annotationCount: number;
      fileCount: number;
      expiredCount: number;
      expiringCount: number;
      healthyCount: number;
    }
  >();

  for (const entry of byFile) {
    const dir = dirname(entry.path);
    const existing = dirMap.get(dir);
    if (existing) {
      existing.annotationCount += entry.annotationCount;
      existing.fileCount += 1;
      existing.expiredCount += entry.expiredCount;
      existing.expiringCount += entry.expiringCount;
      existing.healthyCount += entry.healthyCount;
    } else {
      dirMap.set(dir, {
        annotationCount: entry.annotationCount,
        fileCount: 1,
        expiredCount: entry.expiredCount,
        expiringCount: entry.expiringCount,
        healthyCount: entry.healthyCount,
      });
    }
  }

  const entries: DirectoryBreakdownEntry[] = [];
  for (const [directory, data] of dirMap) {
    entries.push({ directory, ...data });
  }

  // Sort by annotationCount descending, then directory ascending for stability
  return entries.sort(
    (a, b) =>
      b.annotationCount - a.annotationCount ||
      a.directory.localeCompare(b.directory),
  );
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
