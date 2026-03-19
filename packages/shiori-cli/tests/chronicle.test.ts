import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ShioriAnnotation,
  Registry,
  RefStatusValue,
  ChronicleEntry,
  ChronicleResult,
} from '../src/core/types.ts';
import { buildChronicle } from '../src/core/chronicle.ts';

/** Minimal annotation factory */
function makeAnnotation(
  ref: string,
  file: string,
  line: number,
  opts?: {
    expires?: string;
    provenance?: {
      author: string;
      authorEmail: string;
      date: string;
      commitHash: string;
      commitSummary: string;
    };
  },
): ShioriAnnotation {
  return {
    ref,
    tagged: true,
    ignored: false,
    location: { file, line },
    expires: opts?.expires,
    provenance: opts?.provenance,
  };
}

/** Fixed reference date for deterministic tests */
const NOW = new Date('2026-03-01T00:00:00Z');

/** Helper to get first entry with assertion guard */
function firstEntry(result: ChronicleResult): ChronicleEntry {
  assert.ok(result.entries.length > 0, 'Expected at least one entry');
  return result.entries[0]!;
}

describe('buildChronicle', () => {
  it('returns empty result for no annotations', () => {
    const result = buildChronicle({
      annotations: [],
      registry: {},
      now: NOW,
    });
    assert.equal(result.entries.length, 0);
    assert.deepEqual(result.summary, {
      totalRefs: 0,
      withProvenance: 0,
      withRefStatus: 0,
      withExpires: 0,
    });
  });

  it('skips draft annotations (empty ref)', () => {
    const result = buildChronicle({
      annotations: [makeAnnotation('', 'a.ts', 1)],
      registry: {},
      now: NOW,
    });
    assert.equal(result.entries.length, 0);
  });

  it('creates entry with no events when only location data exists', () => {
    const result = buildChronicle({
      annotations: [makeAnnotation('SUP-1', 'a.ts', 10)],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.ref, 'SUP-1');
    assert.deepEqual(entry.locations, [{ file: 'a.ts', line: 10 }]);
    assert.equal(entry.events.length, 0);
  });

  it('generates introduced event from provenance', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'a.ts', 10, {
          provenance: {
            author: 'Alice',
            authorEmail: 'alice@example.com',
            date: '2025-06-15T10:00:00Z',
            commitHash: 'abc1234',
            commitSummary: 'feat: add annotation',
          },
        }),
      ],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.events.length, 1);
    const event = entry.events[0]!;
    assert.equal(event.type, 'introduced');
    assert.equal(event.date, '2025-06-15');
    assert.ok(event.label.includes('Alice'));
    assert.equal(result.summary.withProvenance, 1);
  });

  it('uses earliest provenance date when ref appears in multiple locations', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'b.ts', 20, {
          provenance: {
            author: 'Bob',
            authorEmail: 'bob@example.com',
            date: '2025-08-01T00:00:00Z',
            commitHash: 'bbb1234',
            commitSummary: 'fix: later commit',
          },
        }),
        makeAnnotation('SUP-1', 'a.ts', 10, {
          provenance: {
            author: 'Alice',
            authorEmail: 'alice@example.com',
            date: '2025-06-01T00:00:00Z',
            commitHash: 'aaa1234',
            commitSummary: 'feat: first commit',
          },
        }),
      ],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    const event = entry.events[0]!;
    assert.equal(event.type, 'introduced');
    assert.equal(event.date, '2025-06-01');
    assert.ok(event.label.includes('Alice'));
    assert.equal(entry.locations.length, 2);
  });

  it('generates expires event for future expiration', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'a.ts', 10, { expires: '2026-06' }),
      ],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.events.length, 1);
    const event = entry.events[0]!;
    assert.equal(event.type, 'expires');
    assert.equal(event.date, '2026-06-01');
    assert.equal(result.summary.withExpires, 1);
  });

  it('generates expired event for past expiration', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'a.ts', 10, { expires: '2025-01-15' }),
      ],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.events.length, 1);
    const event = entry.events[0]!;
    assert.equal(event.type, 'expired');
    assert.equal(event.date, '2025-01-15');
  });

  it('uses registry expires when annotation has none', () => {
    const registry: Registry = {
      'SUP-1': {
        reason: 'workaround',
        target: 'a.ts',
        expires: '2026-12-01',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const result = buildChronicle({
      annotations: [makeAnnotation('SUP-1', 'a.ts', 10)],
      registry,
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.events.length, 1);
    const event = entry.events[0]!;
    assert.equal(event.type, 'expires');
    assert.equal(event.date, '2026-12-01');
  });

  it('generates status-closed event from refStatuses', () => {
    const refStatuses = new Map<string, RefStatusValue>([['SUP-1', 'closed']]);
    const result = buildChronicle({
      annotations: [makeAnnotation('SUP-1', 'a.ts', 10)],
      registry: {},
      refStatuses,
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.events.length, 1);
    const event = entry.events[0]!;
    assert.equal(event.type, 'status-closed');
    assert.equal(entry.currentStatus, 'closed');
    assert.equal(result.summary.withRefStatus, 1);
  });

  it('does not generate status event for open refs', () => {
    const refStatuses = new Map<string, RefStatusValue>([['SUP-1', 'open']]);
    const result = buildChronicle({
      annotations: [makeAnnotation('SUP-1', 'a.ts', 10)],
      registry: {},
      refStatuses,
      now: NOW,
    });
    const entry = firstEntry(result);
    // No status-closed event, but currentStatus is still set
    const statusEvents = entry.events.filter((e) => e.type === 'status-closed');
    assert.equal(statusEvents.length, 0);
    assert.equal(entry.currentStatus, 'open');
  });

  it('attaches owner and kind from registry', () => {
    const registry: Registry = {
      'SUP-1': {
        reason: 'workaround',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: 'team-alpha',
        notes: undefined,
        kind: 'suppression',
      },
    };
    const result = buildChronicle({
      annotations: [makeAnnotation('SUP-1', 'a.ts', 10)],
      registry,
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.owner, 'team-alpha');
    assert.equal(entry.kind, 'suppression');
  });

  it('sorts events by date (oldest first)', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'a.ts', 10, {
          expires: '2025-01-01',
          provenance: {
            author: 'Alice',
            authorEmail: 'alice@example.com',
            date: '2024-06-01T00:00:00Z',
            commitHash: 'aaa1234',
            commitSummary: 'feat: initial',
          },
        }),
      ],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.events.length, 2);
    assert.equal(entry.events[0]!.type, 'introduced');
    assert.equal(entry.events[0]!.date, '2024-06-01');
    assert.equal(entry.events[1]!.type, 'expired');
    assert.equal(entry.events[1]!.date, '2025-01-01');
  });

  it('sorts entries by ref', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('ZZZ-1', 'z.ts', 1),
        makeAnnotation('AAA-1', 'a.ts', 1),
        makeAnnotation('MMM-1', 'm.ts', 1),
      ],
      registry: {},
      now: NOW,
    });
    assert.deepEqual(
      result.entries.map((e) => e.ref),
      ['AAA-1', 'MMM-1', 'ZZZ-1'],
    );
  });

  it('full timeline: provenance + expires + status-closed', () => {
    const registry: Registry = {
      'SUP-1': {
        reason: 'workaround',
        target: 'a.ts',
        expires: '2026-06-01',
        ticket: 'https://jira.example.com/SUP-1',
        owner: 'team-alpha',
        notes: undefined,
        kind: 'suppression',
      },
    };
    const refStatuses = new Map<string, RefStatusValue>([['SUP-1', 'closed']]);
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'a.ts', 10, {
          provenance: {
            author: 'Alice',
            authorEmail: 'alice@example.com',
            date: '2025-01-15T10:00:00Z',
            commitHash: 'abc1234',
            commitSummary: 'feat: add workaround',
          },
        }),
      ],
      registry,
      refStatuses,
      now: NOW,
    });

    assert.equal(result.entries.length, 1);
    const entry = firstEntry(result);
    assert.equal(entry.ref, 'SUP-1');
    assert.equal(entry.owner, 'team-alpha');
    assert.equal(entry.kind, 'suppression');
    assert.equal(entry.currentStatus, 'closed');

    // 3 events: introduced, status-closed (now=2026-03-01), expires (2026-06-01)
    assert.equal(entry.events.length, 3);
    assert.equal(entry.events[0]!.type, 'introduced');
    assert.equal(entry.events[0]!.date, '2025-01-15');
    assert.equal(entry.events[1]!.type, 'status-closed');
    assert.equal(entry.events[1]!.date, '2026-03-01');
    assert.equal(entry.events[2]!.type, 'expires');
    assert.equal(entry.events[2]!.date, '2026-06-01');

    assert.deepEqual(result.summary, {
      totalRefs: 1,
      withProvenance: 1,
      withRefStatus: 1,
      withExpires: 1,
    });
  });

  it('degradation: works without refStatuses (level 2)', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'a.ts', 10, {
          expires: '2026-06',
          provenance: {
            author: 'Alice',
            authorEmail: 'alice@example.com',
            date: '2025-01-01T00:00:00Z',
            commitHash: 'abc1234',
            commitSummary: 'feat: add',
          },
        }),
      ],
      registry: {},
      // no refStatuses
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(entry.currentStatus, undefined);
    assert.equal(result.summary.withRefStatus, 0);
    assert.equal(entry.events.length, 2); // introduced + expires
  });

  it('degradation: works without provenance (level 3)', () => {
    const result = buildChronicle({
      annotations: [
        makeAnnotation('SUP-1', 'a.ts', 10, { expires: '2025-01' }),
      ],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(result.summary.withProvenance, 0);
    assert.equal(entry.events.length, 1); // expired only
    assert.equal(entry.events[0]!.type, 'expired');
  });

  it('degradation: works with only annotations (level 4)', () => {
    const result = buildChronicle({
      annotations: [makeAnnotation('SUP-1', 'a.ts', 10)],
      registry: {},
      now: NOW,
    });
    const entry = firstEntry(result);
    assert.equal(result.entries.length, 1);
    assert.equal(entry.events.length, 0);
    assert.equal(result.summary.withProvenance, 0);
    assert.equal(result.summary.withRefStatus, 0);
    assert.equal(result.summary.withExpires, 0);
  });
});
