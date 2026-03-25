import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CliJournalEntry,
  JournalVelocityResult,
} from '../src/core/types.ts';
import {
  truncateToBucket,
  aggregateJournalEntries,
  computeJournalVelocity,
  formatVelocityAsMarkdown,
  formatVelocityAsCsv,
  formatVelocityAsSpark,
  formatJournalVelocity,
} from '../src/commands/journal-velocity.ts';

function makeEntry(overrides?: Partial<CliJournalEntry>): CliJournalEntry {
  return {
    timestamp: '2026-03-18T12:34:56.000Z',
    source: 'cli',
    event_type: 'cli.resolve',
    refs: ['SUP-1234'],
    success: true,
    entries_added: null,
    entries_removed: 1,
    ...overrides,
  };
}

describe('truncateToBucket', () => {
  it('truncates to hour boundary', () => {
    const result = truncateToBucket('2026-03-18T14:32:15.123Z', 'hour');
    assert.equal(result, '2026-03-18T14:00:00.000Z');
  });

  it('truncates to day boundary', () => {
    const result = truncateToBucket('2026-03-18T14:32:15.123Z', 'day');
    assert.equal(result, '2026-03-18T00:00:00.000Z');
  });

  it('truncates to week boundary (Monday)', () => {
    // 2026-03-18 is a Wednesday
    const result = truncateToBucket('2026-03-18T14:32:15.123Z', 'week');
    assert.equal(result, '2026-03-16T00:00:00.000Z'); // Monday
  });

  it('truncates Sunday to previous Monday', () => {
    // 2026-03-22 is a Sunday
    const result = truncateToBucket('2026-03-22T10:00:00.000Z', 'week');
    assert.equal(result, '2026-03-16T00:00:00.000Z'); // Monday
  });

  it('keeps Monday as-is for week boundary', () => {
    // 2026-03-16 is a Monday
    const result = truncateToBucket('2026-03-16T10:00:00.000Z', 'week');
    assert.equal(result, '2026-03-16T00:00:00.000Z');
  });

  it('handles midnight exactly for hour', () => {
    const result = truncateToBucket('2026-03-18T00:00:00.000Z', 'hour');
    assert.equal(result, '2026-03-18T00:00:00.000Z');
  });

  it('handles midnight exactly for day', () => {
    const result = truncateToBucket('2026-03-18T00:00:00.000Z', 'day');
    assert.equal(result, '2026-03-18T00:00:00.000Z');
  });
});

describe('aggregateJournalEntries', () => {
  it('returns empty array for empty input', () => {
    const result = aggregateJournalEntries([], 'day');
    assert.equal(result.length, 0);
  });

  it('aggregates entries into a single day bucket', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 2,
        entries_removed: null,
      }),
      makeEntry({
        timestamp: '2026-03-18T14:00:00.000Z',
        entries_added: 1,
        entries_removed: 1,
      }),
    ];

    const result = aggregateJournalEntries(entries, 'day');

    assert.equal(result.length, 1);
    assert.equal(result[0]!.bucket, '2026-03-18T00:00:00.000Z');
    assert.equal(result[0]!.operations, 2);
    assert.equal(result[0]!.successes, 2);
    assert.equal(result[0]!.failures, 0);
    assert.equal(result[0]!.entriesAdded, 3);
    assert.equal(result[0]!.entriesRemoved, 1);
    assert.equal(result[0]!.netChange, 2);
  });

  it('splits entries into multiple day buckets', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-19T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-20T10:00:00.000Z' }),
    ];

    const result = aggregateJournalEntries(entries, 'day');

    assert.equal(result.length, 3);
    assert.equal(result[0]!.bucket, '2026-03-18T00:00:00.000Z');
    assert.equal(result[1]!.bucket, '2026-03-19T00:00:00.000Z');
    assert.equal(result[2]!.bucket, '2026-03-20T00:00:00.000Z');
  });

  it('counts successes and failures separately', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z', success: true }),
      makeEntry({ timestamp: '2026-03-18T14:00:00.000Z', success: false }),
      makeEntry({ timestamp: '2026-03-18T16:00:00.000Z', success: true }),
    ];

    const result = aggregateJournalEntries(entries, 'day');

    assert.equal(result[0]!.successes, 2);
    assert.equal(result[0]!.failures, 1);
  });

  it('counts unique refs per bucket', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        refs: ['SUP-001', 'SUP-002'],
      }),
      makeEntry({
        timestamp: '2026-03-18T14:00:00.000Z',
        refs: ['SUP-002', 'SUP-003'],
      }),
    ];

    const result = aggregateJournalEntries(entries, 'day');

    assert.equal(result[0]!.refsCount, 3); // SUP-001, SUP-002, SUP-003
  });

  it('treats null entries_added/entries_removed as zero', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: null,
        entries_removed: null,
      }),
    ];

    const result = aggregateJournalEntries(entries, 'day');

    assert.equal(result[0]!.entriesAdded, 0);
    assert.equal(result[0]!.entriesRemoved, 0);
    assert.equal(result[0]!.netChange, 0);
  });

  it('sorts buckets chronologically', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-20T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-19T10:00:00.000Z' }),
    ];

    const result = aggregateJournalEntries(entries, 'day');

    assert.equal(result[0]!.bucket, '2026-03-18T00:00:00.000Z');
    assert.equal(result[1]!.bucket, '2026-03-19T00:00:00.000Z');
    assert.equal(result[2]!.bucket, '2026-03-20T00:00:00.000Z');
  });

  it('aggregates by hour granularity', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-18T10:15:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T10:45:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T11:30:00.000Z' }),
    ];

    const result = aggregateJournalEntries(entries, 'hour');

    assert.equal(result.length, 2);
    assert.equal(result[0]!.bucket, '2026-03-18T10:00:00.000Z');
    assert.equal(result[0]!.operations, 2);
    assert.equal(result[1]!.bucket, '2026-03-18T11:00:00.000Z');
    assert.equal(result[1]!.operations, 1);
  });

  it('aggregates by week granularity', () => {
    const entries = [
      // Week of 2026-03-16 (Mon-Sun)
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }), // Wed
      makeEntry({ timestamp: '2026-03-20T10:00:00.000Z' }), // Fri
      // Week of 2026-03-23 (Mon-Sun)
      makeEntry({ timestamp: '2026-03-24T10:00:00.000Z' }), // Tue
    ];

    const result = aggregateJournalEntries(entries, 'week');

    assert.equal(result.length, 2);
    assert.equal(result[0]!.bucket, '2026-03-16T00:00:00.000Z');
    assert.equal(result[0]!.operations, 2);
    assert.equal(result[1]!.bucket, '2026-03-23T00:00:00.000Z');
    assert.equal(result[1]!.operations, 1);
  });
});

describe('computeJournalVelocity', () => {
  it('returns empty result for empty input', () => {
    const result = computeJournalVelocity([]);

    assert.equal(result.points.length, 0);
    assert.equal(result.summary.count, 0);
    assert.equal(result.summary.oldest, '');
    assert.equal(result.summary.newest, '');
    assert.equal(result.summary.totalOperations, 0);
    assert.equal(result.summary.successRate, 0);
    assert.equal(result.summary.direction, 'neutral');
  });

  it('computes velocity for a single bucket', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 3,
        entries_removed: 1,
      }),
    ];

    const result = computeJournalVelocity(entries);

    assert.equal(result.points.length, 1);
    assert.equal(result.summary.totalOperations, 1);
    assert.equal(result.summary.successRate, 100);
    assert.equal(result.summary.totalNetChange, 2);
    assert.equal(result.summary.direction, 'growing');
  });

  it('detects shrinking direction', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 0,
        entries_removed: 5,
      }),
    ];

    const result = computeJournalVelocity(entries);

    assert.equal(result.summary.direction, 'shrinking');
    assert.equal(result.summary.totalNetChange, -5);
  });

  it('detects neutral direction', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 3,
        entries_removed: 3,
      }),
    ];

    const result = computeJournalVelocity(entries);

    assert.equal(result.summary.direction, 'neutral');
    assert.equal(result.summary.totalNetChange, 0);
  });

  it('applies --last limit', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-16T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-17T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-19T10:00:00.000Z' }),
    ];

    const result = computeJournalVelocity(entries, { last: 2 });

    assert.equal(result.points.length, 2);
    assert.equal(result.points[0]!.bucket, '2026-03-18T00:00:00.000Z');
    assert.equal(result.points[1]!.bucket, '2026-03-19T00:00:00.000Z');
  });

  it('handles --last larger than data points', () => {
    const entries = [makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' })];

    const result = computeJournalVelocity(entries, { last: 10 });

    assert.equal(result.points.length, 1);
  });

  it('uses specified bucket granularity', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-18T10:15:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T10:45:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T11:30:00.000Z' }),
    ];

    const result = computeJournalVelocity(entries, { bucket: 'hour' });

    assert.equal(result.points.length, 2);
    assert.equal(result.summary.count, 2);
  });

  it('computes success rate with mixed results', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z', success: true }),
      makeEntry({ timestamp: '2026-03-18T11:00:00.000Z', success: true }),
      makeEntry({ timestamp: '2026-03-18T12:00:00.000Z', success: false }),
      makeEntry({ timestamp: '2026-03-18T13:00:00.000Z', success: true }),
    ];

    const result = computeJournalVelocity(entries);

    assert.equal(result.summary.successRate, 75); // 3/4 = 75%
  });

  it('includes oldest and newest in summary', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-20T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
    ];

    const result = computeJournalVelocity(entries);

    assert.equal(result.summary.oldest, '2026-03-18T00:00:00.000Z');
    assert.equal(result.summary.newest, '2026-03-20T00:00:00.000Z');
  });

  it('defaults to day bucket when not specified', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T14:00:00.000Z' }),
    ];

    const result = computeJournalVelocity(entries);

    assert.equal(result.points.length, 1); // Same day → same bucket
    assert.equal(result.points[0]!.bucket, '2026-03-18T00:00:00.000Z');
  });
});

describe('formatVelocityAsMarkdown', () => {
  it('handles empty result', () => {
    const result = computeJournalVelocity([]);
    const md = formatVelocityAsMarkdown(result);

    assert.ok(md.includes('# Shiori Journal Velocity'));
    assert.ok(md.includes('No journal data available.'));
  });

  it('includes summary table', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 3,
        entries_removed: 1,
      }),
    ];
    const result = computeJournalVelocity(entries);
    const md = formatVelocityAsMarkdown(result);

    assert.ok(md.includes('# Shiori Journal Velocity'));
    assert.ok(md.includes('## Summary:'));
    assert.ok(md.includes('growing'));
    assert.ok(md.includes('📈'));
    assert.ok(md.includes('## Timeline'));
  });

  it('shows shrinking direction', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 0,
        entries_removed: 5,
      }),
    ];
    const result = computeJournalVelocity(entries);
    const md = formatVelocityAsMarkdown(result);

    assert.ok(md.includes('📉'));
    assert.ok(md.includes('shrinking'));
  });

  it('shows net change with sign', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 5,
        entries_removed: 2,
      }),
    ];
    const result = computeJournalVelocity(entries);
    const md = formatVelocityAsMarkdown(result);

    assert.ok(md.includes('+3'));
  });
});

describe('formatVelocityAsCsv', () => {
  it('includes header with all fields', () => {
    const result = computeJournalVelocity([]);
    const csv = formatVelocityAsCsv(result);
    const header = csv.split('\n')[0]!;

    assert.equal(
      header,
      'bucket,operations,successes,failures,entriesAdded,entriesRemoved,netChange,refsCount',
    );
  });

  it('outputs correct data rows', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        refs: ['SUP-001'],
        entries_added: 2,
        entries_removed: 1,
      }),
    ];
    const result = computeJournalVelocity(entries);
    const csv = formatVelocityAsCsv(result);
    const dataRow = csv.split('\n')[1]!;

    assert.equal(dataRow, '2026-03-18T00:00:00.000Z,1,1,0,2,1,1,1');
  });

  it('handles empty result', () => {
    const result = computeJournalVelocity([]);
    const csv = formatVelocityAsCsv(result);
    const lines = csv.split('\n');

    assert.equal(lines.length, 1); // header only
  });
});

describe('formatVelocityAsSpark', () => {
  it('handles empty result', () => {
    const result = computeJournalVelocity([]);
    const spark = formatVelocityAsSpark(result);

    assert.equal(spark, 'No journal data available.');
  });

  it('renders three series lines', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        entries_added: 3,
        entries_removed: 1,
      }),
    ];
    const result = computeJournalVelocity(entries);
    const spark = formatVelocityAsSpark(result);
    const lines = spark.split('\n');

    assert.equal(lines.length, 3);
    assert.ok(lines[0]!.startsWith('Ops:'));
    assert.ok(lines[1]!.startsWith('Added:'));
    assert.ok(lines[2]!.startsWith('Removed:'));
  });

  it('includes ops count and success rate', () => {
    const entries = [
      makeEntry({
        timestamp: '2026-03-18T10:00:00.000Z',
        success: true,
      }),
      makeEntry({
        timestamp: '2026-03-18T12:00:00.000Z',
        success: false,
      }),
    ];
    const result = computeJournalVelocity(entries);
    const spark = formatVelocityAsSpark(result);

    assert.ok(spark.includes('2 ops'));
    assert.ok(spark.includes('50% OK'));
  });
});

describe('formatJournalVelocity', () => {
  it('routes to JSON by default', () => {
    const result = computeJournalVelocity([
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
    ]);
    const output = formatJournalVelocity(result, 'json');
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'journal-velocity');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data as JournalVelocityResult;

    assert.equal(parsed.points.length, 1);
    assert.equal(parsed.summary.direction, 'shrinking');
  });

  it('routes to markdown', () => {
    const result = computeJournalVelocity([
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
    ]);
    const output = formatJournalVelocity(result, 'markdown');

    assert.ok(output.includes('# Shiori Journal Velocity'));
  });

  it('routes to csv', () => {
    const result = computeJournalVelocity([
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
    ]);
    const output = formatJournalVelocity(result, 'csv');

    assert.ok(output.includes('bucket,operations'));
  });

  it('routes to spark', () => {
    const result = computeJournalVelocity([
      makeEntry({ timestamp: '2026-03-18T10:00:00.000Z' }),
    ]);
    const output = formatJournalVelocity(result, 'spark');

    assert.ok(output.includes('Ops:'));
  });
});
