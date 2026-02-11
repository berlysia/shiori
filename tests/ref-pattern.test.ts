import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchRefPattern, resolveRefUrl } from '../src/core/ref-pattern.ts';
import type { RefPatternConfig } from '../src/core/ref-pattern.ts';

describe('matchRefPattern', () => {
  it('matches {id} pattern and captures id', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}', urlTemplate: 'https://jira.example.com/browse/{id}' },
    ];
    const result = matchRefPattern('JIRA-PROJ-123', patterns);
    assert.ok(result);
    assert.equal(result.captures.id, 'PROJ-123');
    assert.equal(result.config, patterns[0]);
  });

  it('matches ADR-{id} pattern', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'ADR-{id}', urlTemplate: 'docs/decisions/{id}.md' },
    ];
    const result = matchRefPattern('ADR-0007', patterns);
    assert.ok(result);
    assert.equal(result.captures.id, '0007');
  });

  it('matches colon-based pattern for backward compat (JIRA:{id})', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/browse/{id}' },
    ];
    const result = matchRefPattern('JIRA:PROJ-123', patterns);
    assert.ok(result);
    assert.equal(result.captures.id, 'PROJ-123');
  });

  it('returns first matching pattern (priority order)', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/{id}' },
      { match: '{id}', urlTemplate: 'https://fallback.example.com/{id}' },
    ];
    const result = matchRefPattern('JIRA:PROJ-1', patterns);
    assert.ok(result);
    assert.equal(result.config, patterns[0]);
  });

  it('matches catch-all {id} pattern', () => {
    const patterns: RefPatternConfig[] = [
      { match: '{id}', urlTemplate: 'https://example.com/{id}' },
    ];
    const result = matchRefPattern('anything-here', patterns);
    assert.ok(result);
    assert.equal(result.captures.id, 'anything-here');
  });

  it('matches literal pattern (no {id}) with exact match', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'LEGACY-WORKAROUND' },
    ];
    const result = matchRefPattern('LEGACY-WORKAROUND', patterns);
    assert.ok(result);
    assert.equal(result.captures.id, 'LEGACY-WORKAROUND');
  });

  it('does not match literal pattern partially', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'LEGACY' },
    ];
    const result = matchRefPattern('LEGACY-EXTRA', patterns);
    assert.equal(result, undefined);
  });

  it('returns undefined when no pattern matches', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}' },
    ];
    const result = matchRefPattern('ADR-0007', patterns);
    assert.equal(result, undefined);
  });

  it('returns undefined for empty array', () => {
    const result = matchRefPattern('JIRA-123', []);
    assert.equal(result, undefined);
  });

  it('returns undefined for undefined patterns', () => {
    const result = matchRefPattern('JIRA-123', undefined);
    assert.equal(result, undefined);
  });

  it('escapes regex special characters in pattern literal parts', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'PROJ.{id}' },
    ];
    // Should match: dot is literal
    const result = matchRefPattern('PROJ.123', patterns);
    assert.ok(result);
    assert.equal(result.captures.id, '123');

    // Should NOT match: dot is not a wildcard
    const noMatch = matchRefPattern('PROJX123', patterns);
    assert.equal(noMatch, undefined);
  });

  it('returns undefined for empty ref', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}' },
    ];
    const result = matchRefPattern('', patterns);
    assert.equal(result, undefined);
  });

  it('matches {id} at the start of pattern ({id}-SUFFIX)', () => {
    const patterns: RefPatternConfig[] = [
      { match: '{id}-SUFFIX' },
    ];
    const result = matchRefPattern('abc-def-SUFFIX', patterns);
    assert.ok(result);
    assert.equal(result.captures.id, 'abc-def');
  });
});

describe('resolveRefUrl', () => {
  it('resolves URL with {id} substitution', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/browse/{id}' },
    ];
    const url = resolveRefUrl('JIRA:PROJ-123', patterns);
    assert.equal(url, 'https://jira.example.com/browse/PROJ-123');
  });

  it('resolves ADR ref to path', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'ADR:{id}', urlTemplate: 'docs/decisions/{id}.md' },
    ];
    const url = resolveRefUrl('ADR:0007', patterns);
    assert.equal(url, 'docs/decisions/0007.md');
  });

  it('returns undefined when no pattern matches', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/{id}' },
    ];
    const url = resolveRefUrl('SUP-1234', patterns);
    assert.equal(url, undefined);
  });

  it('returns undefined when patterns is undefined', () => {
    const url = resolveRefUrl('JIRA:PROJ-123', undefined);
    assert.equal(url, undefined);
  });

  it('returns undefined when matched pattern has no urlTemplate', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA:{id}' },
    ];
    const url = resolveRefUrl('JIRA:PROJ-123', patterns);
    assert.equal(url, undefined);
  });

  it('resolves colon-based ref', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/browse/{id}' },
      { match: 'ADR:{id}', urlTemplate: 'docs/decisions/{id}.md' },
    ];
    const url = resolveRefUrl('ADR:0007', patterns);
    assert.equal(url, 'docs/decisions/0007.md');
  });
});
