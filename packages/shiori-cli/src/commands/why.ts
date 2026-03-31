import type {
  ShioriAnnotation,
  ShioriCandidate,
  Registry,
  RegistryEntry,
  VerifyIssue,
  VerifyIssueType,
} from '../core/types.ts';
import type { RegistryDuplicateWarning } from '../core/registry.ts';
import type { RefPatternConfig } from '../core/ref-pattern.ts';
import { resolveRefUrl } from '../core/ref-pattern.ts';
import { verify } from './verify.ts';
import { DEDUCTION_TIERS } from '../core/deduction-tiers.ts';

export interface WhyInput {
  ref: string;
  registry: Registry;
  annotations: ShioriAnnotation[];
  /** All candidates from scan (for coverage impact calculation, EP-0199) */
  candidates?: ShioriCandidate[];
  refPatterns: RefPatternConfig[] | undefined;
  /** Reference date for expiry checks (default: now, injectable for tests) */
  now?: Date;
  /** Threshold in days for expiring-soon detection (default: 14) */
  expiringThresholdDays?: number;
  /** Registry duplicate warnings from multi-registry loading */
  duplicates?: RegistryDuplicateWarning[];
  /** Maps each ref to its origin registryFile (ADR 012 phase 2) */
  refOrigins?: Map<string, string | null>;
}

/** Per-ref score impact on Coverage/Hygiene axes (EP-0199) */
export interface ScoreImpact {
  /** Coverage contribution: percentage points this ref adds to coverage */
  coverageContribution: number;
  /** Hygiene deduction: points deducted from hygiene due to this ref's issues */
  hygieneDeduction: number;
  /** Issue types causing hygiene deductions */
  deductionSources: Array<{ type: VerifyIssueType; points: number }>;
}

export interface WhyResult {
  ref: string;
  /** Registry entry (undefined if ref not in registry) */
  registryEntry: RegistryEntry | undefined;
  /** Source locations where this ref appears */
  sourceLocations: Array<{ file: string; line: number; rule?: string }>;
  /** Resolved URL from refPatterns */
  url: string | undefined;
  /** Verify issues related to this ref */
  issues: VerifyIssue[];
  /** Dual-axis score impact of this ref (EP-0199) */
  scoreImpact?: ScoreImpact;
  /** Human-readable summary lines */
  summary: string[];
}

/**
 * Aggregate ref information for human consumption.
 *
 * Combines show() lookup and verify() diagnostics into a single
 * result with pre-formatted summary lines. Pure function — no IO.
 */
export function why(input: WhyInput): WhyResult {
  const { ref, registry, annotations, refPatterns, now } = input;

  // Registry lookup
  const registryEntry = registry[ref] ?? undefined;

  // Source locations with rule info
  const sourceLocations = annotations
    .filter((a) => a.ref === ref)
    .map((a) => ({
      file: a.location.file,
      line: a.location.line,
      rule: a.rule,
    }));

  // URL resolution
  const url = resolveRefUrl(ref, refPatterns);

  // Run verify scoped to this ref only (performance optimization).
  // Filter records and registry to the target ref so verify() only
  // processes relevant data, while keeping its single-responsibility intact.
  const scopedRecords = annotations.filter((a) => a.ref === ref);
  const scopedRegistry: Registry =
    ref in registry ? { [ref]: registry[ref]! } : {};
  // Scope duplicates and refOrigins to the target ref
  const scopedDuplicates = input.duplicates?.filter((d) => d.ref === ref);
  const scopedRefOrigins =
    input.refOrigins && input.refOrigins.has(ref)
      ? new Map([[ref, input.refOrigins.get(ref)!]])
      : undefined;

  const verifyResult = verify({
    records: scopedRecords,
    registry: scopedRegistry,
    failOn: [],
    warnOn: [],
    now,
    refPatterns,
    expiringThresholdDays: input.expiringThresholdDays,
    duplicates: scopedDuplicates,
    refOrigins: scopedRefOrigins,
  });
  const issues = verifyResult.issues;

  // Compute dual-axis score impact (EP-0199)
  const scoreImpact = computeRefScoreImpact({
    refAnnotationCount: sourceLocations.length,
    totalAnnotations: annotations.length,
    totalCandidates: input.candidates?.length ?? 0,
    issues,
  });

  // Build human-readable summary
  const summary = buildSummary({
    ref,
    registryEntry,
    sourceLocations,
    url,
    issues,
    scoreImpact,
  });

  return {
    ref,
    registryEntry,
    sourceLocations,
    url,
    issues,
    scoreImpact,
    summary,
  };
}

/** Whether the why result found any information */
export function isFound(result: WhyResult): boolean {
  return (
    result.registryEntry !== undefined || result.sourceLocations.length > 0
  );
}

// ── Summary builder ──────────────────────────────────────────

interface SummaryInput {
  ref: string;
  registryEntry: RegistryEntry | undefined;
  sourceLocations: Array<{ file: string; line: number; rule?: string }>;
  url: string | undefined;
  issues: VerifyIssue[];
  scoreImpact?: ScoreImpact;
}

function buildSummary(input: SummaryInput): string[] {
  const { ref, registryEntry, sourceLocations, url, issues } = input;
  const lines: string[] = [];

  // Header
  lines.push(`ref: ${ref}`);

  // Registry info
  if (registryEntry) {
    if (registryEntry.reason) {
      lines.push(`reason: ${registryEntry.reason}`);
    }
    if (registryEntry.owner) {
      lines.push(`owner: ${registryEntry.owner}`);
    }
    if (registryEntry.expires) {
      lines.push(`expires: ${registryEntry.expires}`);
    }
    if (registryEntry.kind) {
      lines.push(`kind: ${registryEntry.kind}`);
    }
    if (registryEntry.ticket) {
      lines.push(`ticket: ${registryEntry.ticket}`);
    }
    if (registryEntry.notes) {
      lines.push(`notes: ${registryEntry.notes}`);
    }
  } else {
    lines.push('registry: not found');
  }

  // URL
  if (url) {
    lines.push(`url: ${url}`);
  }

  // Source locations
  if (sourceLocations.length > 0) {
    lines.push(`locations: ${sourceLocations.length} occurrence(s)`);
    for (const loc of sourceLocations) {
      const ruleLabel = loc.rule ? ` (${loc.rule})` : '';
      lines.push(`  ${loc.file}:${loc.line}${ruleLabel}`);
    }
  } else {
    lines.push('locations: none (not found in source)');
  }

  // Issues
  if (issues.length > 0) {
    lines.push(`issues: ${issues.length}`);
    for (const issue of issues) {
      lines.push(`  [${issue.severity}] ${issue.type}: ${issue.message}`);
    }
  } else {
    lines.push('issues: none');
  }

  // Dual-axis score impact (EP-0199)
  if (input.scoreImpact) {
    const { coverageContribution, hygieneDeduction, deductionSources } =
      input.scoreImpact;
    lines.push(
      `impact: coverage +${coverageContribution}pt, hygiene -${hygieneDeduction}pt`,
    );
    if (deductionSources.length > 0) {
      for (const src of deductionSources) {
        lines.push(`  -${src.points}pt from ${src.type}`);
      }
    }
  }

  return lines;
}

// ── Dual-axis score impact (EP-0199) ────────────────────────

interface RefScoreImpactInput {
  /** Number of annotations for this ref */
  refAnnotationCount: number;
  /** Total annotations across the project */
  totalAnnotations: number;
  /** Total candidates across the project */
  totalCandidates: number;
  /** Verify issues for this ref */
  issues: VerifyIssue[];
}

/**
 * Compute how a single ref impacts Coverage/Hygiene scores.
 *
 * Coverage contribution: this ref's annotation count / total (annotations + candidates).
 * Hygiene deduction: per-issue points from DEDUCTION_TIERS for this ref's issues.
 */
export function computeRefScoreImpact(input: RefScoreImpactInput): ScoreImpact {
  const { refAnnotationCount, totalAnnotations, totalCandidates, issues } =
    input;

  // Coverage contribution (percentage points)
  const total = totalAnnotations + totalCandidates;
  const coverageContribution =
    total > 0 ? Math.round((refAnnotationCount / total) * 100) : 0;

  // Hygiene deduction from this ref's issues
  const issueTypeCounts = new Map<VerifyIssueType, number>();
  for (const issue of issues) {
    issueTypeCounts.set(issue.type, (issueTypeCounts.get(issue.type) ?? 0) + 1);
  }

  const deductionSources: ScoreImpact['deductionSources'] = [];
  let hygieneDeduction = 0;

  for (const tier of DEDUCTION_TIERS) {
    for (const issueType of tier.types) {
      const count = issueTypeCounts.get(issueType) ?? 0;
      if (count > 0) {
        const points = count * tier.perIssue;
        deductionSources.push({ type: issueType, points });
        hygieneDeduction += points;
      }
    }
  }

  return {
    coverageContribution,
    hygieneDeduction,
    deductionSources,
  };
}
