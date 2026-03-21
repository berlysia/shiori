import type { VerifyIssueType, PrescriptionUrgency } from './types.ts';

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
    types: ['expired', 'syntax-error'],
    perIssue: 10,
    maxDeduction: 40,
    urgency: 'critical',
  },
  {
    types: [
      'missing-in-registry',
      'unused-in-source',
      'ref-collision',
      'ref-status-closed',
    ],
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
