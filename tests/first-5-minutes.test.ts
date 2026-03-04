/**
 * First 5 Minutes E2E — EP-0028
 *
 * Validates the complete onboarding flow for a new user starting with
 * an empty project directory. Measures per-step timing and records
 * friction points for future doctor check items.
 *
 * Flow: empty project → write source → shiori init → shiori check → shiori update → shiori check (pass) → shiori doctor
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  mkdtemp,
  access,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli as _runCli,
  PROJECT_ROOT,
  type CliResult,
} from './helpers/cli-test-utils.ts';

/** Wrapper that keeps capture files within PROJECT_ROOT/.tmp */
async function runCli(args: string[], cwd?: string): Promise<CliResult> {
  return _runCli(args, {
    cwd,
    baseDir: join(PROJECT_ROOT, '.tmp', 'cli-run'),
  });
}

/** Per-step timing record */
interface StepTiming {
  step: string;
  elapsed_ms: number;
  exitCode: number;
}

/** Friction point discovered during the flow */
interface FrictionPoint {
  step: string;
  category:
    | 'error-message'
    | 'missing-guidance'
    | 'unexpected-behavior'
    | 'timing';
  description: string;
  suggestion?: string;
}

/** Measure a CLI step and record timing */
async function measureStep(
  name: string,
  args: string[],
  cwd?: string,
): Promise<{ result: CliResult; timing: StepTiming }> {
  const start = Date.now();
  const result = await runCli(args, cwd);
  const elapsed_ms = Date.now() - start;
  return {
    result,
    timing: { step: name, elapsed_ms, exitCode: result.exitCode },
  };
}

describe('First 5 Minutes E2E: Empty Project Onboarding', () => {
  let projectDir: string;
  const timings: StepTiming[] = [];
  const frictionPoints: FrictionPoint[] = [];

  before(async () => {
    const tmpBase = join(PROJECT_ROOT, '.tmp', 'test-first-5min');
    await mkdir(tmpBase, { recursive: true });
    projectDir = await mkdtemp(join(tmpBase, 'run-'));
  });

  after(async () => {
    // Report collected timings and friction points to stderr for observability
    if (timings.length > 0) {
      const totalMs = timings.reduce((sum, t) => sum + t.elapsed_ms, 0);
      console.error('\n--- First 5 Minutes E2E Timing Report ---');
      for (const t of timings) {
        console.error(`  ${t.step}: ${t.elapsed_ms}ms (exit ${t.exitCode})`);
      }
      console.error(`  TOTAL: ${totalMs}ms`);
    }
    if (frictionPoints.length > 0) {
      console.error('\n--- Friction Points ---');
      for (const fp of frictionPoints) {
        console.error(`  [${fp.category}] ${fp.step}: ${fp.description}`);
      }
    }

    await rm(projectDir, { recursive: true, force: true });
  });

  // ── Step 0: Start with an empty project ──

  it('Step 0: empty project has no shiori artifacts', async () => {
    // Verify project dir is truly empty (no .config/shiori/)
    let configExists = true;
    try {
      await access(join(projectDir, '.config', 'shiori'));
    } catch {
      configExists = false;
    }
    assert.equal(
      configExists,
      false,
      'Project should start without .config/shiori',
    );
  });

  // ── Step 1: Create source files with annotations ──

  it('Step 1: create sample source files with lint disable comments', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true });

    // TypeScript file with eslint disable + shiori annotation
    await writeFile(
      join(projectDir, 'src', 'app.ts'),
      [
        '// eslint-disable-next-line no-console -- shiori: ONBOARD-001 reason=initial-logging',
        'console.log("hello");',
        '',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiori: ONBOARD-002 expires=2027-06',
        'const data: any = {};',
        '',
        '// shiori: ONBOARD-003 reason=design-decision',
        'export default data;',
      ].join('\n') + '\n',
      'utf-8',
    );

    // CSS file with stylelint disable + shiori annotation
    await writeFile(
      join(projectDir, 'src', 'styles.css'),
      [
        '/* stylelint-disable-next-line property-no-vendor-prefix -- shiori: ONBOARD-004 reason=legacy-browser */',
        '.box { -webkit-transform: rotate(45deg); }',
      ].join('\n') + '\n',
      'utf-8',
    );

    // Verify files exist
    const appContent = await readFile(
      join(projectDir, 'src', 'app.ts'),
      'utf-8',
    );
    assert.ok(appContent.includes('ONBOARD-001'));
  });

  // ── Step 2: shiori init ──

  it('Step 2: shiori init creates config, registry, and gitignore', async () => {
    const { result, timing } = await measureStep(
      'init',
      ['init', '--cwd', projectDir, '--patterns', 'src/**/*.ts,src/**/*.css'],
      undefined,
    );
    timings.push(timing);

    assert.equal(
      result.exitCode,
      0,
      `init should succeed. stderr: ${result.stderr}`,
    );

    // Verify expected output messages
    assert.ok(
      result.stderr.includes('shiori initialized'),
      'Should show initialization message',
    );
    assert.ok(result.stderr.includes('config:'), 'Should report config step');
    assert.ok(
      result.stderr.includes('registry:'),
      'Should report registry step',
    );
    assert.ok(
      result.stderr.includes('gitignore:'),
      'Should report gitignore step',
    );

    // Verify artifacts created
    const configContent = await readFile(
      join(projectDir, '.config', 'shiori', 'config.yaml'),
      'utf-8',
    );
    assert.ok(
      configContent.includes('shiori configuration'),
      'Config file should be created',
    );

    const registryContent = await readFile(
      join(projectDir, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    const registry = JSON.parse(registryContent) as Record<string, unknown>;
    assert.ok('ONBOARD-001' in registry, 'Registry should contain ONBOARD-001');
    assert.ok('ONBOARD-002' in registry, 'Registry should contain ONBOARD-002');
    assert.ok('ONBOARD-003' in registry, 'Registry should contain ONBOARD-003');
    assert.ok('ONBOARD-004' in registry, 'Registry should contain ONBOARD-004');

    const gitignoreContent = await readFile(
      join(projectDir, '.gitignore'),
      'utf-8',
    );
    assert.ok(
      gitignoreContent.includes('scan-result.json'),
      '.gitignore should include scan-result.json',
    );

    // Friction check: does init output guide the user to the next step?
    if (!result.stderr.includes('Next steps')) {
      frictionPoints.push({
        step: 'init',
        category: 'missing-guidance',
        description: 'init output does not include next steps guidance',
        suggestion: 'Add "Next steps:" section to init output',
      });
    }

    // Friction check: timing
    if (timing.elapsed_ms > 5000) {
      frictionPoints.push({
        step: 'init',
        category: 'timing',
        description: `init took ${timing.elapsed_ms}ms (> 5s threshold)`,
        suggestion: 'Investigate init performance bottleneck',
      });
    }
  });

  // ── Step 3: shiori check (first run — should pass with registry from init) ──

  it('Step 3: shiori check after init finds no errors', async () => {
    const { result, timing } = await measureStep('check-after-init', [
      'check',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts,src/**/*.css',
      '--warn-on',
      'missing-in-registry,unused-in-source,expired,syntax-error',
    ]);
    timings.push(timing);

    assert.equal(
      result.exitCode,
      0,
      `check should pass after init. stderr: ${result.stderr}`,
    );

    const checkResult = JSON.parse(result.stdout) as {
      summary: { errors: number; warnings: number };
      issues: Array<{ type: string; ref?: string }>;
    };
    assert.equal(
      checkResult.summary.errors,
      0,
      'No errors expected after init',
    );
  });

  // ── Step 4: Add a new annotation that is NOT in registry ──

  it('Step 4: add new annotation not in registry', async () => {
    // Simulate developer adding a new lint disable without running update
    await writeFile(
      join(projectDir, 'src', 'utils.ts'),
      [
        '// eslint-disable-next-line no-unused-vars -- shiori: ONBOARD-005 reason=placeholder',
        'const _unused = 42;',
      ].join('\n') + '\n',
      'utf-8',
    );
  });

  // ── Step 5: shiori check detects the missing ref ──

  it('Step 5: shiori check detects missing-in-registry for new annotation', async () => {
    const { result, timing } = await measureStep('check-missing-ref', [
      'check',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts,src/**/*.css',
      '--fail-on',
      'missing-in-registry',
      '--warn-on',
      'unused-in-source,expired,syntax-error',
    ]);
    timings.push(timing);

    assert.equal(
      result.exitCode,
      1,
      'check should fail with missing-in-registry',
    );

    const checkResult = JSON.parse(result.stdout) as {
      issues: Array<{ type: string; ref?: string }>;
      summary: { errors: number };
    };
    assert.ok(checkResult.summary.errors > 0, 'Should have errors');
    const missingIssues = checkResult.issues.filter(
      (i) => i.type === 'missing-in-registry',
    );
    assert.ok(
      missingIssues.some((i) => i.ref === 'ONBOARD-005'),
      'ONBOARD-005 should be reported as missing-in-registry',
    );

    // Friction check: does the error output help the user fix the issue?
    if (!result.stdout.includes('missing-in-registry')) {
      frictionPoints.push({
        step: 'check-missing-ref',
        category: 'error-message',
        description:
          'Check output does not clearly indicate missing-in-registry issue type',
      });
    }
  });

  // ── Step 6: shiori update adds missing ref to registry ──

  it('Step 6: shiori update adds the missing ref to registry', async () => {
    // First scan to get current state
    const scanRes = await runCli([
      'scan',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts,src/**/*.css',
    ]);
    assert.equal(scanRes.exitCode, 0, 'scan should succeed');

    const scanResultPath = join(
      projectDir,
      '.config',
      'shiori',
      'scan-result.json',
    );
    await writeFile(scanResultPath, scanRes.stdout, 'utf-8');

    const { result, timing } = await measureStep('update', [
      'update',
      '--scan',
      scanResultPath,
      '--cwd',
      projectDir,
    ]);
    timings.push(timing);

    assert.equal(
      result.exitCode,
      0,
      `update should succeed. stderr: ${result.stderr}`,
    );
    assert.ok(result.stderr.includes('Added'), 'Should report added refs');
    assert.ok(
      result.stderr.includes('ONBOARD-005'),
      'Should report ONBOARD-005 was added',
    );

    // Verify registry was updated
    const registryContent = await readFile(
      join(projectDir, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    const registry = JSON.parse(registryContent) as Record<
      string,
      { reason: string }
    >;
    assert.ok(
      'ONBOARD-005' in registry,
      'ONBOARD-005 should now be in registry',
    );
  });

  // ── Step 7: shiori check passes after update ──

  it('Step 7: shiori check passes after update', async () => {
    const { result, timing } = await measureStep('check-after-update', [
      'check',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts,src/**/*.css',
      '--fail-on',
      'missing-in-registry',
      '--warn-on',
      'unused-in-source,expired,syntax-error',
    ]);
    timings.push(timing);

    assert.equal(
      result.exitCode,
      0,
      `check should pass after update. stderr: ${result.stderr}`,
    );
  });

  // ── Step 8: shiori doctor reports healthy setup ──

  it('Step 8: shiori doctor reports healthy setup', async () => {
    const { result, timing } = await measureStep('doctor', [
      'doctor',
      '--cwd',
      projectDir,
      '--format',
      'json',
    ]);
    timings.push(timing);

    assert.equal(
      result.exitCode,
      0,
      `doctor should pass. stderr: ${result.stderr}`,
    );

    // doctor outputs to stderr (even in JSON format)
    const doctorResult = JSON.parse(result.stderr) as {
      checks: Array<{ name: string; status: string; message: string }>;
      summary: { pass: number; warn: number; fail: number };
    };
    assert.equal(doctorResult.summary.fail, 0, 'No doctor check should fail');

    // Record which checks passed/warned for friction analysis
    for (const check of doctorResult.checks) {
      if (check.status === 'warn') {
        frictionPoints.push({
          step: 'doctor',
          category: 'unexpected-behavior',
          description: `doctor check "${check.name}" warns: ${check.message}`,
          suggestion: `Investigate if this warning is expected for freshly initialized projects`,
        });
      }
    }
  });

  // ── Step 9: shiori init is idempotent (re-run doesn't overwrite) ──

  it('Step 9: shiori init is idempotent on existing project', async () => {
    const { result, timing } = await measureStep('init-idempotent', [
      'init',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts,src/**/*.css',
    ]);
    timings.push(timing);

    assert.equal(result.exitCode, 0, 'init should succeed on existing project');
    assert.ok(
      result.stderr.includes('already exists, skipped'),
      'Should skip existing config',
    );

    // Registry should still have all entries (not overwritten)
    const registryContent = await readFile(
      join(projectDir, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    const registry = JSON.parse(registryContent) as Record<string, unknown>;
    assert.ok(
      'ONBOARD-005' in registry,
      'ONBOARD-005 should be preserved after re-init',
    );
  });
});

describe('First 5 Minutes E2E: Zero Annotations Project', () => {
  let projectDir: string;

  before(async () => {
    const tmpBase = join(PROJECT_ROOT, '.tmp', 'test-first-5min-zero');
    await mkdir(tmpBase, { recursive: true });
    projectDir = await mkdtemp(join(tmpBase, 'run-'));
  });

  after(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('init succeeds with zero annotations', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true });
    // Source file with NO shiori annotations
    await writeFile(
      join(projectDir, 'src', 'clean.ts'),
      'export const x = 1;\n',
      'utf-8',
    );

    const result = await runCli([
      'init',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts',
    ]);

    assert.equal(
      result.exitCode,
      0,
      `init should succeed with zero annotations. stderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes('0 annotation(s)'),
      'Should report 0 annotations',
    );
    assert.ok(
      result.stderr.includes('shiori initialized'),
      'Should show initialization message',
    );

    // Registry should be created but empty
    const registryContent = await readFile(
      join(projectDir, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    const registry = JSON.parse(registryContent) as Record<string, unknown>;
    assert.equal(Object.keys(registry).length, 0, 'Registry should be empty');
  });

  it('check passes with zero annotations', async () => {
    const result = await runCli([
      'check',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts',
      '--fail-on',
      'missing-in-registry',
      '--warn-on',
      'unused-in-source,expired,syntax-error',
    ]);

    assert.equal(result.exitCode, 0, 'check should pass with zero annotations');
  });

  it('doctor passes with zero annotations', async () => {
    const result = await runCli([
      'doctor',
      '--cwd',
      projectDir,
      '--format',
      'json',
    ]);

    assert.equal(
      result.exitCode,
      0,
      `doctor should pass. stderr: ${result.stderr}`,
    );

    // doctor outputs to stderr (even in JSON format)
    const doctorResult = JSON.parse(result.stderr) as {
      summary: { fail: number };
    };
    assert.equal(doctorResult.summary.fail, 0, 'No doctor check should fail');
  });
});

describe('First 5 Minutes E2E: Candidate Detection Flow', () => {
  let projectDir: string;

  before(async () => {
    const tmpBase = join(PROJECT_ROOT, '.tmp', 'test-first-5min-candidates');
    await mkdir(tmpBase, { recursive: true });
    projectDir = await mkdtemp(join(tmpBase, 'run-'));
  });

  after(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('init detects candidates (lint disables without shiori annotation)', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'legacy.ts'),
      [
        '// eslint-disable-next-line no-console',
        'console.log("no shiori annotation");',
        '',
        '// eslint-disable-next-line no-unused-vars -- shiori: CAND-001',
        'const _x = 1;',
      ].join('\n') + '\n',
      'utf-8',
    );

    const result = await runCli([
      'init',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts',
    ]);

    assert.equal(result.exitCode, 0, 'init should succeed');
    // Init reports both annotations and candidates
    assert.ok(
      result.stderr.includes('1 annotation(s)'),
      'Should find 1 annotation',
    );
    assert.ok(
      result.stderr.includes('1 candidate(s)'),
      'Should find 1 candidate',
    );
  });

  it('check reports candidates for review', async () => {
    const result = await runCli([
      'check',
      '--cwd',
      projectDir,
      '--patterns',
      'src/**/*.ts',
      '--format',
      'summary',
      '--warn-on',
      'missing-in-registry,unused-in-source,expired,syntax-error',
    ]);

    assert.equal(result.exitCode, 0);
    const summary = JSON.parse(result.stdout) as {
      totals: { annotations: number; candidates: number };
    };
    assert.equal(summary.totals.annotations, 1, 'Should have 1 annotation');
    assert.equal(summary.totals.candidates, 1, 'Should have 1 candidate');
  });
});
