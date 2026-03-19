import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriAnnotation, Registry } from '../src/core/types.ts';
import {
  removeAnnotation,
  planResolve,
  applyResolveToFile,
  formatResolvePreview,
  checkScanFreshness,
  planBulkResolve,
  formatBulkResolvePreview,
} from '../src/commands/resolve.ts';

// ── removeAnnotation ─────────────────────────────────────────

describe('removeAnnotation', () => {
  it('Case 1: removes -- shiori: REF suffix from lint disable', () => {
    const line = '// eslint-disable-next-line no-console -- shiori: SUP-1234';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, '// eslint-disable-next-line no-console');
  });

  it('Case 1: removes -- shiori: REF with key=value pairs', () => {
    const line =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234 expires=2026-06 reason=workaround';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, '// eslint-disable-next-line no-console');
  });

  it('Case 2: standalone line comment returns null', () => {
    const line = '// shiori: SUP-1234';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, null);
  });

  it('Case 2: standalone line comment with key=value returns null', () => {
    const line = '// shiori: SUP-1234 reason=workaround';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, null);
  });

  it('Case 2: standalone line comment with leading whitespace returns null', () => {
    const line = '  // shiori: SUP-1234';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, null);
  });

  it('Case 3: block comment with only shiori returns null', () => {
    const line = '/* shiori: SUP-1234 */';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, null);
  });

  it('Case 3: block comment removes shiori portion, keeps other content', () => {
    const line = '/* eslint-disable no-console -- shiori: SUP-1234 */';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, '/* eslint-disable no-console */');
  });

  it('Case 4: separator with other text keeps non-shiori text', () => {
    const line =
      '// eslint-disable-next-line no-console -- important note shiori: SUP-1234';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(
      result,
      '// eslint-disable-next-line no-console -- important note',
    );
  });

  it('Case 5: multiple shiori annotations, removes only target ref', () => {
    const line =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234 shiori: SUP-5678';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.notEqual(result, null);
    assert.ok(result!.includes('shiori: SUP-5678'));
    assert.ok(!result!.includes('SUP-1234'));
  });

  it('returns line unchanged if ref not found', () => {
    const line = '// eslint-disable-next-line no-console -- shiori: OTHER-001';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, line);
  });

  it('handles compact form shiori:REF', () => {
    const line = '// shiori:SUP-1234';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, null);
  });

  it('handles ref with colon separator (ADR:0007)', () => {
    const line = '// shiori: ADR:0007';
    const result = removeAnnotation(line, 'ADR:0007');
    assert.equal(result, null);
  });

  // ── Quoted value support (AC-7) ──────────────────────────────

  it('Case 1: removes annotation with double-quoted reason', () => {
    const line =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234 reason="legacy code issue"';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, '// eslint-disable-next-line no-console');
  });

  it('Case 1: removes annotation with single-quoted reason', () => {
    const line =
      "// eslint-disable-next-line no-console -- shiori: SUP-1234 reason='single quoted'";
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, '// eslint-disable-next-line no-console');
  });

  it('Case 1: removes annotation with mixed quoted and unquoted fields', () => {
    const line =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234 expires=2026-06 reason="temporary fix"';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, '// eslint-disable-next-line no-console');
  });

  it('Case 2: standalone line comment with quoted reason returns null', () => {
    const line = '// shiori: SUP-1234 reason="legacy code issue"';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, null);
  });

  it('Case 3: block comment with quoted reason returns null', () => {
    const line = '/* shiori: SUP-1234 reason="legacy code issue" */';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, null);
  });

  it('Case 3: block comment removes shiori with quoted reason, keeps other content', () => {
    const line =
      '/* eslint-disable no-console -- shiori: SUP-1234 reason="temporary fix" */';
    const result = removeAnnotation(line, 'SUP-1234');
    assert.equal(result, '/* eslint-disable no-console */');
  });

  // ── Ref substring collision prevention ────────────────────────

  it('does not match when ref is a prefix of actual ref (SUP-1 vs SUP-12)', () => {
    const line = '// shiori: SUP-12 reason=test';
    const result = removeAnnotation(line, 'SUP-1');
    assert.equal(result, line); // unchanged — SUP-1 should NOT match SUP-12
  });

  it('does not match when ref is a prefix of actual ref in separator form', () => {
    const line =
      '// eslint-disable-next-line no-console -- shiori: SUP-12 reason=test';
    const result = removeAnnotation(line, 'SUP-1');
    assert.equal(result, line); // unchanged
  });

  it('matches exact ref even when similar refs exist nearby', () => {
    const line =
      '// eslint-disable-next-line no-console -- shiori: SUP-1 shiori: SUP-12';
    const result = removeAnnotation(line, 'SUP-1');
    assert.notEqual(result, null);
    assert.ok(!result!.includes('SUP-1 ')); // SUP-1 removed
    assert.ok(result!.includes('SUP-12')); // SUP-12 kept
  });
});

// ── planResolve ──────────────────────────────────────────────

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> = {},
): ShioriAnnotation {
  return {
    ref: 'SUP-1234',
    tagged: true,
    ignored: false,
    location: { file: 'src/foo.ts', line: 10 },
    ...overrides,
  };
}

describe('planResolve', () => {
  it('resolves single annotation in one file', () => {
    const fileContent =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234\nconsole.log("hi");';
    const annotations = [
      makeAnnotation({
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 1 },
      }),
    ];
    const registry: Registry = {
      'SUP-1234': {
        reason: 'test',
        target: 'src/foo.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = planResolve({
      ref: 'SUP-1234',
      annotations,
      registry,
      fileContents: new Map([['src/foo.ts', fileContent]]),
    });

    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]!.type, 'remove-annotation');
    assert.equal(
      result.actions[0]!.modifiedLine,
      '// eslint-disable-next-line no-console',
    );
    assert.deepEqual(result.registryRemovals, ['SUP-1234']);
    assert.equal(result.filesAffected, 1);
  });

  it('resolves annotations across multiple files', () => {
    const fileA =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234\nconsole.log("a");';
    const fileB = 'code\n// shiori: SUP-1234\nmore code';
    const annotations = [
      makeAnnotation({
        rule: 'no-console',
        location: { file: 'src/a.ts', line: 1 },
      }),
      makeAnnotation({
        location: { file: 'src/b.ts', line: 2 },
      }),
    ];

    const result = planResolve({
      ref: 'SUP-1234',
      annotations,
      registry: {},
      fileContents: new Map([
        ['src/a.ts', fileA],
        ['src/b.ts', fileB],
      ]),
    });

    assert.equal(result.actions.length, 2);
    assert.equal(result.filesAffected, 2);
  });

  it('removes entire line with --remove-directive for lint disable', () => {
    const fileContent =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234\nconsole.log("hi");';
    const annotations = [
      makeAnnotation({
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 1 },
      }),
    ];

    const result = planResolve({
      ref: 'SUP-1234',
      annotations,
      registry: {},
      fileContents: new Map([['src/foo.ts', fileContent]]),
      removeDirective: true,
    });

    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]!.type, 'remove-line');
    assert.equal(result.actions[0]!.modifiedLine, null);
  });

  it('generates registry removal when ref exists in registry', () => {
    const registry: Registry = {
      'SUP-1234': {
        reason: 'test',
        target: 'src/foo.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = planResolve({
      ref: 'SUP-1234',
      annotations: [],
      registry,
      fileContents: new Map(),
    });

    assert.equal(result.actions.length, 0);
    assert.deepEqual(result.registryRemovals, ['SUP-1234']);
    assert.equal(result.filesAffected, 0);
  });

  it('returns empty result when ref not found anywhere', () => {
    const result = planResolve({
      ref: 'NONEXISTENT-999',
      annotations: [],
      registry: {},
      fileContents: new Map(),
    });

    assert.equal(result.actions.length, 0);
    assert.equal(result.registryRemovals.length, 0);
    assert.equal(result.filesAffected, 0);
  });

  it('skips annotation when line content does not match ref (stale scan)', () => {
    // Simulate: scan result says line 1 has SUP-1234, but file has changed
    const fileContent = 'const x = 42;\nconsole.log("hi");';
    const annotations = [
      makeAnnotation({
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 1 },
      }),
    ];

    const result = planResolve({
      ref: 'SUP-1234',
      annotations,
      registry: {},
      fileContents: new Map([['src/foo.ts', fileContent]]),
    });

    assert.equal(result.actions.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]!.file, 'src/foo.ts');
    assert.equal(result.skipped[0]!.line, 1);
    assert.ok(result.skipped[0]!.reason.includes('does not match'));
  });

  it('skips annotation when line number exceeds file length (stale scan)', () => {
    const fileContent = 'only one line';
    const annotations = [
      makeAnnotation({
        location: { file: 'src/foo.ts', line: 100 },
      }),
    ];

    const result = planResolve({
      ref: 'SUP-1234',
      annotations,
      registry: {},
      fileContents: new Map([['src/foo.ts', fileContent]]),
    });

    assert.equal(result.actions.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0]!.reason.includes('out of range'));
  });

  it('skips annotation when line has shiori: but different ref', () => {
    const fileContent =
      '// eslint-disable-next-line no-console -- shiori: OTHER-999\nconsole.log("hi");';
    const annotations = [
      makeAnnotation({
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 1 },
      }),
    ];

    const result = planResolve({
      ref: 'SUP-1234',
      annotations,
      registry: {},
      fileContents: new Map([['src/foo.ts', fileContent]]),
    });

    assert.equal(result.actions.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0]!.reason.includes('does not match'));
  });

  it('registry-only resolve (no source locations)', () => {
    const registry: Registry = {
      'SUP-1234': {
        reason: 'test',
        target: 'src/foo.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = planResolve({
      ref: 'SUP-1234',
      annotations: [],
      registry,
      fileContents: new Map(),
    });

    assert.equal(result.actions.length, 0);
    assert.deepEqual(result.registryRemovals, ['SUP-1234']);
  });

  it('skips when ref is a prefix of actual ref in line (SUP-1 vs SUP-12)', () => {
    const fileContent =
      '// eslint-disable-next-line no-console -- shiori: SUP-12\nconsole.log("hi");';
    const annotations = [
      makeAnnotation({
        ref: 'SUP-1',
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 1 },
      }),
    ];

    const result = planResolve({
      ref: 'SUP-1',
      annotations,
      registry: {},
      fileContents: new Map([['src/foo.ts', fileContent]]),
    });

    assert.equal(result.actions.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0]!.reason.includes('does not match'));
  });
});

// ── applyResolveToFile ───────────────────────────────────────

describe('applyResolveToFile', () => {
  it('removes annotation portion from line', () => {
    const content =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234\nconsole.log("hi");';
    const result = applyResolveToFile(content, [
      {
        ref: 'SUP-1234',
        file: 'test.ts',
        line: 1,
        type: 'remove-annotation',
        originalLine:
          '// eslint-disable-next-line no-console -- shiori: SUP-1234',
        modifiedLine: '// eslint-disable-next-line no-console',
      },
    ]);

    assert.equal(
      result.content,
      '// eslint-disable-next-line no-console\nconsole.log("hi");',
    );
    assert.equal(result.modifiedLines, 1);
  });

  it('removes entire line', () => {
    const content = 'line1\n// shiori: SUP-1234\nline3';
    const result = applyResolveToFile(content, [
      {
        ref: 'SUP-1234',
        file: 'test.ts',
        line: 2,
        type: 'remove-line',
        originalLine: '// shiori: SUP-1234',
        modifiedLine: null,
      },
    ]);

    assert.equal(result.content, 'line1\nline3');
    assert.equal(result.modifiedLines, 1);
  });

  it('handles mixed remove-annotation and remove-line', () => {
    const content =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234\nconsole.log("hi");\n// shiori: SUP-1234\nother code';
    const result = applyResolveToFile(content, [
      {
        ref: 'SUP-1234',
        file: 'test.ts',
        line: 1,
        type: 'remove-annotation',
        originalLine:
          '// eslint-disable-next-line no-console -- shiori: SUP-1234',
        modifiedLine: '// eslint-disable-next-line no-console',
      },
      {
        ref: 'SUP-1234',
        file: 'test.ts',
        line: 3,
        type: 'remove-line',
        originalLine: '// shiori: SUP-1234',
        modifiedLine: null,
      },
    ]);

    assert.equal(
      result.content,
      '// eslint-disable-next-line no-console\nconsole.log("hi");\nother code',
    );
    assert.equal(result.modifiedLines, 2);
  });

  it('warns on out-of-range line number', () => {
    const content = 'only one line';
    const result = applyResolveToFile(content, [
      {
        ref: 'SUP-1234',
        file: 'test.ts',
        line: 100,
        type: 'remove-line',
        originalLine: '',
        modifiedLine: null,
      },
    ]);

    assert.equal(result.content, 'only one line');
    assert.equal(result.modifiedLines, 0);
    assert.equal(result.warnings.length, 1);
  });
});

// ── formatResolvePreview ─────────────────────────────────────

describe('formatResolvePreview', () => {
  it('shows "no annotations" for empty result', () => {
    const output = formatResolvePreview(
      { actions: [], registryRemovals: [], filesAffected: 0, skipped: [] },
      'SUP-1234',
    );
    assert.ok(output.includes('No annotations or registry entries found'));
  });

  it('shows source changes and registry removals', () => {
    const output = formatResolvePreview(
      {
        actions: [
          {
            ref: 'SUP-1234',
            file: 'src/foo.ts',
            line: 10,
            type: 'remove-annotation',
            originalLine:
              '// eslint-disable-next-line no-console -- shiori: SUP-1234',
            modifiedLine: '// eslint-disable-next-line no-console',
          },
        ],
        registryRemovals: ['SUP-1234'],
        filesAffected: 1,
        skipped: [],
      },
      'SUP-1234',
    );

    assert.ok(output.includes('Resolving ref "SUP-1234"'));
    assert.ok(output.includes('Source changes (1 file(s))'));
    assert.ok(output.includes('src/foo.ts:10'));
    assert.ok(output.includes('Remove entry "SUP-1234"'));
    assert.ok(output.includes('Run with --apply to execute'));
  });

  it('shows remove-line actions correctly', () => {
    const output = formatResolvePreview(
      {
        actions: [
          {
            ref: 'SUP-1234',
            file: 'src/bar.ts',
            line: 25,
            type: 'remove-line',
            originalLine: '// shiori: SUP-1234 reason=workaround',
            modifiedLine: null,
          },
        ],
        registryRemovals: [],
        filesAffected: 1,
        skipped: [],
      },
      'SUP-1234',
    );

    assert.ok(output.includes('remove entire line'));
    assert.ok(output.includes('shiori: SUP-1234 reason=workaround'));
  });

  it('shows skipped annotations in preview', () => {
    const output = formatResolvePreview(
      {
        actions: [],
        registryRemovals: ['SUP-1234'],
        filesAffected: 0,
        skipped: [
          {
            file: 'src/foo.ts',
            line: 10,
            reason:
              'line content does not match scan result (file may have changed since last scan)',
          },
        ],
      },
      'SUP-1234',
    );

    assert.ok(output.includes('Skipped 1 annotation(s)'));
    assert.ok(output.includes('src/foo.ts:10'));
    assert.ok(output.includes('stale scan result'));
    assert.ok(output.includes('shiori scan'));
  });
});

// ── insertAnnotation/removeAnnotation roundtrip ──────────────

describe('insertAnnotation/removeAnnotation roundtrip', () => {
  // Architect recommended roundtrip tests to verify insert/remove symmetry
  it('roundtrips for lint disable line', async () => {
    const { insertAnnotation } = await import('../src/commands/migrate.ts');
    const original = '// eslint-disable-next-line no-console';
    const inserted = insertAnnotation(original, 'SUP-1234');
    const restored = removeAnnotation(inserted, 'SUP-1234');
    assert.equal(restored, original);
  });

  it('roundtrips for block comment lint disable', async () => {
    const { insertAnnotation } = await import('../src/commands/migrate.ts');
    const original = '/* eslint-disable no-console */';
    const inserted = insertAnnotation(original, 'SUP-1234');
    const restored = removeAnnotation(inserted, 'SUP-1234');
    assert.equal(restored, original);
  });

  it('roundtrips for stylelint disable-next-line', async () => {
    const { insertAnnotation } = await import('../src/commands/migrate.ts');
    const original = '/* stylelint-disable-next-line color-no-hex */';
    const inserted = insertAnnotation(original, 'SUP-1234');
    const restored = removeAnnotation(inserted, 'SUP-1234');
    assert.equal(restored, original);
  });

  it('roundtrips for stylelint disable (block)', async () => {
    const { insertAnnotation } = await import('../src/commands/migrate.ts');
    const original = '/* stylelint-disable declaration-no-important */';
    const inserted = insertAnnotation(original, 'DEBT-042');
    const restored = removeAnnotation(inserted, 'DEBT-042');
    assert.equal(restored, original);
  });

  it('roundtrips for @ts-ignore comment', async () => {
    const { insertAnnotation } = await import('../src/commands/migrate.ts');
    const original = '// @ts-ignore';
    const inserted = insertAnnotation(original, 'DEV-099');
    const restored = removeAnnotation(inserted, 'DEV-099');
    assert.equal(restored, original);
  });
});

// ── checkScanFreshness ──────────────────────────────────────

describe('checkScanFreshness', () => {
  it('reports fresh when all source files are older than scan result', () => {
    const scanMtime = 2000;
    const sourceFiles = new Map([
      ['src/a.ts', 1000],
      ['src/b.ts', 1500],
    ]);

    const result = checkScanFreshness(scanMtime, sourceFiles);
    assert.equal(result.fresh, true);
    assert.equal(result.staleFiles.length, 0);
  });

  it('reports stale when a source file is newer than scan result', () => {
    const scanMtime = 1000;
    const sourceFiles = new Map([
      ['src/a.ts', 500],
      ['src/b.ts', 2000],
    ]);

    const result = checkScanFreshness(scanMtime, sourceFiles);
    assert.equal(result.fresh, false);
    assert.deepEqual(result.staleFiles, ['src/b.ts']);
  });

  it('reports stale for all newer files', () => {
    const scanMtime = 1000;
    const sourceFiles = new Map([
      ['src/a.ts', 2000],
      ['src/b.ts', 3000],
      ['src/c.ts', 500],
    ]);

    const result = checkScanFreshness(scanMtime, sourceFiles);
    assert.equal(result.fresh, false);
    assert.equal(result.staleFiles.length, 2);
    assert.ok(result.staleFiles.includes('src/a.ts'));
    assert.ok(result.staleFiles.includes('src/b.ts'));
  });

  it('reports fresh for empty source file map', () => {
    const result = checkScanFreshness(1000, new Map());
    assert.equal(result.fresh, true);
    assert.equal(result.staleFiles.length, 0);
  });

  it('reports fresh when source file mtime equals scan result mtime', () => {
    const scanMtime = 1000;
    const sourceFiles = new Map([['src/a.ts', 1000]]);

    const result = checkScanFreshness(scanMtime, sourceFiles);
    assert.equal(result.fresh, true);
    assert.equal(result.staleFiles.length, 0);
  });
});

// ── planBulkResolve ─────────────────────────────────────────

describe('planBulkResolve', () => {
  it('resolves multiple refs across files', () => {
    const fileA =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234\nconsole.log("a");';
    const fileB =
      'code\n// eslint-disable-next-line no-eval -- shiori: SUP-5678\neval("x");';
    const annotations = [
      makeAnnotation({
        ref: 'SUP-1234',
        rule: 'no-console',
        location: { file: 'src/a.ts', line: 1 },
      }),
      makeAnnotation({
        ref: 'SUP-5678',
        rule: 'no-eval',
        location: { file: 'src/b.ts', line: 2 },
      }),
    ];
    const registry: Registry = {
      'SUP-1234': {
        reason: 'test',
        target: 'src/a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'SUP-5678': {
        reason: 'eval workaround',
        target: 'src/b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = planBulkResolve(['SUP-1234', 'SUP-5678'], {
      annotations,
      registry,
      fileContents: new Map([
        ['src/a.ts', fileA],
        ['src/b.ts', fileB],
      ]),
    });

    assert.equal(result.perRef.length, 2);
    assert.equal(result.allActions.length, 2);
    assert.equal(result.totalFilesAffected, 2);
    assert.deepEqual(result.allRegistryRemovals.sort(), [
      'SUP-1234',
      'SUP-5678',
    ]);
  });

  it('merges actions from multiple refs in the same file', () => {
    // Two different refs annotated on different lines of the same file
    const fileContent =
      '// eslint-disable-next-line no-console -- shiori: SUP-1234\nconsole.log("a");\n// eslint-disable-next-line no-eval -- shiori: SUP-5678\neval("x");';
    const annotations = [
      makeAnnotation({
        ref: 'SUP-1234',
        rule: 'no-console',
        location: { file: 'src/shared.ts', line: 1 },
      }),
      makeAnnotation({
        ref: 'SUP-5678',
        rule: 'no-eval',
        location: { file: 'src/shared.ts', line: 3 },
      }),
    ];

    const result = planBulkResolve(['SUP-1234', 'SUP-5678'], {
      annotations,
      registry: {},
      fileContents: new Map([['src/shared.ts', fileContent]]),
    });

    assert.equal(result.allActions.length, 2);
    assert.equal(result.totalFilesAffected, 1);
    // Both actions target the same file
    assert.equal(result.allActions[0]!.file, 'src/shared.ts');
    assert.equal(result.allActions[1]!.file, 'src/shared.ts');
  });

  it('deduplicates registry removals across refs', () => {
    // Edge case: same ref appears in multiple "refs" list (shouldn't happen but be safe)
    const registry: Registry = {
      'SUP-1234': {
        reason: 'test',
        target: 'src/foo.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };

    const result = planBulkResolve(['SUP-1234', 'SUP-1234'], {
      annotations: [],
      registry,
      fileContents: new Map(),
    });

    // Registry removals should be deduplicated
    assert.deepEqual(result.allRegistryRemovals, ['SUP-1234']);
  });

  it('returns empty result for no refs', () => {
    const result = planBulkResolve([], {
      annotations: [],
      registry: {},
      fileContents: new Map(),
    });

    assert.equal(result.perRef.length, 0);
    assert.equal(result.allActions.length, 0);
    assert.equal(result.allRegistryRemovals.length, 0);
    assert.equal(result.totalFilesAffected, 0);
    assert.equal(result.allSkipped.length, 0);
  });

  it('aggregates skipped annotations across refs', () => {
    const fileContent = 'const x = 42;'; // No shiori annotations
    const annotations = [
      makeAnnotation({
        ref: 'SUP-1234',
        location: { file: 'src/foo.ts', line: 1 },
      }),
      makeAnnotation({
        ref: 'SUP-5678',
        location: { file: 'src/foo.ts', line: 1 },
      }),
    ];

    const result = planBulkResolve(['SUP-1234', 'SUP-5678'], {
      annotations,
      registry: {},
      fileContents: new Map([['src/foo.ts', fileContent]]),
    });

    assert.equal(result.allActions.length, 0);
    assert.equal(result.allSkipped.length, 2);
  });

  it('allActions can be safely applied via applyResolveToFile for same-file multi-ref', () => {
    // Reviewer's blocking concern: line offset issues when multiple refs in same file
    // allActions + groupResolveActionsByFile + applyResolveToFile (desc sort) handles this
    const fileContent = [
      '// eslint-disable-next-line no-console -- shiori: SUP-1234',
      'console.log("a");',
      '// eslint-disable-next-line no-eval -- shiori: SUP-5678',
      'eval("x");',
    ].join('\n');
    const annotations = [
      makeAnnotation({
        ref: 'SUP-1234',
        rule: 'no-console',
        location: { file: 'src/shared.ts', line: 1 },
      }),
      makeAnnotation({
        ref: 'SUP-5678',
        rule: 'no-eval',
        location: { file: 'src/shared.ts', line: 3 },
      }),
    ];

    const bulkResult = planBulkResolve(['SUP-1234', 'SUP-5678'], {
      annotations,
      registry: {},
      fileContents: new Map([['src/shared.ts', fileContent]]),
      removeDirective: true,
    });

    // Apply the merged allActions to the file
    const editResult = applyResolveToFile(fileContent, bulkResult.allActions);

    // Both lint disable lines should be removed, code lines preserved
    const expectedContent = ['console.log("a");', 'eval("x");'].join('\n');
    assert.equal(editResult.content, expectedContent);
    assert.equal(editResult.modifiedLines, 2);
    assert.equal(editResult.warnings.length, 0);
  });
});

// ── formatBulkResolvePreview ─────────────────────────────────

describe('formatBulkResolvePreview', () => {
  it('shows "no closed refs" for empty result', () => {
    const output = formatBulkResolvePreview({
      perRef: [],
      allActions: [],
      allRegistryRemovals: [],
      totalFilesAffected: 0,
      allSkipped: [],
    });
    assert.ok(
      output.includes(
        'No closed refs with annotations or registry entries found.',
      ),
    );
  });

  it('shows per-ref summary and aggregated changes', () => {
    const output = formatBulkResolvePreview({
      perRef: [
        {
          ref: 'SUP-1234',
          result: {
            actions: [
              {
                ref: 'SUP-1234',
                file: 'src/a.ts',
                line: 1,
                type: 'remove-annotation',
                originalLine:
                  '// eslint-disable-next-line no-console -- shiori: SUP-1234',
                modifiedLine: '// eslint-disable-next-line no-console',
              },
            ],
            registryRemovals: ['SUP-1234'],
            filesAffected: 1,
            skipped: [],
          },
        },
        {
          ref: 'SUP-5678',
          result: {
            actions: [
              {
                ref: 'SUP-5678',
                file: 'src/b.ts',
                line: 5,
                type: 'remove-line',
                originalLine: '// shiori: SUP-5678',
                modifiedLine: null,
              },
            ],
            registryRemovals: ['SUP-5678'],
            filesAffected: 1,
            skipped: [],
          },
        },
      ],
      allActions: [
        {
          ref: 'SUP-1234',
          file: 'src/a.ts',
          line: 1,
          type: 'remove-annotation',
          originalLine:
            '// eslint-disable-next-line no-console -- shiori: SUP-1234',
          modifiedLine: '// eslint-disable-next-line no-console',
        },
        {
          ref: 'SUP-5678',
          file: 'src/b.ts',
          line: 5,
          type: 'remove-line',
          originalLine: '// shiori: SUP-5678',
          modifiedLine: null,
        },
      ],
      allRegistryRemovals: ['SUP-1234', 'SUP-5678'],
      totalFilesAffected: 2,
      allSkipped: [],
    });

    assert.ok(output.includes('Found 2 closed ref(s) to resolve:'));
    assert.ok(output.includes('SUP-1234: 1 source change(s)'));
    assert.ok(output.includes('SUP-5678: 1 source change(s)'));
    assert.ok(output.includes('Source changes (2 file(s), 2 action(s))'));
    assert.ok(output.includes('[SUP-1234] remove shiori annotation'));
    assert.ok(output.includes('[SUP-5678] remove entire line'));
    assert.ok(output.includes('Remove entry "SUP-1234"'));
    assert.ok(output.includes('Remove entry "SUP-5678"'));
    assert.ok(output.includes('Run with --apply to execute'));
  });

  it('shows skipped annotations', () => {
    const output = formatBulkResolvePreview({
      perRef: [
        {
          ref: 'SUP-1234',
          result: {
            actions: [],
            registryRemovals: ['SUP-1234'],
            filesAffected: 0,
            skipped: [
              {
                file: 'src/foo.ts',
                line: 10,
                reason: 'line content does not match scan result',
              },
            ],
          },
        },
      ],
      allActions: [],
      allRegistryRemovals: ['SUP-1234'],
      totalFilesAffected: 0,
      allSkipped: [
        {
          file: 'src/foo.ts',
          line: 10,
          reason: 'line content does not match scan result',
        },
      ],
    });

    assert.ok(output.includes('Skipped 1 annotation(s)'));
    assert.ok(output.includes('src/foo.ts:10'));
  });
});
