/**
 * Tests for workspace detection and cross-package scanning.
 *
 * Uses s8-pnpm-workspace fixture: pnpm monorepo with two packages
 * (packages/core and packages/ui), each containing shiori annotations.
 *
 * Architecture constraint: import from src/core/workspace.ts (pure functions),
 * never from *-cli.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  detectWorkspaces,
  scanWorkspaces,
  type WorkspaceDetectionResult,
} from '../src/core/workspace.ts';
import { CommentProvider } from '../src/core/providers/CommentProvider.ts';

const FIXTURES_DIR = new URL('./fixtures/scenarios', import.meta.url).pathname;
const S8_DIR = join(FIXTURES_DIR, 's8-pnpm-workspace');

const provider = new CommentProvider();

describe('workspace: detectWorkspaces()', () => {
  it('detects pnpm-workspace.yaml packages', async () => {
    const result = await detectWorkspaces(S8_DIR);

    assert.ok(result, 'should detect workspace');
    assert.equal(result.source, 'pnpm-workspace');
    assert.equal(result.root, S8_DIR);
    assert.equal(result.packages.length, 2);

    const names = result.packages.map((p) => p.name).sort();
    assert.deepEqual(names, ['@myapp/core', '@myapp/ui']);
  });

  it('returns correct directory paths', async () => {
    const result = await detectWorkspaces(S8_DIR);
    assert.ok(result);

    const dirs = result.packages.map((p) => p.dir).sort();
    assert.deepEqual(dirs, ['packages/core', 'packages/ui']);
  });

  it('returns null for non-workspace directory', async () => {
    // s1 has no pnpm-workspace.yaml or package.json#workspaces
    const result = await detectWorkspaces(join(FIXTURES_DIR, 's1'));
    assert.equal(result, null);
  });
});

describe('workspace: scanWorkspaces()', () => {
  let detection: WorkspaceDetectionResult;

  // Detect once, reuse across tests
  it('setup: detect packages', async () => {
    const result = await detectWorkspaces(S8_DIR);
    assert.ok(result);
    detection = result;
  });

  it('scans all packages and merges results', async () => {
    const result = await scanWorkspaces(detection.packages, S8_DIR, {
      patterns: ['src/**/*.ts'],
      ignore: ['**/node_modules/**', '**/dist/**'],
      provider,
    });

    // Should have 2 package results
    assert.equal(result.packages.length, 2);

    // Merged result should have annotations from both packages
    assert.ok(
      result.merged.annotations.length >= 4,
      `Expected at least 4 annotations, got ${result.merged.annotations.length}`,
    );

    // Merged filesScanned = sum of package file counts
    const sumFiles = result.packages.reduce(
      (sum, p) => sum + p.scanResult.filesScanned,
      0,
    );
    assert.equal(result.merged.filesScanned, sumFiles);
  });

  it('normalizes location.file to root-relative paths', async () => {
    const result = await scanWorkspaces(detection.packages, S8_DIR, {
      patterns: ['src/**/*.ts'],
      ignore: ['**/node_modules/**', '**/dist/**'],
      provider,
    });

    // All merged annotation paths should start with packages/<name>/
    for (const annotation of result.merged.annotations) {
      assert.ok(
        annotation.location.file.startsWith('packages/'),
        `Expected root-relative path starting with "packages/", got: ${annotation.location.file}`,
      );
    }

    // Verify specific paths exist
    const files = result.merged.annotations.map((a) => a.location.file);
    assert.ok(
      files.some((f) => f === 'packages/core/src/index.ts'),
      'Should contain packages/core/src/index.ts',
    );
    assert.ok(
      files.some((f) => f === 'packages/ui/src/button.ts'),
      'Should contain packages/ui/src/button.ts',
    );
  });

  it('preserves per-package scan results with package-relative paths', async () => {
    const result = await scanWorkspaces(detection.packages, S8_DIR, {
      patterns: ['src/**/*.ts'],
      ignore: ['**/node_modules/**', '**/dist/**'],
      provider,
    });

    const corePkg = result.packages.find((p) => p.package === '@myapp/core');
    assert.ok(corePkg, 'Should have @myapp/core package result');
    assert.equal(corePkg.dir, 'packages/core');

    // Per-package paths should be package-relative (not root-relative)
    for (const annotation of corePkg.scanResult.annotations) {
      assert.ok(
        annotation.location.file.startsWith('src/'),
        `Per-package path should be package-relative, got: ${annotation.location.file}`,
      );
    }
  });

  it('merged annotations contain correct refs', async () => {
    const result = await scanWorkspaces(detection.packages, S8_DIR, {
      patterns: ['src/**/*.ts'],
      ignore: ['**/node_modules/**', '**/dist/**'],
      provider,
    });

    const refs = result.merged.annotations.map((a) => a.ref).sort();
    assert.deepEqual(refs, ['SUP-100', 'SUP-101', 'SUP-200', 'SUP-201']);
  });

  it('merged annotations are stably sorted', async () => {
    const result = await scanWorkspaces(detection.packages, S8_DIR, {
      patterns: ['src/**/*.ts'],
      ignore: ['**/node_modules/**', '**/dist/**'],
      provider,
    });

    // Verify sort order: by ref, then file, then line
    for (let i = 1; i < result.merged.annotations.length; i++) {
      const prev = result.merged.annotations[i - 1]!;
      const curr = result.merged.annotations[i]!;
      const cmp =
        prev.ref.localeCompare(curr.ref) ||
        prev.location.file.localeCompare(curr.location.file) ||
        prev.location.line - curr.location.line;
      assert.ok(cmp <= 0, `Annotations not sorted at index ${i}`);
    }
  });
});
