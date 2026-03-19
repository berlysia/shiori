import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriCandidate, Registry } from '../src/core/types.ts';
import {
  planMigration,
  insertAnnotation,
  applyMigrateToFile,
  groupActionsByFile,
  formatMigratePreview,
} from '../src/commands/migrate.ts';

function makeCandidate(
  overrides: Partial<ShioriCandidate> = {},
): ShioriCandidate {
  return {
    pattern: 'eslint',
    location: { file: 'src/test.ts', line: 10 },
    ...overrides,
  };
}

describe('planMigration', () => {
  it('generates sequential refs with default prefix', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'a.ts', line: 1 },
      }),
      makeCandidate({
        rule: 'no-debugger',
        location: { file: 'b.ts', line: 5 },
      }),
    ];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    assert.equal(result.actions.length, 2);
    assert.equal(result.actions[0]!.ref, 'MIG-001');
    assert.equal(result.actions[1]!.ref, 'MIG-002');
  });

  it('uses custom prefix', () => {
    const candidates = [makeCandidate()];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'DEBT',
    });

    assert.equal(result.actions[0]!.ref, 'DEBT-001');
  });

  it('avoids collisions with existing registry refs', () => {
    const existingRegistry: Registry = {
      'MIG-001': {
        reason: 'existing',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'MIG-003': {
        reason: 'existing',
        target: 'b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const candidates = [makeCandidate()];
    const result = planMigration({
      candidates,
      existingRegistry,
      prefix: 'MIG',
    });

    // Should start after max existing (003 → 004)
    assert.equal(result.actions[0]!.ref, 'MIG-004');
  });

  it('generates registry entries with auto-migrated reason and migration kind', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 42 },
      }),
    ];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    const entry = result.registry['MIG-001'];
    assert.ok(entry);
    assert.equal(entry.reason, 'auto-migrated');
    assert.equal(entry.kind, 'migration');
    assert.equal(entry.target, 'src/foo.ts');
    assert.equal(entry.notes, 'rule: no-console');
  });

  it('generates entry without notes when no rule', () => {
    const candidates = [makeCandidate({ rule: undefined })];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    const entry = result.registry['MIG-001'];
    assert.ok(entry);
    assert.equal(entry.notes, undefined);
  });

  it('returns empty result for empty candidates', () => {
    const result = planMigration({
      candidates: [],
      existingRegistry: {},
      prefix: 'MIG',
    });

    assert.equal(result.actions.length, 0);
    assert.deepEqual(result.registry, {});
  });

  it('uses 4-digit padding for 1000+ candidates', () => {
    const candidates = Array.from({ length: 1001 }, (_, i) =>
      makeCandidate({ location: { file: `f${i}.ts`, line: i } }),
    );
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    assert.equal(result.actions[0]!.ref, 'MIG-0001');
    assert.equal(result.actions[999]!.ref, 'MIG-1000');
    assert.equal(result.actions[1000]!.ref, 'MIG-1001');
  });

  it('merges multiple candidates on the same line into one action', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'src/test.ts', line: 10 },
      }),
      makeCandidate({
        rule: 'no-debugger',
        location: { file: 'src/test.ts', line: 10 },
      }),
    ];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    // Two candidates on the same line should produce one action
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]!.ref, 'MIG-001');
    assert.deepEqual(result.actions[0]!.rules, ['no-console', 'no-debugger']);

    // Registry should have one entry with both rules in notes
    const entry = result.registry['MIG-001'];
    assert.ok(entry);
    assert.equal(entry.notes, 'rules: no-console, no-debugger');
  });

  it('merges same-line candidates but keeps different-line candidates separate', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'a.ts', line: 5 },
      }),
      makeCandidate({
        rule: 'no-debugger',
        location: { file: 'a.ts', line: 5 },
      }),
      makeCandidate({
        rule: 'no-eval',
        location: { file: 'a.ts', line: 20 },
      }),
    ];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    assert.equal(result.actions.length, 2);
    assert.equal(result.actions[0]!.ref, 'MIG-001');
    assert.deepEqual(result.actions[0]!.rules, ['no-console', 'no-debugger']);
    assert.equal(result.actions[1]!.ref, 'MIG-002');
    assert.deepEqual(result.actions[1]!.rules, ['no-eval']);
  });

  it('merges same-line candidates across different files independently', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'a.ts', line: 5 },
      }),
      makeCandidate({
        rule: 'no-console',
        location: { file: 'b.ts', line: 5 },
      }),
    ];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    // Same line number but different files → separate actions
    assert.equal(result.actions.length, 2);
  });

  it('populates rules array for single-rule action', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'a.ts', line: 1 },
      }),
    ];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    assert.deepEqual(result.actions[0]!.rules, ['no-console']);
  });

  it('populates empty rules array when no rule', () => {
    const candidates = [
      makeCandidate({
        rule: undefined,
        location: { file: 'a.ts', line: 1 },
      }),
    ];
    const result = planMigration({
      candidates,
      existingRegistry: {},
      prefix: 'MIG',
    });

    assert.deepEqual(result.actions[0]!.rules, []);
  });
});

describe('insertAnnotation', () => {
  it('adds -- separator for eslint disable-next-line without existing separator', () => {
    const line = '  // eslint-disable-next-line no-console';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(
      result,
      '  // eslint-disable-next-line no-console -- shiori: MIG-001',
    );
  });

  it('appends after existing -- separator', () => {
    const line = '  // eslint-disable-next-line no-console -- existing reason';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(
      result,
      '  // eslint-disable-next-line no-console -- existing reason shiori: MIG-001',
    );
  });

  it('inserts inside block comment for stylelint disable-next-line', () => {
    const line = '  /* stylelint-disable-next-line color-named */';
    const result = insertAnnotation(line, 'MIG-001');
    // Annotation must stay inside the block comment delimiters
    assert.equal(
      result,
      '  /* stylelint-disable-next-line color-named -- shiori: MIG-001 */',
    );
  });

  it('appends after existing separator inside block comment', () => {
    const line = '  /* stylelint-disable-next-line color-named -- reason */';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(
      result,
      '  /* stylelint-disable-next-line color-named -- reason shiori: MIG-001 */',
    );
  });

  it('handles stylelint-disable-line in block comment', () => {
    const line = '  color: red; /* stylelint-disable-line color-named */';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(
      result,
      '  color: red; /* stylelint-disable-line color-named -- shiori: MIG-001 */',
    );
  });

  it('adds shiori: inline for @ts-ignore', () => {
    const line = '  // @ts-ignore';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(result, '  // @ts-ignore shiori: MIG-001');
  });

  it('adds shiori: inline for @ts-expect-error', () => {
    const line = '  // @ts-expect-error some reason';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(result, '  // @ts-expect-error some reason shiori: MIG-001');
  });

  it('trims trailing whitespace', () => {
    const line = '  // eslint-disable-next-line no-console   ';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(
      result,
      '  // eslint-disable-next-line no-console -- shiori: MIG-001',
    );
  });

  it('handles eslint-disable-line', () => {
    const line = 'const x = 1; // eslint-disable-line no-unused-vars';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(
      result,
      'const x = 1; // eslint-disable-line no-unused-vars -- shiori: MIG-001',
    );
  });

  it('handles eslint-disable-next-line without specific rule', () => {
    const line = '  // eslint-disable-next-line';
    const result = insertAnnotation(line, 'MIG-001');
    // "eslint-disable-next-line" is not followed by a space+rule, so the
    // directive regex requires a trailing \s which won't match. Falls through
    // to plain append.
    assert.ok(result.includes('shiori: MIG-001'));
  });

  it('handles block comment without lint directive', () => {
    const line = '  /* some regular comment */';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(result, '  /* some regular comment shiori: MIG-001 */');
  });

  it('handles line comment for @ts-expect-error with block closing', () => {
    // Edge case: line doesn't actually end with `*/` — no block comment
    const line = '  // @ts-expect-error reason here';
    const result = insertAnnotation(line, 'MIG-001');
    assert.equal(result, '  // @ts-expect-error reason here shiori: MIG-001');
  });
});

describe('applyMigrateToFile', () => {
  it('inserts annotations at correct line numbers', () => {
    const content = [
      'line 1',
      '// eslint-disable-next-line no-console',
      'console.log("hello");',
      '// eslint-disable-next-line no-debugger',
      'debugger;',
    ].join('\n');

    const actions = [
      {
        ref: 'MIG-001',
        file: 'test.ts',
        line: 2,
        candidate: makeCandidate({ location: { file: 'test.ts', line: 2 } }),
        rules: ['no-console'],
      },
      {
        ref: 'MIG-002',
        file: 'test.ts',
        line: 4,
        candidate: makeCandidate({ location: { file: 'test.ts', line: 4 } }),
        rules: ['no-debugger'],
      },
    ];

    const result = applyMigrateToFile(content, actions);
    const lines = result.content.split('\n');

    assert.equal(result.modifiedLines, 2);
    assert.ok(lines[1]!.includes('shiori: MIG-001'));
    assert.ok(lines[3]!.includes('shiori: MIG-002'));
    // Unmodified lines
    assert.equal(lines[0], 'line 1');
    assert.equal(lines[2], 'console.log("hello");');
    assert.equal(lines[4], 'debugger;');
  });

  it('warns about long lines', () => {
    const longRule = 'a'.repeat(100);
    const content = `// eslint-disable-next-line ${longRule}`;
    const actions = [
      {
        ref: 'MIG-001',
        file: 'test.ts',
        line: 1,
        candidate: makeCandidate({ location: { file: 'test.ts', line: 1 } }),
        rules: [],
      },
    ];

    const result = applyMigrateToFile(content, actions);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0]!.includes('exceeds'));
  });

  it('warns about out-of-range lines', () => {
    const content = 'single line';
    const actions = [
      {
        ref: 'MIG-001',
        file: 'test.ts',
        line: 99,
        candidate: makeCandidate({ location: { file: 'test.ts', line: 99 } }),
        rules: [],
      },
    ];

    const result = applyMigrateToFile(content, actions);
    assert.equal(result.modifiedLines, 0);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0]!.includes('out of range'));
  });
});

describe('groupActionsByFile', () => {
  it('groups actions by file path', () => {
    const actions = [
      {
        ref: 'MIG-001',
        file: 'a.ts',
        line: 1,
        candidate: makeCandidate({ location: { file: 'a.ts', line: 1 } }),
        rules: [],
      },
      {
        ref: 'MIG-002',
        file: 'b.ts',
        line: 5,
        candidate: makeCandidate({ location: { file: 'b.ts', line: 5 } }),
        rules: [],
      },
      {
        ref: 'MIG-003',
        file: 'a.ts',
        line: 10,
        candidate: makeCandidate({ location: { file: 'a.ts', line: 10 } }),
        rules: [],
      },
    ];

    const grouped = groupActionsByFile(actions);
    assert.equal(grouped.size, 2);
    assert.equal(grouped.get('a.ts')!.length, 2);
    assert.equal(grouped.get('b.ts')!.length, 1);
  });

  it('returns empty map for empty actions', () => {
    const grouped = groupActionsByFile([]);
    assert.equal(grouped.size, 0);
  });
});

describe('formatMigratePreview', () => {
  it('shows "No candidates" for empty result', () => {
    const preview = formatMigratePreview({ actions: [], registry: {} });
    assert.ok(preview.includes('No candidates to migrate'));
  });

  it('shows grouped preview with refs and rules', () => {
    const actions = [
      {
        ref: 'MIG-001',
        file: 'src/foo.ts',
        line: 10,
        candidate: makeCandidate({
          rule: 'no-console',
          location: { file: 'src/foo.ts', line: 10 },
        }),
        rules: ['no-console'],
      },
      {
        ref: 'MIG-002',
        file: 'src/foo.ts',
        line: 20,
        candidate: makeCandidate({
          rule: 'no-debugger',
          location: { file: 'src/foo.ts', line: 20 },
        }),
        rules: ['no-debugger'],
      },
      {
        ref: 'MIG-003',
        file: 'src/bar.ts',
        line: 5,
        candidate: makeCandidate({
          rule: undefined,
          location: { file: 'src/bar.ts', line: 5 },
        }),
        rules: [],
      },
    ];
    const preview = formatMigratePreview({ actions, registry: {} });

    assert.ok(preview.includes('3 candidate(s)'));
    assert.ok(preview.includes('src/foo.ts (2)'));
    assert.ok(preview.includes('L10: MIG-001 [no-console]'));
    assert.ok(preview.includes('L20: MIG-002 [no-debugger]'));
    assert.ok(preview.includes('src/bar.ts (1)'));
    assert.ok(preview.includes('L5: MIG-003'));
  });

  it('shows merged rules in preview for same-line candidates', () => {
    const actions = [
      {
        ref: 'MIG-001',
        file: 'src/test.ts',
        line: 10,
        candidate: makeCandidate({
          rule: 'no-console',
          location: { file: 'src/test.ts', line: 10 },
        }),
        rules: ['no-console', 'no-debugger'],
      },
    ];
    const preview = formatMigratePreview({ actions, registry: {} });

    assert.ok(preview.includes('1 candidate(s)'));
    assert.ok(preview.includes('L10: MIG-001 [no-console, no-debugger]'));
  });
});
