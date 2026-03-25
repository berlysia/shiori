/**
 * Tests for EP-0152: adopt --auto-init
 *
 * Verifies that `shiori adopt` auto-initializes config and registry
 * when they don't exist, following the EP-0141 graceful degradation pattern.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createFixtureDir,
  createTempBase,
} from './helpers/cli-test-utils.ts';

const SCAN_RESULT_REL = '.config/shiori/scan-result.json';

describe('adopt --auto-init (EP-0152)', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-adopt-autoinit-'));
  });

  after(async () => {
    await cleanup();
  });

  it('auto-initializes config and registry when missing, then shows dry-run preview', async () => {
    const dir = await createFixtureDir(baseDir, 'autoinit-dry', {
      sourceFiles: {
        'src/app.ts':
          '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      },
      scanResult: {
        annotations: [],
        candidates: [
          {
            pattern: 'eslint-disable-next-line',
            directive: 'no-console',
            location: { file: 'src/app.ts', line: 1 },
          },
        ],
        filesScanned: 1,
      },
      skipRegistry: true,
    });

    const { exitCode, stdout, stderr } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
    ]);

    assert.equal(exitCode, 0);
    // Should report auto-initialization
    assert.ok(
      stderr.includes('Auto-initialized'),
      'Should report auto-initialization',
    );
    // Should still show dry-run preview
    assert.ok(
      stdout.includes('1 candidate(s)'),
      'Should show dry-run preview after auto-init',
    );
  });

  it('auto-initializes and applies changes with --apply', async () => {
    const dir = await createFixtureDir(baseDir, 'autoinit-apply', {
      sourceFiles: {
        'src/index.ts':
          '// eslint-disable-next-line no-unused-vars\nconst x = 1;\n',
      },
      scanResult: {
        annotations: [],
        candidates: [
          {
            pattern: 'eslint-disable-next-line',
            directive: 'no-unused-vars',
            location: { file: 'src/index.ts', line: 1 },
          },
        ],
        filesScanned: 1,
      },
      skipRegistry: true,
    });

    const { exitCode, stderr } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
      '--apply',
    ]);

    assert.equal(exitCode, 0);
    assert.ok(
      stderr.includes('Auto-initialized'),
      'Should report auto-initialization',
    );
    assert.ok(
      stderr.includes('Adopted 1 candidate(s)'),
      'Should report successful adoption',
    );

    // Source file should now contain shiori annotation
    const modifiedSource = await readFile(join(dir, 'src/index.ts'), 'utf-8');
    assert.ok(
      modifiedSource.includes('shiori:'),
      'Source should contain shiori annotation',
    );

    // Registry should have been created and contain the adopted entry
    const registryContent = await readFile(
      join(dir, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    const registry = JSON.parse(registryContent) as Record<string, unknown>;
    const refs = Object.keys(registry);
    assert.ok(refs.length > 0, 'Registry should have entries');
    assert.ok(
      refs.some((r) => r.startsWith('ADOPT-')),
      'Registry should contain ADOPT ref',
    );
  });

  it('creates config.yaml when config directory does not exist', async () => {
    const dir = await createFixtureDir(baseDir, 'autoinit-config', {
      sourceFiles: {
        'src/app.ts':
          '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      },
      scanResult: {
        annotations: [],
        candidates: [
          {
            pattern: 'eslint-disable-next-line',
            directive: 'no-console',
            location: { file: 'src/app.ts', line: 1 },
          },
        ],
        filesScanned: 1,
      },
      skipRegistry: true,
    });

    const { exitCode, stderr } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
    ]);

    assert.equal(exitCode, 0);
    assert.ok(
      stderr.includes('config'),
      'Should mention config in auto-init message',
    );

    // Config file should exist
    const configContent = await readFile(
      join(dir, '.config', 'shiori', 'config.yaml'),
      'utf-8',
    );
    assert.ok(
      configContent.includes('shiori configuration'),
      'Config should contain template content',
    );
  });

  it('does not auto-init when registry already exists', async () => {
    const dir = await createFixtureDir(baseDir, 'no-autoinit', {
      sourceFiles: {
        'src/app.ts':
          '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      },
      scanResult: {
        annotations: [],
        candidates: [
          {
            pattern: 'eslint-disable-next-line',
            directive: 'no-console',
            location: { file: 'src/app.ts', line: 1 },
          },
        ],
        filesScanned: 1,
      },
      // Default: registry IS created by createFixtureDir
    });

    const { exitCode, stderr } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
    ]);

    assert.equal(exitCode, 0);
    assert.ok(
      !stderr.includes('Auto-initialized'),
      'Should NOT auto-initialize when registry exists',
    );
  });

  it('reports nothing to adopt after auto-init when no candidates', async () => {
    const dir = await createFixtureDir(baseDir, 'autoinit-no-cand', {
      scanResult: {
        annotations: [],
        candidates: [],
        filesScanned: 1,
      },
      skipRegistry: true,
    });

    const { exitCode, stderr } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
    ]);

    assert.equal(exitCode, 0);
    assert.ok(
      stderr.includes('Auto-initialized'),
      'Should auto-initialize even with no candidates',
    );
    assert.ok(
      stderr.includes('No candidates found'),
      'Should report no candidates after auto-init',
    );
  });
});
