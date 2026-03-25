/**
 * CLI integration tests for `check --workspace`.
 *
 * Uses two fixture strategies:
 *   1. s8-pnpm-workspace scenario: static fixture with all annotations in registry (no errors)
 *   2. createWorkspaceFixture helper: dynamic temp directories for error/edge-case scenarios
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli, unwrapEnvelope } from './helpers/cli-test-utils.ts';

const S8_DIR = new URL(
  './fixtures/scenarios/s8-pnpm-workspace',
  import.meta.url,
).pathname;

// ── Helper: create workspace fixture in temp dir ────────────

interface WorkspaceFixtureOptions {
  packages: Array<{
    name: string;
    dir: string;
    files: Record<string, string>;
  }>;
  registryEntries?: Record<string, object>;
  skipRegistry?: boolean;
}

async function createWorkspaceFixture(
  baseDir: string,
  prefix: string,
  options: WorkspaceFixtureOptions,
): Promise<string> {
  const dir = await mkdtemp(join(baseDir, `${prefix}-`));

  // pnpm-workspace.yaml
  const packageDirs = options.packages.map((p) => p.dir);
  // Derive glob patterns from package dirs (e.g. "packages/core" → "packages/*")
  const globs = [
    ...new Set(packageDirs.map((d) => d.replace(/\/[^/]+$/, '/*'))),
  ];
  await writeFile(
    join(dir, 'pnpm-workspace.yaml'),
    `packages:\n${globs.map((g) => `  - '${g}'`).join('\n')}\n`,
    'utf-8',
  );

  // Package directories + source files
  for (const pkg of options.packages) {
    const pkgDir = join(dir, pkg.dir);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkg.name }, null, 2),
      'utf-8',
    );
    for (const [filePath, content] of Object.entries(pkg.files)) {
      const fullPath = join(pkgDir, filePath);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
    }
  }

  // Registry
  if (!options.skipRegistry) {
    const configDir = join(dir, '.config', 'shiori');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'registry.json'),
      JSON.stringify(options.registryEntries ?? {}, null, 2) + '\n',
      'utf-8',
    );
  }

  return dir;
}

// ── Tests ────────────────────────────────────────────────────

describe('check --workspace: static s8 fixture', () => {
  it('exits 0 and returns workspace JSON with package breakdown', async () => {
    const { exitCode, stdout, stderr } = await runCli([
      'check',
      '--workspace',
      '--cwd',
      S8_DIR,
      '--patterns',
      'src/**/*.ts',
    ]);

    assert.equal(exitCode, 0, `Expected exit 0, stderr: ${stderr}`);

    // stderr should mention workspace detection
    assert.ok(
      stderr.includes('Workspace detected'),
      'stderr should mention workspace detection',
    );
    assert.ok(stderr.includes('2 package(s)'), 'stderr should show 2 packages');

    // stdout should be valid JSON with workspace structure
    const result = unwrapEnvelope<{
      workspace: boolean;
      packages: Array<{
        name: string;
        dir: string;
        issues: number;
        errors: number;
        warnings: number;
      }>;
      verifyResult: {
        summary: { errors: number; total: number };
      };
    }>(stdout);

    assert.equal(result.workspace, true);
    assert.equal(result.packages.length, 2);

    // Check package names
    const names = result.packages.map((p) => p.name).sort();
    assert.deepEqual(names, ['@myapp/core', '@myapp/ui']);

    // Check package dirs
    const dirs = result.packages.map((p) => p.dir).sort();
    assert.deepEqual(dirs, ['packages/core', 'packages/ui']);

    // All annotations are in registry, so 0 errors
    assert.equal(result.verifyResult.summary.errors, 0);
  });

  it('per-package scan summary appears in stderr', async () => {
    const { stderr } = await runCli([
      'check',
      '--workspace',
      '--cwd',
      S8_DIR,
      '--patterns',
      'src/**/*.ts',
    ]);

    // Should list both packages with annotation counts
    assert.ok(
      stderr.includes('@myapp/core'),
      'stderr should mention @myapp/core',
    );
    assert.ok(stderr.includes('@myapp/ui'), 'stderr should mention @myapp/ui');
    assert.ok(
      stderr.includes('annotation(s)'),
      'stderr should include annotation count',
    );
  });
});

describe('check --workspace: non-json formats fall back to standard output', () => {
  it('markdown format does not include workspace wrapper', async () => {
    const { exitCode, stdout } = await runCli([
      'check',
      '--workspace',
      '--cwd',
      S8_DIR,
      '--patterns',
      'src/**/*.ts',
      '--format',
      'markdown',
    ]);

    assert.equal(exitCode, 0);
    // Markdown output should not contain "workspace" JSON key
    assert.ok(
      !stdout.includes('"workspace"'),
      'markdown output should not contain workspace JSON',
    );
    // Should contain markdown content
    assert.ok(
      stdout.includes('#') || stdout.includes('Verify'),
      'should produce markdown output',
    );
  });
});

describe('check --workspace: error when no workspace config', () => {
  let tempDir: string;

  before(async () => {
    // Create a non-workspace directory with just a registry
    tempDir = await mkdtemp(join(tmpdir(), 'shiori-no-ws-'));
    const configDir = join(tempDir, '.config', 'shiori');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'registry.json'),
      JSON.stringify({}, null, 2) + '\n',
      'utf-8',
    );
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('exits 3 with error message when workspace config is missing', async () => {
    const { exitCode, stderr } = await runCli([
      'check',
      '--workspace',
      '--cwd',
      tempDir,
    ]);

    assert.equal(exitCode, 3);
    assert.ok(
      stderr.includes('No workspace configuration found'),
      'should report missing workspace configuration',
    );
  });
});

describe('check --workspace: dynamic fixture with missing-in-registry', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-ws-test-'));
  });

  after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('exits 1 and reports per-package errors correctly', async () => {
    const dir = await createWorkspaceFixture(baseDir, 'missing', {
      packages: [
        {
          name: '@test/pkg-a',
          dir: 'packages/pkg-a',
          files: {
            'src/index.ts':
              '// eslint-disable-next-line no-console -- shiori: WS-001\nconsole.log("a");\n',
          },
        },
        {
          name: '@test/pkg-b',
          dir: 'packages/pkg-b',
          files: {
            'src/index.ts':
              '// eslint-disable-next-line no-console -- shiori: WS-MISSING\nconsole.log("b");\n',
          },
        },
      ],
      registryEntries: {
        'WS-001': { reason: 'known issue', target: 'all' },
        // WS-MISSING intentionally absent
      },
    });

    const { exitCode, stdout } = await runCli([
      'check',
      '--workspace',
      '--cwd',
      dir,
      '--patterns',
      'src/**/*.ts',
      '--fail-on',
      'missing-in-registry',
    ]);

    assert.equal(exitCode, 1);

    const result = unwrapEnvelope<{
      workspace: boolean;
      packages: Array<{
        name: string;
        dir: string;
        issues: number;
        errors: number;
        warnings: number;
      }>;
      verifyResult: {
        summary: { errors: number };
        issues: Array<{ ref: string; type: string; file: string }>;
      };
    }>(stdout);

    assert.equal(result.workspace, true);
    assert.equal(result.packages.length, 2);

    // pkg-a should have 0 errors (WS-001 is in registry)
    const pkgA = result.packages.find((p) => p.name === '@test/pkg-a');
    assert.ok(pkgA);
    assert.equal(pkgA.errors, 0);

    // pkg-b should have 1 error (WS-MISSING not in registry)
    const pkgB = result.packages.find((p) => p.name === '@test/pkg-b');
    assert.ok(pkgB);
    assert.equal(pkgB.errors, 1);

    // Verify the issue references the correct root-relative file path
    const missingIssue = result.verifyResult.issues.find(
      (i) => i.ref === 'WS-MISSING',
    );
    assert.ok(missingIssue);
    assert.equal(missingIssue.file, 'packages/pkg-b/src/index.ts');
  });
});

describe('check --workspace: without --workspace flag on monorepo root', () => {
  it('runs in single-package mode (no workspace wrapper)', async () => {
    const { exitCode, stdout } = await runCli([
      'check',
      '--cwd',
      S8_DIR,
      '--patterns',
      'src/**/*.ts',
    ]);

    // Without --workspace, should run in single-package mode
    // May find 0 annotations in root (s8 has no root src/)
    assert.equal(exitCode, 0);

    const result = unwrapEnvelope<{
      workspace?: boolean;
      summary: { errors: number };
    }>(stdout);

    // Should NOT have workspace wrapper
    assert.equal(result.workspace, undefined);
    assert.ok('summary' in result, 'should have standard VerifyResult shape');
  });
});
