import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMultiRegistry } from '../src/core/registry.ts';
import { PathBoundaryError } from '../src/core/path-boundary.ts';
import {
  routeRegistryByPattern,
  initRegistry,
  isValidRef,
} from '../src/commands/registry-generator.ts';
import type { Registry, ShioriAnnotation } from '../src/core/types.ts';

describe('loadMultiRegistry', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-multi-registry-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads only default registry when no namespaces', async () => {
    const defaultPath = join(tmpDir, 'default.json');
    await writeFile(
      defaultPath,
      JSON.stringify({
        'SUP-1234': { reason: 'test', target: 'all' },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, undefined);
    assert.equal(Object.keys(result.registry).length, 1);
    assert.equal(result.registry['SUP-1234']!.reason, 'test');
    assert.equal(result.duplicates.length, 0);
  });

  it('loads only default registry when no registryFile in patterns', async () => {
    const defaultPath = join(tmpDir, 'default2.json');
    await writeFile(
      defaultPath,
      JSON.stringify({
        'SUP-1234': { reason: 'test', target: 'all' },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'JIRA:{id}',
        urlTemplate: 'https://jira.example.com/browse/{id}',
      },
    ]);
    assert.equal(Object.keys(result.registry).length, 1);
    assert.equal(result.duplicates.length, 0);
  });

  it('merges pattern-specific registry', async () => {
    const defaultPath = join(tmpDir, 'merge-default.json');
    const jiraPath = join(tmpDir, 'jira-registry.json');

    await writeFile(
      defaultPath,
      JSON.stringify({
        'SUP-1234': { reason: 'default entry', target: 'all' },
      }),
    );
    await writeFile(
      jiraPath,
      JSON.stringify({
        'JIRA:PROJ-123': { reason: 'jira entry', target: 'src/api.ts' },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'JIRA:{id}',
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: jiraPath,
      },
    ]);

    assert.equal(Object.keys(result.registry).length, 2);
    assert.equal(result.registry['SUP-1234']!.reason, 'default entry');
    assert.equal(result.registry['JIRA:PROJ-123']!.reason, 'jira entry');
    assert.equal(result.duplicates.length, 0);
  });

  it('pattern file wins on duplicate keys', async () => {
    const defaultPath = join(tmpDir, 'dup-default.json');
    const jiraPath = join(tmpDir, 'dup-jira.json');

    await writeFile(
      defaultPath,
      JSON.stringify({
        'JIRA:PROJ-123': { reason: 'old entry in default', target: 'all' },
      }),
    );
    await writeFile(
      jiraPath,
      JSON.stringify({
        'JIRA:PROJ-123': {
          reason: 'authoritative entry',
          target: 'src/api.ts',
        },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'JIRA:{id}',
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: jiraPath,
      },
    ]);

    assert.equal(
      result.registry['JIRA:PROJ-123']!.reason,
      'authoritative entry',
    );
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0]!.ref, 'JIRA:PROJ-123');
  });

  it('merges multiple pattern registries', async () => {
    const defaultPath = join(tmpDir, 'multi-default.json');
    const jiraPath = join(tmpDir, 'multi-jira.json');
    const adrPath = join(tmpDir, 'multi-adr.yaml');

    await writeFile(
      defaultPath,
      JSON.stringify({
        'SUP-1234': { reason: 'default', target: 'all' },
      }),
    );
    await writeFile(
      jiraPath,
      JSON.stringify({
        'JIRA:PROJ-1': { reason: 'jira', target: 'src/a.ts' },
      }),
    );
    await writeFile(adrPath, 'ADR:0007:\n  reason: adr\n  target: docs/\n');

    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'JIRA:{id}',
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: jiraPath,
      },
      {
        match: 'ADR:{id}',
        urlTemplate: 'docs/decisions/{id}.md',
        registryFile: adrPath,
      },
    ]);

    assert.equal(Object.keys(result.registry).length, 3);
    assert.equal(result.registry['SUP-1234']!.reason, 'default');
    assert.equal(result.registry['JIRA:PROJ-1']!.reason, 'jira');
    assert.equal(result.registry['ADR:0007']!.reason, 'adr');
  });

  it('does not load the same file twice', async () => {
    const defaultPath = join(tmpDir, 'shared-default.json');
    const sharedPath = join(tmpDir, 'shared-ns.json');

    await writeFile(
      defaultPath,
      JSON.stringify({ 'SUP-1': { reason: 'default', target: 'all' } }),
    );
    await writeFile(
      sharedPath,
      JSON.stringify({ 'NS:1': { reason: 'shared', target: 'all' } }),
    );

    // Two patterns pointing to the same file
    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'NS1:{id}',
        urlTemplate: 'https://example.com/{id}',
        registryFile: sharedPath,
      },
      {
        match: 'NS2:{id}',
        urlTemplate: 'https://example.com/{id}',
        registryFile: sharedPath,
      },
    ]);

    assert.equal(Object.keys(result.registry).length, 2);
  });

  it('populates refOrigins for default and pattern entries', async () => {
    const defaultPath = join(tmpDir, 'origins-default.json');
    const jiraPath = join(tmpDir, 'origins-jira.json');

    await writeFile(
      defaultPath,
      JSON.stringify({
        'SUP-1': { reason: 'default entry', target: 'all' },
      }),
    );
    await writeFile(
      jiraPath,
      JSON.stringify({
        'JIRA:PROJ-1': { reason: 'jira entry', target: 'src/' },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'JIRA:{id}',
        registryFile: jiraPath,
      },
    ]);

    assert.equal(result.refOrigins.get('SUP-1'), null);
    assert.equal(result.refOrigins.get('JIRA:PROJ-1'), jiraPath);
  });

  it('refOrigins reflects last-wins on duplicate keys', async () => {
    const defaultPath = join(tmpDir, 'origins-dup-default.json');
    const jiraPath = join(tmpDir, 'origins-dup-jira.json');

    await writeFile(
      defaultPath,
      JSON.stringify({
        'JIRA:PROJ-1': { reason: 'from default', target: 'all' },
      }),
    );
    await writeFile(
      jiraPath,
      JSON.stringify({
        'JIRA:PROJ-1': { reason: 'from jira', target: 'src/' },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'JIRA:{id}',
        registryFile: jiraPath,
      },
    ]);

    // Pattern file wins, so origin should be the pattern's registryFile
    assert.equal(result.refOrigins.get('JIRA:PROJ-1'), jiraPath);
  });

  it('refOrigins is empty Map when no entries', async () => {
    const defaultPath = join(tmpDir, 'origins-empty.json');
    await writeFile(defaultPath, JSON.stringify({}));

    const result = await loadMultiRegistry(defaultPath, undefined);
    assert.equal(result.refOrigins.size, 0);
  });

  it('rejects pattern registryFile that escapes cwd boundary', async () => {
    const projectDir = join(tmpDir, 'boundary-project');
    const outsideDir = join(tmpDir, 'boundary-outside');
    await mkdir(projectDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    const defaultPath = join(projectDir, 'registry.json');
    const outsidePath = join(outsideDir, 'evil-registry.json');

    await writeFile(
      defaultPath,
      JSON.stringify({ 'SUP-1': { reason: 'ok', target: 'all' } }),
    );
    await writeFile(
      outsidePath,
      JSON.stringify({ 'EVIL-1': { reason: 'evil', target: 'all' } }),
    );

    await assert.rejects(
      () =>
        loadMultiRegistry(
          defaultPath,
          [
            {
              match: 'EVIL:{id}',
              registryFile: outsidePath,
            },
          ],
          undefined,
          projectDir,
        ),
      (err: unknown) => {
        assert.ok(err instanceof PathBoundaryError);
        return true;
      },
    );
  });

  it('accepts pattern registryFile within cwd boundary', async () => {
    const projectDir = join(tmpDir, 'boundary-ok-project');
    await mkdir(projectDir, { recursive: true });

    const defaultPath = join(projectDir, 'registry.json');
    const patternPath = join(projectDir, 'ns-registry.json');

    await writeFile(
      defaultPath,
      JSON.stringify({ 'SUP-1': { reason: 'ok', target: 'all' } }),
    );
    await writeFile(
      patternPath,
      JSON.stringify({ 'NS:1': { reason: 'ns', target: 'src/' } }),
    );

    const result = await loadMultiRegistry(
      defaultPath,
      [
        {
          match: 'NS:{id}',
          registryFile: patternPath,
        },
      ],
      undefined,
      projectDir,
    );

    assert.equal(Object.keys(result.registry).length, 2);
    assert.equal(result.registry['NS:1']!.reason, 'ns');
  });

  it('skips boundary check when cwd is not provided', async () => {
    const defaultPath = join(tmpDir, 'no-cwd-default.json');
    const patternPath = join(tmpDir, 'no-cwd-pattern.json');

    await writeFile(
      defaultPath,
      JSON.stringify({ 'SUP-1': { reason: 'default', target: 'all' } }),
    );
    await writeFile(
      patternPath,
      JSON.stringify({ 'NS:1': { reason: 'pattern', target: 'src/' } }),
    );

    // No cwd provided — should not throw even if paths cross directories
    const result = await loadMultiRegistry(defaultPath, [
      {
        match: 'NS:{id}',
        registryFile: patternPath,
      },
    ]);

    assert.equal(Object.keys(result.registry).length, 2);
  });
});

describe('routeRegistryByPattern', () => {
  const registry: Registry = {
    'JIRA:PROJ-1': {
      reason: 'jira entry',
      target: 'src/a.ts',
      expires: undefined,
      ticket: undefined,
      owner: undefined,
      notes: undefined,
      kind: undefined,
    },
    'ADR:0007': {
      reason: 'adr entry',
      target: 'docs/',
      expires: undefined,
      ticket: undefined,
      owner: undefined,
      notes: undefined,
      kind: undefined,
    },
    'SUP-1234': {
      reason: 'default entry',
      target: 'all',
      expires: undefined,
      ticket: undefined,
      owner: undefined,
      notes: undefined,
      kind: undefined,
    },
  };

  it('routes entries to pattern-specific files', () => {
    const patterns = [
      {
        match: 'JIRA:{id}',
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: 'jira-registry.json',
      },
      {
        match: 'ADR:{id}',
        urlTemplate: 'docs/decisions/{id}.md',
        registryFile: 'adr-registry.yaml',
      },
    ];

    const routed = routeRegistryByPattern(registry, patterns);

    assert.equal(routed.size, 3);
    assert.deepEqual(Object.keys(routed.get('jira-registry.json')!), [
      'JIRA:PROJ-1',
    ]);
    assert.deepEqual(Object.keys(routed.get('adr-registry.yaml')!), [
      'ADR:0007',
    ]);
    assert.deepEqual(Object.keys(routed.get(null)!), ['SUP-1234']);
  });

  it('routes all to default when no patterns', () => {
    const routed = routeRegistryByPattern(registry, undefined);
    assert.equal(routed.size, 1);
    assert.equal(Object.keys(routed.get(null)!).length, 3);
  });

  it('routes all to default when pattern has no registryFile', () => {
    const patterns = [
      {
        match: 'JIRA:{id}',
        urlTemplate: 'https://jira.example.com/browse/{id}',
      },
    ];
    const routed = routeRegistryByPattern(registry, patterns);
    assert.equal(routed.size, 1);
    assert.equal(Object.keys(routed.get(null)!).length, 3);
  });
});

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> = {},
): ShioriAnnotation {
  return {
    ref: 'TEST-001',
    rule: 'no-console',
    tagged: true,
    ignored: false,
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

describe('isValidRef', () => {
  it('accepts valid refs', () => {
    assert.equal(isValidRef('SUP-1234'), true);
    assert.equal(isValidRef('ADR:0007'), true);
    assert.equal(isValidRef('JIRA:PROJ-123'), true);
    assert.equal(isValidRef('DEV-001'), true);
    assert.equal(isValidRef('MIG-1'), true);
  });

  it('rejects invalid refs', () => {
    assert.equal(isValidRef('prefix'), false);
    assert.equal(isValidRef('marker'), false);
    assert.equal(isValidRef("');"), false);
    assert.equal(isValidRef('`'), false);
    assert.equal(isValidRef('→'), false);
    assert.equal(isValidRef('(no'), false);
    assert.equal(isValidRef("SUP-1234');"), false);
    assert.equal(isValidRef("ignore');"), false);
  });

  it('rejects empty string', () => {
    assert.equal(isValidRef(''), false);
  });
});

describe('initRegistry ref validation', () => {
  it('filters out invalid refs from generated registry', () => {
    const records = [
      makeAnnotation({ ref: 'SUP-1234' }),
      makeAnnotation({ ref: 'marker)' }),
      makeAnnotation({ ref: "');", location: { file: 'test.ts', line: 2 } }),
      makeAnnotation({
        ref: 'DEV-001',
        location: { file: 'test.ts', line: 3 },
      }),
    ];
    const registry = initRegistry({ records });
    assert.ok('SUP-1234' in registry);
    assert.ok('DEV-001' in registry);
    assert.ok(!('marker)' in registry));
    assert.ok(!("');" in registry));
  });

  it('preserves existing registry entries regardless of ref format', () => {
    const records = [makeAnnotation({ ref: 'SUP-1234' })];
    const existingRegistry: Registry = {
      'legacy-ref': {
        reason: 'legacy',
        target: 'all',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const registry = initRegistry({ records, existingRegistry });
    assert.ok('SUP-1234' in registry);
    assert.ok('legacy-ref' in registry);
  });
});
