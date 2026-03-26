import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Registry, ShioriAnnotation } from '../src/core/types.ts';
import type { RefPatternConfig } from '../src/core/ref-pattern.ts';
import { isValidRef } from '../src/core/ref-validation.ts';
import {
  initRegistry,
  routeRegistryByPattern,
} from '../src/commands/registry-generator.ts';

// --- helpers ---

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> & { ref: string },
): ShioriAnnotation {
  return {
    tagged: true,
    ignored: false,
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

function makeRegistryEntry(
  overrides: Partial<Registry[string]> = {},
): Registry[string] {
  return {
    reason: 'existing reason',
    target: 'existing target',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: 'intentional',
    ...overrides,
  };
}

// --- isValidRef ---

describe('isValidRef', () => {
  const validRefs = [
    'SUP-1234',
    'ADR-0007',
    'JIRA:PROJ-123',
    'DEV-001',
    'MIG-1',
    'A-b',
    'AB-1.2.3',
  ];

  for (const ref of validRefs) {
    it(`accepts valid ref: ${ref}`, () => {
      assert.equal(isValidRef(ref), true);
    });
  }

  const invalidRefs: Array<[string, string]> = [
    ['', 'empty string'],
    ['lowercase', 'lowercase start'],
    ['123-NUM', 'digit start'],
    [')', 'special character'],
    ['A-', 'trailing hyphen'],
    ['A`B-1', 'backtick'],
  ];

  for (const [ref, label] of invalidRefs) {
    it(`rejects invalid ref: ${label} ("${ref}")`, () => {
      assert.equal(isValidRef(ref), false);
    });
  }
});

// --- initRegistry ---

describe('initRegistry', () => {
  it('generates placeholder entry from a single annotation', () => {
    const records = [makeAnnotation({ ref: 'TEST-001' })];
    const registry = initRegistry({ records });

    assert.ok('TEST-001' in registry);
    assert.equal(registry['TEST-001']!.reason, 'TODO: fill in reason');
    assert.equal(registry['TEST-001']!.target, 'TODO: fill in target');
  });

  it('preserves existing registry entries on merge', () => {
    const records = [
      makeAnnotation({ ref: 'TEST-001' }),
      makeAnnotation({ ref: 'TEST-002' }),
    ];
    const existingRegistry: Registry = {
      'TEST-001': makeRegistryEntry({ reason: 'kept' }),
    };

    const registry = initRegistry({ records, existingRegistry });

    assert.equal(registry['TEST-001']!.reason, 'kept');
    assert.equal(registry['TEST-002']!.reason, 'TODO: fill in reason');
  });

  it('skips annotations with empty ref', () => {
    const records = [
      makeAnnotation({ ref: '' }),
      makeAnnotation({ ref: 'VALID-1' }),
    ];
    const registry = initRegistry({ records });

    assert.ok(!('' in registry));
    assert.ok('VALID-1' in registry);
  });

  it('skips annotations with invalid ref', () => {
    const records = [
      makeAnnotation({ ref: 'lowercase' }),
      makeAnnotation({ ref: 'VALID-1' }),
    ];
    const registry = initRegistry({ records });

    assert.ok(!('lowercase' in registry));
    assert.ok('VALID-1' in registry);
  });

  it('groups multiple annotations with the same ref into one entry', () => {
    const records = [
      makeAnnotation({ ref: 'DUP-1', location: { file: 'a.ts', line: 1 } }),
      makeAnnotation({ ref: 'DUP-1', location: { file: 'b.ts', line: 2 } }),
    ];
    const registry = initRegistry({ records });

    const keys = Object.keys(registry);
    assert.equal(keys.length, 1);
    assert.equal(keys[0], 'DUP-1');
  });

  it('picks the earliest expires from multiple annotations', () => {
    const records = [
      makeAnnotation({ ref: 'EXP-1', expires: '2026-06' }),
      makeAnnotation({ ref: 'EXP-1', expires: '2026-03' }),
      makeAnnotation({ ref: 'EXP-1', expires: '2026-09' }),
    ];
    const registry = initRegistry({ records });

    assert.equal(registry['EXP-1']!.expires, '2026-03');
  });

  it('leaves expires undefined when no annotation has expires', () => {
    const records = [
      makeAnnotation({ ref: 'NO-EXP' }),
      makeAnnotation({ ref: 'NO-EXP' }),
    ];
    const registry = initRegistry({ records });

    assert.equal(registry['NO-EXP']!.expires, undefined);
  });

  it('returns only existing registry when records are empty', () => {
    const existingRegistry: Registry = {
      'OLD-1': makeRegistryEntry(),
    };
    const registry = initRegistry({ records: [], existingRegistry });

    assert.deepEqual(Object.keys(registry), ['OLD-1']);
    assert.equal(registry['OLD-1']!.reason, 'existing reason');
  });

  it('sorts output entries by ref alphabetically', () => {
    const records = [
      makeAnnotation({ ref: 'ZZZ-1' }),
      makeAnnotation({ ref: 'AAA-1' }),
      makeAnnotation({ ref: 'MMM-1' }),
    ];
    const registry = initRegistry({ records });

    assert.deepEqual(Object.keys(registry), ['AAA-1', 'MMM-1', 'ZZZ-1']);
  });

  it('preserves existing entries not present in scan', () => {
    const records = [makeAnnotation({ ref: 'NEW-1' })];
    const existingRegistry: Registry = {
      'OLD-1': makeRegistryEntry({ reason: 'not in scan' }),
    };
    const registry = initRegistry({ records, existingRegistry });

    assert.ok('OLD-1' in registry);
    assert.equal(registry['OLD-1']!.reason, 'not in scan');
    assert.ok('NEW-1' in registry);
  });
});

// --- routeRegistryByPattern ---

describe('routeRegistryByPattern', () => {
  const sampleRegistry: Registry = {
    'JIRA-100': makeRegistryEntry(),
    'ADR-001': makeRegistryEntry(),
    'DEV-999': makeRegistryEntry(),
  };

  it('routes all entries to null key when patterns is undefined', () => {
    const result = routeRegistryByPattern(sampleRegistry, undefined);

    assert.equal(result.size, 1);
    assert.ok(result.has(null));
    assert.deepEqual(Object.keys(result.get(null)!).sort(), [
      'ADR-001',
      'DEV-999',
      'JIRA-100',
    ]);
  });

  it('routes all entries to null key when patterns is empty array', () => {
    const result = routeRegistryByPattern(sampleRegistry, []);

    assert.equal(result.size, 1);
    assert.ok(result.has(null));
  });

  it('routes matched refs to the configured registryFile', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}', registryFile: 'jira-registry.json' },
    ];
    const result = routeRegistryByPattern(sampleRegistry, patterns);

    assert.ok(result.has('jira-registry.json'));
    assert.deepEqual(Object.keys(result.get('jira-registry.json')!), [
      'JIRA-100',
    ]);
  });

  it('routes multiple patterns to different files', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}', registryFile: 'jira.json' },
      { match: 'ADR-{id}', registryFile: 'adr.json' },
    ];
    const result = routeRegistryByPattern(sampleRegistry, patterns);

    assert.ok(result.has('jira.json'));
    assert.ok(result.has('adr.json'));
    assert.deepEqual(Object.keys(result.get('jira.json')!), ['JIRA-100']);
    assert.deepEqual(Object.keys(result.get('adr.json')!), ['ADR-001']);
  });

  it('routes unmatched refs to null key', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'JIRA-{id}', registryFile: 'jira.json' },
    ];
    const result = routeRegistryByPattern(sampleRegistry, patterns);

    assert.ok(result.has(null));
    const defaultEntries = Object.keys(result.get(null)!).sort();
    assert.deepEqual(defaultEntries, ['ADR-001', 'DEV-999']);
  });

  it('handles mixed matched and unmatched refs', () => {
    const patterns: RefPatternConfig[] = [
      { match: 'ADR-{id}', registryFile: 'adr.yaml' },
    ];
    const result = routeRegistryByPattern(sampleRegistry, patterns);

    assert.equal(result.size, 2);
    assert.deepEqual(Object.keys(result.get('adr.yaml')!), ['ADR-001']);
    assert.deepEqual(Object.keys(result.get(null)!).sort(), [
      'DEV-999',
      'JIRA-100',
    ]);
  });

  it('routes to null key when pattern matches but has no registryFile', () => {
    const patterns: RefPatternConfig[] = [{ match: 'JIRA-{id}' }];
    const result = routeRegistryByPattern(sampleRegistry, patterns);

    assert.ok(result.has(null));
    assert.ok('JIRA-100' in result.get(null)!);
  });
});
