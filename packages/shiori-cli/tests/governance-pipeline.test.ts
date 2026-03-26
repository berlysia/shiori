/**
 * Unit tests for governance-pipeline.ts (EP-0187 carryover).
 *
 * Tests the shared scan → report orchestrator used by
 * onboard-cli, pitch-cli, and health-cli.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGovernancePipeline } from '../src/core/governance-pipeline.ts';

// ── Helpers ──────────────────────────────────────────────────

/** Create a temporary project directory with the minimal shiori structure */
async function createTmpProject(): Promise<string> {
  const dir = join(tmpdir(), `shiori-gov-pipeline-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  return dir;
}

/** Write a JSON registry file to the project's config directory */
async function writeRegistry(
  projectDir: string,
  registry: Record<string, unknown>,
): Promise<string> {
  const registryPath = join(projectDir, '.config', 'shiori', 'registry.json');
  await writeFile(registryPath, JSON.stringify(registry));
  return registryPath;
}

/** Write a source file with shiori annotations */
async function writeSourceFile(
  projectDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await writeFile(join(projectDir, relativePath), content);
}

// ── Tests ────────────────────────────────────────────────────

describe('runGovernancePipeline', () => {
  describe('empty project (no annotations)', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {});
      // Empty source file — no annotations
      await writeSourceFile(tmpDir, 'src/clean.ts', '// no annotations here\n');
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('returns zero annotations and healthy score', async () => {
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: () => {},
      });

      assert.equal(result.scanResult.annotations.length, 0);
      assert.equal(result.scanResult.candidates.length, 0);
      assert.ok(result.scanResult.filesScanned >= 1);
      assert.equal(result.reportResult.health.score, 100);
      assert.equal(result.reportResult.health.level, 'healthy');
      assert.ok(result.registryPath.length > 0);
    });
  });

  describe('project with tracked annotations', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {
        'TEST-001': { reason: 'workaround for upstream bug', target: 'src/' },
      });
      await writeSourceFile(
        tmpDir,
        'src/example.ts',
        [
          '// eslint-disable-next-line no-console -- shiori: TEST-001',
          'console.log("tracked");',
        ].join('\n'),
      );
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('finds annotations and returns report with registry', async () => {
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: () => {},
      });

      assert.equal(result.scanResult.annotations.length, 1);
      assert.equal(result.scanResult.annotations[0]!.ref, 'TEST-001');
      assert.ok(result.registry['TEST-001']);
      // Score should be 100 — annotation is properly tracked
      assert.equal(result.reportResult.health.score, 100);
    });
  });

  describe('project with unregistered annotations', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      // Empty registry — annotation is not registered
      await writeRegistry(tmpDir, {});
      await writeSourceFile(
        tmpDir,
        'src/unregistered.ts',
        [
          '// eslint-disable-next-line no-console -- shiori: MISSING-001',
          'console.log("unregistered");',
        ].join('\n'),
      );
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('detects unregistered annotation and lowers score', async () => {
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: () => {},
      });

      assert.equal(result.scanResult.annotations.length, 1);
      assert.equal(result.scanResult.annotations[0]!.ref, 'MISSING-001');
      // Score should be < 100 — unregistered annotation penalizes
      assert.ok(
        result.reportResult.health.score < 100,
        `Expected score < 100, got ${result.reportResult.health.score}`,
      );
    });
  });

  describe('project with candidates (untracked lint disables)', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {});
      await writeSourceFile(
        tmpDir,
        'src/candidate.ts',
        [
          '// eslint-disable-next-line no-console',
          'console.log("no shiori marker");',
        ].join('\n'),
      );
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('detects candidates', async () => {
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: () => {},
      });

      assert.ok(
        result.scanResult.candidates.length >= 1,
        `Expected at least 1 candidate, got ${result.scanResult.candidates.length}`,
      );
    });
  });

  describe('onScanProgress callback', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {});
      await writeSourceFile(tmpDir, 'src/empty.ts', '// nothing\n');
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('receives progress message with file/annotation counts', async () => {
      const messages: string[] = [];
      await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: (msg) => messages.push(msg),
      });

      assert.equal(messages.length, 1);
      assert.ok(
        messages[0]!.includes('Scanned'),
        `Expected progress message to include "Scanned", got: ${messages[0]}`,
      );
      assert.ok(
        messages[0]!.includes('annotation'),
        `Expected progress message to include "annotation", got: ${messages[0]}`,
      );
    });
  });

  describe('pattern resolution', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {
        'PAT-001': { reason: 'test', target: 'src/' },
      });
      // Two files — only one matches the restricted pattern
      await writeSourceFile(
        tmpDir,
        'src/matched.ts',
        '// eslint-disable-next-line no-console -- shiori: PAT-001\nconsole.log("matched");\n',
      );
      await writeSourceFile(
        tmpDir,
        'src/excluded.css',
        '/* stylelint-disable color-named -- shiori: PAT-001 */\n',
      );
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('respects pattern option to limit scanned files', async () => {
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: () => {},
      });

      // Only .ts files scanned — CSS file excluded
      const files = result.scanResult.annotations.map((a) => a.location.file);
      assert.ok(
        files.every((f) => f.endsWith('.ts')),
        `Expected only .ts files, got: ${JSON.stringify(files)}`,
      );
    });
  });

  describe('result shape', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {});
      await writeSourceFile(tmpDir, 'src/shape.ts', '// nothing\n');
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('returns all expected fields', async () => {
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: () => {},
      });

      // Verify the result shape matches GovernancePipelineResult
      assert.ok('scanResult' in result);
      assert.ok('reportResult' in result);
      assert.ok('registry' in result);
      assert.ok('registryPath' in result);
      assert.ok('registryContext' in result);

      // ScanResult shape
      assert.ok('annotations' in result.scanResult);
      assert.ok('candidates' in result.scanResult);
      assert.ok('filesScanned' in result.scanResult);

      // ReportResult shape
      assert.ok('health' in result.reportResult);
      assert.ok('score' in result.reportResult.health);
      assert.ok('level' in result.reportResult.health);

      // RegistryContext shape
      assert.ok('config' in result.registryContext);
      assert.ok('registryPath' in result.registryContext);
      assert.ok('cwd' in result.registryContext);
    });
  });

  describe('expired annotations', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {
        'EXP-001': {
          reason: 'temp workaround',
          target: 'src/',
          expires: '2020-01-01',
        },
      });
      await writeSourceFile(
        tmpDir,
        'src/expired.ts',
        [
          '// eslint-disable-next-line no-console -- shiori: EXP-001 expires=2020-01-01',
          'console.log("expired");',
        ].join('\n'),
      );
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('reports expired annotations and lowers health score', async () => {
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
        onScanProgress: () => {},
      });

      assert.equal(result.scanResult.annotations.length, 1);
      // Expired annotation should lower the health score
      assert.ok(
        result.reportResult.health.score < 100,
        `Expected score < 100 for expired annotation, got ${result.reportResult.health.score}`,
      );
    });
  });

  describe('default onScanProgress (stderr)', () => {
    let tmpDir: string;

    before(async () => {
      tmpDir = await createTmpProject();
      await writeRegistry(tmpDir, {});
      await writeSourceFile(tmpDir, 'src/default.ts', '// nothing\n');
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('does not throw when onScanProgress is omitted', async () => {
      // Should use default console.error — must not throw
      const result = await runGovernancePipeline({
        cwd: tmpDir,
        patterns: 'src/**/*.ts',
      });

      assert.ok(result.scanResult);
      assert.ok(result.reportResult);
    });
  });
});
