/**
 * Unit tests for autoInitProject() (EP-0152).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoInitProject } from '../src/core/auto-init.ts';

describe('autoInitProject', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-autoinit-unit-'));
  });

  after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('creates config and registry in empty directory', async () => {
    const cwd = await mkdtemp(join(baseDir, 'empty-'));

    const result = await autoInitProject({ cwd });

    assert.equal(result.configCreated, true);
    assert.equal(result.registryCreated, true);

    // Config should exist
    const config = await readFile(
      join(cwd, '.config', 'shiori', 'config.yaml'),
      'utf-8',
    );
    assert.ok(config.includes('shiori configuration'));

    // Registry should exist and be empty
    const registry = await readFile(
      join(cwd, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    assert.deepEqual(JSON.parse(registry), {});
  });

  it('skips config creation when config.yaml already exists', async () => {
    const cwd = await mkdtemp(join(baseDir, 'has-config-'));
    await mkdir(join(cwd, '.config', 'shiori'), { recursive: true });
    await writeFile(
      join(cwd, '.config', 'shiori', 'config.yaml'),
      '# existing config\n',
      'utf-8',
    );

    const result = await autoInitProject({ cwd });

    assert.equal(result.configCreated, false);
    assert.equal(result.registryCreated, true);

    // Config should NOT be overwritten
    const config = await readFile(
      join(cwd, '.config', 'shiori', 'config.yaml'),
      'utf-8',
    );
    assert.equal(config, '# existing config\n');
  });

  it('skips registry creation when registry.json already exists', async () => {
    const cwd = await mkdtemp(join(baseDir, 'has-registry-'));
    await mkdir(join(cwd, '.config', 'shiori'), { recursive: true });
    await writeFile(
      join(cwd, '.config', 'shiori', 'registry.json'),
      '{"EXISTING-001": {"reason": "test"}}\n',
      'utf-8',
    );

    const result = await autoInitProject({ cwd });

    assert.equal(result.configCreated, true);
    assert.equal(result.registryCreated, false);

    // Registry should NOT be overwritten
    const registry = await readFile(
      join(cwd, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    assert.ok(registry.includes('EXISTING-001'));
  });

  it('skips both when both already exist', async () => {
    const cwd = await mkdtemp(join(baseDir, 'has-both-'));
    await mkdir(join(cwd, '.config', 'shiori'), { recursive: true });
    await writeFile(
      join(cwd, '.config', 'shiori', 'config.yaml'),
      '# existing\n',
      'utf-8',
    );
    await writeFile(
      join(cwd, '.config', 'shiori', 'registry.json'),
      '{}\n',
      'utf-8',
    );

    const result = await autoInitProject({ cwd });

    assert.equal(result.configCreated, false);
    assert.equal(result.registryCreated, false);
  });

  it('returns correct registryPath', async () => {
    const cwd = await mkdtemp(join(baseDir, 'path-'));

    const result = await autoInitProject({ cwd });

    assert.equal(
      result.registryPath,
      join(cwd, '.config', 'shiori', 'registry.json'),
    );
  });
});
