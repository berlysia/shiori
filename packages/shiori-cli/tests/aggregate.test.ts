import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HealthLevel } from '../src/core/types.ts';
import {
  aggregate,
  formatAggregate,
  formatAggregateAsMarkdown,
  type AggregateInput,
} from '../src/commands/aggregate.ts';
import type { SummaryResult } from '../src/commands/summary.ts';
import type { HealthResult } from '../src/core/types.ts';

// ── Test helpers ────────────────────────────────────────────

function makeHealthResult(
  overrides: Partial<{
    score: number;
    level: HealthLevel;
    issuesTotal: number;
    errors: number;
    warnings: number;
    expired: number;
    expiringSoon: number;
  }> = {},
): HealthResult {
  return {
    timestamp: '2026-03-19T00:00:00.000Z',
    health: {
      level: overrides.level ?? 'healthy',
      score: overrides.score ?? 100,
      summary: 'Test summary',
    },
    issues: {
      total: overrides.issuesTotal ?? 0,
      errors: overrides.errors ?? 0,
      warnings: overrides.warnings ?? 0,
    },
    expiring: {
      expired: overrides.expired ?? 0,
      expiringSoon: overrides.expiringSoon ?? 0,
    },
    insights: [],
  };
}

function makeSummaryResult(
  overrides: Partial<{
    repository: string;
    score: number;
    level: HealthLevel;
    issuesTotal: number;
    errors: number;
    warnings: number;
    expired: number;
    expiringSoon: number;
  }> = {},
): SummaryResult {
  return {
    timestamp: '2026-03-19T00:00:00.000Z',
    repository: overrides.repository,
    health: makeHealthResult(overrides),
  };
}

function makeInput(
  overrides: Partial<{
    repository: string;
    fallbackRepository: string;
    score: number;
    level: HealthLevel;
    issuesTotal: number;
    errors: number;
    warnings: number;
    expired: number;
    expiringSoon: number;
  }> = {},
): AggregateInput {
  const { fallbackRepository = 'default-repo', ...summaryOverrides } =
    overrides;
  return {
    summaryResult: makeSummaryResult(summaryOverrides),
    fallbackRepository,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('aggregate', () => {
  describe('basic aggregation', () => {
    it('aggregates two repositories', () => {
      const result = aggregate([
        makeInput({ repository: 'org/repo-a', score: 80, level: 'healthy' }),
        makeInput({
          repository: 'org/repo-b',
          score: 60,
          level: 'warning',
          issuesTotal: 3,
          errors: 1,
          warnings: 2,
        }),
      ]);

      assert.equal(result.overall.repositoryCount, 2);
      assert.equal(result.overall.averageScore, 70);
      assert.equal(result.overall.worstRepository, 'org/repo-b');
      assert.equal(result.overall.worstScore, 60);
      assert.equal(result.overall.totalIssues, 3);
      assert.equal(result.overall.totalErrors, 1);
      assert.equal(result.overall.totalWarnings, 2);
      assert.equal(result.repositories.length, 2);
    });

    it('handles single repository input', () => {
      const result = aggregate([
        makeInput({ repository: 'org/solo', score: 90, level: 'healthy' }),
      ]);

      assert.equal(result.overall.repositoryCount, 1);
      assert.equal(result.overall.averageScore, 90);
      assert.equal(result.overall.worstRepository, 'org/solo');
      assert.equal(result.overall.worstScore, 90);
    });
  });

  describe('repository key resolution', () => {
    it('uses summaryResult.repository when available', () => {
      const result = aggregate([
        makeInput({
          repository: 'org/from-summary',
          fallbackRepository: 'fallback-name',
        }),
      ]);

      assert.equal(result.repositories[0]!.repository, 'org/from-summary');
    });

    it('falls back to fallbackRepository when repository is undefined', () => {
      const result = aggregate([
        makeInput({ fallbackRepository: 'my-report-file' }),
      ]);

      assert.equal(result.repositories[0]!.repository, 'my-report-file');
    });
  });

  describe('score calculation', () => {
    it('computes simple average of all repository scores', () => {
      const result = aggregate([
        makeInput({ repository: 'a', score: 100 }),
        makeInput({ repository: 'b', score: 50 }),
        makeInput({ repository: 'c', score: 70 }),
      ]);

      // (100 + 50 + 70) / 3 = 73.33... → 73 (rounded)
      assert.equal(result.overall.averageScore, 73);
    });

    it('rounds average score to nearest integer', () => {
      const result = aggregate([
        makeInput({ repository: 'a', score: 33 }),
        makeInput({ repository: 'b', score: 34 }),
      ]);

      // (33 + 34) / 2 = 33.5 → 34
      assert.equal(result.overall.averageScore, 34);
    });

    it('handles all scores being zero', () => {
      const result = aggregate([
        makeInput({ repository: 'a', score: 0, level: 'critical' }),
        makeInput({ repository: 'b', score: 0, level: 'critical' }),
      ]);

      assert.equal(result.overall.averageScore, 0);
      // Worst is lexicographically smallest on tie
      assert.equal(result.overall.worstRepository, 'a');
    });
  });

  describe('worst repository', () => {
    it('identifies the repository with the lowest score', () => {
      const result = aggregate([
        makeInput({ repository: 'high', score: 90, level: 'healthy' }),
        makeInput({ repository: 'low', score: 30, level: 'critical' }),
        makeInput({ repository: 'mid', score: 60, level: 'warning' }),
      ]);

      assert.equal(result.overall.worstRepository, 'low');
      assert.equal(result.overall.worstScore, 30);
    });

    it('selects lexicographically smallest on tie', () => {
      const result = aggregate([
        makeInput({ repository: 'zebra', score: 50, level: 'warning' }),
        makeInput({ repository: 'alpha', score: 50, level: 'warning' }),
        makeInput({ repository: 'mango', score: 50, level: 'warning' }),
      ]);

      assert.equal(result.overall.worstRepository, 'alpha');
      assert.equal(result.overall.worstScore, 50);
    });
  });

  describe('sorting', () => {
    it('sorts repositories by score ascending, then name', () => {
      const result = aggregate([
        makeInput({ repository: 'c-repo', score: 80 }),
        makeInput({ repository: 'a-repo', score: 40, level: 'critical' }),
        makeInput({ repository: 'b-repo', score: 40, level: 'critical' }),
      ]);

      assert.equal(result.repositories[0]!.repository, 'a-repo');
      assert.equal(result.repositories[1]!.repository, 'b-repo');
      assert.equal(result.repositories[2]!.repository, 'c-repo');
    });
  });

  describe('issue and expiry aggregation', () => {
    it('sums issues across repositories', () => {
      const result = aggregate([
        makeInput({
          repository: 'r1',
          issuesTotal: 5,
          errors: 2,
          warnings: 3,
          expired: 1,
          expiringSoon: 2,
        }),
        makeInput({
          repository: 'r2',
          issuesTotal: 3,
          errors: 1,
          warnings: 2,
          expired: 0,
          expiringSoon: 1,
        }),
      ]);

      assert.equal(result.overall.totalIssues, 8);
      assert.equal(result.overall.totalErrors, 3);
      assert.equal(result.overall.totalWarnings, 5);

      // Per-repository entries preserve individual counts
      const r1 = result.repositories.find((r) => r.repository === 'r1')!;
      assert.equal(r1.expired, 1);
      assert.equal(r1.expiringSoon, 2);
    });
  });

  describe('timestamp', () => {
    it('generates a valid ISO timestamp', () => {
      const result = aggregate([makeInput({ repository: 'test' })]);

      assert.ok(result.timestamp);
      // Verify it parses as a valid date
      const date = new Date(result.timestamp);
      assert.ok(!isNaN(date.getTime()));
    });
  });
});

describe('formatAggregate', () => {
  const result = aggregate([
    makeInput({ repository: 'org/repo-a', score: 90, level: 'healthy' }),
    makeInput({
      repository: 'org/repo-b',
      score: 60,
      level: 'warning',
      issuesTotal: 3,
      errors: 1,
      warnings: 2,
    }),
  ]);

  it('formats as JSON', () => {
    const output = formatAggregate(result, 'json');
    const parsed = JSON.parse(output);
    assert.equal(parsed.overall.repositoryCount, 2);
    assert.equal(parsed.overall.averageScore, 75);
    assert.ok(Array.isArray(parsed.repositories));
    assert.equal(parsed.repositories.length, 2);
  });

  it('formats as markdown', () => {
    const output = formatAggregate(result, 'markdown');
    assert.ok(output.includes('## Shiori Organization Governance Report'));
    assert.ok(output.includes('### Repositories'));
    assert.ok(output.includes('### Overall'));
  });
});

describe('formatAggregateAsMarkdown', () => {
  it('includes repository table with all columns', () => {
    const result = aggregate([
      makeInput({
        repository: 'org/repo-a',
        score: 80,
        level: 'healthy',
        issuesTotal: 1,
        errors: 0,
        warnings: 1,
        expired: 0,
        expiringSoon: 1,
      }),
    ]);

    const output = formatAggregateAsMarkdown(result);
    assert.ok(output.includes('org/repo-a'));
    assert.ok(output.includes('| Repository |'));
    assert.ok(output.includes('Score'));
    assert.ok(output.includes('Level'));
    assert.ok(output.includes('Issues'));
    assert.ok(output.includes('Expired'));
    assert.ok(output.includes('Expiring'));
  });

  it('includes overall summary section', () => {
    const result = aggregate([
      makeInput({ repository: 'org/repo-a', score: 80 }),
      makeInput({ repository: 'org/repo-b', score: 60, level: 'warning' }),
    ]);

    const output = formatAggregateAsMarkdown(result);
    assert.ok(output.includes('**Repositories:** 2'));
    assert.ok(output.includes('**Average Score:**'));
    assert.ok(output.includes('**Worst:**'));
    assert.ok(output.includes('**Total Issues:**'));
  });

  it('includes health emoji in table rows', () => {
    const result = aggregate([
      makeInput({ repository: 'healthy-repo', score: 90, level: 'healthy' }),
      makeInput({ repository: 'critical-repo', score: 20, level: 'critical' }),
    ]);

    const output = formatAggregateAsMarkdown(result);
    assert.ok(output.includes('🟢'));
    assert.ok(output.includes('🔴'));
  });
});
