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
import type { ResolvedCandidatePatterns } from '../src/core/providers/AnnotationProvider.ts';

/** Extract enabled map from resolved patterns for a given entry */
function getEnabledMap(
  patterns: ResolvedCandidatePatterns,
  entry: string,
): Record<string, boolean> {
  const matchers = patterns.entries[entry];
  if (!matchers) return {};
  return Object.fromEntries(matchers.map((m) => [m.name, m.enabled]));
}

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
      // Default: eslint and stylelint enabled with all directives
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'stylelint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      // typescript not in defaults
      assert.deepEqual(
        getEnabledMap(config.candidatePatterns, 'typescript'),
        {},
      );
      // keywords disabled by default
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'keywords'), {
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
        JSON.stringify({
          candidates: { keywords: { todo: true, fixme: true } },
        }),
        'utf-8',
      );

      const config = await loadConfig(join(tmpDir, 'new-format'));
      // eslint still enabled (from defaults)
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      // keywords: todo and fixme explicitly true, others default enabled (builtin)
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      assert.equal(kwMap.todo, true);
      assert.equal(kwMap.fixme, true);
      // hack and xxx are builtins not explicitly set in CandidateToolConfig → default enabled
      assert.equal(kwMap.hack, true);
      assert.equal(kwMap.xxx, true);
    });

    it('uses explicit configDir when provided', async () => {
      const customDir = join(tmpDir, 'custom-config');
      await mkdir(customDir, { recursive: true });
      await writeFile(
        join(customDir, 'config.json'),
        JSON.stringify({ candidates: { keywords: { hack: true } } }),
        'utf-8',
      );

      const config = await loadConfig(tmpDir, customDir);
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      assert.equal(kwMap.hack, true);
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

    it('loads from config.yaml', async () => {
      const configDir = join(tmpDir, 'yaml-config', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        'candidates:\n  keywords:\n    todo: true\n    fixme: true\n',
        'utf-8',
      );

      const config = await loadConfig(join(tmpDir, 'yaml-config'));
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      assert.equal(kwMap.todo, true);
      assert.equal(kwMap.fixme, true);
    });

    it('prefers config.yaml over config.json', async () => {
      const configDir = join(tmpDir, 'yaml-priority', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        'candidates:\n  keywords:\n    todo: true\n',
        'utf-8',
      );
      await writeFile(
        join(configDir, 'config.json'),
        JSON.stringify({ candidates: { keywords: { hack: true } } }),
        'utf-8',
      );

      const config = await loadConfig(join(tmpDir, 'yaml-priority'));
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      assert.equal(kwMap.todo, true);
      // hack not in yaml config → still enabled (builtin default in CandidateToolConfig)
      assert.equal(kwMap.hack, true);
    });

    it('throws on invalid YAML', async () => {
      const configDir = join(tmpDir, 'invalid-yaml', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        '  bad:\n yaml: [unclosed',
        'utf-8',
      );

      await assert.rejects(
        () => loadConfig(join(tmpDir, 'invalid-yaml')),
        /Error/,
      );
    });

    it('returns defaults for comment-only YAML', async () => {
      const configDir = join(tmpDir, 'comment-yaml', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        '# shiori configuration\n# all commented out\n',
        'utf-8',
      );

      const config = await loadConfig(join(tmpDir, 'comment-yaml'));
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'keywords'), {
        todo: false,
        fixme: false,
        hack: false,
        xxx: false,
      });
    });

    it('resolves per-tool config from YAML', async () => {
      const configDir = join(tmpDir, 'per-tool-yaml', '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        [
          'candidates:',
          '  eslint: true',
          '  stylelint:',
          '    disable-next-line: true',
          '    disable-line: false',
          '  typescript:',
          '    ts-ignore: true',
          '    ts-expect-error: false',
          '  keywords:',
          '    todo: true',
        ].join('\n'),
        'utf-8',
      );

      const config = await loadConfig(join(tmpDir, 'per-tool-yaml'));
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'stylelint'), {
        'disable-next-line': true,
        'disable-line': false,
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'typescript'), {
        'ts-ignore': true,
        'ts-expect-error': false,
      });
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      assert.equal(kwMap.todo, true);
    });
  });

  describe('resolveConfig', () => {
    it('returns defaults for empty config', () => {
      const config = resolveConfig({});
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'stylelint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'keywords'), {
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
        candidates: { keywords: { todo: true } },
      });
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      assert.equal(kwMap.todo, true);
      // eslint still enabled from defaults
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': true,
        'disable-line': true,
      });
    });

    it('resolves boolean tool config to all directives', () => {
      const config = resolveConfig({
        candidates: { eslint: false },
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': false,
        'disable-line': false,
      });
    });

    it('merges per-directive config with defaults', () => {
      const config = resolveConfig({
        candidates: {
          eslint: { 'disable-next-line': false },
        },
      });
      assert.deepEqual(getEnabledMap(config.candidatePatterns, 'eslint'), {
        'disable-next-line': false,
        'disable-line': true,
      });
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

    it('resolves _matchers merge with builtins', () => {
      const config = resolveConfig({
        candidates: {
          keywords: {
            _matchers: {
              note: {
                pattern: '^NOTE\\b:?\\s*(.*)',
                text: true,
              },
            },
            note: true,
            todo: true,
          },
        },
      });
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      assert.equal(kwMap.note, true);
      assert.equal(kwMap.todo, true);
      // builtins not explicitly set → default enabled
      assert.equal(kwMap.fixme, true);
      assert.equal(kwMap.hack, true);
      assert.equal(kwMap.xxx, true);
    });

    it('_matchers-added matchers default to disabled', () => {
      const config = resolveConfig({
        candidates: {
          keywords: {
            _matchers: {
              note: {
                pattern: '^NOTE\\b:?\\s*(.*)',
                text: true,
              },
            },
            todo: true,
          },
        },
      });
      const kwMap = getEnabledMap(config.candidatePatterns, 'keywords');
      // note not explicitly set → default disabled (added via _matchers, not builtin)
      assert.equal(kwMap.note, false);
      assert.equal(kwMap.todo, true);
    });

    it('falls back to default when expiringThresholdDays is invalid', () => {
      // String value should fall back to default 14
      const config = resolveConfig({
        verify: { expiringThresholdDays: 'seven' as unknown as number },
      });
      assert.equal(config.verify.expiringThresholdDays, 14);
    });

    it('falls back to default when expiringThresholdDays is zero', () => {
      const config = resolveConfig({
        verify: { expiringThresholdDays: 0 },
      });
      assert.equal(config.verify.expiringThresholdDays, 14);
    });

    it('falls back to default when expiringThresholdDays is negative', () => {
      const config = resolveConfig({
        verify: { expiringThresholdDays: -5 },
      });
      assert.equal(config.verify.expiringThresholdDays, 14);
    });

    it('falls back to default when expiringThresholdDays is float', () => {
      const config = resolveConfig({
        verify: { expiringThresholdDays: 3.5 },
      });
      assert.equal(config.verify.expiringThresholdDays, 14);
    });

    it('accepts valid expiringThresholdDays', () => {
      const config = resolveConfig({
        verify: { expiringThresholdDays: 30 },
      });
      assert.equal(config.verify.expiringThresholdDays, 30);
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
