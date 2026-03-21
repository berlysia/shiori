/**
 * CLI integration tests for `shiori fix --output-refs` (EP-0124).
 *
 * Tests the --output-refs flag behavior: validation errors,
 * happy path (refs written to file), and empty case (no new refs).
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

describe('fix --output-refs (EP-0124)', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-fix-output-refs-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('validation errors', () => {
    it('rejects --output-refs without --apply (exit code 2)', async () => {
      const dir = await createFixtureDir(baseDir, 'no-apply', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: REF-001\nconsole.log("test");\n',
        },
        registryEntries: {},
      });

      const { exitCode, stderr } = await runCli(
        [
          'fix',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--output-refs',
          join(dir, 'refs.txt'),
        ],
        { baseDir },
      );

      assert.equal(exitCode, 2);
      assert.ok(stderr.includes('--output-refs requires --apply'));
    });

    it('rejects --output-refs with --interactive (exit code 2)', async () => {
      const dir = await createFixtureDir(baseDir, 'interactive', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: REF-001\nconsole.log("test");\n',
        },
        registryEntries: {},
      });

      // --interactive without TTY will fail first, but --output-refs + --interactive
      // validation is checked before TTY check because --apply is also absent.
      // With --apply + --interactive + --output-refs, the mutual exclusivity
      // of --apply and --interactive is checked first (existing validation).
      // So we test --output-refs without --apply + --interactive.
      const { exitCode, stderr } = await runCli(
        [
          'fix',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--output-refs',
          join(dir, 'refs.txt'),
          '--interactive',
        ],
        { baseDir },
      );

      // Without --apply, --output-refs validation fires first
      assert.equal(exitCode, 2);
      assert.ok(
        stderr.includes('--output-refs requires --apply') ||
          stderr.includes('--interactive requires a TTY'),
      );
    });
  });

  describe('apply mode with --output-refs', () => {
    it('writes applied refs to file (newline-delimited)', async () => {
      const dir = await createFixtureDir(baseDir, 'happy', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: NEW-001\nconsole.log("a");\n// eslint-disable-next-line no-console -- shiori: NEW-002\nconsole.log("b");\n',
        },
        registryEntries: {},
      });

      const refsPath = join(dir, '.tmp', 'applied-refs.txt');
      const { exitCode } = await runCli(
        [
          'fix',
          '--apply',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--output-refs',
          refsPath,
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);

      const content = await readFile(refsPath, 'utf-8');
      const refs = content.trim().split('\n').filter(Boolean);
      assert.ok(
        refs.includes('NEW-001'),
        `Expected NEW-001 in refs, got: ${content}`,
      );
      assert.ok(
        refs.includes('NEW-002'),
        `Expected NEW-002 in refs, got: ${content}`,
      );
    });

    it('creates empty file when no new refs to add', async () => {
      const dir = await createFixtureDir(baseDir, 'empty', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: EXIST-001\nconsole.log("test");\n',
        },
        registryEntries: {
          'EXIST-001': { reason: 'already tracked', target: 'src/sample.ts' },
        },
      });

      const refsPath = join(dir, '.tmp', 'applied-refs.txt');
      const { exitCode } = await runCli(
        [
          'fix',
          '--apply',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--output-refs',
          refsPath,
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);

      const content = await readFile(refsPath, 'utf-8');
      // Empty content (writeOutput adds trailing newline, so content is just "\n")
      const refs = content.trim().split('\n').filter(Boolean);
      assert.equal(
        refs.length,
        0,
        `Expected empty refs file, got: ${JSON.stringify(content)}`,
      );
    });
  });
});
