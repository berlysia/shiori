import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CliJournalEntry } from '../src/core/types.ts';
import {
  filterJournalEntries,
  formatJournalAsTable,
  formatJournalAsJson,
  formatJournal,
} from '../src/commands/journal.ts';

function makeEntry(overrides?: Partial<CliJournalEntry>): CliJournalEntry {
  return {
    timestamp: '2026-03-18T12:00:00.000Z',
    source: 'cli',
    event_type: 'cli.resolve',
    refs: ['SUP-1234'],
    success: true,
    entries_added: null,
    entries_removed: 1,
    ...overrides,
  };
}

// ── filterJournalEntries ──────────────────────────────────────

describe('filterJournalEntries', () => {
  it('returns all entries when no filters applied', () => {
    const entries = [makeEntry(), makeEntry({ refs: ['SUP-5678'] })];
    const result = filterJournalEntries(entries, {});

    assert.equal(result.entries.length, 2);
    assert.equal(result.totalCount, 2);
    assert.equal(result.filteredOutCount, 0);
  });

  it('returns empty result for empty input', () => {
    const result = filterJournalEntries([], {});

    assert.equal(result.entries.length, 0);
    assert.equal(result.totalCount, 0);
    assert.equal(result.filteredOutCount, 0);
  });

  // --last N
  describe('--last filter', () => {
    it('keeps only the last N entries', () => {
      const entries = [
        makeEntry({ refs: ['A'] }),
        makeEntry({ refs: ['B'] }),
        makeEntry({ refs: ['C'] }),
      ];
      const result = filterJournalEntries(entries, { last: 2 });

      assert.equal(result.entries.length, 2);
      assert.deepEqual(result.entries[0]!.refs, ['B']);
      assert.deepEqual(result.entries[1]!.refs, ['C']);
      assert.equal(result.filteredOutCount, 1);
    });

    it('returns all entries when last > total', () => {
      const entries = [makeEntry(), makeEntry()];
      const result = filterJournalEntries(entries, { last: 10 });

      assert.equal(result.entries.length, 2);
      assert.equal(result.filteredOutCount, 0);
    });
  });

  // --ref
  describe('--ref filter', () => {
    it('filters by ref substring (case-insensitive)', () => {
      const entries = [
        makeEntry({ refs: ['SUP-1234'] }),
        makeEntry({ refs: ['ADR-001'] }),
        makeEntry({ refs: ['sup-5678'] }),
      ];
      const result = filterJournalEntries(entries, { ref: 'sup' });

      assert.equal(result.entries.length, 2);
      assert.deepEqual(result.entries[0]!.refs, ['SUP-1234']);
      assert.deepEqual(result.entries[1]!.refs, ['sup-5678']);
    });

    it('matches any ref in multi-ref entries', () => {
      const entries = [
        makeEntry({ refs: ['SUP-001', 'ADR-002'] }),
        makeEntry({ refs: ['DEV-003'] }),
      ];
      const result = filterJournalEntries(entries, { ref: 'ADR' });

      assert.equal(result.entries.length, 1);
      assert.deepEqual(result.entries[0]!.refs, ['SUP-001', 'ADR-002']);
    });

    it('returns empty when no refs match', () => {
      const entries = [makeEntry({ refs: ['SUP-1234'] })];
      const result = filterJournalEntries(entries, { ref: 'NONEXIST' });

      assert.equal(result.entries.length, 0);
      assert.equal(result.filteredOutCount, 1);
    });
  });

  // --event-type
  describe('--event-type filter', () => {
    it('filters by exact event type', () => {
      const entries = [
        makeEntry({ event_type: 'cli.resolve' }),
        makeEntry({ event_type: 'cli.adopt' }),
        makeEntry({ event_type: 'cli.resolve' }),
      ];
      const result = filterJournalEntries(entries, {
        eventType: 'cli.resolve',
      });

      assert.equal(result.entries.length, 2);
      assert.equal(result.filteredOutCount, 1);
    });

    it('returns empty when no event types match', () => {
      const entries = [makeEntry({ event_type: 'cli.resolve' })];
      const result = filterJournalEntries(entries, {
        eventType: 'cli.migrate',
      });

      assert.equal(result.entries.length, 0);
    });
  });

  // --since
  describe('--since filter', () => {
    it('filters entries on or after the given date', () => {
      const entries = [
        makeEntry({ timestamp: '2026-03-01T00:00:00.000Z' }),
        makeEntry({ timestamp: '2026-03-10T00:00:00.000Z' }),
        makeEntry({ timestamp: '2026-03-20T00:00:00.000Z' }),
      ];
      const result = filterJournalEntries(entries, {
        since: '2026-03-10',
      });

      assert.equal(result.entries.length, 2);
      assert.equal(result.entries[0]!.timestamp, '2026-03-10T00:00:00.000Z');
      assert.equal(result.entries[1]!.timestamp, '2026-03-20T00:00:00.000Z');
    });

    it('includes entries at the exact boundary', () => {
      const entries = [makeEntry({ timestamp: '2026-03-10T00:00:00.000Z' })];
      const result = filterJournalEntries(entries, {
        since: '2026-03-10T00:00:00.000Z',
      });

      assert.equal(result.entries.length, 1);
    });

    it('excludes entries before since date', () => {
      const entries = [makeEntry({ timestamp: '2026-02-28T23:59:59.999Z' })];
      const result = filterJournalEntries(entries, {
        since: '2026-03-01',
      });

      assert.equal(result.entries.length, 0);
    });
  });

  // Combined filters
  describe('combined filters', () => {
    it('applies all filters in correct order', () => {
      const entries = [
        makeEntry({
          timestamp: '2026-03-01T00:00:00.000Z',
          event_type: 'cli.resolve',
          refs: ['SUP-001'],
        }),
        makeEntry({
          timestamp: '2026-03-10T00:00:00.000Z',
          event_type: 'cli.adopt',
          refs: ['SUP-002'],
        }),
        makeEntry({
          timestamp: '2026-03-15T00:00:00.000Z',
          event_type: 'cli.resolve',
          refs: ['ADR-001'],
        }),
        makeEntry({
          timestamp: '2026-03-18T00:00:00.000Z',
          event_type: 'cli.resolve',
          refs: ['SUP-003'],
        }),
        makeEntry({
          timestamp: '2026-03-20T00:00:00.000Z',
          event_type: 'cli.resolve',
          refs: ['SUP-004'],
        }),
      ];

      const result = filterJournalEntries(entries, {
        since: '2026-03-10',
        eventType: 'cli.resolve',
        ref: 'SUP',
        last: 1,
      });

      // since: excludes entry 1 (2026-03-01)
      // eventType: excludes entry 2 (cli.adopt)
      // ref: excludes entry 3 (ADR-001)
      // remaining: SUP-003, SUP-004
      // last=1: keeps only SUP-004
      assert.equal(result.entries.length, 1);
      assert.deepEqual(result.entries[0]!.refs, ['SUP-004']);
      assert.equal(result.totalCount, 5);
      assert.equal(result.filteredOutCount, 4);
    });
  });
});

// ── formatJournalAsTable ──────────────────────────────────────

describe('formatJournalAsTable', () => {
  it('returns "No journal entries found." for empty result', () => {
    const result = formatJournalAsTable({
      entries: [],
      totalCount: 0,
      filteredOutCount: 0,
    });

    assert.equal(result, 'No journal entries found.');
  });

  it('formats entries as a table with header and separator', () => {
    const result = formatJournalAsTable({
      entries: [
        makeEntry({
          timestamp: '2026-03-18T12:00:00.000Z',
          event_type: 'cli.resolve',
          refs: ['SUP-1234'],
          success: true,
          entries_added: null,
          entries_removed: 1,
        }),
      ],
      totalCount: 1,
      filteredOutCount: 0,
    });

    const lines = result.split('\n');
    // Header + separator + 1 data row + empty line + summary
    assert.equal(lines.length, 5);
    assert.ok(lines[0]!.includes('TIMESTAMP'));
    assert.ok(lines[0]!.includes('EVENT TYPE'));
    assert.ok(lines[0]!.includes('REFS'));
    assert.ok(lines[2]!.includes('SUP-1234'));
    assert.ok(lines[2]!.includes('cli.resolve'));
    assert.ok(lines[2]!.includes('yes'));
    assert.equal(lines[4], '1 entries');
  });

  it('shows filter summary when entries were filtered out', () => {
    const result = formatJournalAsTable({
      entries: [makeEntry()],
      totalCount: 5,
      filteredOutCount: 4,
    });

    assert.ok(result.includes('Showing 1 of 5 entries (4 filtered out)'));
  });

  it('shows dash for null entries_added/entries_removed', () => {
    const result = formatJournalAsTable({
      entries: [makeEntry({ entries_added: null, entries_removed: null })],
      totalCount: 1,
      filteredOutCount: 0,
    });

    const dataLine = result.split('\n')[2]!;
    // Both should show '-' for null values
    assert.ok(dataLine.includes('-'));
  });

  it('truncates long refs to 20 characters', () => {
    const result = formatJournalAsTable({
      entries: [makeEntry({ refs: ['VERY-LONG-REF-12345678901234567890'] })],
      totalCount: 1,
      filteredOutCount: 0,
    });

    const dataLine = result.split('\n')[2]!;
    // Ref column should be truncated to 20 chars
    assert.ok(!dataLine.includes('VERY-LONG-REF-12345678901234567890'));
  });
});

// ── formatJournalAsJson ──────────────────────────────────────

describe('formatJournalAsJson', () => {
  it('returns valid JSON with expected structure', () => {
    const input = {
      entries: [makeEntry()],
      totalCount: 5,
      filteredOutCount: 4,
    };

    const output = formatJournalAsJson(input);
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'journal');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data;

    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.totalCount, 5);
    assert.equal(parsed.filteredOutCount, 4);
    assert.deepEqual(parsed.entries[0].refs, ['SUP-1234']);
  });

  it('produces pretty-printed JSON with 2-space indentation', () => {
    const output = formatJournalAsJson({
      entries: [],
      totalCount: 0,
      filteredOutCount: 0,
    });

    // Pretty-printed JSON has newlines
    assert.ok(output.includes('\n'));
    // First non-brace line should start with 2 spaces
    const lines = output.split('\n');
    assert.ok(lines[1]!.startsWith('  '));
  });
});

// ── formatJournal (dispatch) ──────────────────────────────────

describe('formatJournal', () => {
  const input = {
    entries: [makeEntry()],
    totalCount: 1,
    filteredOutCount: 0,
  };

  it('dispatches to table format', () => {
    const result = formatJournal(input, 'table');
    assert.ok(result.includes('TIMESTAMP'));
    assert.ok(result.includes('SUP-1234'));
  });

  it('dispatches to json format', () => {
    const result = formatJournal(input, 'json');
    const envelope = JSON.parse(result);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'journal');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data;
    assert.equal(parsed.entries.length, 1);
  });
});
