import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { why, isFound } from '../src/commands/why.ts';
import type { ShioriAnnotation, Registry } from '../src/core/types.ts';

const makeAnnotation = (
  ref: string,
  file: string,
  line: number,
  opts?: { rule?: string },
): ShioriAnnotation => ({
  ref,
  rule: opts?.rule,
  tagged: true,
  ignored: false,
  location: { file, line },
});

describe('why', () => {
  const registry: Registry = {
    'JIRA:PROJ-123': {
      reason: 'Legacy API compatibility',
      target: 'src/api/legacy.ts',
      expires: '2026-06',
      ticket: 'https://jira.example.com/browse/PROJ-123',
      owner: 'team-platform',
      notes: 'Will be removed after v3 migration',
      kind: 'compat',
    },
  };

  const annotations: ShioriAnnotation[] = [
    makeAnnotation('JIRA:PROJ-123', 'src/api/legacy.ts', 42, {
      rule: 'no-deprecated-api',
    }),
    makeAnnotation('JIRA:PROJ-123', 'src/api/legacy.ts', 87, {
      rule: '@typescript-eslint/no-explicit-any',
    }),
    makeAnnotation('SUP-999', 'src/util.ts', 10),
  ];

  const refPatterns = [
    {
      match: 'JIRA:{id}',
      urlTemplate: 'https://jira.example.com/browse/{id}',
    },
  ];

  it('returns full info for ref in registry and source', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
    });

    assert.equal(result.ref, 'JIRA:PROJ-123');
    assert.deepEqual(result.registryEntry, registry['JIRA:PROJ-123']);
    assert.equal(result.sourceLocations.length, 2);
    assert.deepEqual(result.sourceLocations[0], {
      file: 'src/api/legacy.ts',
      line: 42,
      rule: 'no-deprecated-api',
    });
    assert.deepEqual(result.sourceLocations[1], {
      file: 'src/api/legacy.ts',
      line: 87,
      rule: '@typescript-eslint/no-explicit-any',
    });
    assert.equal(result.url, 'https://jira.example.com/browse/PROJ-123');
  });

  it('includes rule info in source locations', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
    });

    assert.equal(result.sourceLocations[0]?.rule, 'no-deprecated-api');
    assert.equal(
      result.sourceLocations[1]?.rule,
      '@typescript-eslint/no-explicit-any',
    );
  });

  it('returns issues for ref missing from registry', () => {
    const result = why({
      ref: 'SUP-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.equal(result.registryEntry, undefined);
    assert.equal(result.sourceLocations.length, 1);
    assert.ok(result.issues.length > 0);
    assert.ok(
      result.issues.some((i) => i.type === 'missing-in-registry'),
      'Expected missing-in-registry issue',
    );
  });

  it('returns issues for expired registry entry', () => {
    const expiredRegistry: Registry = {
      'EXP-001': {
        reason: 'Temporary workaround',
        target: 'src/hack.ts',
        expires: '2020-01-01',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const expiredAnnotations = [makeAnnotation('EXP-001', 'src/hack.ts', 5)];

    const result = why({
      ref: 'EXP-001',
      registry: expiredRegistry,
      annotations: expiredAnnotations,
      refPatterns: undefined,
      now: new Date('2025-06-01'),
    });

    assert.ok(
      result.issues.some((i) => i.type === 'expired'),
      'Expected expired issue',
    );
  });

  it('returns no issues when ref is healthy', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
      now: new Date('2025-01-01'),
    });

    assert.deepEqual(result.issues, []);
  });

  it('returns empty result for unknown ref', () => {
    const result = why({
      ref: 'UNKNOWN-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.equal(result.registryEntry, undefined);
    assert.deepEqual(result.sourceLocations, []);
    assert.equal(result.url, undefined);
  });

  it('builds human-readable summary with all fields', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
      now: new Date('2025-01-01'),
    });

    assert.ok(result.summary.includes('ref: JIRA:PROJ-123'));
    assert.ok(result.summary.includes('reason: Legacy API compatibility'));
    assert.ok(result.summary.includes('owner: team-platform'));
    assert.ok(result.summary.includes('expires: 2026-06'));
    assert.ok(result.summary.includes('kind: compat'));
    assert.ok(
      result.summary.includes(
        'ticket: https://jira.example.com/browse/PROJ-123',
      ),
    );
    assert.ok(
      result.summary.includes('notes: Will be removed after v3 migration'),
    );
    assert.ok(
      result.summary.includes('url: https://jira.example.com/browse/PROJ-123'),
    );
    assert.ok(result.summary.includes('locations: 2 occurrence(s)'));
    assert.ok(result.summary.includes('issues: none'));
  });

  it('summary shows registry: not found for missing entry', () => {
    const result = why({
      ref: 'SUP-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.ok(result.summary.includes('registry: not found'));
  });

  it('summary shows issue details', () => {
    const result = why({
      ref: 'SUP-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.ok(
      result.summary.some((line) => line.includes('missing-in-registry')),
    );
  });
});

describe('isFound (why)', () => {
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
        issues: [],
        summary: [],
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
        issues: [],
        summary: [],
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
        issues: [],
        summary: [],
      }),
      false,
    );
  });
});
