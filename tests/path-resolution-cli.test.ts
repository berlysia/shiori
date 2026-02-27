/**
 * CLI path resolution tests: verifies that explicit relative paths (--output, --registry, --scan)
 * are resolved against --cwd, not process.cwd().
 *
 * Scenario: process spawns CLI from PROJECT_ROOT, but --cwd points to a different directory.
 * Relative paths in --output/--registry/--scan should resolve against --cwd.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const CLI_PATH = new URL('../dist/src/cli.js', import.meta.url).pathname;
const PROJECT_ROOT = new URL('..', import.meta.url).pathname;

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<CliResult> {
  const tmpBase = join(PROJECT_ROOT, '.tmp', 'path-res-run');
  await mkdir(tmpBase, { recursive: true });
  const runDir = await mkdtemp(join(tmpBase, 'run-'));
  const stdoutPath = join(runDir, 'stdout.log');
  const stderrPath = join(runDir, 'stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn('node', [CLI_PATH, ...args], {
        // spawn cwd is always PROJECT_ROOT (simulates process.cwd() != --cwd)
        cwd: options?.cwd ?? PROJECT_ROOT,
        stdio: ['ignore', stdoutFd, stderrFd],
      });
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 1));
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const [stdout, stderr] = await Promise.all([
    readFile(stdoutPath, 'utf-8').catch(() => ''),
    readFile(stderrPath, 'utf-8').catch(() => ''),
  ]);
  await rm(runDir, { recursive: true, force: true });

  return { stdout, stderr, exitCode };
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('outside'));
    });
  });
});
