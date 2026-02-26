import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../src/core/registry-loader.ts';

describe('loadConfigAndRegistry', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-registry-loader-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, '.config', 'shiori'), { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads config and default registry in one call', async () => {
    const registryPath = join(tmpDir, '.config', 'shiori', 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify({
        'SUP-1234': { reason: 'test', target: 'all' },
      }),
    );

    const result = await loadConfigAndRegistry({ cwd: tmpDir });

    assert.ok(result.config);
    assert.equal(result.registry['SUP-1234']!.reason, 'test');
    assert.equal(result.registryPath, registryPath);
    assert.equal(result.errors.length, 0);
    assert.equal(result.duplicates.length, 0);
  });

  it('passes explicit registry path through', async () => {
    const customPath = join(tmpDir, 'custom-registry.json');
    await writeFile(
      customPath,
      JSON.stringify({
        'CUSTOM-1': { reason: 'custom', target: 'src/' },
      }),
    );

    const result = await loadConfigAndRegistry({
      cwd: tmpDir,
      registryPath: customPath,
    });

    assert.equal(result.registryPath, customPath);
    assert.equal(result.registry['CUSTOM-1']!.reason, 'custom');
  });

  it('passes explicit config directory through', async () => {
    const configDir = join(tmpDir, 'custom-config');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({ paths: { registry: '.config/shiori/registry.json' } }),
    );

    const registryPath = join(tmpDir, '.config', 'shiori', 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify({
        'SUP-1': { reason: 'with config', target: 'all' },
      }),
    );

    const result = await loadConfigAndRegistry({
      cwd: tmpDir,
      configDir,
    });

    assert.ok(result.config);
    assert.equal(result.registry['SUP-1']!.reason, 'with config');
  });

  it('returns validation errors from registry', async () => {
    const registryPath = join(tmpDir, '.config', 'shiori', 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify({
        'BAD-1': { target: 'all' }, // missing reason
      }),
    );

    const result = await loadConfigAndRegistry({ cwd: tmpDir });

    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.message.includes('reason')));
  });

  it('loads multi-registry with pattern config', async () => {
    const configDir = join(tmpDir, 'multi-config');
    await mkdir(configDir, { recursive: true });
    const registryDir = join(tmpDir, 'multi-registries');
    await mkdir(registryDir, { recursive: true });

    const defaultPath = join(registryDir, 'registry.json');
    const jiraPath = join(registryDir, 'jira-registry.json');

    await writeFile(
      defaultPath,
      JSON.stringify({
        'SUP-1': { reason: 'default', target: 'all' },
      }),
    );
    await writeFile(
      jiraPath,
      JSON.stringify({
        'JIRA:PROJ-1': { reason: 'jira', target: 'src/' },
      }),
    );
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({
        refPatterns: [
          {
            match: 'JIRA:{id}',
            urlTemplate: 'https://jira.example.com/browse/{id}',
            registryFile: jiraPath,
          },
        ],
      }),
    );

    const result = await loadConfigAndRegistry({
      cwd: tmpDir,
      configDir,
      registryPath: defaultPath,
    });

    assert.equal(Object.keys(result.registry).length, 2);
    assert.equal(result.registry['SUP-1']!.reason, 'default');
    assert.equal(result.registry['JIRA:PROJ-1']!.reason, 'jira');
  });
});

describe('reportRegistryIssues', () => {
  it('logs nothing when no issues', (t) => {
    const errors: string[] = [];
    const originalError = console.error;
    t.after(() => {
      console.error = originalError;
    });
    console.error = (...args: unknown[]) => {
      errors.push(args.join(' '));
    };

    reportRegistryIssues({ errors: [], duplicates: [] });

    assert.equal(errors.length, 0);
  });

  it('logs validation errors', (t) => {
    const output: string[] = [];
    const originalError = console.error;
    t.after(() => {
      console.error = originalError;
    });
    console.error = (...args: unknown[]) => {
      output.push(args.join(' '));
    };

    reportRegistryIssues({
      errors: [{ id: 'REF-1', message: 'missing field' }],
      duplicates: [],
    });

    assert.ok(
      output.some((line) => line.includes('Registry validation errors')),
    );
    assert.ok(output.some((line) => line.includes('REF-1: missing field')));
  });

  it('logs duplicate warnings', (t) => {
    const output: string[] = [];
    const originalError = console.error;
    t.after(() => {
      console.error = originalError;
    });
    console.error = (...args: unknown[]) => {
      output.push(args.join(' '));
    };

    reportRegistryIssues({
      errors: [],
      duplicates: [
        {
          ref: 'JIRA:PROJ-1',
          defaultFile: 'default.json',
          patternFile: 'jira.json',
        },
      ],
    });

    assert.ok(
      output.some((line) => line.includes('Registry duplicate warnings')),
    );
    assert.ok(
      output.some(
        (line) =>
          line.includes('JIRA:PROJ-1') &&
          line.includes('default.json') &&
          line.includes('jira.json'),
      ),
    );
  });
});
