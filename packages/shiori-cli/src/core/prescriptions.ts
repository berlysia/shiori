import type {
  ReportResult,
  HealthPrescription,
  VerifyIssueType,
  PrescriptionActionType,
} from './types.ts';
import { ACTION_HINTS } from './action-hints.ts';
import { DEDUCTION_TIERS } from './deduction-tiers.ts';

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
 * Map issue type to a programmatic action type for fix dispatch (EP-0112).
 * "update" is the only fully automatable action; others require human judgment.
 */
function buildActionType(issueType: VerifyIssueType): PrescriptionActionType {
  switch (issueType) {
    case 'missing-in-registry':
      return 'update';
    case 'expired':
    case 'expiring-soon':
    case 'ref-status-closed':
      return 'triage';
    case 'syntax-error':
    case 'unused-in-source':
    case 'ref-format':
    case 'ref-collision':
      return 'verify';
    case 'unrouted-ref':
    case 'registry-routing-mismatch':
    case 'intentional-without-reason':
    case 'temporary-without-expires':
      return 'doctor';
  }
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
    case 'intentional-without-reason':
    case 'temporary-without-expires':
      return 'shiori doctor';
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
        actionType: buildActionType(issueType),
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
        actionType: 'candidates',
      });
    }
  }

  // Sort by score impact descending (highest impact first)
  prescriptions.sort((a, b) => b.scoreImpact - a.scoreImpact);

  return prescriptions;
}
