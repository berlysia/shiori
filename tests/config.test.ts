import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  resolveConfig,
  resolveRegistryPath,
  DEFAULT_SCAN_RESULT_PATH,
} from '../src/core/config.ts';

describe('config', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-config-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', async () => {
      const config = await loadConfig(tmpDir);
      assert.deepEqual(config.candidatePatterns, {
        'lint-disable': true,
        todo: false,
        fixme: false,
        hack: false,
        xxx: false,
      });
      assert.equal(config.scanPatterns, undefined);
      assert.equal(config.scanIgnore, undefined);
      assert.equal(config.paths.scanResult, DEFAULT_SCAN_RESULT_PATH);
      assert.equal(config.paths.registry, undefined);
    });

    it('loads from .config/shiori/config.json', async () => {
      const configDir = join(tmpDir, 'new-format', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.json'),
        JSON.stringify({ candidates: { todo: true, fixme: true } }),
        'utf-8',
      );

      const config = await loadConfig(join(tmpDir, 'new-format'));
      assert.equal(config.candidatePatterns['lint-disable'], true);
      assert.equal(config.candidatePatterns.todo, true);
      assert.equal(config.candidatePatterns.fixme, true);
      assert.equal(config.candidatePatterns.hack, false);
    });

    it('uses explicit configDir when provided', async () => {
      const customDir = join(tmpDir, 'custom-config');
      await mkdir(customDir, { recursive: true });
      await writeFile(
        join(customDir, 'config.json'),
        JSON.stringify({ candidates: { hack: true } }),
        'utf-8',
      );

      const config = await loadConfig(tmpDir, customDir);
      assert.equal(config.candidatePatterns.hack, true);
    });

    it('loads scan and paths config', async () => {
      const configDir = join(tmpDir, 'full-config', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.json'),
        JSON.stringify({
          scan: {
            patterns: ['src/**/*.ts'],
            ignore: ['**/test/**'],
          },
          paths: {
            scanResult: 'custom/scan.json',
            registry: 'custom/registry.json',
          },
        }),
        'utf-8',
      );

      const config = await loadConfig(join(tmpDir, 'full-config'));
      assert.deepEqual(config.scanPatterns, ['src/**/*.ts']);
      assert.deepEqual(config.scanIgnore, ['**/test/**']);
      assert.equal(config.paths.scanResult, 'custom/scan.json');
      assert.equal(config.paths.registry, 'custom/registry.json');
    });

    it('throws on invalid JSON', async () => {
      const configDir = join(tmpDir, 'invalid', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'config.json'), 'not json', 'utf-8');

      await assert.rejects(
        () => loadConfig(join(tmpDir, 'invalid')),
        SyntaxError,
      );
    });
  });

  describe('resolveConfig', () => {
    it('returns defaults for empty config', () => {
      const config = resolveConfig({});
      assert.deepEqual(config.candidatePatterns, {
        'lint-disable': true,
        todo: false,
        fixme: false,
        hack: false,
        xxx: false,
      });
      assert.equal(config.refPatterns, undefined);
      assert.equal(config.scanPatterns, undefined);
      assert.equal(config.scanIgnore, undefined);
      assert.equal(config.paths.scanResult, DEFAULT_SCAN_RESULT_PATH);
      assert.equal(config.paths.registry, undefined);
    });

    it('overrides specific patterns', () => {
      const config = resolveConfig({
        candidates: { todo: true },
      });
      assert.equal(config.candidatePatterns.todo, true);
      assert.equal(config.candidatePatterns['lint-disable'], true);
    });

    it('passes through refPatterns', () => {
      const config = resolveConfig({
        refPatterns: [
          { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/{id}' },
        ],
      });
      assert.equal(config.refPatterns!.length, 1);
      assert.equal(config.refPatterns![0]!.match, 'JIRA:{id}');
    });

    it('resolves scan and paths fields', () => {
      const config = resolveConfig({
        scan: { patterns: ['**/*.ts'], ignore: ['dist/**'] },
        paths: { scanResult: 'out/scan.json', registry: 'my-registry.json' },
      });
      assert.deepEqual(config.scanPatterns, ['**/*.ts']);
      assert.deepEqual(config.scanIgnore, ['dist/**']);
      assert.equal(config.paths.scanResult, 'out/scan.json');
      assert.equal(config.paths.registry, 'my-registry.json');
    });
  });

  describe('resolveRegistryPath', () => {
    it('returns explicit path immediately', async () => {
      const result = await resolveRegistryPath(
        '/explicit/path.json',
        resolveConfig({}),
        tmpDir,
      );
      assert.equal(result, '/explicit/path.json');
    });

    it('finds .config/shiori/registry.json in cwd', async () => {
      const projectDir = join(tmpDir, 'registry-test');
      const registryDir = join(projectDir, '.config', 'shiori');
      await mkdir(registryDir, { recursive: true });
      await writeFile(join(registryDir, 'registry.json'), '{}', 'utf-8');

      const result = await resolveRegistryPath(
        undefined,
        resolveConfig({}),
        projectDir,
      );
      assert.equal(result, join(registryDir, 'registry.json'));
    });

    it('prefers config.paths.registry over default', async () => {
      const projectDir = join(tmpDir, 'registry-priority');
      const registryDir = join(projectDir, '.config', 'shiori');
      await mkdir(registryDir, { recursive: true });
      await writeFile(join(registryDir, 'registry.json'), '{}', 'utf-8');
      await writeFile(join(projectDir, 'custom-registry.json'), '{}', 'utf-8');

      const config = resolveConfig({
        paths: { registry: 'custom-registry.json' },
      });
      const result = await resolveRegistryPath(undefined, config, projectDir);
      assert.equal(result, join(projectDir, 'custom-registry.json'));
    });

    it('throws when no registry found', async () => {
      const emptyDir = join(tmpDir, 'no-registry');
      await mkdir(emptyDir, { recursive: true });

      await assert.rejects(
        () => resolveRegistryPath(undefined, resolveConfig({}), emptyDir),
        /No registry file found/,
      );
    });
  });
});
