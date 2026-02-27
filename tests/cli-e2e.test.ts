import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  unlink,
  mkdtemp,
  mkdir,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli as _runCli,
  PROJECT_ROOT,
  type CliResult,
} from './helpers/cli-test-utils.ts';

// Relative patterns for fast-glob (resolved from PROJECT_ROOT as cwd)
const SCAN_PATTERNS = 'tests/fixtures/e2e/**/*.css,tests/fixtures/e2e/**/*.ts';
// Override default ignore to allow scanning test fixture files
const SCAN_IGNORE = '**/node_modules/**,**/dist/**,**/.git/**';
const REGISTRY_PATH = 'tests/fixtures/e2e/registry.json';
const REGISTRY_YAML_PATH = 'tests/fixtures/e2e/registry.yaml';

/** Wrapper that keeps capture files within PROJECT_ROOT/.tmp/cli-run */
async function runCli(args: string[]): Promise<CliResult> {
  return _runCli(args, {
    baseDir: join(PROJECT_ROOT, '.tmp', 'cli-run'),
  });
}

describe('CLI E2E', () => {
  let tmpDir: string;
  let scanResultPath: string;

  before(async () => {
    // Use PROJECT_ROOT/.tmp/ so output paths stay within cwd boundary
    const tmpBase = join(PROJECT_ROOT, '.tmp', 'test-e2e');
    await mkdir(tmpBase, { recursive: true });
    tmpDir = await mkdtemp(join(tmpBase, 'run-'));
    scanResultPath = join(tmpDir, 'scan-result.json');

    // Pre-run scan and save result for verify/update/draft tests
    const { stdout } = await runCli([
      'scan',
      '--patterns',
      SCAN_PATTERNS,
      '--ignore',
      SCAN_IGNORE,
    ]);

    const scanResult = JSON.parse(stdout) as {
      annotations: unknown[];
      candidates: unknown[];
      filesScanned: number;
    };
    assert.ok(
      Array.isArray(scanResult.annotations),
      'scan should output ScanResult with annotations array',
    );
    assert.ok(
      scanResult.annotations.length > 0,
      'scan should find annotations',
    );
    await writeFile(scanResultPath, stdout, 'utf-8');
  });

  after(async () => {
    const files = [
      'scan-result.json',
      'output-scan.json',
      'updated-registry.json',
      'updated-registry.yaml',
      'draft-result.json',
      'scan-multi.json',
      'watch-scan.json',
      'watch-sync-scan.json',
      'watch-registry.json',
    ];
    for (const f of files) {
      try {
        await unlink(join(tmpDir, f));
      } catch {
        // file may not exist
      }
    }
  });

  describe('scan command', () => {
    it('outputs ScanResult JSON to stdout', async () => {
      const { stdout, exitCode } = await runCli([
        'scan',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
      ]);
      assert.equal(exitCode, 0);
      const scanResult = JSON.parse(stdout) as {
        annotations: Array<{ ref: string; location: { file: string } }>;
        candidates: Array<{ pattern: string }>;
        filesScanned: number;
      };
      // SUP-1001, SUP-1002, SUP-2001, SUP-2002, draft(no ref)
      assert.equal(scanResult.annotations.length, 5);
      // Line 7: eslint-disable-next-line no-debugger → eslint candidate
      assert.equal(scanResult.candidates.length, 1);
      assert.equal(scanResult.candidates[0]!.pattern, 'eslint');
      assert.equal(scanResult.filesScanned, 2);
      // Verify annotation field shape
      assert.ok(scanResult.annotations[0]!.ref !== undefined);
      assert.ok(scanResult.annotations[0]!.location !== undefined);
    });

    it('writes to file with --output', async () => {
      const outputPath = join(tmpDir, 'output-scan.json');
      const { exitCode } = await runCli([
        'scan',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const scanResult = JSON.parse(content) as {
        annotations: unknown[];
        candidates: unknown[];
      };
      assert.equal(scanResult.annotations.length, 5);
      assert.equal(scanResult.candidates.length, 1);
    });
  });

  describe('verify command', () => {
    it('exits 1 when missing-in-registry with --fail-on', async () => {
      // SUP-2002 is not in registry -> missing-in-registry
      const { exitCode, stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--fail-on',
        'missing-in-registry',
      ]);
      assert.equal(exitCode, 1);
      const result = JSON.parse(stdout) as { summary: { errors: number } };
      assert.ok(result.summary.errors > 0);
    });

    it('exits 0 when all issues are warn-on', async () => {
      const { exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
    });

    it('outputs markdown with --format markdown', async () => {
      const { stdout, exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'markdown',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('# Annotation Registry Verification Report'));
    });

    it('works with YAML registry', async () => {
      const { exitCode, stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_YAML_PATH),
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        registryEntries: number;
      };
      assert.equal(result.registryEntries, 4);
    });

    it('detects expired entries', async () => {
      const { stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--fail-on',
        'expired',
        '--warn-on',
        'missing-in-registry,unused-in-source,syntax-error',
      ]);
      const result = JSON.parse(stdout) as {
        issues: Array<{ type: string }>;
      };
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.ok(expired.length > 0); // SUP-9999 expired
    });
  });

  describe('update command', () => {
    it('merges new refs into existing registry', async () => {
      // Copy fixture registry to tmpDir so update can write to it
      const registryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      const outputPath = join(tmpDir, 'updated-registry.json');
      await writeFile(outputPath, registryContent, 'utf-8');

      const { exitCode, stderr } = await runCli([
        'update',
        '--scan',
        scanResultPath,
        '--registry',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const registry = JSON.parse(content) as Record<
        string,
        { reason: string }
      >;
      // Existing entry preserved
      assert.equal(registry['SUP-1001']!.reason, 'vendor prefix fallback');
      // New entry gets placeholder
      assert.equal(registry['SUP-2002']!.reason, 'TODO: fill in reason');
      assert.ok(stderr.includes('Added'));
    });

    it('reports up to date when no new refs', async () => {
      // Create a registry that already has all refs
      const fullRegistryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      const fullRegistry = JSON.parse(fullRegistryContent) as Record<
        string,
        unknown
      >;
      // Add all scan refs to make it complete
      fullRegistry['SUP-2002'] = {
        reason: 'existing',
        target: 'test',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      };
      const outputPath = join(tmpDir, 'updated-registry.json');
      await writeFile(
        outputPath,
        JSON.stringify(fullRegistry, null, 2),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'update',
        '--scan',
        scanResultPath,
        '--registry',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('up to date'));
    });
  });

  describe('draft command', () => {
    it('lists draft annotations from scan result', async () => {
      const { stdout, exitCode } = await runCli([
        'draft',
        '--scan',
        scanResultPath,
      ]);
      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        drafts: Array<{ ref: string; tagged: boolean }>;
        count: number;
      };
      assert.equal(result.count, 1);
      assert.equal(result.drafts[0]!.ref, '');
      assert.equal(result.drafts[0]!.tagged, true);
    });

    it('writes to file with --output', async () => {
      const outputPath = join(tmpDir, 'draft-result.json');
      const { exitCode } = await runCli([
        'draft',
        '--scan',
        scanResultPath,
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as { count: number };
      assert.equal(result.count, 1);
    });
  });

  describe('jump command', () => {
    it('prints first location as file:line', async () => {
      const { stdout, exitCode } = await runCli([
        'jump',
        '--ref',
        'SUP-2001',
        '--scan',
        scanResultPath,
      ]);

      assert.equal(exitCode, 0);
      assert.equal(stdout.trim(), 'tests/fixtures/e2e/sample.ts:1');
    });

    it('prints all locations with --all', async () => {
      const customScanPath = join(tmpDir, 'scan-multi.json');
      const customScan = {
        annotations: [
          {
            ref: 'SUP-MULTI',
            tagged: true,
            ignored: false,
            location: { file: 'a.ts', line: 3 },
          },
          {
            ref: 'SUP-MULTI',
            tagged: true,
            ignored: false,
            location: { file: 'b.ts', line: 8 },
          },
          {
            ref: 'SUP-OTHER',
            tagged: true,
            ignored: false,
            location: { file: 'c.ts', line: 1 },
          },
        ],
        candidates: [],
        filesScanned: 3,
      };
      await writeFile(customScanPath, JSON.stringify(customScan), 'utf-8');

      const { stdout, exitCode } = await runCli([
        'jump',
        '--ref',
        'SUP-MULTI',
        '--all',
        '--scan',
        customScanPath,
      ]);

      assert.equal(exitCode, 0);
      assert.deepEqual(stdout.trim().split('\n'), ['a.ts:3', 'b.ts:8']);
    });
  });

  describe('watch command', () => {
    it('runs once and writes scan result', async () => {
      const outputPath = join(tmpDir, 'watch-scan.json');

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
      };
      assert.equal(result.annotations.length, 5);
      assert.equal(result.candidates.length, 1);
    });

    it('runs once with registry sync and adds new refs', async () => {
      const outputPath = join(tmpDir, 'watch-sync-scan.json');
      const registryPath = join(tmpDir, 'watch-registry.json');
      const registryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      await writeFile(registryPath, registryContent, 'utf-8');

      const { exitCode } = await runCli([
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
      const content = await readFile(registryPath, 'utf-8');
      const registry = JSON.parse(content) as Record<
        string,
        { reason: string }
      >;
      assert.equal(registry['SUP-2002']!.reason, 'TODO: fill in reason');
    });
  });

  describe('verify --format sarif', () => {
    it('outputs valid SARIF JSON', async () => {
      const { stdout, exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'sarif',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const sarif = JSON.parse(stdout) as {
        version: string;
        runs: Array<{
          tool: { driver: { name: string } };
          results: unknown[];
        }>;
      };
      assert.equal(sarif.version, '2.1.0');
      assert.equal(sarif.runs[0]!.tool.driver.name, 'shiori');
      assert.ok(Array.isArray(sarif.runs[0]!.results));
    });
  });

  describe('verify --format jsonl', () => {
    it('outputs one JSON per line', async () => {
      const { stdout, exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'jsonl',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const parsed = JSON.parse(line) as { type: string };
        assert.ok(parsed.type);
      }
    });
  });

  describe('verify --format summary', () => {
    it('outputs summary JSON with totals', async () => {
      const { stdout, exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'summary',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const summary = JSON.parse(stdout) as {
        totals: {
          annotations: number;
          candidates: number;
        };
        byRule: Record<string, number>;
      };
      assert.ok(summary.totals.annotations >= 0);
      assert.equal(summary.totals.candidates, 0); // verify has no candidates
      assert.ok(typeof summary.byRule === 'object');
    });
  });

  describe('check --format sarif', () => {
    it('outputs valid SARIF JSON', async () => {
      const { stdout, exitCode } = await runCli([
        'check',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'sarif',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const sarif = JSON.parse(stdout) as {
        version: string;
        runs: Array<{
          tool: { driver: { name: string } };
        }>;
      };
      assert.equal(sarif.version, '2.1.0');
      assert.equal(sarif.runs[0]!.tool.driver.name, 'shiori');
    });
  });

  describe('check --format jsonl', () => {
    it('outputs one JSON per line', async () => {
      const { stdout, exitCode } = await runCli([
        'check',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'jsonl',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const parsed = JSON.parse(line) as { type: string };
        assert.ok(parsed.type);
      }
    });
  });

  describe('check --format summary', () => {
    it('outputs summary JSON with totals and candidates', async () => {
      const { stdout, exitCode } = await runCli([
        'check',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'summary',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const summary = JSON.parse(stdout) as {
        totals: {
          annotations: number;
          candidates: number;
        };
        byRule: Record<string, number>;
      };
      assert.ok(summary.totals.annotations > 0);
      assert.ok(summary.totals.candidates >= 0); // check includes candidates
      assert.ok(typeof summary.byRule === 'object');
    });
  });

  describe('option validation', () => {
    it('exits 1 for invalid --fail-on value in verify', async () => {
      const { exitCode, stderr } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--fail-on',
        'typo',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('"typo"'));
      assert.ok(stderr.includes('Valid values:'));
    });

    it('exits 1 for invalid --warn-on value in verify', async () => {
      const { exitCode, stderr } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--warn-on',
        'not-a-type',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('"not-a-type"'));
    });

    it('exits 1 for invalid --format value in verify', async () => {
      const { exitCode, stderr } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'xml',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('"xml"'));
      assert.ok(stderr.includes('Valid values:'));
    });

    it('exits 1 for invalid --fail-on value in check', async () => {
      const { exitCode, stderr } = await runCli([
        'check',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--fail-on',
        'bad-value',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('"bad-value"'));
    });

    it('exits 1 for invalid --format value in check', async () => {
      const { exitCode, stderr } = await runCli([
        'check',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'html',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('"html"'));
    });

    it('exits 1 for unknown --provider in scan', async () => {
      const { exitCode, stderr } = await runCli([
        'scan',
        '--patterns',
        SCAN_PATTERNS,
        '--ignore',
        SCAN_IGNORE,
        '--provider',
        'foo',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('"foo"'));
      assert.ok(stderr.includes('Valid values:'));
    });
  });

  describe('error UX', () => {
    it('shows user-friendly message for missing scan result file', async () => {
      const { exitCode, stderr } = await runCli([
        'verify',
        '--scan',
        '/nonexistent/scan-result.json',
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Scan result file not found'));
      assert.ok(stderr.includes('/nonexistent/scan-result.json'));
      // Should not contain raw stack trace
      assert.ok(!stderr.includes('    at '));
    });

    it('shows user-friendly message for invalid JSON in scan result', async () => {
      const badJsonPath = join(tmpDir, 'bad-scan.json');
      await writeFile(badJsonPath, '{ broken json', 'utf-8');

      const { exitCode, stderr } = await runCli([
        'verify',
        '--scan',
        badJsonPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Failed to parse scan result as JSON'));
      assert.ok(!stderr.includes('    at '));
    });

    it('shows user-friendly message for missing registry file', async () => {
      const { exitCode, stderr } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        '/nonexistent/registry.json',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(!stderr.includes('    at '));
    });
  });

  describe('watch command errors', () => {
    it('exits 1 for non-numeric --debounce-ms', async () => {
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
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --debounce-ms'));
    });
  });

  describe('init command', () => {
    it('initializes in a fresh directory', async () => {
      const initDir = await mkdtemp(join(tmpDir, 'init-'));
      // Create a minimal source file so scan finds something
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: INIT-001\n',
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
      assert.ok(stderr.includes('config:'));
      assert.ok(stderr.includes('registry:'));

      // Verify config was created
      const configContent = await readFile(
        join(initDir, '.config', 'shiori', 'config.yaml'),
        'utf-8',
      );
      assert.ok(configContent.includes('shiori configuration'));

      // Verify registry was created
      const registryContent = await readFile(
        join(initDir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('INIT-001' in registry);
    });
  });

  describe('docs command', () => {
    it('outputs README content', async () => {
      const { exitCode, stdout } = await runCli(['docs']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('shiori'));
    });
  });
});

describe('CLI E2E: multi-registry', () => {
  let multiDir: string;

  before(async () => {
    const multiBase = join(PROJECT_ROOT, '.tmp', 'test-multi-e2e');
    await mkdir(multiBase, { recursive: true });
    multiDir = await mkdtemp(join(multiBase, 'run-'));

    // Create source file with annotations from different namespaces
    await mkdir(join(multiDir, 'src'), { recursive: true });
    await writeFile(
      join(multiDir, 'src', 'app.ts'),
      [
        '// eslint-disable-next-line no-console -- shiori: SUP-100',
        'console.log("default namespace ref");',
        '',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiori: JIRA:PROJ-200',
        'const x: any = {};',
      ].join('\n') + '\n',
      'utf-8',
    );

    // Create config with refPatterns pointing to pattern-specific registry
    await mkdir(join(multiDir, '.config', 'shiori'), { recursive: true });
    await writeFile(
      join(multiDir, '.config', 'shiori', 'config.yaml'),
      [
        '# shiori configuration',
        'refPatterns:',
        '  - match: "JIRA:{id}"',
        '    urlTemplate: "https://jira.example.com/browse/{id}"',
        '    registryFile: "jira-registry.json"',
      ].join('\n') + '\n',
      'utf-8',
    );

    // Default registry: only SUP-100
    await writeFile(
      join(multiDir, '.config', 'shiori', 'registry.json'),
      JSON.stringify(
        {
          'SUP-100': {
            reason: 'default namespace entry',
            target: 'all',
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Pattern-specific registry: only JIRA:PROJ-200
    await writeFile(
      join(multiDir, '.config', 'shiori', 'jira-registry.json'),
      JSON.stringify(
        {
          'JIRA:PROJ-200': {
            reason: 'jira namespace entry',
            target: 'src/app.ts',
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
  });

  after(async () => {
    await rm(multiDir, { recursive: true, force: true });
  });

  it('verify reads pattern-specific registry (no false positive missing-in-registry)', async () => {
    // First scan
    const scanResult = await runCli([
      'scan',
      '--patterns',
      'src/**/*.ts',
      '--cwd',
      multiDir,
    ]);
    assert.equal(scanResult.exitCode, 0);

    const scanPath = join(multiDir, 'scan-result.json');
    await writeFile(scanPath, scanResult.stdout, 'utf-8');

    // Verify: both refs exist in their respective registries → no missing-in-registry
    const { exitCode, stdout } = await runCli([
      'verify',
      '--scan',
      scanPath,
      '--fail-on',
      'missing-in-registry',
      '--warn-on',
      'unused-in-source,expired,syntax-error',
      '--cwd',
      multiDir,
    ]);

    const result = JSON.parse(stdout) as {
      issues: Array<{ type: string; ref: string }>;
      summary: { errors: number };
    };
    const missingIssues = result.issues.filter(
      (i) => i.type === 'missing-in-registry',
    );
    assert.deepEqual(
      missingIssues,
      [],
      'Pattern-specific registry ref should not trigger missing-in-registry',
    );
    assert.equal(exitCode, 0);
  });

  it('check reads pattern-specific registry (no false positive missing-in-registry)', async () => {
    const { exitCode, stdout } = await runCli([
      'check',
      '--patterns',
      'src/**/*.ts',
      '--fail-on',
      'missing-in-registry',
      '--warn-on',
      'unused-in-source,expired,syntax-error',
      '--cwd',
      multiDir,
    ]);

    const result = JSON.parse(stdout) as {
      issues: Array<{ type: string; ref: string }>;
      summary: { errors: number };
    };
    const missingIssues = result.issues.filter(
      (i) => i.type === 'missing-in-registry',
    );
    assert.deepEqual(
      missingIssues,
      [],
      'Pattern-specific registry ref should not trigger missing-in-registry in check',
    );
    assert.equal(exitCode, 0);
  });

  it('show finds ref from pattern-specific registry', async () => {
    const scanPath = join(multiDir, 'scan-result.json');
    // Ensure scan result exists
    const scanResult = await runCli([
      'scan',
      '--patterns',
      'src/**/*.ts',
      '--cwd',
      multiDir,
    ]);
    await writeFile(scanPath, scanResult.stdout, 'utf-8');

    const { exitCode, stdout } = await runCli([
      'show',
      '--ref',
      'JIRA:PROJ-200',
      '--scan',
      scanPath,
      '--cwd',
      multiDir,
    ]);
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout) as {
      registryEntry: { reason: string } | undefined;
    };
    assert.equal(
      result.registryEntry?.reason,
      'jira namespace entry',
      'show should find ref from pattern-specific registry',
    );
  });

  it('update reads merged multi-registry before writing', async () => {
    // Create a fresh copy for update test
    const updateMultiBase = join(PROJECT_ROOT, '.tmp', 'test-update-multi');
    await mkdir(updateMultiBase, { recursive: true });
    const updateDir = await mkdtemp(join(updateMultiBase, 'run-'));
    await mkdir(join(updateDir, 'src'), { recursive: true });
    await writeFile(
      join(updateDir, 'src', 'app.ts'),
      [
        '// eslint-disable-next-line no-console -- shiori: SUP-100',
        'console.log("a");',
        '',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiori: JIRA:PROJ-200',
        'const x: any = {};',
        '',
        '// shiori: NEW-001',
        'const y = 1;',
      ].join('\n') + '\n',
      'utf-8',
    );

    await mkdir(join(updateDir, '.config', 'shiori'), { recursive: true });
    await writeFile(
      join(updateDir, '.config', 'shiori', 'config.yaml'),
      [
        '# shiori configuration',
        'refPatterns:',
        '  - match: "JIRA:{id}"',
        '    urlTemplate: "https://jira.example.com/browse/{id}"',
        '    registryFile: "jira-registry.json"',
      ].join('\n') + '\n',
      'utf-8',
    );
    await writeFile(
      join(updateDir, '.config', 'shiori', 'registry.json'),
      JSON.stringify(
        { 'SUP-100': { reason: 'default', target: 'all' } },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    await writeFile(
      join(updateDir, '.config', 'shiori', 'jira-registry.json'),
      JSON.stringify(
        { 'JIRA:PROJ-200': { reason: 'jira entry', target: 'src/app.ts' } },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Scan
    const scanResult = await runCli([
      'scan',
      '--patterns',
      'src/**/*.ts',
      '--cwd',
      updateDir,
    ]);
    const scanPath = join(updateDir, 'scan-result.json');
    await writeFile(scanPath, scanResult.stdout, 'utf-8');

    // Update: should only add NEW-001, not re-add JIRA:PROJ-200
    const { exitCode, stderr } = await runCli([
      'update',
      '--scan',
      scanPath,
      '--cwd',
      updateDir,
    ]);
    assert.equal(exitCode, 0);
    assert.ok(
      stderr.includes('NEW-001'),
      'update should add NEW-001 as new ref',
    );
    // JIRA:PROJ-200 should NOT be added as new (it's already in pattern registry)
    assert.ok(
      !stderr.includes('JIRA:PROJ-200'),
      'update should not re-add JIRA:PROJ-200 from pattern registry',
    );

    await rm(updateDir, { recursive: true, force: true });
  });
});
