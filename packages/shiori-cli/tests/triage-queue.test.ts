import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTriageQueue,
  type TriageResult,
  type TriageItem,
  type WizardUrgency,
} from '../src/commands/triage.ts';
import { makeRegistryEntry } from './helpers/registry.ts';

// ── Test helpers ─────────────────────────────────────────────

function makeTriageItem(
  ref: string,
  overrides: Partial<TriageItem> = {},
): TriageItem {
  return {
    ref,
    priority: 'medium',
    issues: [
      {
        type: 'missing-in-registry',
        severity: 'warning',
        ref,
        message: `test issue for ${ref}`,
        file: 'src/a.ts',
        line: 1,
      },
    ],
    registryEntry: undefined,
    sourceLocations: [{ file: 'src/a.ts', line: 1 }],
    url: undefined,
    action: 'shiori update',
    ...overrides,
  };
}

function makeTriageResult(items: TriageItem[]): TriageResult {
  const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of items) {
    byPriority[item.priority]++;
  }
  return {
    timestamp: '2025-01-01T00:00:00.000Z',
    items,
    summary: { total: items.length, byPriority },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('buildTriageQueue', () => {
  const now = new Date('2025-06-15T00:00:00.000Z');

  describe('empty input', () => {
    it('returns empty queue for empty triage result', () => {
      const queue = buildTriageQueue({
        triageResult: makeTriageResult([]),
        now,
      });

      assert.equal(queue.items.length, 0);
      assert.deepEqual(queue.byUrgency, {
        overdue: 0,
        imminent: 0,
        upcoming: 0,
        open: 0,
      });
    });
  });

  describe('urgency classification', () => {
    it('classifies expired items as overdue', () => {
      const item = makeTriageItem('EXP-001', {
        priority: 'critical',
        registryEntry: makeRegistryEntry({ expires: '2025-06-01' }),
      });

      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
      });

      assert.equal(queue.items.length, 1);
      assert.equal(queue.items[0]!.urgency, 'overdue');
      assert.ok(queue.items[0]!.daysToExpiry! < 0);
    });

    it('classifies items expiring within 14 days as imminent', () => {
      const item = makeTriageItem('SOON-001', {
        priority: 'high',
        registryEntry: makeRegistryEntry({ expires: '2025-06-25' }),
      });

      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
      });

      assert.equal(queue.items[0]!.urgency, 'imminent');
      assert.equal(queue.items[0]!.daysToExpiry, 10);
    });

    it('classifies items expiring within 30 days as upcoming', () => {
      const item = makeTriageItem('UP-001', {
        priority: 'medium',
        registryEntry: makeRegistryEntry({ expires: '2025-07-10' }),
      });

      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
      });

      assert.equal(queue.items[0]!.urgency, 'upcoming');
      assert.equal(queue.items[0]!.daysToExpiry, 25);
    });

    it('classifies items with no expiry as open', () => {
      const item = makeTriageItem('OPEN-001', {
        registryEntry: makeRegistryEntry(),
      });

      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
      });

      assert.equal(queue.items[0]!.urgency, 'open');
      assert.equal(queue.items[0]!.daysToExpiry, null);
    });

    it('classifies items without registry entry as open', () => {
      const item = makeTriageItem('NOREG-001');

      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
      });

      assert.equal(queue.items[0]!.urgency, 'open');
      assert.equal(queue.items[0]!.daysToExpiry, null);
    });

    it('handles YYYY-MM format dates', () => {
      const item = makeTriageItem('YM-001', {
        priority: 'critical',
        registryEntry: makeRegistryEntry({ expires: '2025-06' }),
      });

      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
      });

      // 2025-06-01 is before 2025-06-15, so overdue
      assert.equal(queue.items[0]!.urgency, 'overdue');
      assert.ok(queue.items[0]!.daysToExpiry! < 0);
    });
  });

  describe('custom thresholds', () => {
    it('respects custom imminentDays', () => {
      const item = makeTriageItem('THRESH-001', {
        registryEntry: makeRegistryEntry({ expires: '2025-06-20' }),
      });

      // 5 days remaining, imminent threshold = 3
      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
        imminentDays: 3,
      });

      // 5 days > 3 days threshold, but within default 30 days → upcoming
      assert.equal(queue.items[0]!.urgency, 'upcoming');
    });

    it('respects custom upcomingDays', () => {
      const item = makeTriageItem('THRESH-002', {
        registryEntry: makeRegistryEntry({ expires: '2025-07-10' }),
      });

      // 25 days remaining, upcoming threshold = 10
      const queue = buildTriageQueue({
        triageResult: makeTriageResult([item]),
        now,
        upcomingDays: 10,
      });

      // 25 days > 10 days threshold → open
      assert.equal(queue.items[0]!.urgency, 'open');
    });
  });

  describe('sorting', () => {
    it('sorts overdue before imminent before upcoming before open', () => {
      const items = [
        makeTriageItem('OPEN-A', {
          registryEntry: makeRegistryEntry(),
        }),
        makeTriageItem('OVERDUE-A', {
          priority: 'critical',
          registryEntry: makeRegistryEntry({ expires: '2025-06-01' }),
        }),
        makeTriageItem('UPCOMING-A', {
          registryEntry: makeRegistryEntry({ expires: '2025-07-10' }),
        }),
        makeTriageItem('IMMINENT-A', {
          priority: 'high',
          registryEntry: makeRegistryEntry({ expires: '2025-06-25' }),
        }),
      ];

      const queue = buildTriageQueue({
        triageResult: makeTriageResult(items),
        now,
      });

      const urgencies = queue.items.map((qi) => qi.urgency);
      assert.deepEqual(urgencies, ['overdue', 'imminent', 'upcoming', 'open']);
    });

    it('sorts within urgency by days-to-expiry ascending', () => {
      const items = [
        makeTriageItem('LATE-B', {
          priority: 'critical',
          registryEntry: makeRegistryEntry({ expires: '2025-05-01' }),
        }),
        makeTriageItem('LATE-A', {
          priority: 'critical',
          registryEntry: makeRegistryEntry({ expires: '2025-06-01' }),
        }),
      ];

      const queue = buildTriageQueue({
        triageResult: makeTriageResult(items),
        now,
      });

      // Both overdue: LATE-B (more overdue, more negative days) comes first
      assert.equal(queue.items[0]!.item.ref, 'LATE-B');
      assert.equal(queue.items[1]!.item.ref, 'LATE-A');
    });

    it('sorts within same expiry by priority then ref', () => {
      const items = [
        makeTriageItem('B-REF', {
          priority: 'high',
          registryEntry: makeRegistryEntry({ expires: '2025-06-01' }),
        }),
        makeTriageItem('A-REF', {
          priority: 'critical',
          registryEntry: makeRegistryEntry({ expires: '2025-06-01' }),
        }),
      ];

      const queue = buildTriageQueue({
        triageResult: makeTriageResult(items),
        now,
      });

      // Same expiry date → sort by priority: critical (A-REF) before high (B-REF)
      assert.equal(queue.items[0]!.item.ref, 'A-REF');
      assert.equal(queue.items[1]!.item.ref, 'B-REF');
    });
  });

  describe('summary counts', () => {
    it('counts items by urgency correctly', () => {
      const items = [
        makeTriageItem('OD-1', {
          priority: 'critical',
          registryEntry: makeRegistryEntry({ expires: '2025-01-01' }),
        }),
        makeTriageItem('OD-2', {
          priority: 'critical',
          registryEntry: makeRegistryEntry({ expires: '2025-03-01' }),
        }),
        makeTriageItem('IM-1', {
          priority: 'high',
          registryEntry: makeRegistryEntry({ expires: '2025-06-25' }),
        }),
        makeTriageItem('OPEN-1', {
          registryEntry: makeRegistryEntry(),
        }),
      ];

      const queue = buildTriageQueue({
        triageResult: makeTriageResult(items),
        now,
      });

      assert.equal(queue.byUrgency.overdue, 2);
      assert.equal(queue.byUrgency.imminent, 1);
      assert.equal(queue.byUrgency.upcoming, 0);
      assert.equal(queue.byUrgency.open, 1);
    });
  });
});
