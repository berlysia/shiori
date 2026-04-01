import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectCoachSnapshot,
  buildCoachDiffContext,
  buildDiffSummaryOneLiner,
  isStageAdvancement,
  serializeCoachSnapshot,
  deserializeCoachSnapshot,
  coachSnapshotFilename,
  formatSigned,
  selectSnapshotsToDelete,
  DEFAULT_MAX_SNAPSHOTS,
} from '../src/core/coach-diff.ts';
import type {
  HealthResult,
  CoachSnapshotData,
  StageTransition,
} from '../src/core/types.ts';

// ── Test Fixtures ────────────────────────────────────────────

function makeHealthResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    timestamp: '2026-04-01T10:00:00.000Z',
    health: {
      level: 'warning',
      score: 65,
      coverage: 70,
      hygiene: 60,
      summary: 'Governance needs attention',
    },
    issues: { total: 5, errors: 2, warnings: 3 },
    expiring: { expired: 1, expiringSoon: 2 },
    insights: [],
    maturityStage: 'Tracking',
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<CoachSnapshotData> = {},
): CoachSnapshotData {
  return {
    timestamp: '2026-03-25T10:00:00.000Z',
    totalIssues: 3,
    expiredRefs: 0,
    healthScore: 50,
    coverage: 60,
    hygiene: 55,
    maturityStage: 'Foundation',
    ...overrides,
  };
}

// ── collectCoachSnapshot ─────────────────────────────────────

describe('collectCoachSnapshot', () => {
  it('extracts governance metrics from HealthResult', () => {
    const healthResult = makeHealthResult();
    const snapshot = collectCoachSnapshot(healthResult);

    assert.equal(snapshot.timestamp, healthResult.timestamp);
    assert.equal(snapshot.healthScore, 65);
    assert.equal(snapshot.coverage, 70);
    assert.equal(snapshot.hygiene, 60);
    assert.equal(snapshot.expiredRefs, 1);
    assert.equal(snapshot.totalIssues, 5);
    assert.equal(snapshot.maturityStage, 'Tracking');
  });

  it('handles undefined maturityStage', () => {
    const healthResult = makeHealthResult({ maturityStage: undefined });
    const snapshot = collectCoachSnapshot(healthResult);

    assert.equal(snapshot.maturityStage, undefined);
  });

  it('uses issues.total for totalIssues', () => {
    const healthResult = makeHealthResult({
      issues: { total: 10, errors: 4, warnings: 6 },
    });
    const snapshot = collectCoachSnapshot(healthResult);

    assert.equal(snapshot.totalIssues, 10);
  });
});

// ── buildCoachDiffContext ────────────────────────────────────

describe('buildCoachDiffContext', () => {
  it('returns baseline context when no previous snapshot', () => {
    const healthResult = makeHealthResult();
    const ctx = buildCoachDiffContext(healthResult);

    assert.ok(ctx.current);
    assert.equal(ctx.previous, undefined);
    assert.equal(ctx.deltas, undefined);
    assert.equal(ctx.stageTransition, undefined);
    assert.ok(ctx.diffSummaryOneLiner.includes('ベースライン'));
  });

  it('computes deltas when previous snapshot is provided', () => {
    const healthResult = makeHealthResult();
    const previous = makeSnapshot({
      healthScore: 50,
      coverage: 60,
      hygiene: 55,
      expiredRefs: 3,
    });
    const ctx = buildCoachDiffContext(healthResult, previous);

    assert.ok(ctx.deltas);
    assert.equal(ctx.deltas!.healthScore, 15); // 65 - 50
    assert.equal(ctx.deltas!.coverage, 10); // 70 - 60
    assert.equal(ctx.deltas!.hygiene, 5); // 60 - 55
    assert.equal(ctx.deltas!.expiredRefs, -2); // 1 - 3
    assert.ok(ctx.previous);
  });

  it('detects stage transition when stage changes', () => {
    const healthResult = makeHealthResult({ maturityStage: 'Maintained' });
    const previous = makeSnapshot({ maturityStage: 'Tracking' });
    const ctx = buildCoachDiffContext(healthResult, previous);

    assert.ok(ctx.stageTransition);
    assert.equal(ctx.stageTransition!.from, 'Tracking');
    assert.equal(ctx.stageTransition!.to, 'Maintained');
  });

  it('does not detect transition when stage is the same', () => {
    const healthResult = makeHealthResult({ maturityStage: 'Tracking' });
    const previous = makeSnapshot({ maturityStage: 'Tracking' });
    const ctx = buildCoachDiffContext(healthResult, previous);

    assert.equal(ctx.stageTransition, undefined);
  });

  it('does not detect transition when either stage is undefined', () => {
    const healthResult = makeHealthResult({ maturityStage: undefined });
    const previous = makeSnapshot({ maturityStage: 'Foundation' });
    const ctx = buildCoachDiffContext(healthResult, previous);

    assert.equal(ctx.stageTransition, undefined);
  });
});

// ── buildDiffSummaryOneLiner ─────────────────────────────────

describe('buildDiffSummaryOneLiner', () => {
  it('returns baseline message when no previous', () => {
    const current = makeSnapshot({
      healthScore: 65,
      coverage: 70,
      hygiene: 60,
    });
    const result = buildDiffSummaryOneLiner(current);

    assert.ok(result.includes('ベースライン'));
    assert.ok(result.includes('65'));
  });

  it('returns delta message when previous exists', () => {
    const current = makeSnapshot({
      healthScore: 65,
      coverage: 75,
      hygiene: 60,
    });
    const previous = makeSnapshot({
      healthScore: 50,
      coverage: 60,
      hygiene: 60,
    });
    const result = buildDiffSummaryOneLiner(current, previous);

    assert.ok(result.includes('50'));
    assert.ok(result.includes('65'));
    assert.ok(result.includes('+15'));
    assert.ok(result.includes('カバレッジ'));
    // hygiene delta is 0, should not appear
    assert.ok(!result.includes('衛生度'));
  });

  it('shows negative deltas', () => {
    const current = makeSnapshot({
      healthScore: 40,
      coverage: 50,
      hygiene: 45,
    });
    const previous = makeSnapshot({
      healthScore: 65,
      coverage: 70,
      hygiene: 60,
    });
    const result = buildDiffSummaryOneLiner(current, previous);

    assert.ok(result.includes('-25'));
  });
});

// ── isStageAdvancement ───────────────────────────────────────

describe('isStageAdvancement', () => {
  it('returns true for Foundation → Tracking', () => {
    const transition: StageTransition = {
      from: 'Foundation',
      to: 'Tracking',
    };
    assert.ok(isStageAdvancement(transition));
  });

  it('returns true for Tracking → Maintained', () => {
    const transition: StageTransition = {
      from: 'Tracking',
      to: 'Maintained',
    };
    assert.ok(isStageAdvancement(transition));
  });

  it('returns true for Maintained → Autonomous', () => {
    const transition: StageTransition = {
      from: 'Maintained',
      to: 'Autonomous',
    };
    assert.ok(isStageAdvancement(transition));
  });

  it('returns false for regression (Tracking → Foundation)', () => {
    const transition: StageTransition = {
      from: 'Tracking',
      to: 'Foundation',
    };
    assert.equal(isStageAdvancement(transition), false);
  });

  it('returns true for multi-level jump (Foundation → Autonomous)', () => {
    const transition: StageTransition = {
      from: 'Foundation',
      to: 'Autonomous',
    };
    assert.ok(isStageAdvancement(transition));
  });
});

// ── formatSigned ─────────────────────────────────────────────

describe('formatSigned', () => {
  it('formats positive numbers with +', () => {
    assert.equal(formatSigned(5), '+5');
  });

  it('formats negative numbers with -', () => {
    assert.equal(formatSigned(-3), '-3');
  });

  it('formats zero as ±0', () => {
    assert.equal(formatSigned(0), '±0');
  });
});

// ── Serialization ────────────────────────────────────────────

describe('serializeCoachSnapshot / deserializeCoachSnapshot', () => {
  it('round-trips a valid snapshot', () => {
    const snapshot = makeSnapshot();
    const json = serializeCoachSnapshot(snapshot);
    const parsed = deserializeCoachSnapshot(json);

    assert.ok(parsed);
    assert.equal(parsed!.timestamp, snapshot.timestamp);
    assert.equal(parsed!.healthScore, snapshot.healthScore);
    assert.equal(parsed!.coverage, snapshot.coverage);
    assert.equal(parsed!.hygiene, snapshot.hygiene);
    assert.equal(parsed!.totalIssues, snapshot.totalIssues);
    assert.equal(parsed!.expiredRefs, snapshot.expiredRefs);
  });

  it('returns undefined for invalid JSON', () => {
    const result = deserializeCoachSnapshot('not json');
    assert.equal(result, undefined);
  });

  it('returns undefined for JSON missing required fields', () => {
    const result = deserializeCoachSnapshot('{"timestamp":"2026-01-01"}');
    assert.equal(result, undefined);
  });

  it('serialized output ends with newline', () => {
    const json = serializeCoachSnapshot(makeSnapshot());
    assert.ok(json.endsWith('\n'));
  });

  it('handles old snapshot format with totalRefs field', () => {
    // Backward compat: old snapshots used 'totalRefs' instead of 'totalIssues'
    const oldJson = JSON.stringify({
      timestamp: '2026-01-01T00:00:00.000Z',
      totalRefs: 7,
      expiredRefs: 2,
      healthScore: 55,
      coverage: 60,
      hygiene: 50,
      maturityStage: 'Foundation',
    });
    const parsed = deserializeCoachSnapshot(oldJson);

    assert.ok(parsed);
    assert.equal(parsed!.totalIssues, 7); // totalRefs → totalIssues
    assert.equal(parsed!.expiredRefs, 2);
  });

  it('defaults expiredRefs to 0 when missing', () => {
    const json = JSON.stringify({
      timestamp: '2026-01-01T00:00:00.000Z',
      healthScore: 55,
      coverage: 60,
      hygiene: 50,
    });
    const parsed = deserializeCoachSnapshot(json);

    assert.ok(parsed);
    assert.equal(parsed!.totalIssues, 0);
    assert.equal(parsed!.expiredRefs, 0);
  });
});

// ── coachSnapshotFilename ────────────────────────────────────

describe('coachSnapshotFilename', () => {
  it('generates ISO8601-safe filename with coach- prefix', () => {
    const filename = coachSnapshotFilename('2026-04-01T10:00:00.000Z');
    assert.equal(filename, 'coach-2026-04-01T10-00-00-000Z.json');
  });

  it('handles timestamp without colons', () => {
    const filename = coachSnapshotFilename('2026-04-01');
    assert.equal(filename, 'coach-2026-04-01.json');
  });
});

// ── selectSnapshotsToDelete (EP-0208) ────────────────────────

describe('selectSnapshotsToDelete', () => {
  it('returns empty when files count is within limit', () => {
    const files = ['coach-2026-03-01.json', 'coach-2026-03-02.json'];
    assert.deepEqual(selectSnapshotsToDelete(files, 5), []);
  });

  it('returns empty when files count equals limit', () => {
    const files = ['coach-2026-03-01.json', 'coach-2026-03-02.json'];
    assert.deepEqual(selectSnapshotsToDelete(files, 2), []);
  });

  it('returns oldest files when exceeding limit', () => {
    const files = [
      'coach-2026-03-03.json',
      'coach-2026-03-01.json',
      'coach-2026-03-02.json',
      'coach-2026-03-04.json',
    ];
    const result = selectSnapshotsToDelete(files, 2);
    // Sorted: 01, 02, 03, 04 → delete 01, 02
    assert.deepEqual(result, [
      'coach-2026-03-01.json',
      'coach-2026-03-02.json',
    ]);
  });

  it('returns empty for empty file list', () => {
    assert.deepEqual(selectSnapshotsToDelete([], 30), []);
  });

  it('returns empty when maxSnapshots is 0 (disabled)', () => {
    const files = ['coach-2026-03-01.json'];
    assert.deepEqual(selectSnapshotsToDelete(files, 0), []);
  });

  it('retains only maxSnapshots newest files', () => {
    const files = Array.from({ length: 35 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return `coach-2026-03-${day}.json`;
    });
    const result = selectSnapshotsToDelete(files, 30);
    assert.equal(result.length, 5);
    // First 5 (oldest) should be deleted
    assert.equal(result[0], 'coach-2026-03-01.json');
    assert.equal(result[4], 'coach-2026-03-05.json');
  });

  it('does not mutate the input array', () => {
    const files = ['coach-2026-03-03.json', 'coach-2026-03-01.json'];
    const original = [...files];
    selectSnapshotsToDelete(files, 1);
    assert.deepEqual(files, original);
  });
});

// ── DEFAULT_MAX_SNAPSHOTS ────────────────────────────────────

describe('DEFAULT_MAX_SNAPSHOTS', () => {
  it('is 30', () => {
    assert.equal(DEFAULT_MAX_SNAPSHOTS, 30);
  });
});
