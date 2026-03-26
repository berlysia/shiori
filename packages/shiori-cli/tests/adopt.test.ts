import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriCandidate, Registry } from '../src/core/types.ts';
import {
  planAdoption,
  formatAdoptPreview,
  buildGroupKey,
  buildGroupSummaries,
  filterCandidatesByGroups,
} from '../src/commands/adopt.ts';
import { formatGroupLabel } from '../src/core/format-utils.ts';

function makeCandidate(
  overrides: Partial<ShioriCandidate> = {},
): ShioriCandidate {
  return {
    pattern: 'eslint',
    location: { file: 'src/test.ts', line: 10 },
    ...overrides,
  };
}

describe('planAdoption', () => {
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
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted by shiori adopt',
      kind: 'adoption',
    });

    assert.equal(result.migrate.actions.length, 2);
    assert.equal(result.migrate.actions[0]!.ref, 'ADOPT-001');
    assert.equal(result.migrate.actions[1]!.ref, 'ADOPT-002');
  });

  it('uses custom prefix', () => {
    const candidates = [makeCandidate()];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'DEBT',
      reason: 'legacy code',
      kind: 'adoption',
    });

    assert.equal(result.migrate.actions[0]!.ref, 'DEBT-001');
  });

  it('sets adopt-specific reason and kind in registry entries', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 42 },
      }),
    ];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted by shiori adopt',
      kind: 'adoption',
    });

    const entry = result.migrate.registry['ADOPT-001'];
    assert.ok(entry);
    assert.equal(entry.reason, 'adopted by shiori adopt');
    assert.equal(entry.kind, 'adoption');
    assert.equal(entry.target, 'src/foo.ts');
  });

  it('uses custom reason and kind', () => {
    const candidates = [makeCandidate()];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'legacy technical debt',
      kind: 'tech-debt',
    });

    const entry = result.migrate.registry['ADOPT-001'];
    assert.ok(entry);
    assert.equal(entry.reason, 'legacy technical debt');
    assert.equal(entry.kind, 'tech-debt');
  });

  it('avoids collisions with existing registry refs', () => {
    const existingRegistry: Registry = {
      'ADOPT-001': {
        reason: 'existing',
        target: 'a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
      'ADOPT-003': {
        reason: 'existing',
        target: 'b.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };
    const candidates = [makeCandidate()];
    const result = planAdoption({
      candidates,
      existingRegistry,
      prefix: 'ADOPT',
      reason: 'adopted by shiori adopt',
      kind: 'adoption',
    });

    assert.equal(result.migrate.actions[0]!.ref, 'ADOPT-004');
  });

  it('returns empty result for empty candidates', () => {
    const result = planAdoption({
      candidates: [],
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted by shiori adopt',
      kind: 'adoption',
    });

    assert.equal(result.migrate.actions.length, 0);
    assert.deepEqual(result.migrate.registry, {});
    assert.equal(result.groups.length, 0);
    assert.equal(result.filesAffected, 0);
  });

  it('groups candidates by pattern and directive', () => {
    const candidates = [
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-console',
        location: { file: 'a.ts', line: 1 },
      }),
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-debugger',
        location: { file: 'b.ts', line: 5 },
      }),
      makeCandidate({
        pattern: 'stylelint',
        directive: 'disable-next-line',
        rule: 'color-named',
        location: { file: 'c.css', line: 3 },
      }),
    ];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted',
      kind: 'adoption',
    });

    assert.equal(result.groups.length, 2);

    const eslintGroup = result.groups.find((g) => g.pattern === 'eslint');
    assert.ok(eslintGroup);
    assert.equal(eslintGroup.count, 2);

    const stylelintGroup = result.groups.find((g) => g.pattern === 'stylelint');
    assert.ok(stylelintGroup);
    assert.equal(stylelintGroup.count, 1);
  });

  it('counts affected files correctly', () => {
    const candidates = [
      makeCandidate({ location: { file: 'a.ts', line: 1 } }),
      makeCandidate({ location: { file: 'a.ts', line: 5 } }),
      makeCandidate({ location: { file: 'b.ts', line: 3 } }),
    ];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted',
      kind: 'adoption',
    });

    assert.equal(result.filesAffected, 2);
  });

  it('merges same-line candidates into one action', () => {
    const candidates = [
      makeCandidate({
        rule: 'no-console',
        location: { file: 'a.ts', line: 10 },
      }),
      makeCandidate({
        rule: 'no-debugger',
        location: { file: 'a.ts', line: 10 },
      }),
    ];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted',
      kind: 'adoption',
    });

    assert.equal(result.migrate.actions.length, 1);
    assert.deepEqual(result.migrate.actions[0]!.rules, [
      'no-console',
      'no-debugger',
    ]);
  });
});

describe('formatAdoptPreview', () => {
  it('shows "No candidates" for empty result', () => {
    const result = planAdoption({
      candidates: [],
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted',
      kind: 'adoption',
    });
    const preview = formatAdoptPreview(result);
    assert.ok(preview.includes('No candidates to adopt'));
  });

  it('shows pattern summary and file details', () => {
    const candidates = [
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 10 },
      }),
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-debugger',
        location: { file: 'src/foo.ts', line: 20 },
      }),
      makeCandidate({
        pattern: 'stylelint',
        directive: 'disable-next-line',
        rule: 'color-named',
        location: { file: 'src/bar.css', line: 5 },
      }),
    ];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted',
      kind: 'adoption',
    });
    const preview = formatAdoptPreview(result);

    assert.ok(preview.includes('3 candidate(s) across 2 file(s)'));
    assert.ok(preview.includes('By pattern:'));
    assert.ok(preview.includes('eslint / disable-next-line: 2'));
    assert.ok(preview.includes('stylelint / disable-next-line: 1'));
    assert.ok(preview.includes('src/foo.ts (2)'));
    assert.ok(preview.includes('L10: ADOPT-001 [no-console]'));
    assert.ok(preview.includes('L20: ADOPT-002 [no-debugger]'));
    assert.ok(preview.includes('src/bar.css (1)'));
    assert.ok(preview.includes('L5: ADOPT-003 [color-named]'));
  });

  it('shows pattern without directive for keyword candidates', () => {
    const candidates = [
      makeCandidate({
        pattern: 'keywords',
        directive: undefined,
        text: 'TODO: fix this',
        location: { file: 'src/util.ts', line: 7 },
      }),
    ];
    const result = planAdoption({
      candidates,
      existingRegistry: {},
      prefix: 'ADOPT',
      reason: 'adopted',
      kind: 'adoption',
    });
    const preview = formatAdoptPreview(result);

    assert.ok(preview.includes('keywords: 1'));
  });
});

describe('buildGroupKey', () => {
  it('returns pattern/directive for lint candidates', () => {
    const key = buildGroupKey(
      makeCandidate({ pattern: 'eslint', directive: 'disable-next-line' }),
    );
    assert.equal(key, 'eslint/disable-next-line');
  });

  it('returns pattern alone when directive is undefined', () => {
    const key = buildGroupKey(
      makeCandidate({ pattern: 'keywords', directive: undefined }),
    );
    assert.equal(key, 'keywords');
  });
});

describe('buildGroupSummaries', () => {
  it('groups candidates by pattern/directive', () => {
    const candidates = [
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        location: { file: 'a.ts', line: 1 },
      }),
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        location: { file: 'b.ts', line: 2 },
      }),
      makeCandidate({
        pattern: 'stylelint',
        directive: 'disable-next-line',
        location: { file: 'c.css', line: 3 },
      }),
    ];
    const groups = buildGroupSummaries(candidates);

    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.pattern, 'eslint');
    assert.equal(groups[0]!.count, 2);
    assert.equal(groups[1]!.pattern, 'stylelint');
    assert.equal(groups[1]!.count, 1);
  });

  it('returns empty array for empty candidates', () => {
    const groups = buildGroupSummaries([]);
    assert.equal(groups.length, 0);
  });
});

describe('filterCandidatesByGroups', () => {
  it('returns only candidates matching selected groups', () => {
    const candidates = [
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-console',
        location: { file: 'a.ts', line: 1 },
      }),
      makeCandidate({
        pattern: 'stylelint',
        directive: 'disable-next-line',
        rule: 'color-named',
        location: { file: 'b.css', line: 2 },
      }),
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-debugger',
        location: { file: 'c.ts', line: 3 },
      }),
    ];

    const selected = new Set(['eslint/disable-next-line']);
    const filtered = filterCandidatesByGroups(candidates, selected);

    assert.equal(filtered.length, 2);
    assert.equal(filtered[0]!.rule, 'no-console');
    assert.equal(filtered[1]!.rule, 'no-debugger');
  });

  it('returns empty array when no groups match', () => {
    const candidates = [
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        location: { file: 'a.ts', line: 1 },
      }),
    ];

    const filtered = filterCandidatesByGroups(
      candidates,
      new Set(['nonexistent']),
    );
    assert.equal(filtered.length, 0);
  });

  it('handles keyword candidates (no directive)', () => {
    const candidates = [
      makeCandidate({
        pattern: 'keywords',
        directive: undefined,
        location: { file: 'a.ts', line: 1 },
      }),
    ];

    const filtered = filterCandidatesByGroups(
      candidates,
      new Set(['keywords']),
    );
    assert.equal(filtered.length, 1);
  });
});

describe('formatGroupLabel', () => {
  it('formats label with directive', () => {
    const label = formatGroupLabel({
      pattern: 'eslint',
      directive: 'disable-next-line',
    });
    assert.equal(label, 'eslint / disable-next-line');
  });

  it('formats label without directive', () => {
    const label = formatGroupLabel({
      pattern: 'keywords',
      directive: undefined,
    });
    assert.equal(label, 'keywords');
  });
});
