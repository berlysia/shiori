import { dirname } from "node:path/posix";
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
  PrescriptionUrgency,
} from "../core/types.ts";
import { verify, type VerifyOptions } from "./verify.ts";

// ── Score deduction tiers (Single Source of Truth) ────────────
// Shared by calculateScore() and prescriptions.ts

/** Per-issue point deduction and maximum cap for each tier */
export interface DeductionTier {
  types: VerifyIssueType[];
  perIssue: number;
  maxDeduction: number;
  urgency: PrescriptionUrgency;
}

/** Canonical deduction tier definitions used by calculateScore and buildPrescriptions */
export const DEDUCTION_TIERS: DeductionTier[] = [
  {
    types: ["expired", "syntax-error"],
    perIssue: 10,
    maxDeduction: 40,
    urgency: "critical",
  },
  {
    types: ["missing-in-registry", "unused-in-source", "ref-collision", "ref-status-closed"],
    perIssue: 5,
    maxDeduction: 30,
    urgency: "recommended",
  },
  {
    types: ["ref-format", "unrouted-ref", "registry-routing-mismatch", "expiring-soon"],
    perIssue: 2,
    maxDeduction: 10,
    urgency: "suggestion",
  },
];

/**
 * Input options for generating a report.
 * Derived from VerifyOptions — replaces `records` with `scanResult`
 * so that field additions to VerifyOptions automatically propagate.
 */
export interface ReportOptions extends Omit<VerifyOptions, "records"> {
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
  const score = calculateScore(annotations, candidates, byType);
  const level = scoreToLevel(score);
  const summary = buildHealthSummary(level, score, verifyResult.summary.total);

  // Heatmap aggregation: exclude ignored annotations (matching verify's behavior)
  const activeAnnotations = annotations.filter((a) => !a.ignored);
  const byFile = aggregateByFile(activeAnnotations, verifyResult);
  const byDirectory = aggregateByDirectory(byFile);

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
  if (byType["expired"] > 0) {
    insights.push({
      level: "error",
      label: "expired",
      message: `${byType["expired"]} annotation(s) have expired. Resolve the underlying issues or extend the expiration dates.`,
    });
  }

  // Missing in registry = untracked annotations
  if (byType["missing-in-registry"] > 0) {
    insights.push({
      level: "warning",
      label: "unregistered",
      message: `${byType["missing-in-registry"]} annotation(s) are not registered. Run "shiori update" to add them.`,
    });
  }

  // Unused in source = stale registry entries
  if (byType["unused-in-source"] > 0) {
    insights.push({
      level: "warning",
      label: "stale",
      message: `${byType["unused-in-source"]} registry entry(ies) have no matching source annotation. Consider removing them.`,
    });
  }

  // Candidates = untracked lint disables
  if (candidates.length > 0) {
    const ratio =
      annotations.length > 0
        ? ((candidates.length / (annotations.length + candidates.length)) * 100).toFixed(0)
        : "100";
    insights.push({
      level: "info",
      label: "candidates",
      message: `${candidates.length} lint disable comment(s) detected without shiori tracking (${ratio}% untracked). Run "shiori candidates" to review.`,
    });
  }

  // Syntax errors
  if (byType["syntax-error"] > 0) {
    insights.push({
      level: "error",
      label: "syntax",
      message: `${byType["syntax-error"]} annotation(s) have syntax errors. Fix annotation format: "shiori: <ref> [key=value ...]"`,
    });
  }

  // Ref collisions
  if (byType["ref-collision"] > 0) {
    insights.push({
      level: "warning",
      label: "collision",
      message: `${byType["ref-collision"]} ref(s) are duplicated across registry files. Consolidate to a single registry per ref.`,
    });
  }

  // Expiring soon
  if (byType["expiring-soon"] > 0) {
    insights.push({
      level: "warning",
      label: "expiring",
      message: `${byType["expiring-soon"]} annotation(s) are approaching expiration. Extend expires or resolve the underlying issues.`,
    });
  }

  // All clear
  if (insights.length === 0) {
    insights.push({
      level: "info",
      label: "clean",
      message: "All annotations are tracked, registered, and valid. No issues detected.",
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
export function calculateScore(
  annotations: ShioriAnnotation[],
  candidates: ShioriCandidate[],
  byType: Record<VerifyIssueType, number>,
): number {
  let score = 100;
  const totalTracked = annotations.length;

  // Apply deduction tiers from Single Source of Truth
  for (const tier of DEDUCTION_TIERS) {
    const tierTotal = tier.types.reduce((sum, t) => sum + byType[t], 0);
    score -= Math.min(tierTotal * tier.perIssue, tier.maxDeduction);
  }

  // Candidate ratio penalty (max 20)
  if (totalTracked + candidates.length > 0) {
    const untrackedRatio = candidates.length / (totalTracked + candidates.length);
    score -= Math.round(untrackedRatio * 20);
  }

  return Math.max(0, Math.min(100, score));
}

function scoreToLevel(score: number): HealthLevel {
  if (score >= 80) return "healthy";
  if (score >= 50) return "warning";
  return "critical";
}

function buildHealthSummary(level: HealthLevel, score: number, issueCount: number): string {
  switch (level) {
    case "healthy":
      return issueCount === 0
        ? `Governance health: ${score}/100. All annotations are properly tracked.`
        : `Governance health: ${score}/100. ${issueCount} minor issue(s) detected.`;
    case "warning":
      return `Governance health: ${score}/100. ${issueCount} issue(s) require attention.`;
    case "critical":
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
    if (issue.type === "expired") {
      expiredRefs.add(issue.ref);
    } else if (issue.type === "expiring-soon") {
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
    (a, b) => b.annotationCount - a.annotationCount || a.path.localeCompare(b.path),
  );
}

/**
 * Aggregate file-level breakdowns by directory.
 * Uses POSIX dirname for grouping. Sorted by annotationCount descending.
 */
function aggregateByDirectory(byFile: FileBreakdownEntry[]): DirectoryBreakdownEntry[] {
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
    (a, b) => b.annotationCount - a.annotationCount || a.directory.localeCompare(b.directory),
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
