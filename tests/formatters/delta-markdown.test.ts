import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriAnnotation } from '../../src/core/types.ts';
import type { DeltaResult, AnnotationDelta } from '../../src/core/types.ts';
import { formatDeltaAsMarkdown } from '../../src/formatters/delta-markdown.ts';

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

function makeDeltaResult(
  deltas: AnnotationDelta[],
  summary?: Partial<DeltaResult['summary']>,
): DeltaResult {
  const added = deltas.filter((d) => d.kind === 'added').length;
  const removed = deltas.filter((d) => d.kind === 'removed').length;
  const unchanged = deltas.filter((d) => d.kind === 'unchanged').length;
  return {
    deltas,
    summary: {
      added,
      removed,
      unchanged,
      net: added - removed,
      ...summary,
    },
  };
}

describe('formatDeltaAsMarkdown', () => {
  it('renders report header and summary table', () => {
    const result = makeDeltaResult([]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(md.includes('# Annotation Delta Report'));
    assert.ok(md.includes('## Summary'));
    assert.ok(md.includes('| Metric | Count |'));
    assert.ok(md.includes('| Added | 0 |'));
    assert.ok(md.includes('| Removed | 0 |'));
    assert.ok(md.includes('| Unchanged | 0 |'));
    assert.ok(md.includes('| **Net** | **+0** |'));
  });

  it('renders Added section with table', () => {
    const result = makeDeltaResult([
      {
        kind: 'added',
        ref: 'NEW-001',
        head: makeAnnotation('NEW-001', 'src/a.ts', 10),
      },
      {
        kind: 'added',
        ref: 'NEW-002',
        head: makeAnnotation('NEW-002', 'src/b.ts', 20),
      },
    ]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(md.includes('## Added'));
    assert.ok(md.includes('| NEW-001 | src/a.ts | 10 |'));
    assert.ok(md.includes('| NEW-002 | src/b.ts | 20 |'));
  });

  it('renders Removed section with table', () => {
    const result = makeDeltaResult([
      {
        kind: 'removed',
        ref: 'OLD-001',
        base: makeAnnotation('OLD-001', 'src/c.ts', 5),
      },
    ]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(md.includes('## Removed'));
    assert.ok(md.includes('| OLD-001 | src/c.ts | 5 |'));
  });

  it('collapses unchanged into details element', () => {
    const result = makeDeltaResult([
      {
        kind: 'unchanged',
        ref: 'KEEP-001',
        base: makeAnnotation('KEEP-001'),
        head: makeAnnotation('KEEP-001'),
      },
      {
        kind: 'unchanged',
        ref: 'KEEP-002',
        base: makeAnnotation('KEEP-002'),
        head: makeAnnotation('KEEP-002'),
      },
    ]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(
      md.includes('<details><summary>2 unchanged annotation(s)</summary>'),
    );
    assert.ok(md.includes('</details>'));
    assert.ok(md.includes('| KEEP-001 |'));
    assert.ok(md.includes('| KEEP-002 |'));
    // Should NOT have a separate ## Unchanged heading
    assert.ok(!md.includes('## Unchanged'));
  });

  it('omits sections when no deltas of that kind exist', () => {
    const result = makeDeltaResult([
      { kind: 'added', ref: 'NEW-001', head: makeAnnotation('NEW-001') },
    ]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(md.includes('## Added'));
    assert.ok(!md.includes('## Removed'));
    assert.ok(!md.includes('<details>'));
  });

  it('renders gate passed footer', () => {
    const result = makeDeltaResult([
      { kind: 'added', ref: 'NEW-001', head: makeAnnotation('NEW-001') },
    ]);
    const md = formatDeltaAsMarkdown(result, { maxIncrease: 5 });

    assert.ok(md.includes('✅ **Gate passed**'));
    assert.ok(md.includes('within allowed threshold (5)'));
  });

  it('renders gate failed footer', () => {
    const result = makeDeltaResult([
      { kind: 'added', ref: 'NEW-001', head: makeAnnotation('NEW-001') },
      { kind: 'added', ref: 'NEW-002', head: makeAnnotation('NEW-002') },
      { kind: 'added', ref: 'NEW-003', head: makeAnnotation('NEW-003') },
    ]);
    const md = formatDeltaAsMarkdown(result, { maxIncrease: 2 });

    assert.ok(md.includes('❌ **Gate failed**'));
    assert.ok(md.includes('exceeds maximum allowed increase (2)'));
  });

  it('omits gate footer when maxIncrease is not provided', () => {
    const result = makeDeltaResult([]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(!md.includes('Gate passed'));
    assert.ok(!md.includes('Gate failed'));
    // No horizontal rule separator for gate footer
    assert.ok(!md.includes('\n---\n'));
  });

  it('formats negative net correctly', () => {
    const result = makeDeltaResult([
      { kind: 'removed', ref: 'OLD-001', base: makeAnnotation('OLD-001') },
      { kind: 'removed', ref: 'OLD-002', base: makeAnnotation('OLD-002') },
    ]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(md.includes('| **Net** | **-2** |'));
  });

  it('handles mixed changes', () => {
    const result = makeDeltaResult([
      {
        kind: 'added',
        ref: 'ADD-001',
        head: makeAnnotation('ADD-001', 'src/new.ts', 1),
      },
      {
        kind: 'removed',
        ref: 'REM-001',
        base: makeAnnotation('REM-001', 'src/old.ts', 2),
      },
      {
        kind: 'unchanged',
        ref: 'KEEP-001',
        base: makeAnnotation('KEEP-001', 'src/keep.ts', 3),
        head: makeAnnotation('KEEP-001', 'src/keep.ts', 3),
      },
    ]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(md.includes('## Added'));
    assert.ok(md.includes('## Removed'));
    assert.ok(md.includes('<details>'));
    assert.ok(md.includes('| Added | 1 |'));
    assert.ok(md.includes('| Removed | 1 |'));
    assert.ok(md.includes('| Unchanged | 1 |'));
    assert.ok(md.includes('| **Net** | **+0** |'));
  });

  it('gate passes at exact threshold boundary', () => {
    const result = makeDeltaResult([
      { kind: 'added', ref: 'NEW-001', head: makeAnnotation('NEW-001') },
      { kind: 'added', ref: 'NEW-002', head: makeAnnotation('NEW-002') },
    ]);
    const md = formatDeltaAsMarkdown(result, { maxIncrease: 2 });

    assert.ok(md.includes('✅ **Gate passed**'));
  });

  it('gate with maxIncrease=0 fails on any addition', () => {
    const result = makeDeltaResult([
      { kind: 'added', ref: 'NEW-001', head: makeAnnotation('NEW-001') },
    ]);
    const md = formatDeltaAsMarkdown(result, { maxIncrease: 0 });

    assert.ok(md.includes('❌ **Gate failed**'));
  });

  it('gate with maxIncrease=0 passes with no changes', () => {
    const result = makeDeltaResult([]);
    const md = formatDeltaAsMarkdown(result, { maxIncrease: 0 });

    assert.ok(md.includes('✅ **Gate passed**'));
  });

  it('uses dash for missing file/line', () => {
    const delta: AnnotationDelta = {
      kind: 'added',
      ref: 'ORPHAN-001',
      // head is undefined — edge case
    };
    const result = makeDeltaResult([delta]);
    const md = formatDeltaAsMarkdown(result);

    assert.ok(md.includes('| ORPHAN-001 | - | - |'));
  });
});
