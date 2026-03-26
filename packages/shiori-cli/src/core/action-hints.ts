import type { VerifyIssueType } from './types.ts';

/**
 * Human-readable action hints for each verify issue type.
 * Shared between triage (per-ref actions) and prescriptions (health recommendations).
 */
export const ACTION_HINTS: Record<VerifyIssueType, string> = {
  expired: 'shiori resolve --ref <ref> or extend expires',
  'expiring-soon': 'extend expires or resolve',
  'missing-in-registry': 'shiori update',
  'syntax-error': 'fix annotation syntax',
  'unused-in-source': 'shiori resolve --ref <ref>',
  'ref-format': 'fix ref format',
  'ref-collision': 'consolidate to single registry',
  'unrouted-ref': 'add refPattern or rename',
  'registry-routing-mismatch': 'move to correct registry file',
  'ref-status-closed': 'shiori resolve --ref <ref> (issue/ticket is closed)',
  'intentional-without-reason': 'add reason to explain permanent suppression',
  'temporary-without-expires':
    'set expires date or change to kind=intentional with reason',
};
