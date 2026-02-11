import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMultiRegistry } from '../src/core/registry.ts';
import { routeRegistryByNamespace } from '../src/commands/init-registry.ts';
import type { Registry } from '../src/core/types.ts';

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

  it('loads only default registry when no registryFile in namespaces', async () => {
    const defaultPath = join(tmpDir, 'default2.json');
    await writeFile(
      defaultPath,
      JSON.stringify({
        'SUP-1234': { reason: 'test', target: 'all' },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, {
      JIRA: { urlTemplate: 'https://jira.example.com/browse/{id}' },
    });
    assert.equal(Object.keys(result.registry).length, 1);
    assert.equal(result.duplicates.length, 0);
  });

  it('merges namespace-specific registry', async () => {
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

    const result = await loadMultiRegistry(defaultPath, {
      JIRA: {
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: jiraPath,
      },
    });

    assert.equal(Object.keys(result.registry).length, 2);
    assert.equal(result.registry['SUP-1234']!.reason, 'default entry');
    assert.equal(result.registry['JIRA:PROJ-123']!.reason, 'jira entry');
    assert.equal(result.duplicates.length, 0);
  });

  it('namespace file wins on duplicate keys', async () => {
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
        'JIRA:PROJ-123': { reason: 'authoritative entry', target: 'src/api.ts' },
      }),
    );

    const result = await loadMultiRegistry(defaultPath, {
      JIRA: {
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: jiraPath,
      },
    });

    assert.equal(result.registry['JIRA:PROJ-123']!.reason, 'authoritative entry');
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0]!.ref, 'JIRA:PROJ-123');
  });

  it('merges multiple namespace registries', async () => {
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

    const result = await loadMultiRegistry(defaultPath, {
      JIRA: {
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: jiraPath,
      },
      ADR: {
        urlTemplate: 'docs/decisions/{id}.md',
        registryFile: adrPath,
      },
    });

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

    // Two namespaces pointing to the same file
    const result = await loadMultiRegistry(defaultPath, {
      NS1: {
        urlTemplate: 'https://example.com/{id}',
        registryFile: sharedPath,
      },
      NS2: {
        urlTemplate: 'https://example.com/{id}',
        registryFile: sharedPath,
      },
    });

    assert.equal(Object.keys(result.registry).length, 2);
  });
});

describe('routeRegistryByNamespace', () => {
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

  it('routes entries to namespace-specific files', () => {
    const namespaces = {
      JIRA: {
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: 'jira-registry.json',
      },
      ADR: {
        urlTemplate: 'docs/decisions/{id}.md',
        registryFile: 'adr-registry.yaml',
      },
    };

    const routed = routeRegistryByNamespace(registry, namespaces);

    assert.equal(routed.size, 3);
    assert.deepEqual(Object.keys(routed.get('jira-registry.json')!), [
      'JIRA:PROJ-1',
    ]);
    assert.deepEqual(Object.keys(routed.get('adr-registry.yaml')!), [
      'ADR:0007',
    ]);
    assert.deepEqual(Object.keys(routed.get(null)!), ['SUP-1234']);
  });

  it('routes all to default when no namespaces', () => {
    const routed = routeRegistryByNamespace(registry, undefined);
    assert.equal(routed.size, 1);
    assert.equal(Object.keys(routed.get(null)!).length, 3);
  });

  it('routes all to default when namespace has no registryFile', () => {
    const namespaces = {
      JIRA: { urlTemplate: 'https://jira.example.com/browse/{id}' },
    };
    const routed = routeRegistryByNamespace(registry, namespaces);
    assert.equal(routed.size, 1);
    assert.equal(Object.keys(routed.get(null)!).length, 3);
  });
});
