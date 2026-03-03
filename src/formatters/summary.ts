import type {
  Registry,
  ShioriAnnotation,
  ShioriCandidate,
  VerifyResult,
} from '../core/types.ts';

export interface SummaryInput {
  verifyResult: VerifyResult;
  annotations: ShioriAnnotation[];
  candidates: ShioriCandidate[];
  registry: Registry;
}

interface SummaryTotals {
  annotations: number;
  candidates: number;
  expired: number;
  missing: number;
  expiringSoon: number;
}

interface SummaryOutput {
  totals: SummaryTotals;
  byRule: Record<string, number>;
  byKind: Record<string, number>;
  byOwner: Record<string, number>;
}

/**
 * Format as summary JSON for dashboards.
 * Aggregates annotations by rule, registry entries by kind and owner.
 */
export function formatAsSummary(input: SummaryInput): string {
  const { verifyResult, annotations, candidates, registry } = input;

  const totals: SummaryTotals = {
    annotations: annotations.length,
    candidates: candidates.length,
    expired: verifyResult.summary.byType['expired'],
    missing: verifyResult.summary.byType['missing-in-registry'],
    expiringSoon: verifyResult.summary.byType['expiring-soon'],
  };

  // Aggregate annotations by rule
  const byRule: Record<string, number> = {};
  for (const annotation of annotations) {
    if (annotation.rule) {
      byRule[annotation.rule] = (byRule[annotation.rule] ?? 0) + 1;
    }
  }

  // Aggregate registry entries by kind
  const byKind: Record<string, number> = {};
  for (const entry of Object.values(registry)) {
    if (entry.kind) {
      byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    }
  }

  // Aggregate registry entries by owner
  const byOwner: Record<string, number> = {};
  for (const entry of Object.values(registry)) {
    if (entry.owner) {
      byOwner[entry.owner] = (byOwner[entry.owner] ?? 0) + 1;
    }
  }

  const summary: SummaryOutput = { totals, byRule, byKind, byOwner };
  return JSON.stringify(summary, null, 2);
}
