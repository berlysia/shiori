import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SnapshotDiff } from '../src/core/diff-snapshots.ts';
import { computeNarrative } from '../src/commands/narrative.ts';
import { formatNarrativeAsMarkdown } from '../src/formatters/narrative-markdown.ts';

function makeSnapshotDiff(overrides: Partial<SnapshotDiff> = {}): SnapshotDiff {
  return {
    baseTimestamp: overrides.baseTimestamp ?? '2026-01-01T00:00:00.000Z',
    headTimestamp: overrides.headTimestamp ?? '2026-01-02T00:00:00.000Z',
    categories: overrides.categories ?? [
      { category: 'annotations', base: 5, head: 5, delta: 0 },
      { category: 'candidates', base: 2, head: 2, delta: 0 },
      { category: 'registryEntries', base: 5, head: 5, delta: 0 },
      { category: 'issues', base: 0, head: 0, delta: 0 },
      { category: 'errors', base: 0, head: 0, delta: 0 },
      { category: 'warnings', base: 0, head: 0, delta: 0 },
    ],
    health: overrides.health ?? {
      base: 'healthy',
      head: 'healthy',
      baseScore: 100,
      headScore: 100,
      scoreDelta: 0,
      direction: 'stable',
    },
  };
}

describe('computeNarrative', () => {
  it('produces stable headline for identical snapshots', () => {
    const diff = makeSnapshotDiff();
    const result = computeNarrative(diff);

    assert.ok(result.headline.includes('stable'));
    assert.equal(result.observations.length, 0);
    assert.equal(result.baseTimestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(result.headTimestamp, '2026-01-02T00:00:00.000Z');
  });

  it('reports improving health', () => {
    const diff = makeSnapshotDiff({
      health: {
        base: 'warning',
        head: 'healthy',
        baseScore: 60,
        headScore: 90,
        scoreDelta: 30,
        direction: 'improving',
      },
    });

    const result = computeNarrative(diff);

    assert.ok(result.headline.includes('improved'));
    assert.ok(result.healthSummary.includes('warning'));
    assert.ok(result.healthSummary.includes('healthy'));
  });

  it('reports declining health', () => {
    const diff = makeSnapshotDiff({
      health: {
        base: 'healthy',
        head: 'critical',
        baseScore: 90,
        headScore: 30,
        scoreDelta: -60,
        direction: 'declining',
      },
    });

    const result = computeNarrative(diff);

    assert.ok(result.headline.includes('declined'));
  });

  it('generates observations for changed categories', () => {
    const diff = makeSnapshotDiff({
      categories: [
        { category: 'annotations', base: 5, head: 10, delta: 5 },
        { category: 'issues', base: 3, head: 0, delta: -3 },
        { category: 'candidates', base: 2, head: 2, delta: 0 },
        { category: 'registryEntries', base: 5, head: 5, delta: 0 },
        { category: 'errors', base: 0, head: 0, delta: 0 },
        { category: 'warnings', base: 0, head: 0, delta: 0 },
      ],
    });

    const result = computeNarrative(diff);

    // Should have 2 observations (annotations increased, issues decreased)
    assert.equal(result.observations.length, 2);

    // Issues should have higher significance (weight 10) than annotations (weight 3)
    assert.equal(result.observations[0]!.category, 'issues');
    assert.equal(result.observations[1]!.category, 'annotations');

    assert.ok(result.observations[0]!.message.includes('decreased'));
    assert.ok(result.observations[1]!.message.includes('increased'));
  });

  it('sorts observations by significance descending', () => {
    const diff = makeSnapshotDiff({
      categories: [
        { category: 'annotations', base: 0, head: 100, delta: 100 },
        { category: 'issues', base: 0, head: 1, delta: 1 },
        { category: 'candidates', base: 0, head: 0, delta: 0 },
        { category: 'registryEntries', base: 0, head: 0, delta: 0 },
        { category: 'errors', base: 0, head: 0, delta: 0 },
        { category: 'warnings', base: 0, head: 0, delta: 0 },
      ],
    });

    const result = computeNarrative(diff);

    // annotations: 100 * 3 = 300, issues: 1 * 10 = 10
    assert.equal(result.observations[0]!.category, 'annotations');
    assert.equal(result.observations[1]!.category, 'issues');
  });

  it('includes diff in result for JSON output', () => {
    const diff = makeSnapshotDiff();
    const result = computeNarrative(diff);

    assert.deepEqual(result.diff, diff);
  });

  it('handles byType categories', () => {
    const diff = makeSnapshotDiff({
      categories: [
        { category: 'annotations', base: 5, head: 5, delta: 0 },
        { category: 'candidates', base: 2, head: 2, delta: 0 },
        { category: 'registryEntries', base: 5, head: 5, delta: 0 },
        { category: 'issues', base: 0, head: 0, delta: 0 },
        { category: 'errors', base: 0, head: 0, delta: 0 },
        { category: 'warnings', base: 0, head: 0, delta: 0 },
        { category: 'byType.expired', base: 0, head: 3, delta: 3 },
      ],
    });

    const result = computeNarrative(diff);

    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0]!.category, 'byType.expired');
    assert.ok(result.observations[0]!.message.includes('expired'));
  });
});

describe('formatNarrativeAsMarkdown', () => {
  it('includes deduplication marker', () => {
    const diff = makeSnapshotDiff();
    const result = computeNarrative(diff);
    const md = formatNarrativeAsMarkdown(result);

    assert.ok(md.includes('<!-- shiori-narrative -->'));
  });

  it('includes headline and health section', () => {
    const diff = makeSnapshotDiff({
      health: {
        base: 'warning',
        head: 'healthy',
        baseScore: 60,
        headScore: 90,
        scoreDelta: 30,
        direction: 'improving',
      },
    });

    const result = computeNarrative(diff);
    const md = formatNarrativeAsMarkdown(result);

    assert.ok(md.includes('# 📈 Shiori Governance Narrative'));
    assert.ok(md.includes('## Health Transition'));
    assert.ok(md.includes('warning'));
    assert.ok(md.includes('healthy'));
  });

  it('includes observations table when changes exist', () => {
    const diff = makeSnapshotDiff({
      categories: [
        { category: 'issues', base: 5, head: 0, delta: -5 },
        { category: 'annotations', base: 5, head: 5, delta: 0 },
        { category: 'candidates', base: 2, head: 2, delta: 0 },
        { category: 'registryEntries', base: 5, head: 5, delta: 0 },
        { category: 'errors', base: 0, head: 0, delta: 0 },
        { category: 'warnings', base: 0, head: 0, delta: 0 },
      ],
    });

    const result = computeNarrative(diff);
    const md = formatNarrativeAsMarkdown(result);

    assert.ok(md.includes('## Notable Changes'));
    assert.ok(md.includes('| Category | Change | Significance |'));
  });

  it('shows "no changes" when stable', () => {
    const diff = makeSnapshotDiff();
    const result = computeNarrative(diff);
    const md = formatNarrativeAsMarkdown(result);

    assert.ok(md.includes('No significant metric changes detected.'));
  });

  it('includes metric details table for changed categories', () => {
    const diff = makeSnapshotDiff({
      categories: [
        { category: 'annotations', base: 5, head: 10, delta: 5 },
        { category: 'candidates', base: 2, head: 2, delta: 0 },
        { category: 'registryEntries', base: 5, head: 5, delta: 0 },
        { category: 'issues', base: 0, head: 0, delta: 0 },
        { category: 'errors', base: 0, head: 0, delta: 0 },
        { category: 'warnings', base: 0, head: 0, delta: 0 },
      ],
    });

    const result = computeNarrative(diff);
    const md = formatNarrativeAsMarkdown(result);

    assert.ok(md.includes('## Metric Details'));
    assert.ok(md.includes('| Metric | Base | Head | Delta |'));
  });
});
