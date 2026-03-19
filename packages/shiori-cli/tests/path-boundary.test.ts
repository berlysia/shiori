import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertWithinCwd,
  assertAllWithinCwd,
  PathBoundaryError,
} from '../src/core/path-boundary.ts';

describe('assertWithinCwd', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-path-boundary-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    // Create a subdirectory and file for testing
    await mkdir(join(tmpDir, 'project', 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'project', 'src', 'index.ts'), '// ok');
    // Create a directory outside the project for symlink tests
    await mkdir(join(tmpDir, 'outside'), { recursive: true });
    await writeFile(join(tmpDir, 'outside', 'secret.txt'), 'secret');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Normal case (1) ---

  it('accepts a path within cwd', async () => {
    const projectDir = join(tmpDir, 'project');
    const result = await assertWithinCwd('src/index.ts', projectDir);
    assert.ok(result.endsWith('src/index.ts'));
  });

  // --- Abnormal cases (6) ---

  it('rejects path traversal with ../', async () => {
    const projectDir = join(tmpDir, 'project');
    await assert.rejects(
      () => assertWithinCwd('../outside/secret.txt', projectDir),
      (err: unknown) => {
        assert.ok(err instanceof PathBoundaryError);
        assert.ok(err.message.includes('outside the allowed boundary'));
        return true;
      },
    );
  });

  it('rejects absolute path outside cwd', async () => {
    const projectDir = join(tmpDir, 'project');
    const outsidePath = join(tmpDir, 'outside', 'secret.txt');
    await assert.rejects(
      () => assertWithinCwd(outsidePath, projectDir),
      (err: unknown) => {
        assert.ok(err instanceof PathBoundaryError);
        return true;
      },
    );
  });

  it('rejects path with embedded .. segments', async () => {
    const projectDir = join(tmpDir, 'project');
    await assert.rejects(
      () => assertWithinCwd('src/../../outside/secret.txt', projectDir),
      (err: unknown) => {
        assert.ok(err instanceof PathBoundaryError);
        return true;
      },
    );
  });

  it('rejects symlink that resolves outside cwd', async () => {
    const projectDir = join(tmpDir, 'project');
    const linkPath = join(projectDir, 'src', 'sneaky-link');
    try {
      await symlink(join(tmpDir, 'outside'), linkPath);
    } catch {
      // symlink creation may fail on some CI environments; skip gracefully
      return;
    }

    await assert.rejects(
      () => assertWithinCwd('src/sneaky-link/secret.txt', projectDir),
      (err: unknown) => {
        assert.ok(err instanceof PathBoundaryError);
        return true;
      },
    );
  });

  it('accepts path to non-existent file within cwd', async () => {
    const projectDir = join(tmpDir, 'project');
    // File doesn't exist but parent directory does and is within cwd
    const result = await assertWithinCwd('src/new-file.ts', projectDir);
    assert.ok(result.endsWith('src/new-file.ts'));
  });

  it('rejects cwd prefix attack (cwd name as substring)', async () => {
    // If cwd is "/tmp/project", a path in "/tmp/project-evil/" should be rejected
    const evilDir = join(tmpDir, 'project-evil');
    await mkdir(evilDir, { recursive: true });
    await writeFile(join(evilDir, 'payload.txt'), 'evil');

    const projectDir = join(tmpDir, 'project');
    const evilPath = join(evilDir, 'payload.txt');
    await assert.rejects(
      () => assertWithinCwd(evilPath, projectDir),
      (err: unknown) => {
        assert.ok(err instanceof PathBoundaryError);
        return true;
      },
    );
  });
});

describe('assertAllWithinCwd', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-path-boundary-all-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, 'project', 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'project', 'src', 'a.ts'), '// a');
    await writeFile(join(tmpDir, 'project', 'src', 'b.ts'), '// b');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('validates multiple paths successfully', async () => {
    const projectDir = join(tmpDir, 'project');
    const results = await assertAllWithinCwd(
      ['src/a.ts', 'src/b.ts'],
      projectDir,
    );
    assert.equal(results.length, 2);
  });

  it('fails fast on first invalid path', async () => {
    const projectDir = join(tmpDir, 'project');
    await assert.rejects(
      () =>
        assertAllWithinCwd(
          ['src/a.ts', '../outside/evil.txt', 'src/b.ts'],
          projectDir,
        ),
      (err: unknown) => {
        assert.ok(err instanceof PathBoundaryError);
        return true;
      },
    );
  });
});
