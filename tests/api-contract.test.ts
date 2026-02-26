import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('API contract: @berlysia/shiori (core types)', () => {
  it('exports all public types and interfaces', async () => {
    const mod = await import('../src/core/types.ts');

    // types.ts exports are type-only except for the module itself
    // Verify the module is importable and has expected shape
    assert.equal(typeof mod, 'object');
  });
});

describe('API contract: @berlysia/shiori/core/ref-pattern', () => {
  it('exports matchRefPattern function', async () => {
    const mod = await import('../src/core/ref-pattern.ts');
    assert.equal(typeof mod.matchRefPattern, 'function');
  });

  it('exports resolveRefUrl function', async () => {
    const mod = await import('../src/core/ref-pattern.ts');
    assert.equal(typeof mod.resolveRefUrl, 'function');
  });

  it('matchRefPattern returns expected shape', async () => {
    const { matchRefPattern } = await import('../src/core/ref-pattern.ts');
    const result = matchRefPattern('JIRA-1234', [
      { match: 'JIRA-{id}', urlTemplate: 'https://example.com/{id}' },
    ]);
    assert.ok(result);
    assert.equal(typeof result.config, 'object');
    assert.equal(typeof result.captures, 'object');
    assert.equal(result.captures.id, '1234');
  });

  it('resolveRefUrl returns expected shape', async () => {
    const { resolveRefUrl } = await import('../src/core/ref-pattern.ts');
    const url = resolveRefUrl('JIRA-1234', [
      {
        match: 'JIRA-{id}',
        urlTemplate: 'https://example.com/browse/JIRA-{id}',
      },
    ]);
    assert.equal(url, 'https://example.com/browse/JIRA-1234');
  });
});

describe('API contract: @berlysia/shiori/commands/show', () => {
  it('exports show function', async () => {
    const mod = await import('../src/commands/show.ts');
    assert.equal(typeof mod.show, 'function');
  });

  it('exports isFound function', async () => {
    const mod = await import('../src/commands/show.ts');
    assert.equal(typeof mod.isFound, 'function');
  });

  it('show returns expected shape', async () => {
    const { show } = await import('../src/commands/show.ts');
    const result = show({
      ref: 'TEST-001',
      registry: {},
      annotations: [],
      refPatterns: undefined,
    });
    assert.equal(result.ref, 'TEST-001');
    assert.equal(result.registryEntry, undefined);
    assert.ok(Array.isArray(result.sourceLocations));
    assert.equal(result.url, undefined);
  });

  it('isFound returns false for empty result', async () => {
    const { show, isFound } = await import('../src/commands/show.ts');
    const result = show({
      ref: 'NONEXISTENT',
      registry: {},
      annotations: [],
      refPatterns: undefined,
    });
    assert.equal(isFound(result), false);
  });
});
