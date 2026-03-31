import type {
  Registry,
  ScanResult,
  VerifyResult,
  VerifyIssueType,
  ImpactResult,
  ImpactRefEntry,
  ImpactPrescription,
  ImpactFormat,
} from '../core/types.ts';
import { IMPACT_FORMATS, resolveKind } from '../core/types.ts';
import { DEDUCTION_TIERS } from '../core/deduction-tiers.ts';
import { ACTION_HINTS } from '../core/action-hints.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';

export { IMPACT_FORMATS };
export type { ImpactResult, ImpactFormat };

/**
 * Options for computing owner impact.
 */
export interface ImpactOptions {
  /** Target owner name */
  owner: string;
  /** Scan result containing annotations and candidates */
  scanResult: ScanResult;
  /** Registry data */
  registry: Registry;
  /** Verify result containing issues */
  verifyResult: VerifyResult;
}

/**
 * Compute an owner's governance impact.
 *
 * Filters annotations and issues to the specified owner, then calculates
 * owner-scoped Coverage and Hygiene scores. Pure function — no I/O.
 */
export function computeImpact(options: ImpactOptions): ImpactResult {
  const { owner, scanResult, registry, verifyResult } = options;

  // Collect refs owned by this owner
  const ownerRefs = new Set<string>();
  for (const [ref, entry] of Object.entries(registry)) {
    if (entry.owner === owner) {
      ownerRefs.add(ref);
    }
  }

  // Filter annotations to owner's refs
  const ownerAnnotations = scanResult.annotations.filter((a) =>
    ownerRefs.has(a.ref),
  );

  // Build per-ref detail entries
  const refMap = new Map<string, ImpactRefEntry>();
  for (const a of ownerAnnotations) {
    const existing = refMap.get(a.ref);
    if (existing) {
      existing.locations.push({
        file: a.location.file,
        line: a.location.line,
      });
    } else {
      const entry = registry[a.ref];
      refMap.set(a.ref, {
        ref: a.ref,
        kind: resolveKind(entry?.kind),
        issues: [],
        locations: [{ file: a.location.file, line: a.location.line }],
      });
    }
  }

  // Also include registry entries with no matching source annotation
  for (const ref of ownerRefs) {
    if (!refMap.has(ref)) {
      const entry = registry[ref];
      if (entry) {
        refMap.set(ref, {
          ref,
          kind: resolveKind(entry.kind),
          issues: [],
          locations: [],
        });
      }
    }
  }

  // Attach issues to their refs
  const ownerByType: Record<VerifyIssueType, number> = {
    'missing-in-registry': 0,
    'unused-in-source': 0,
    expired: 0,
    'syntax-error': 0,
    'ref-format': 0,
    'ref-collision': 0,
    'unrouted-ref': 0,
    'registry-routing-mismatch': 0,
    'expiring-soon': 0,
    'ref-status-closed': 0,
    'intentional-without-reason': 0,
    'temporary-without-expires': 0,
  };

  for (const issue of verifyResult.issues) {
    if (ownerRefs.has(issue.ref)) {
      ownerByType[issue.type]++;
      const refEntry = refMap.get(issue.ref);
      if (refEntry && !refEntry.issues.includes(issue.type)) {
        refEntry.issues.push(issue.type);
      }
    }
  }

  // Owner-scoped coverage: owner's annotations / (owner's annotations + all candidates)
  // Rationale: candidates are untracked so they have no owner; all candidates represent
  // potential coverage improvement for anyone. An owner's tracked annotations contribute
  // to reducing the untracked pool.
  const totalPool = ownerAnnotations.length + scanResult.candidates.length;
  const coverage =
    totalPool === 0
      ? 100
      : Math.round((ownerAnnotations.length / totalPool) * 100);

  // Owner-scoped hygiene: 100 minus deductions from owner's issues only
  const hygiene = calculateOwnerHygiene(ownerByType);

  // Build owner-scoped prescriptions
  const prescriptions = buildOwnerPrescriptions(ownerByType, owner);

  // Sort refs by issue count descending, then ref ascending
  const refs = [...refMap.values()].sort(
    (a, b) => b.issues.length - a.issues.length || a.ref.localeCompare(b.ref),
  );

  return {
    timestamp: verifyResult.timestamp,
    owner,
    coverage,
    hygiene,
    annotationCount: ownerAnnotations.length,
    refs,
    prescriptions,
  };
}

/**
 * Calculate owner-scoped hygiene using the same DEDUCTION_TIERS as global hygiene.
 */
function calculateOwnerHygiene(
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
 * Build owner-scoped prescriptions from the owner's issue breakdown.
 */
function buildOwnerPrescriptions(
  byType: Record<VerifyIssueType, number>,
  owner: string,
): ImpactPrescription[] {
  const prescriptions: ImpactPrescription[] = [];

  for (const tier of DEDUCTION_TIERS) {
    for (const issueType of tier.types) {
      const count = byType[issueType];
      if (count === 0) continue;

      // Estimate impact (simplified: min of count * perIssue and maxDeduction)
      const totalInTier = tier.types.reduce((sum, t) => sum + byType[t], 0);
      const currentDeduction = Math.min(
        totalInTier * tier.perIssue,
        tier.maxDeduction,
      );
      const afterRemoval = totalInTier - count;
      const newDeduction = Math.min(
        Math.max(0, afterRemoval) * tier.perIssue,
        tier.maxDeduction,
      );
      const scoreImpact = currentDeduction - newDeduction;
      if (scoreImpact === 0) continue;

      const hint = ACTION_HINTS[issueType];

      prescriptions.push({
        urgency: tier.urgency,
        message: `${count} ${issueType} issue(s) for ${owner}: ${hint}`,
        command: buildOwnerCommand(issueType),
        scoreImpact,
      });
    }
  }

  prescriptions.sort((a, b) => b.scoreImpact - a.scoreImpact);
  return prescriptions;
}

function buildOwnerCommand(issueType: VerifyIssueType): string {
  switch (issueType) {
    case 'expired':
      return 'shiori triage --expired-only';
    case 'expiring-soon':
      return 'shiori triage';
    case 'missing-in-registry':
      return 'shiori update';
    case 'syntax-error':
    case 'unused-in-source':
    case 'ref-format':
    case 'ref-collision':
      return 'shiori verify';
    case 'unrouted-ref':
    case 'registry-routing-mismatch':
    case 'intentional-without-reason':
    case 'temporary-without-expires':
    case 'ref-status-closed':
      return 'shiori triage';
  }
}

/**
 * Format impact result as markdown.
 */
export function formatImpactMarkdown(result: ImpactResult): string {
  const lines: string[] = [];

  lines.push(`# Impact: ${result.owner}`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Annotations | ${result.annotationCount} |`);
  lines.push(`| Coverage | ${result.coverage}/100 |`);
  lines.push(`| Hygiene | ${result.hygiene}/100 |`);
  lines.push('');

  if (result.refs.length > 0) {
    lines.push('## Refs');
    lines.push('');
    lines.push('| Ref | Kind | Issues | Locations |');
    lines.push('| --- | --- | --- | --- |');
    for (const ref of result.refs) {
      const issues = ref.issues.length > 0 ? ref.issues.join(', ') : '-';
      const locs = ref.locations.map((l) => `${l.file}:${l.line}`).join(', ');
      lines.push(`| ${ref.ref} | ${ref.kind} | ${issues} | ${locs || '-'} |`);
    }
    lines.push('');
  }

  if (result.prescriptions.length > 0) {
    lines.push('## Prescriptions');
    lines.push('');
    for (const rx of result.prescriptions) {
      const urgencyMark =
        rx.urgency === 'critical'
          ? '🔴'
          : rx.urgency === 'recommended'
            ? '🟡'
            : '⚪';
      lines.push(
        `- ${urgencyMark} **+${rx.scoreImpact}pt**: ${rx.message} → \`${rx.command}\``,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format impact result for output based on format.
 */
export function formatImpact(
  result: ImpactResult,
  format: ImpactFormat,
): string {
  switch (format) {
    case 'json':
      return wrapOutputJson(result, { command: 'impact', schemaVersion: 1 });
    case 'markdown':
      return formatImpactMarkdown(result);
  }
}
