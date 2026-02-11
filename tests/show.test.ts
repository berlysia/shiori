import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { show, isFound } from '../src/commands/show.ts';
import type { ShioriAnnotation, Registry } from '../src/core/types.ts';

const makeAnnotation = (
  ref: string,
  file: string,
  line: number,
): ShioriAnnotation => ({
  ref,
  tagged: true,
  ignored: false,
  location: { file, line },
});

describe('show', () => {
  const registry: Registry = {
    'JIRA:PROJ-123': {
      reason: 'Legacy API compatibility',
      target: 'src/api/legacy.ts',
      expires: '2026-06',
      ticket: undefined,
      owner: 'team-platform',
      notes: undefined,
      kind: 'compat',
    },
  };

  const annotations: ShioriAnnotation[] = [
    makeAnnotation('JIRA:PROJ-123', 'src/api/legacy.ts', 42),
    makeAnnotation('JIRA:PROJ-123', 'src/api/legacy.ts', 87),
    makeAnnotation('SUP-999', 'src/util.ts', 10),
  ];

  const namespaces = {
    JIRA: { urlTemplate: 'https://jira.example.com/browse/{id}' },
  };

  it('returns full info for ref in registry and source', () => {
    const result = show({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      namespaces,
    });

    assert.equal(result.ref, 'JIRA:PROJ-123');
    assert.deepEqual(result.registryEntry, registry['JIRA:PROJ-123']);
    assert.deepEqual(result.sourceLocations, [
      { file: 'src/api/legacy.ts', line: 42 },
      { file: 'src/api/legacy.ts', line: 87 },
    ]);
    assert.equal(result.url, 'https://jira.example.com/browse/PROJ-123');
  });

  it('returns undefined registryEntry for ref not in registry', () => {
    const result = show({
      ref: 'SUP-999',
      registry,
      annotations,
      namespaces,
    });

    assert.equal(result.registryEntry, undefined);
    assert.deepEqual(result.sourceLocations, [
      { file: 'src/util.ts', line: 10 },
    ]);
    assert.equal(result.url, undefined);
  });

  it('returns empty sourceLocations for ref not in annotations', () => {
    const result = show({
      ref: 'JIRA:OTHER-1',
      registry,
      annotations,
      namespaces,
    });

    assert.equal(result.registryEntry, undefined);
    assert.deepEqual(result.sourceLocations, []);
    // URL is still resolved because JIRA namespace config exists
    assert.equal(result.url, 'https://jira.example.com/browse/OTHER-1');
  });

  it('resolves URL when namespace config exists', () => {
    const result = show({
      ref: 'JIRA:PROJ-123',
      registry: {},
      annotations: [],
      namespaces,
    });

    assert.equal(result.url, 'https://jira.example.com/browse/PROJ-123');
  });

  it('returns undefined URL when namespaces is undefined', () => {
    const result = show({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      namespaces: undefined,
    });

    assert.equal(result.url, undefined);
  });
});

describe('isFound', () => {
  it('returns true when registryEntry exists', () => {
    assert.equal(
      isFound({
        ref: 'X',
        registryEntry: {
          reason: 'test',
          target: 'a.ts',
          expires: undefined,
          ticket: undefined,
          owner: undefined,
          notes: undefined,
          kind: undefined,
        },
        sourceLocations: [],
        url: undefined,
      }),
      true,
    );
  });

  it('returns true when sourceLocations exist', () => {
    assert.equal(
      isFound({
        ref: 'X',
        registryEntry: undefined,
        sourceLocations: [{ file: 'a.ts', line: 1 }],
        url: undefined,
      }),
      true,
    );
  });

  it('returns false when neither exists', () => {
    assert.equal(
      isFound({
        ref: 'X',
        registryEntry: undefined,
        sourceLocations: [],
        url: undefined,
      }),
      false,
    );
  });
});
