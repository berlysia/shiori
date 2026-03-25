import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  ShioriAnnotation,
  DeltaResult,
} from '../src/core/types.ts';
import {
  computeDelta,
  filterDelta,
  formatDeltaAsJson,
} from '../src/commands/delta.ts';

function makeAnnotation(
  ref: string,
  file = 'test.ts',
  line = 1,
): ShioriAnnotation {
  return {
    ref,
    tagged: true,
    ignored: false,
    location: { file, line },
  };
}

function makeScanResult(annotations: ShioriAnnotation[]): ScanResult {
  return {
    annotations,
    candidates: [],
    filesScanned: 1,
  };
}

describe('computeDelta', () => {
  it('detects added annotations', () => {
    const base = makeScanResult([]);
    const head = makeScanResult([makeAnnotation('NEW-001')]);

    const result = computeDelta({ base, head });

    assert.equal(result.deltas.length, 1);
    assert.equal(result.deltas[0]!.kind, 'added');
    assert.equal(result.deltas[0]!.ref, 'NEW-001');
    assert.ok(result.deltas[0]!.head);
    assert.equal(result.deltas[0]!.base, undefined);
    assert.equal(result.summary.added, 1);
    assert.equal(result.summary.removed, 0);
    assert.equal(result.summary.unchanged, 0);
    assert.equal(result.summary.net, 1);
  });

  it('detects removed annotations', () => {
    const base = makeScanResult([makeAnnotation('OLD-001')]);
    const head = makeScanResult([]);

    const result = computeDelta({ base, head });

    assert.equal(result.deltas.length, 1);
    assert.equal(result.deltas[0]!.kind, 'removed');
    assert.equal(result.deltas[0]!.ref, 'OLD-001');
    assert.ok(result.deltas[0]!.base);
    assert.equal(result.deltas[0]!.head, undefined);
    assert.equal(result.summary.added, 0);
    assert.equal(result.summary.removed, 1);
    assert.equal(result.summary.net, -1);
  });

  it('detects unchanged annotations', () => {
    const base = makeScanResult([makeAnnotation('SAME-001')]);
    const head = makeScanResult([makeAnnotation('SAME-001')]);

    const result = computeDelta({ base, head });

    assert.equal(result.deltas.length, 1);
    assert.equal(result.deltas[0]!.kind, 'unchanged');
    assert.equal(result.deltas[0]!.ref, 'SAME-001');
    assert.ok(result.deltas[0]!.base);
    assert.ok(result.deltas[0]!.head);
    assert.equal(result.summary.unchanged, 1);
    assert.equal(result.summary.net, 0);
  });

  it('handles mixed changes', () => {
    const base = makeScanResult([
      makeAnnotation('KEEP-001'),
      makeAnnotation('REMOVE-001'),
    ]);
    const head = makeScanResult([
      makeAnnotation('KEEP-001'),
      makeAnnotation('ADD-001'),
    ]);

    const result = computeDelta({ base, head });

    assert.equal(result.summary.added, 1);
    assert.equal(result.summary.removed, 1);
    assert.equal(result.summary.unchanged, 1);
    assert.equal(result.summary.net, 0);

    const added = result.deltas.find(
      (d) => d.kind === 'added' && d.ref === 'ADD-001',
    );
    assert.ok(added, 'should have ADD-001 as added');

    const removed = result.deltas.find(
      (d) => d.kind === 'removed' && d.ref === 'REMOVE-001',
    );
    assert.ok(removed, 'should have REMOVE-001 as removed');

    const unchanged = result.deltas.find(
      (d) => d.kind === 'unchanged' && d.ref === 'KEEP-001',
    );
    assert.ok(unchanged, 'should have KEEP-001 as unchanged');
  });

  it('excludes draft annotations (empty ref)', () => {
    const base = makeScanResult([
      makeAnnotation(''),
      makeAnnotation('REF-001'),
    ]);
    const head = makeScanResult([
      makeAnnotation(''),
      makeAnnotation('REF-001'),
    ]);

    const result = computeDelta({ base, head });

    // Only REF-001 should be in the delta
    assert.equal(result.deltas.length, 1);
    assert.equal(result.deltas[0]!.ref, 'REF-001');
    assert.equal(result.deltas[0]!.kind, 'unchanged');
  });

  it('handles multiple annotations with the same ref', () => {
    const base = makeScanResult([makeAnnotation('DUP-001', 'a.ts', 1)]);
    const head = makeScanResult([
      makeAnnotation('DUP-001', 'a.ts', 1),
      makeAnnotation('DUP-001', 'b.ts', 5),
    ]);

    const result = computeDelta({ base, head });

    // 1 unchanged (paired) + 1 added (extra in head)
    assert.equal(result.summary.unchanged, 1);
    assert.equal(result.summary.added, 1);
    assert.equal(result.summary.net, 1);
  });

  it('handles both scans empty', () => {
    const base = makeScanResult([]);
    const head = makeScanResult([]);

    const result = computeDelta({ base, head });

    assert.equal(result.deltas.length, 0);
    assert.equal(result.summary.added, 0);
    assert.equal(result.summary.removed, 0);
    assert.equal(result.summary.unchanged, 0);
    assert.equal(result.summary.net, 0);
  });

  it('sorts deltas: added first, then removed, then unchanged', () => {
    const base = makeScanResult([
      makeAnnotation('B-REMOVE'),
      makeAnnotation('C-KEEP'),
    ]);
    const head = makeScanResult([
      makeAnnotation('A-NEW'),
      makeAnnotation('C-KEEP'),
    ]);

    const result = computeDelta({ base, head });

    assert.equal(result.deltas[0]!.kind, 'added');
    assert.equal(result.deltas[1]!.kind, 'removed');
    assert.equal(result.deltas[2]!.kind, 'unchanged');
  });
});

describe('filterDelta', () => {
  it('filters to added-only', () => {
    const base = makeScanResult([
      makeAnnotation('KEEP-001'),
      makeAnnotation('REMOVE-001'),
    ]);
    const head = makeScanResult([
      makeAnnotation('KEEP-001'),
      makeAnnotation('ADD-001'),
    ]);

    const full = computeDelta({ base, head });
    const filtered = filterDelta(full, ['added']);

    assert.equal(filtered.deltas.length, 1);
    assert.equal(filtered.deltas[0]!.kind, 'added');
    assert.equal(filtered.deltas[0]!.ref, 'ADD-001');
    assert.equal(filtered.summary.added, 1);
    assert.equal(filtered.summary.removed, 0);
    assert.equal(filtered.summary.unchanged, 0);
    assert.equal(filtered.summary.net, 1);
  });

  it('filters to multiple kinds', () => {
    const base = makeScanResult([
      makeAnnotation('KEEP-001'),
      makeAnnotation('REMOVE-001'),
    ]);
    const head = makeScanResult([
      makeAnnotation('KEEP-001'),
      makeAnnotation('ADD-001'),
    ]);

    const full = computeDelta({ base, head });
    const filtered = filterDelta(full, ['added', 'removed']);

    assert.equal(filtered.deltas.length, 2);
    assert.ok(filtered.deltas.some((d) => d.kind === 'added'));
    assert.ok(filtered.deltas.some((d) => d.kind === 'removed'));
    assert.equal(filtered.summary.unchanged, 0);
  });

  it('returns empty result when no deltas match', () => {
    const base = makeScanResult([makeAnnotation('KEEP-001')]);
    const head = makeScanResult([makeAnnotation('KEEP-001')]);

    const full = computeDelta({ base, head });
    const filtered = filterDelta(full, ['added']);

    assert.equal(filtered.deltas.length, 0);
    assert.equal(filtered.summary.added, 0);
    assert.equal(filtered.summary.net, 0);
  });
});

describe('formatDeltaAsJson', () => {
  it('returns valid JSON', () => {
    const result: DeltaResult = {
      deltas: [
        {
          kind: 'added',
          ref: 'TEST-001',
          head: makeAnnotation('TEST-001'),
        },
      ],
      summary: { added: 1, removed: 0, unchanged: 0, net: 1 },
    };

    const json = formatDeltaAsJson(result);
    const envelope = JSON.parse(json);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'delta');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data;

    assert.equal(parsed.deltas.length, 1);
    assert.equal(parsed.deltas[0].kind, 'added');
    assert.equal(parsed.summary.net, 1);
  });
});
