import type {
  ReportResult,
  HealthPrescription,
  PrescriptionUrgency,
  VerifyIssueType,
} from '../core/types.ts';
import { ACTION_HINTS } from '../core/action-hints.ts';

// ── Score impact estimation ──────────────────────────────────
// Mirrors calculateScore deduction tiers in report.ts

/** Per-issue point deduction and maximum cap for each tier */
interface DeductionTier {
  types: VerifyIssueType[];
  perIssue: number;
  maxDeduction: number;
  urgency: PrescriptionUrgency;
}

const DEDUCTION_TIERS: DeductionTier[] = [
  {
    types: ['expired', 'syntax-error'],
    perIssue: 10,
    maxDeduction: 40,
    urgency: 'critical',
  },
  {
    types: ['missing-in-registry', 'unused-in-source', 'ref-collision'],
    perIssue: 5,
    maxDeduction: 30,
    urgency: 'recommended',
  },
  {
    types: [
      'ref-format',
      'unrouted-ref',
      'registry-routing-mismatch',
      'expiring-soon',
    ],
    perIssue: 2,
    maxDeduction: 10,
    urgency: 'suggestion',
  },
];

/**
 * Estimate score impact for resolving all issues of a given type.
 * This mirrors the deduction logic in calculateScore (report.ts).
 */
function estimateScoreImpact(
  issueType: VerifyIssueType,
  count: number,
  byType: Record<VerifyIssueType, number>,
): number {
  for (const tier of DEDUCTION_TIERS) {
    if (!tier.types.includes(issueType)) continue;

    // Current total deduction for this tier
    const totalInTier = tier.types.reduce((sum, t) => sum + byType[t], 0);
    const currentDeduction = Math.min(
      totalInTier * tier.perIssue,
      tier.maxDeduction,
    );

    // Deduction after removing this issue type
    const afterRemoval = totalInTier - count;
    const newDeduction = Math.min(
      Math.max(0, afterRemoval) * tier.perIssue,
      tier.maxDeduction,
    );

    return currentDeduction - newDeduction;
  }
  return 0;
}

/**
 * Build a command suggestion for the given issue type.
 * Returns a concrete, copy-paste ready CLI command.
 */
function buildCommand(issueType: VerifyIssueType): string {
  // Map issue types to specific CLI commands
  switch (issueType) {
    case 'expired':
      return 'shiori triage --expired-only';
    case 'expiring-soon':
      return 'shiori triage';
    case 'missing-in-registry':
      return 'shiori update';
    case 'syntax-error':
      return 'shiori verify';
    case 'unused-in-source':
      return 'shiori verify';
    case 'ref-format':
      return 'shiori verify';
    case 'ref-collision':
      return 'shiori verify';
    case 'unrouted-ref':
      return 'shiori doctor';
    case 'registry-routing-mismatch':
      return 'shiori doctor';
    case 'ref-status-closed':
      return 'shiori triage';
  }
}

/**
 * Build a human-readable message for the prescription.
 */
function buildMessage(issueType: VerifyIssueType, count: number): string {
  const hint = ACTION_HINTS[issueType];
  return `${count} ${issueType} issue(s): ${hint}`;
}

/**
 * Build actionable prescriptions from a ReportResult.
 *
 * Generates prioritized, concrete prescriptions that tell users
 * exactly what to do next to improve their health score.
 * Each prescription includes estimated score impact and copy-paste CLI commands.
 *
 * Pure function — no I/O.
 */
export function buildPrescriptions(
  reportResult: ReportResult,
): HealthPrescription[] {
  const { byType } = reportResult;
  const prescriptions: HealthPrescription[] = [];

  // Generate prescriptions for each issue type with non-zero counts
  for (const tier of DEDUCTION_TIERS) {
    for (const issueType of tier.types) {
      const count = byType[issueType];
      if (count === 0) continue;

      const scoreImpact = estimateScoreImpact(issueType, count, byType);
      if (scoreImpact === 0) continue;

      prescriptions.push({
        urgency: tier.urgency,
        message: buildMessage(issueType, count),
        command: buildCommand(issueType),
        scoreImpact,
      });
    }
  }

  // Add candidate ratio prescription if applicable
  const { totals } = reportResult;
  if (totals.candidates > 0 && totals.annotations + totals.candidates > 0) {
    const untrackedRatio =
      totals.candidates / (totals.annotations + totals.candidates);
    const candidateImpact = Math.round(untrackedRatio * 20);
    if (candidateImpact > 0) {
      prescriptions.push({
        urgency: 'suggestion',
        message: `${totals.candidates} untracked lint disable comment(s) found. Track them to improve coverage.`,
        command: 'shiori candidates',
        scoreImpact: candidateImpact,
      });
    }
  }

  // Sort by score impact descending (highest impact first)
  prescriptions.sort((a, b) => b.scoreImpact - a.scoreImpact);

  return prescriptions;
}
