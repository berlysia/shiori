import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriAnnotation, Registry } from '../src/core/types.ts';
import {
  removeAnnotation,
  planResolve,
  applyResolveToFile,
  formatResolvePreview,
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
      { actions: [], registryRemovals: [], filesAffected: 0 },
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
      },
      'SUP-1234',
    );

    assert.ok(output.includes('remove entire line'));
    assert.ok(output.includes('shiori: SUP-1234 reason=workaround'));
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
