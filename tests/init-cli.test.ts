import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, createTempBase } from './helpers/cli-test-utils.ts';

describe('init-cli: argument validation and error paths', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-init-test-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('fresh directory initialization', () => {
    it('creates config, registry, and .gitignore in empty directory', async () => {
      const initDir = await mkdtemp(join(baseDir, 'fresh-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: FRESH-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('shiori initialized'));
      assert.ok(stderr.includes('config: created .config/shiori/config.yaml'));
      assert.ok(stderr.includes('registry: created'));
      assert.ok(stderr.includes('gitignore: added'));

      // Verify files were created
      const configContent = await readFile(
        join(initDir, '.config', 'shiori', 'config.yaml'),
        'utf-8',
      );
      assert.ok(configContent.includes('shiori configuration'));

      const registryContent = await readFile(
        join(initDir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('FRESH-001' in registry);

      const gitignore = await readFile(join(initDir, '.gitignore'), 'utf-8');
      assert.ok(gitignore.includes('.config/shiori/scan-result.json'));
    });
  });

  describe('existing config skip', () => {
    it('skips config creation when config.yaml already exists', async () => {
      const initDir = await mkdtemp(join(baseDir, 'existing-config-'));
      await mkdir(join(initDir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(initDir, '.config', 'shiori', 'config.yaml'),
        '# existing config\n',
        'utf-8',
      );
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: EXIST-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('config.yaml already exists, skipped'));

      // Verify original config was NOT overwritten
      const configContent = await readFile(
        join(initDir, '.config', 'shiori', 'config.yaml'),
        'utf-8',
      );
      assert.equal(configContent, '# existing config\n');
    });

    it('detects config.yml as existing config', async () => {
      const initDir = await mkdtemp(join(baseDir, 'existing-yml-'));
      await mkdir(join(initDir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(initDir, '.config', 'shiori', 'config.yml'),
        '# yml config\n',
        'utf-8',
      );
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: YML-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('config.yml already exists, skipped'));
    });

    it('detects config.json as existing config', async () => {
      const initDir = await mkdtemp(join(baseDir, 'existing-json-'));
      await mkdir(join(initDir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(initDir, '.config', 'shiori', 'config.json'),
        '{}',
        'utf-8',
      );
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: JSON-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('config.json already exists, skipped'));
    });
  });

  describe('existing registry skip', () => {
    it('skips registry generation when default registry already exists', async () => {
      const initDir = await mkdtemp(join(baseDir, 'existing-registry-'));
      await mkdir(join(initDir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(initDir, '.config', 'shiori', 'registry.json'),
        JSON.stringify({ 'EXISTING-001': { reason: 'existing' } }, null, 2),
        'utf-8',
      );
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: NEW-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('registry.json already exists, skipped'));

      // Verify original registry was NOT overwritten
      const registryContent = await readFile(
        join(initDir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('EXISTING-001' in registry);
      assert.ok(!('NEW-001' in registry));
    });
  });

  describe('existing .gitignore skip', () => {
    it('skips .gitignore update when entry already present', async () => {
      const initDir = await mkdtemp(join(baseDir, 'existing-gitignore-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: GI-001\n',
        'utf-8',
      );
      await writeFile(
        join(initDir, '.gitignore'),
        'node_modules/\n.config/shiori/scan-result.json\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(
        stderr.includes(
          'gitignore: already contains scan-result entry, skipped',
        ),
      );
    });
  });

  describe('custom --registry flag', () => {
    it('creates registry at custom path', async () => {
      const initDir = await mkdtemp(join(baseDir, 'custom-reg-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: CUSTOM-001\n',
        'utf-8',
      );
      const customRegistryPath = join(initDir, 'custom-registry.json');

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--registry',
        customRegistryPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('registry: created'));

      const registryContent = await readFile(customRegistryPath, 'utf-8');
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('CUSTOM-001' in registry);
    });
  });

  describe('idempotent double init', () => {
    it('second init skips all existing artifacts', async () => {
      const initDir = await mkdtemp(join(baseDir, 'double-init-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: DOUBLE-001\n',
        'utf-8',
      );

      // First init
      const first = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(first.exitCode, 0);
      assert.ok(first.stderr.includes('config: created'));
      assert.ok(first.stderr.includes('registry: created'));
      assert.ok(first.stderr.includes('gitignore: added'));

      // Second init
      const second = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(second.exitCode, 0);
      assert.ok(second.stderr.includes('already exists, skipped'));
      assert.ok(
        second.stderr.includes(
          'gitignore: already contains scan-result entry, skipped',
        ),
      );
    });
  });

  describe('no annotations found', () => {
    it('initializes with empty registry when no source files match', async () => {
      const initDir = await mkdtemp(join(baseDir, 'empty-'));
      // No source files, just an empty directory
      await mkdir(join(initDir, 'src'), { recursive: true });

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('shiori initialized'));
      assert.ok(stderr.includes('scan: 0 files'));

      // Registry should be created (empty)
      const registryContent = await readFile(
        join(initDir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.equal(Object.keys(registry).length, 0);
    });

    it('initializes with empty registry when files exist but have no annotations', async () => {
      const initDir = await mkdtemp(join(baseDir, 'no-annot-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'clean.ts'),
        'const x = 1;\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('0 annotation(s)'));
    });
  });

  describe('--patterns flag', () => {
    it('uses custom comma-separated patterns', async () => {
      const initDir = await mkdtemp(join(baseDir, 'custom-patterns-'));
      await mkdir(join(initDir, 'lib'), { recursive: true });
      await writeFile(
        join(initDir, 'lib', 'main.ts'),
        '// shiori: PAT-001\n',
        'utf-8',
      );
      // File outside pattern should not be scanned
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'other.ts'),
        '// shiori: PAT-002\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'lib/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('1 annotation(s)'));

      const registryContent = await readFile(
        join(initDir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('PAT-001' in registry);
      assert.ok(!('PAT-002' in registry));
    });
  });

  describe('--ignore flag', () => {
    it('excludes files matching ignore patterns', async () => {
      const initDir = await mkdtemp(join(baseDir, 'custom-ignore-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'keep.ts'),
        '// shiori: IGN-001\n',
        'utf-8',
      );
      await mkdir(join(initDir, 'src', 'vendor'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'vendor', 'external.ts'),
        '// shiori: IGN-002\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--ignore',
        '**/vendor/**',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('1 annotation(s)'));

      const registryContent = await readFile(
        join(initDir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('IGN-001' in registry);
      assert.ok(!('IGN-002' in registry));
    });
  });

  describe('summary output format', () => {
    it('outputs structured summary to stderr', async () => {
      const initDir = await mkdtemp(join(baseDir, 'summary-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: SUM-001\n',
        'utf-8',
      );

      const { exitCode, stderr, stdout } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      // All output goes to stderr (init does not produce stdout)
      assert.equal(stdout, '');
      // Structured summary
      assert.ok(stderr.includes('shiori initialized:'));
      assert.ok(stderr.includes('Next steps:'));
      assert.ok(stderr.includes('shiori check'));
      // With 1 annotation → registryEntryCount=1, so "Review registry" is shown
      // instead of "shiori update" (which only appears when registryEntryCount=0)
      assert.ok(
        stderr.includes('Review and fill in registry entries'),
        'Expected registry review guidance when entries exist',
      );
      assert.ok(stderr.includes('shiori docs'));
    });
  });
});
