/**
 * CLI path resolution tests: verifies that explicit relative paths (--output, --registry, --scan)
 * are resolved against --cwd, not process.cwd().
 *
 * Scenario: process spawns CLI from PROJECT_ROOT, but --cwd points to a different directory.
 * Relative paths in --output/--registry/--scan should resolve against --cwd.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli as _runCli,
  PROJECT_ROOT,
  type CliResult,
} from './helpers/cli-test-utils.ts';

/**
 * Wrapper that keeps capture files within PROJECT_ROOT/.tmp/path-res-run
 * for path boundary safety.
 */
async function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<CliResult> {
  return _runCli(args, {
    cwd: options?.cwd,
    baseDir: join(PROJECT_ROOT, '.tmp', 'path-res-run'),
  });
}

describe('CLI path resolution: relative paths resolved against --cwd', () => {
  let workDir: string;

  before(async () => {
    const tmpBase = join(PROJECT_ROOT, '.tmp', 'test-path-res');
    await mkdir(tmpBase, { recursive: true });
    workDir = await mkdtemp(join(tmpBase, 'run-'));

    // Create source file for scanning
    await mkdir(join(workDir, 'src'), { recursive: true });
    await writeFile(
      join(workDir, 'src', 'app.ts'),
      '// shiori: PATH-001\n// eslint-disable-next-line no-console -- shiori: PATH-002\nconsole.log("test");\n',
      'utf-8',
    );
  });

  after(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  describe('scan --output with relative path', () => {
    it('resolves relative --output against --cwd, not process.cwd()', async () => {
      // --cwd = workDir, --output = out/scan.json (relative)
      // Expected: file written to workDir/out/scan.json, NOT PROJECT_ROOT/out/scan.json
      const { exitCode } = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        'out/scan.json',
      ]);

      assert.equal(exitCode, 0);

      const content = await readFile(
        join(workDir, 'out', 'scan.json'),
        'utf-8',
      );
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'PATH-001'));
    });
  });

  describe('watch --output with relative path', () => {
    it('resolves relative --output against --cwd', async () => {
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        'out/watch-scan.json',
      ]);

      assert.equal(exitCode, 0);

      const content = await readFile(
        join(workDir, 'out', 'watch-scan.json'),
        'utf-8',
      );
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'PATH-001'));
    });
  });

  describe('update --registry with relative path', () => {
    it('resolves relative --registry against --cwd', async () => {
      // First scan to generate scan result
      const scanResult = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(scanResult.exitCode, 0);

      // Write scan result to workDir
      const scanPath = join(workDir, 'scan-result.json');
      await writeFile(scanPath, scanResult.stdout, 'utf-8');

      // Create initial registry (relative path target)
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(join(workDir, 'data', 'registry.json'), '{}', 'utf-8');

      // Update with relative --registry and --scan paths
      const { exitCode, stderr } = await runCli([
        'update',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--registry',
        'data/registry.json',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('PATH-001'));

      // Verify registry was written to workDir/data/registry.json
      const registryContent = await readFile(
        join(workDir, 'data', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('PATH-001' in registry);
      assert.ok('PATH-002' in registry);
    });
  });

  describe('verify --scan and --registry with relative paths', () => {
    it('resolves relative --scan and --registry against --cwd', async () => {
      // Set up scan result
      const scanResult = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(scanResult.exitCode, 0);

      await writeFile(
        join(workDir, 'scan-result.json'),
        scanResult.stdout,
        'utf-8',
      );

      // Create registry with PATH-001 and PATH-002
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(
        join(workDir, 'data', 'registry.json'),
        JSON.stringify(
          {
            'PATH-001': { reason: 'test', target: 'all' },
            'PATH-002': { reason: 'test', target: 'all' },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const { exitCode, stdout } = await runCli([
        'verify',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--registry',
        'data/registry.json',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        summary: { errors: number };
      };
      assert.equal(result.summary.errors, 0);
    });
  });

  describe('watch --registry with relative path and --sync-registry', () => {
    it('resolves relative --registry against --cwd', async () => {
      // Create initial registry
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(
        join(workDir, 'data', 'watch-registry.json'),
        '{}',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        'out/watch-sync.json',
        '--sync-registry',
        '--registry',
        'data/watch-registry.json',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('new-refs='));

      // Verify registry was updated at workDir/data/watch-registry.json
      const registryContent = await readFile(
        join(workDir, 'data', 'watch-registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('PATH-001' in registry);
    });
  });

  describe('init with relative --registry', () => {
    it('resolves relative --registry against --cwd', async () => {
      const initDir = await mkdtemp(join(workDir, 'init-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: INIT-REL-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--registry',
        'custom/registry.json',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('registry: created'));

      // Verify registry was created at initDir/custom/registry.json
      const registryContent = await readFile(
        join(initDir, 'custom', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('INIT-REL-001' in registry);
    });
  });

  describe('verify --output with relative path', () => {
    it('resolves relative --output against --cwd', async () => {
      // Prepare scan result and registry in workDir
      const scanResult = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(scanResult.exitCode, 0);
      await writeFile(
        join(workDir, 'scan-result.json'),
        scanResult.stdout,
        'utf-8',
      );
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(
        join(workDir, 'data', 'registry.json'),
        JSON.stringify(
          {
            'PATH-001': { reason: 'test', target: 'all' },
            'PATH-002': { reason: 'test', target: 'all' },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const { exitCode } = await runCli([
        'verify',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--registry',
        'data/registry.json',
        '--output',
        'out/verify-report.json',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(
        join(workDir, 'out', 'verify-report.json'),
        'utf-8',
      );
      const result = JSON.parse(content) as { summary: { errors: number } };
      assert.equal(result.summary.errors, 0);
    });
  });

  describe('check --output with relative path', () => {
    it('resolves relative --output against --cwd', async () => {
      // Prepare registry
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(
        join(workDir, 'data', 'registry.json'),
        JSON.stringify(
          {
            'PATH-001': { reason: 'test', target: 'all' },
            'PATH-002': { reason: 'test', target: 'all' },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const { exitCode } = await runCli([
        'check',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--registry',
        'data/registry.json',
        '--output',
        'out/check-report.json',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(
        join(workDir, 'out', 'check-report.json'),
        'utf-8',
      );
      const result = JSON.parse(content) as { summary: { errors: number } };
      assert.equal(result.summary.errors, 0);
    });
  });

  describe('check --save-scan writes to --cwd', () => {
    it('saves scan result under --cwd/.config/shiori/', async () => {
      // Prepare registry and config in workDir
      await mkdir(join(workDir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(workDir, '.config', 'shiori', 'config.yaml'),
        '# shiori configuration\n',
        'utf-8',
      );
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(
        join(workDir, 'data', 'registry.json'),
        JSON.stringify(
          {
            'PATH-001': { reason: 'test', target: 'all' },
            'PATH-002': { reason: 'test', target: 'all' },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--registry',
        'data/registry.json',
        '--save-scan',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('Scan result saved to'));

      // Verify scan result was written under workDir (not PROJECT_ROOT)
      const scanContent = await readFile(
        join(workDir, '.config', 'shiori', 'scan-result.json'),
        'utf-8',
      );
      const scanResult = JSON.parse(scanContent) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(scanResult.annotations.some((a) => a.ref === 'PATH-001'));
    });
  });

  describe('draft --output with relative path', () => {
    it('resolves relative --output against --cwd', async () => {
      // Prepare scan result
      const scanResult = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(scanResult.exitCode, 0);
      await writeFile(
        join(workDir, 'scan-result.json'),
        scanResult.stdout,
        'utf-8',
      );

      const { exitCode } = await runCli([
        'draft',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--output',
        'out/draft-report.json',
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(
        join(workDir, 'out', 'draft-report.json'),
        'utf-8',
      );
      const result = JSON.parse(content) as { count: number };
      assert.ok(typeof result.count === 'number');
    });
  });

  describe('candidates --output with relative path', () => {
    it('resolves relative --output against --cwd', async () => {
      // Prepare scan result
      const scanResult = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(scanResult.exitCode, 0);
      await writeFile(
        join(workDir, 'scan-result.json'),
        scanResult.stdout,
        'utf-8',
      );

      const { exitCode } = await runCli([
        'candidates',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--output',
        'out/candidates-report.json',
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(
        join(workDir, 'out', 'candidates-report.json'),
        'utf-8',
      );
      const result = JSON.parse(content) as { count: number };
      assert.ok(typeof result.count === 'number');
    });
  });

  describe('--config with relative path resolved against --cwd (Concern 005)', () => {
    it('resolves relative --config against --cwd, not process.cwd()', async () => {
      // Create a custom config directory under workDir
      const customConfigDir = join(workDir, 'custom-config');
      await mkdir(customConfigDir, { recursive: true });
      await writeFile(
        join(customConfigDir, 'config.yaml'),
        [
          '# custom shiori config',
          'scan:',
          '  patterns:',
          '    - "src/**/*.ts"',
        ].join('\n') + '\n',
        'utf-8',
      );

      // --cwd = workDir, --config = custom-config (relative)
      // Expected: config loaded from workDir/custom-config/
      const { exitCode } = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--config',
        'custom-config',
        '--output',
        'out/config-rel.json',
      ]);

      assert.equal(exitCode, 0);

      const content = await readFile(
        join(workDir, 'out', 'config-rel.json'),
        'utf-8',
      );
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'PATH-001'));
    });
  });

  describe('absolute scanResult path in config (Concern 006)', () => {
    it('check --save-scan with absolute config.paths.scanResult writes correctly', async () => {
      // Create a temp dir for absolute path target (under workDir so boundary guard allows it)
      const absDir = await mkdtemp(join(workDir, 'abs-scan-'));
      const absScanPath = join(absDir, 'scan-result.json');

      // Create config with absolute path for scanResult
      const configDir = join(workDir, '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        [
          '# shiori configuration',
          'paths:',
          `  scanResult: "${absScanPath}"`,
        ].join('\n') + '\n',
        'utf-8',
      );

      // Create registry (required by check command)
      await writeFile(
        join(configDir, 'registry.json'),
        JSON.stringify(
          {
            'PATH-001': { reason: 'test', target: 'all' },
            'PATH-002': { reason: 'test', target: 'all' },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--save-scan',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 0, `check failed with stderr: ${stderr}`);

      // Verify scan result was written to the absolute path (not joined with cwd)
      const content = await readFile(absScanPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'PATH-001'));
    });
  });

  /**
   * Concern 006 regression tests: verify that absolute paths in config.paths.scanResult
   * are correctly resolved with path.resolve (not path.join) across all affected code paths.
   *
   * Modified code paths covered:
   * - scan-cli.ts L83,L112: resolve(cwd, output/config.paths.scanResult)
   * - init-cli.ts L70: resolve(cwd, config.paths.scanResult)
   * - scan-result-loader.ts L50: resolve(cwd, configPath) for custom config path
   * - scan-result-loader.ts L57: resolve(cwd, DEFAULT_SCAN_RESULT_PATH) fallback
   */
  describe('Concern 006 absolute path regression: scan --output with absolute path', () => {
    it('scan --output with absolute path writes to absolute location (scan-cli.ts L83,L112)', async () => {
      // Create absolute target under workDir (boundary guard allows it)
      const absDir = await mkdtemp(join(workDir, 'abs-scan-out-'));
      const absOutput = join(absDir, 'scan-result.json');

      const { exitCode, stderr } = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        absOutput, // absolute path
      ]);

      assert.equal(exitCode, 0, `scan failed: ${stderr}`);

      // Verify file written to absolute path (not joined with cwd)
      const content = await readFile(absOutput, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'PATH-001'));
    });
  });

  describe('Concern 006 absolute path regression: init with absolute config.paths.scanResult', () => {
    it('init resolves absolute config.paths.scanResult for boundary check (init-cli.ts L70)', async () => {
      const initDir = await mkdtemp(join(workDir, 'abs-init-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: ABS-INIT-001\n',
        'utf-8',
      );

      // Create config with absolute path for scanResult (pointing inside initDir)
      const absResultDir = await mkdtemp(join(initDir, 'abs-result-'));
      const absScanPath = join(absResultDir, 'scan-result.json');

      const configDir = join(initDir, '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        [
          '# shiori configuration',
          'paths:',
          `  scanResult: "${absScanPath}"`,
        ].join('\n') + '\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0, `init failed: ${stderr}`);

      // Verify scan result written to absolute path
      const content = await readFile(absScanPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'ABS-INIT-001'));
    });
  });

  describe('Concern 006 absolute path regression: verify --scan with absolute path', () => {
    it('verify resolves absolute --scan path via scan-result-loader (L33)', async () => {
      // Create scan result at an absolute path
      const absDir = await mkdtemp(join(workDir, 'abs-loader-'));
      const absScanPath = join(absDir, 'scan-result.json');

      // First scan to generate result
      const scanResult = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(scanResult.exitCode, 0);
      await writeFile(absScanPath, scanResult.stdout, 'utf-8');

      // Create minimal registry
      const configDir = join(workDir, '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'registry.json'),
        JSON.stringify(
          {
            'PATH-001': { reason: 'test', target: 'all' },
            'PATH-002': { reason: 'test', target: 'all' },
          },
          null,
          2,
        ),
        'utf-8',
      );

      // verify with absolute --scan path (tests scan-result-loader.ts L33 resolve)
      const { exitCode, stdout, stderr } = await runCli([
        'verify',
        '--cwd',
        workDir,
        '--scan',
        absScanPath, // absolute path
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 0, `verify failed: ${stderr}`);
      const result = JSON.parse(stdout) as {
        summary: { errors: number };
      };
      assert.equal(result.summary.errors, 0);
    });
  });

  describe('Concern 006 absolute path regression: update --scan with absolute path', () => {
    it('update resolves absolute --scan path via scan-result-loader (L33)', async () => {
      // Create scan result at an absolute path
      const absDir = await mkdtemp(join(workDir, 'abs-update-'));
      const absScanPath = join(absDir, 'scan-result.json');

      // First scan to generate result
      const scanResult = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
      ]);
      assert.equal(scanResult.exitCode, 0);
      await writeFile(absScanPath, scanResult.stdout, 'utf-8');

      // Create empty registry at absolute path
      const absRegistryPath = join(absDir, 'registry.json');
      await writeFile(absRegistryPath, '{}', 'utf-8');

      // update with absolute --scan and --registry paths
      const { exitCode, stderr } = await runCli([
        'update',
        '--cwd',
        workDir,
        '--scan',
        absScanPath, // absolute path
        '--registry',
        absRegistryPath, // absolute path
      ]);

      assert.equal(exitCode, 0, `update failed: ${stderr}`);
      assert.ok(stderr.includes('PATH-001'));

      // Verify registry was updated at absolute path
      const registryContent = await readFile(absRegistryPath, 'utf-8');
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('PATH-001' in registry);
    });
  });

  describe('Concern 006 absolute path regression: check --save-scan with absolute cwd', () => {
    it('check with absolute --cwd and --save-scan resolves config.paths.scanResult correctly', async () => {
      const checkDir = await mkdtemp(join(workDir, 'abs-check-'));
      await mkdir(join(checkDir, 'src'), { recursive: true });
      await writeFile(
        join(checkDir, 'src', 'app.ts'),
        '// shiori: ABS-CHECK-001\n',
        'utf-8',
      );

      // Config with absolute path for scanResult
      const absResultDir = await mkdtemp(join(checkDir, 'abs-result-'));
      const absScanPath = join(absResultDir, 'scan-result.json');

      const configDir = join(checkDir, '.config', 'shiori');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.yaml'),
        [
          '# shiori configuration',
          'paths:',
          `  scanResult: "${absScanPath}"`,
        ].join('\n') + '\n',
        'utf-8',
      );
      await writeFile(join(configDir, 'registry.json'), '{}', 'utf-8');

      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        checkDir,
        '--patterns',
        'src/**/*.ts',
        '--save-scan',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 0, `check failed: ${stderr}`);
      assert.ok(stderr.includes('Scan result saved to'));

      // Verify scan result was written to absolute path
      const content = await readFile(absScanPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'ABS-CHECK-001'));
    });
  });

  describe('boundary guard rejects --output outside --cwd', () => {
    it('scan --output outside --cwd is rejected', async () => {
      const { exitCode, stderr } = await runCli([
        'scan',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        '/tmp/outside-boundary.json',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('outside'));
    });

    it('watch --output outside --cwd is rejected', async () => {
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        '/tmp/outside-boundary.json',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('outside'));
    });

    it('verify --output outside --cwd is rejected', async () => {
      // Prepare minimal scan result
      await writeFile(
        join(workDir, 'scan-result.json'),
        JSON.stringify({ annotations: [], candidates: [], filesScanned: 0 }),
        'utf-8',
      );
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(join(workDir, 'data', 'registry.json'), '{}', 'utf-8');

      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--registry',
        'data/registry.json',
        '--output',
        '/tmp/outside-boundary.json',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('outside'));
    });

    it('check --output outside --cwd is rejected', async () => {
      await mkdir(join(workDir, 'data'), { recursive: true });
      await writeFile(join(workDir, 'data', 'registry.json'), '{}', 'utf-8');

      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        workDir,
        '--patterns',
        'src/**/*.ts',
        '--registry',
        'data/registry.json',
        '--output',
        '/tmp/outside-boundary.json',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('outside'));
    });

    it('draft --output outside --cwd is rejected', async () => {
      await writeFile(
        join(workDir, 'scan-result.json'),
        JSON.stringify({ annotations: [], candidates: [], filesScanned: 0 }),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'draft',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--output',
        '/tmp/outside-boundary.json',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('outside'));
    });

    it('candidates --output outside --cwd is rejected', async () => {
      await writeFile(
        join(workDir, 'scan-result.json'),
        JSON.stringify({ annotations: [], candidates: [], filesScanned: 0 }),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'candidates',
        '--cwd',
        workDir,
        '--scan',
        'scan-result.json',
        '--output',
        '/tmp/outside-boundary.json',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('outside'));
    });

    it('check --save-scan with config pointing outside --cwd is rejected', async () => {
      // Create config with paths.scanResult pointing outside cwd
      const saveScanDir = await mkdtemp(join(workDir, 'save-scan-'));
      await mkdir(join(saveScanDir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(saveScanDir, '.config', 'shiori', 'config.yaml'),
        [
          '# shiori configuration',
          'paths:',
          '  scanResult: "/tmp/outside-scan-result.json"',
        ].join('\n') + '\n',
        'utf-8',
      );
      await mkdir(join(saveScanDir, 'src'), { recursive: true });
      await writeFile(
        join(saveScanDir, 'src', 'app.ts'),
        '// shiori: SAVE-001\n',
        'utf-8',
      );
      await writeFile(
        join(saveScanDir, '.config', 'shiori', 'registry.json'),
        '{}',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        saveScanDir,
        '--patterns',
        'src/**/*.ts',
        '--save-scan',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('outside'));
    });
  });
});
