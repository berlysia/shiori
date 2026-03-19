import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriCandidate } from '../src/core/types.ts';
import {
  listCandidates,
  formatCandidatesAsMarkdown,
} from '../src/commands/candidates.ts';

function makeCandidate(
  overrides: Partial<ShioriCandidate> = {},
): ShioriCandidate {
  return {
    pattern: 'eslint',
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

describe('listCandidates', () => {
  it('returns all candidates with count', () => {
    const candidates = [
      makeCandidate({ rule: 'no-console' }),
      makeCandidate({
        rule: 'no-debugger',
        location: { file: 'a.ts', line: 5 },
      }),
    ];
    const result = listCandidates(candidates);
    assert.equal(result.count, 2);
    assert.equal(result.candidates.length, 2);
  });

  it('returns empty result for no candidates', () => {
    const result = listCandidates([]);
    assert.equal(result.count, 0);
    assert.equal(result.candidates.length, 0);
  });
});

describe('formatCandidatesAsMarkdown', () => {
  it('shows "No candidates found" when empty', () => {
    const md = formatCandidatesAsMarkdown({ candidates: [], count: 0 });
    assert.ok(md.includes('No candidates found'));
  });

  it('groups candidates by pattern and directive', () => {
    const result = listCandidates([
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-console',
      }),
      makeCandidate({
        pattern: 'keywords',
        directive: 'todo',
        text: 'fix later',
        location: { file: 'b.ts', line: 3 },
      }),
      makeCandidate({
        pattern: 'eslint',
        directive: 'disable-next-line',
        rule: 'no-debugger',
        location: { file: 'a.ts', line: 5 },
      }),
    ]);
    const md = formatCandidatesAsMarkdown(result);
    assert.ok(md.includes('# Candidate Report'));
    assert.ok(md.includes('**3** candidate(s)'));
    assert.ok(md.includes('## eslint / disable-next-line (2)'));
    assert.ok(md.includes('## keywords / todo (1)'));
    assert.ok(md.includes('no-console'));
    assert.ok(md.includes('fix later'));
  });

  it('includes file and line info', () => {
    const result = listCandidates([
      makeCandidate({
        directive: 'disable-next-line',
        rule: 'no-console',
        location: { file: 'src/foo.ts', line: 42 },
      }),
    ]);
    const md = formatCandidatesAsMarkdown(result);
    assert.ok(md.includes('`src/foo.ts:42`'));
    assert.ok(md.includes('`no-console`'));
  });

  it('shows pattern only when no directive', () => {
    const result = listCandidates([
      makeCandidate({ pattern: 'eslint', directive: undefined }),
    ]);
    const md = formatCandidatesAsMarkdown(result);
    assert.ok(md.includes('## eslint (1)'));
  });
});
