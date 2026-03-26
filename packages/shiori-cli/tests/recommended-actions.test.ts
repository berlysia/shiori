import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ReportResult,
  TrendResult,
  VerifyIssueType,
} from '../src/core/types.ts';
import { buildRecommendedActions } from '../src/core/recommended-actions.ts';

// ── Helpers ──────────────────────────────────────────────────

const ZERO_BY_TYPE: Record<VerifyIssueType, number> = {
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

function makeReportResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    timestamp: '2026-03-26T00:00:00.000Z',
    health: {
      level: 'healthy',
      score: 100,
      coverage: 100,
      hygiene: 100,
      summary: 'All clear',
    },
    totals: {
      annotations: 1,
      candidates: 0,
      registryEntries: 1,
      issues: 0,
      errors: 0,
      warnings: 0,
    },
    insights: [],
    byType: { ...ZERO_BY_TYPE },
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: {
      timestamp: '2026-03-26T00:00:00.000Z',
      issues: [],
      summary: {
        total: 0,
        errors: 0,
        warnings: 0,
        byType: { ...ZERO_BY_TYPE },
      },
      scannedRecords: 1,
      registryEntries: 1,
    },
    ...overrides,
  };
}

function makeTrendResult(
  overrides: Partial<TrendResult['summary']> = {},
): TrendResult {
  return {
    points: [
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 80,
        level: 'healthy',
        issues: 2,
        annotations: 5,
        candidates: 1,
        registryEntries: 5,
      },
    ],
    summary: {
      count: 1,
      oldest: '2026-01-01T00:00:00.000Z',
      newest: '2026-01-01T00:00:00.000Z',
      latestScore: 80,
      scoreChange: 0,
      direction: 'stable',
      minScore: 80,
      maxScore: 80,
      ...overrides,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('buildRecommendedActions', () => {
  it('generates triage action for expired annotations', () => {
    const report = makeReportResult({
      byType: { ...ZERO_BY_TYPE, expired: 3 },
    });

    const actions = buildRecommendedActions(report);
    const triageAction = actions.find((a) => a.action === 'triage');

    assert.ok(triageAction);
    assert.equal(triageAction.command, 'shiori triage --expired-only');
    assert.deepEqual(triageAction.args, ['--expired-only']);
    assert.equal(triageAction.priority, 1);
  });

  it('generates update action for missing-in-registry refs', () => {
    const report = makeReportResult({
      byType: { ...ZERO_BY_TYPE, 'missing-in-registry': 2 },
      health: {
        level: 'warning',
        score: 70,
        coverage: 100,
        hygiene: 70,
        summary: 'Missing refs',
      },
    });

    const actions = buildRecommendedActions(report);
    const updateAction = actions.find((a) => a.action === 'update');

    assert.ok(updateAction);
    assert.equal(updateAction.command, 'shiori update');
    assert.deepEqual(updateAction.args, []);
  });

  it('generates adopt action when candidates exist', () => {
    const report = makeReportResult({
      totals: {
        annotations: 1,
        candidates: 3,
        registryEntries: 1,
        issues: 0,
        errors: 0,
        warnings: 0,
      },
    });

    const actions = buildRecommendedActions(report);
    const adoptAction = actions.find((a) => a.action === 'adopt');

    assert.ok(adoptAction);
    assert.equal(adoptAction.command, 'shiori adopt');
    assert.deepEqual(adoptAction.args, []);
  });

  it('generates check action for healthy score (>= 80)', () => {
    const report = makeReportResult({
      health: {
        level: 'healthy',
        score: 85,
        coverage: 100,
        hygiene: 85,
        summary: 'Healthy',
      },
    });

    const actions = buildRecommendedActions(report);
    const checkAction = actions.find((a) => a.action === 'check');

    assert.ok(checkAction);
    assert.equal(
      checkAction.command,
      'shiori check --fail-on expired,missing-in-registry',
    );
    assert.deepEqual(checkAction.args, [
      '--fail-on',
      'expired,missing-in-registry',
    ]);
  });

  it('does not generate check action for score < 80', () => {
    const report = makeReportResult({
      health: {
        level: 'warning',
        score: 70,
        coverage: 100,
        hygiene: 70,
        summary: 'Warning',
      },
    });

    const actions = buildRecommendedActions(report);
    const checkAction = actions.find((a) => a.action === 'check');

    assert.equal(checkAction, undefined);
  });

  it('generates health --snapshot when no trend data', () => {
    const report = makeReportResult();

    const actions = buildRecommendedActions(report);
    const healthAction = actions.find(
      (a) => a.command === 'shiori health --snapshot',
    );

    assert.ok(healthAction);
    assert.equal(healthAction.action, 'health');
    assert.deepEqual(healthAction.args, ['--snapshot']);
  });

  it('generates health --snapshot when trend has no points', () => {
    const emptyTrend: TrendResult = {
      points: [],
      summary: {
        count: 0,
        oldest: '',
        newest: '',
        latestScore: 0,
        scoreChange: 0,
        direction: 'stable',
        minScore: 0,
        maxScore: 0,
      },
    };

    const report = makeReportResult();
    const actions = buildRecommendedActions(report, emptyTrend);
    const healthAction = actions.find(
      (a) => a.command === 'shiori health --snapshot',
    );

    assert.ok(healthAction);
  });

  it('omits health --snapshot when trend data exists', () => {
    const report = makeReportResult();
    const trend = makeTrendResult();

    const actions = buildRecommendedActions(report, trend);
    const snapshotAction = actions.find(
      (a) => a.command === 'shiori health --snapshot',
    );

    assert.equal(snapshotAction, undefined);
  });

  it('assigns ascending priority values', () => {
    const report = makeReportResult({
      byType: { ...ZERO_BY_TYPE, expired: 1, 'missing-in-registry': 2 },
      totals: {
        annotations: 3,
        candidates: 1,
        registryEntries: 3,
        issues: 3,
        errors: 3,
        warnings: 0,
      },
      health: {
        level: 'healthy',
        score: 85,
        coverage: 100,
        hygiene: 85,
        summary: 'Test',
      },
    });

    const actions = buildRecommendedActions(report);
    assert.ok(actions.length >= 3);

    for (let i = 1; i < actions.length; i++) {
      assert.ok(
        actions[i]!.priority > actions[i - 1]!.priority,
        `Priority at index ${i} should be greater than ${i - 1}`,
      );
    }
  });

  it('falls back to health --trend when no other actions match', () => {
    // Healthy, no expired, no missing, no candidates, has trend data
    const report = makeReportResult({
      health: {
        level: 'warning',
        score: 70,
        coverage: 100,
        hygiene: 70,
        summary: 'OK',
      },
    });
    const trend = makeTrendResult();

    const actions = buildRecommendedActions(report, trend);

    // score < 80 → no check, no expired/missing/candidates, has trend → no snapshot
    // Only fallback should apply
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.command, 'shiori health --trend');
    assert.equal(actions[0]!.priority, 1);
  });

  it('returns correct RecommendedAction shape', () => {
    const report = makeReportResult();
    const actions = buildRecommendedActions(report);

    for (const action of actions) {
      assert.equal(typeof action.action, 'string');
      assert.equal(typeof action.command, 'string');
      assert.ok(Array.isArray(action.args));
      assert.equal(typeof action.reason, 'string');
      assert.equal(typeof action.priority, 'number');
    }
  });
});
