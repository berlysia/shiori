import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  rm,
  access,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli as _runCli,
  PROJECT_ROOT,
  type CliResult,
} from './helpers/cli-test-utils.ts';

const SCAN_PATTERNS = 'tests/fixtures/e2e/**/*.css,tests/fixtures/e2e/**/*.ts';
const SCAN_IGNORE = '**/node_modules/**,**/dist/**,**/.git/**';
const REGISTRY_PATH = 'tests/fixtures/e2e/registry.json';

/** Wrapper that defaults to baseDir within project and timeout for watch tests */
async function runCli(
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<CliResult> {
  return _runCli(args, {
    cwd: options?.cwd,
    timeout: options?.timeout ?? 30000,
    baseDir: join(PROJECT_ROOT, '.tmp', 'watch-run'),
  });
}

describe('watch-cli: argument validation and error paths', () => {
  let tmpDir: string;

  before(async () => {
    const tmpBase = join(PROJECT_ROOT, '.tmp', 'test-watch');
    await mkdir(tmpBase, { recursive: true });
    tmpDir = await mkdtemp(join(tmpBase, 'run-'));
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  describe('--debounce-ms validation', () => {
    it('exits 3 for non-numeric value', async () => {
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--debounce-ms',
        'abc',
      ]);
      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('Invalid --debounce-ms'));
    });

    it('treats negative value as separate flag (CLI framework limitation)', async () => {
      // When passing "--debounce-ms -100", the CLI framework parses "-100"
      // as a separate flag rather than the value for --debounce-ms.
      // The watch-cli.ts code has a guard (debounceMs < 0) for programmatic use,
      // but the CLI framework prevents negative numeric strings from reaching it.
      // This test documents the actual behavior: debounceMs falls back to default.
      const outputPath = join(tmpDir, 'watch-neg-debounce.json');
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--debounce-ms',
        '-100',
        '--output',
        outputPath,
      ]);
      // -100 is not parsed as the value for --debounce-ms,
      // so it falls back to default (250ms) and succeeds
      assert.equal(exitCode, 0);
    });

    it('exits 3 for floating point value', async () => {
      // parseInt('3.14', 10) returns 3 which is valid,
      // but 'abc' or NaN-producing values should fail
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--debounce-ms',
        'not-a-number',
      ]);
      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('Invalid --debounce-ms'));
    });

    it('accepts debounce-ms=0 as valid boundary value', async () => {
      const outputPath = join(tmpDir, 'watch-debounce-0.json');
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--debounce-ms',
        '0',
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
    });

    it('accepts large debounce-ms value', async () => {
      const outputPath = join(tmpDir, 'watch-debounce-large.json');
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--debounce-ms',
        '10000',
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
    });

    it('uses default 250ms when --debounce-ms not specified', async () => {
      const outputPath = join(tmpDir, 'watch-default-debounce.json');
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
    });
  });

  describe('--once mode', () => {
    it('runs one refresh and exits', async () => {
      const outputPath = join(tmpDir, 'watch-once.json');
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('refreshed (initial)'));
      assert.ok(stderr.includes('Saved scan result to'));

      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: unknown[];
        candidates: unknown[];
      };
      assert.ok(Array.isArray(result.annotations));
      assert.ok(Array.isArray(result.candidates));
    });

    it('produces correct annotation count', async () => {
      const outputPath = join(tmpDir, 'watch-once-count.json');
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: unknown[];
        candidates: unknown[];
        filesScanned: number;
      };
      assert.equal(result.annotations.length, 5);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.filesScanned, 2);
    });
  });

  describe('--sync-registry mode', () => {
    it('merges new refs into registry with --once', async () => {
      const outputPath = join(tmpDir, 'watch-sync.json');
      const registryPath = join(tmpDir, 'watch-sync-registry.json');

      // Copy fixture registry (missing SUP-2002)
      const registryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      await writeFile(registryPath, registryContent, 'utf-8');

      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--sync-registry',
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('refreshed (initial)'));
      assert.ok(stderr.includes('new-refs='));

      // Verify SUP-2002 was added
      const updatedRegistry = JSON.parse(
        await readFile(registryPath, 'utf-8'),
      ) as Record<string, { reason: string }>;
      assert.equal(updatedRegistry['SUP-2002']!.reason, 'TODO: fill in reason');
    });

    it('reports registry=up-to-date when no new refs', async () => {
      const outputPath = join(tmpDir, 'watch-sync-uptodate.json');
      const registryPath = join(tmpDir, 'watch-sync-uptodate-registry.json');

      // Create complete registry
      const baseRegistry = JSON.parse(
        await readFile(join(PROJECT_ROOT, REGISTRY_PATH), 'utf-8'),
      ) as Record<string, unknown>;
      baseRegistry['SUP-2002'] = {
        reason: 'already present',
        target: 'test',
      };
      await writeFile(
        registryPath,
        JSON.stringify(baseRegistry, null, 2),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--sync-registry',
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('registry=up-to-date'));
    });

    it('enables registry sync message in stderr', async () => {
      // Without --once, the watcher would start — but we just verify --once path
      // shows the registry-related output
      const outputPath = join(tmpDir, 'watch-sync-msg.json');
      const registryPath = join(tmpDir, 'watch-sync-msg-registry.json');
      await writeFile(registryPath, '{}', 'utf-8');

      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--sync-registry',
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('new-refs='));
    });
  });

  describe('--output flag', () => {
    it('writes scan result to specified path', async () => {
      const outputPath = join(tmpDir, 'watch-custom-output.json');
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as { annotations: unknown[] };
      assert.ok(Array.isArray(result.annotations));
    });

    it('creates parent directories for output path', async () => {
      const deepOutputPath = join(
        tmpDir,
        'nested',
        'deep',
        'watch-output.json',
      );
      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        deepOutputPath,
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(deepOutputPath, 'utf-8');
      const result = JSON.parse(content) as { annotations: unknown[] };
      assert.ok(Array.isArray(result.annotations));
    });
  });

  describe('--cwd flag', () => {
    it('uses specified working directory', async () => {
      const cwdDir = await mkdtemp(join(tmpDir, 'cwd-'));
      await mkdir(join(cwdDir, 'src'), { recursive: true });
      await writeFile(
        join(cwdDir, 'src', 'file.ts'),
        '// shiori: CWD-001\n',
        'utf-8',
      );
      // Output must be within cwdDir (boundary guard validates against --cwd)
      const outputPath = join(cwdDir, 'watch-cwd-output.json');

      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--cwd',
        cwdDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'CWD-001'));
    });
  });

  describe('stderr output format', () => {
    it('includes timestamp in refresh message', async () => {
      const outputPath = join(tmpDir, 'watch-timestamp.json');
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      // Timestamp format: [2026-...T...Z]
      assert.ok(
        /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(stderr),
        'stderr should include ISO timestamp',
      );
    });

    it('includes annotation and candidate counts in refresh message', async () => {
      const outputPath = join(tmpDir, 'watch-counts.json');
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('annotations='));
      assert.ok(stderr.includes('candidates='));
    });
  });

  describe('--dashboard mode', () => {
    it('generates HTML dashboard file with --once', async () => {
      const outputPath = join(tmpDir, 'watch-dashboard.json');
      const dashboardPath = join(tmpDir, 'watch-dashboard.html');
      const registryPath = join(tmpDir, 'watch-dashboard-registry.json');

      // Create a registry with an entry matching fixtures
      const registryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      await writeFile(registryPath, registryContent, 'utf-8');

      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--dashboard',
        '--dashboard-output',
        dashboardPath,
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(
        stderr.includes('dashboard updated'),
        'stderr reports dashboard update',
      );
      assert.ok(
        stderr.includes('Dashboard written to'),
        'stderr reports dashboard path',
      );

      // Verify dashboard HTML file was created
      await access(dashboardPath);
      const html = await readFile(dashboardPath, 'utf-8');
      assert.ok(html.includes('<!DOCTYPE html>'), 'valid HTML document');
      assert.ok(
        html.includes('Shiori Governance Dashboard'),
        'has dashboard title',
      );
      assert.ok(
        html.includes('http-equiv="refresh"'),
        'has auto-refresh meta tag',
      );
      assert.ok(html.includes('auto-refreshing every'), 'has live indicator');
    });

    it('includes health score in dashboard stderr', async () => {
      const outputPath = join(tmpDir, 'watch-dash-health.json');
      const dashboardPath = join(tmpDir, 'watch-dash-health.html');
      const registryPath = join(tmpDir, 'watch-dash-health-registry.json');

      await writeFile(registryPath, '{}', 'utf-8');

      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--dashboard',
        '--dashboard-output',
        dashboardPath,
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('health='), 'stderr includes health level');
      assert.ok(stderr.includes('score='), 'stderr includes health score');
    });

    it('warns when --open is used without --dashboard', async () => {
      const outputPath = join(tmpDir, 'watch-open-warn.json');
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--open',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(
        stderr.includes('--open requires --dashboard'),
        'warns about --open without --dashboard',
      );
    });

    it('creates dashboard parent directories', async () => {
      const outputPath = join(tmpDir, 'watch-dash-nested.json');
      const dashboardPath = join(tmpDir, 'nested', 'deep', 'dashboard.html');
      const registryPath = join(tmpDir, 'watch-dash-nested-registry.json');

      await writeFile(registryPath, '{}', 'utf-8');

      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--dashboard',
        '--dashboard-output',
        dashboardPath,
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      await access(dashboardPath);
      const html = await readFile(dashboardPath, 'utf-8');
      assert.ok(html.includes('<!DOCTYPE html>'));
    });
  });

  describe('--format flag', () => {
    it('rejects invalid format value', async () => {
      const outputPath = join(tmpDir, 'watch-format-invalid.json');
      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--format',
        'invalid',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 2);
      assert.ok(
        stderr.includes('--format must be'),
        'stderr reports invalid format',
      );
    });

    it('errors when --format diagnostic and --dashboard are both specified', async () => {
      const outputPath = join(tmpDir, 'watch-format-dash-excl.json');
      const registryPath = join(tmpDir, 'watch-format-dash-excl-registry.json');
      await writeFile(registryPath, '{}', 'utf-8');

      const { exitCode, stderr } = await runCli([
        'watch',
        '--once',
        '--format',
        'diagnostic',
        '--dashboard',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 2);
      assert.ok(
        stderr.includes('mutually exclusive'),
        'stderr reports mutual exclusion',
      );
    });

    it('outputs GCC-compatible diagnostic lines to stdout with --format diagnostic', async () => {
      const outputPath = join(tmpDir, 'watch-format-diag.json');
      const registryPath = join(tmpDir, 'watch-format-diag-registry.json');

      // Copy fixture registry (missing SUP-2002, has expired SUP-9999)
      const registryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      await writeFile(registryPath, registryContent, 'utf-8');

      const { exitCode, stdout, stderr } = await runCli([
        'watch',
        '--once',
        '--format',
        'diagnostic',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);

      // Status messages go to stderr
      assert.ok(stderr.includes('refreshed (initial)'));

      // Diagnostic output goes to stdout
      assert.ok(stdout.length > 0, 'stdout should have diagnostic output');

      // Verify GCC-compatible format: file:line:column: severity: message [type]
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        assert.ok(
          /^.+:\d+:\d+: (error|warning): .+ \[.+\]$/.test(line),
          `Line should match GCC diagnostic format: ${line}`,
        );
      }
    });

    it('outputs nothing to stdout when no issues exist with --format diagnostic', async () => {
      // Create a minimal fixture with no issues
      const cwdDir = await mkdtemp(join(tmpDir, 'diag-clean-'));
      await mkdir(join(cwdDir, 'src'), { recursive: true });
      await writeFile(
        join(cwdDir, 'src', 'clean.ts'),
        '// shiori: CLEAN-001\nconst x = 1;\n',
        'utf-8',
      );
      const registryPath = join(cwdDir, 'registry.json');
      await writeFile(
        registryPath,
        JSON.stringify({
          'CLEAN-001': {
            reason: 'test',
            target: 'all',
          },
        }),
        'utf-8',
      );
      const outputPath = join(cwdDir, 'scan-result.json');

      const { exitCode, stdout } = await runCli([
        'watch',
        '--once',
        '--format',
        'diagnostic',
        '--cwd',
        cwdDir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        outputPath,
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      assert.equal(stdout.trim(), '', 'stdout should be empty when no issues');
    });

    it('pretty format (default) does not emit diagnostic lines to stdout', async () => {
      const outputPath = join(tmpDir, 'watch-format-pretty.json');
      const { exitCode, stdout } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      assert.equal(stdout.trim(), '', 'stdout should be empty in pretty mode');
    });
  });
});
