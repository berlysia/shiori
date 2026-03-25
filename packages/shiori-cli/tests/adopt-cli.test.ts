import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createFixtureDir,
  createTempBase,
} from './helpers/cli-test-utils.ts';

/** Default scan result path within fixture dir */
const SCAN_RESULT_REL = '.config/shiori/scan-result.json';

describe('adopt-cli: argument validation', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-adopt-test-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('--prefix validation', () => {
    it('rejects lowercase prefix', async () => {
      const dir = await createFixtureDir(baseDir, 'prefix-lower', {
        scanResult: {
          annotations: [],
          candidates: [
            {
              pattern: 'eslint-disable-next-line',
              directive: 'no-console',
              location: { file: 'src/app.ts', line: 5 },
            },
          ],
          filesScanned: 1,
        },
      });

      const { exitCode, stderr } = await runCli([
        'adopt',
        '--cwd',
        dir,
        '--scan',
        join(dir, SCAN_RESULT_REL),
        '--prefix',
        'invalid',
      ]);

      assert.equal(exitCode, 2);
      assert.ok(stderr.includes('Invalid --prefix'));
    });

    it('rejects prefix starting with number', async () => {
      const dir = await createFixtureDir(baseDir, 'prefix-num', {
        scanResult: {
          annotations: [],
          candidates: [
            {
              pattern: 'eslint-disable-next-line',
              directive: 'no-console',
              location: { file: 'src/app.ts', line: 5 },
            },
          ],
          filesScanned: 1,
        },
      });

      const { exitCode, stderr } = await runCli([
        'adopt',
        '--cwd',
        dir,
        '--scan',
        join(dir, SCAN_RESULT_REL),
        '--prefix',
        '123BAD',
      ]);

      assert.equal(exitCode, 2);
      assert.ok(stderr.includes('Invalid --prefix'));
    });

    it('accepts valid prefix with namespace separator', async () => {
      const dir = await createFixtureDir(baseDir, 'prefix-ns', {
        scanResult: {
          annotations: [],
          candidates: [],
          filesScanned: 1,
        },
      });

      const { exitCode } = await runCli([
        'adopt',
        '--cwd',
        dir,
        '--scan',
        join(dir, SCAN_RESULT_REL),
        '--prefix',
        'JIRA:PROJ',
      ]);

      // No candidates, so exit 0 with "No candidates" message
      assert.equal(exitCode, 0);
    });
  });

  describe('no candidates', () => {
    it('reports nothing to adopt when candidates list is empty', async () => {
      const dir = await createFixtureDir(baseDir, 'no-cand', {
        scanResult: {
          annotations: [],
          candidates: [],
          filesScanned: 1,
        },
      });

      const { exitCode, stderr } = await runCli([
        'adopt',
        '--cwd',
        dir,
        '--scan',
        join(dir, SCAN_RESULT_REL),
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('No candidates found'));
    });
  });
});

describe('adopt-cli: dry-run preview', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-adopt-dry-'));
  });

  after(async () => {
    await cleanup();
  });

  it('shows preview without modifying files', async () => {
    const sourceContent =
      '// eslint-disable-next-line no-console\nconsole.log("hi");\n';
    const dir = await createFixtureDir(baseDir, 'dry', {
      sourceFiles: {
        'src/app.ts': sourceContent,
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
    });

    const { exitCode, stdout, stderr } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
    ]);

    assert.equal(exitCode, 0);
    // Preview output should contain candidate info
    assert.ok(stdout.includes('1 candidate(s)'));
    assert.ok(stdout.includes('src/app.ts'));
    // Should suggest --apply
    assert.ok(stderr.includes('--apply'));

    // Source file should NOT be modified
    const afterContent = await readFile(join(dir, 'src/app.ts'), 'utf-8');
    assert.equal(afterContent, sourceContent);
  });

  it('shows grouped summary by pattern', async () => {
    const dir = await createFixtureDir(baseDir, 'groups', {
      sourceFiles: {
        'src/a.ts':
          '// eslint-disable-next-line no-console\nconsole.log("a");\n',
        'src/b.css':
          '/* stylelint-disable-next-line plugin/baseline */\n.x { color: red; }\n',
      },
      scanResult: {
        annotations: [],
        candidates: [
          {
            pattern: 'eslint-disable-next-line',
            directive: 'no-console',
            location: { file: 'src/a.ts', line: 1 },
          },
          {
            pattern: 'stylelint-disable-next-line',
            directive: 'plugin/baseline',
            location: { file: 'src/b.css', line: 1 },
          },
        ],
        filesScanned: 2,
      },
    });

    const { exitCode, stdout } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
    ]);

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('2 candidate(s)'));
    assert.ok(stdout.includes('2 file(s)'));
    assert.ok(stdout.includes('eslint-disable-next-line'));
    assert.ok(stdout.includes('stylelint-disable-next-line'));
  });
});

describe('adopt-cli: --apply mode', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-adopt-apply-'));
  });

  after(async () => {
    await cleanup();
  });

  it('writes shiori annotation to source file and updates registry', async () => {
    const dir = await createFixtureDir(baseDir, 'apply', {
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
    assert.ok(stderr.includes('Adopted 1 candidate(s)'));

    // Source file should now contain shiori annotation
    const modifiedSource = await readFile(join(dir, 'src/app.ts'), 'utf-8');
    assert.ok(
      modifiedSource.includes('shiori:'),
      'Source should contain shiori annotation',
    );
    assert.ok(
      modifiedSource.includes('ADOPT-'),
      'Source should contain ADOPT ref prefix',
    );

    // Registry should have new entry
    const registryContent = await readFile(
      join(dir, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    const registry = JSON.parse(registryContent) as Record<string, unknown>;
    const refs = Object.keys(registry);
    assert.ok(
      refs.some((r) => r.startsWith('ADOPT-')),
      'Registry should contain ADOPT ref',
    );
  });

  it('respects custom --prefix, --reason, and --kind', async () => {
    const dir = await createFixtureDir(baseDir, 'custom-opts', {
      sourceFiles: {
        'src/index.ts':
          '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst x: any = 1;\n',
      },
      scanResult: {
        annotations: [],
        candidates: [
          {
            pattern: 'eslint-disable-next-line',
            directive: '@typescript-eslint/no-explicit-any',
            location: { file: 'src/index.ts', line: 1 },
          },
        ],
        filesScanned: 1,
      },
    });

    const { exitCode } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
      '--apply',
      '--prefix',
      'DEBT',
      '--reason',
      'legacy type workaround',
      '--kind',
      'tech-debt',
    ]);

    assert.equal(exitCode, 0);

    // Source file should use custom prefix
    const modifiedSource = await readFile(join(dir, 'src/index.ts'), 'utf-8');
    assert.ok(
      modifiedSource.includes('DEBT-'),
      'Source should use custom prefix DEBT',
    );

    // Registry should have custom reason and kind
    const registryContent = await readFile(
      join(dir, '.config', 'shiori', 'registry.json'),
      'utf-8',
    );
    const registry = JSON.parse(registryContent) as Record<
      string,
      { reason?: string; kind?: string }
    >;
    const entry = Object.values(registry).find((e) => e.reason != null);
    assert.ok(entry, 'Registry should have entry');
    assert.equal(entry!.reason, 'legacy type workaround');
    assert.equal(entry!.kind, 'tech-debt');
  });

  it('reports modified lines and suggests next step', async () => {
    const dir = await createFixtureDir(baseDir, 'report', {
      sourceFiles: {
        'src/a.ts':
          '// eslint-disable-next-line no-unused-vars\nconst x = 1;\n',
      },
      scanResult: {
        annotations: [],
        candidates: [
          {
            pattern: 'eslint-disable-next-line',
            directive: 'no-unused-vars',
            location: { file: 'src/a.ts', line: 1 },
          },
        ],
        filesScanned: 1,
      },
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
    assert.ok(stderr.includes('Modified'));
    assert.ok(stderr.includes('registry'));
    // EP-0159: dynamic CTA based on health score (replaces static "shiori check")
    assert.ok(stderr.includes('Next step:'));
    assert.ok(stderr.includes('shiori '));
  });
});

describe('adopt-cli: --wizard flag', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-adopt-wizard-'));
  });

  after(async () => {
    await cleanup();
  });

  it('rejects --wizard combined with --apply as mutually exclusive', async () => {
    const dir = await createFixtureDir(baseDir, 'wizard-apply', {
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
    });

    const { exitCode, stderr } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
      '--wizard',
      '--apply',
    ]);

    assert.equal(exitCode, 2);
    assert.ok(
      stderr.includes('--wizard and --apply are mutually exclusive'),
      'Should report mutually exclusive error',
    );
  });

  it('falls back to dry-run in non-TTY mode', async () => {
    const dir = await createFixtureDir(baseDir, 'wizard-notty', {
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
    });

    // runCli uses stdio: ['ignore', ...] which is non-TTY
    const { exitCode, stderr, stdout } = await runCli([
      'adopt',
      '--cwd',
      dir,
      '--scan',
      join(dir, SCAN_RESULT_REL),
      '--wizard',
    ]);

    assert.equal(exitCode, 0);
    // Should warn about non-TTY fallback
    assert.ok(
      stderr.includes('--wizard requires an interactive terminal'),
      'Should warn about non-TTY fallback',
    );
    // Should still show dry-run preview (non-wizard flow)
    assert.ok(
      stdout.includes('1 candidate(s)') || stderr.includes('--apply'),
      'Should show dry-run output',
    );
    // Source file should NOT be modified
    const afterContent = await readFile(join(dir, 'src/app.ts'), 'utf-8');
    assert.ok(
      !afterContent.includes('shiori:'),
      'Source should NOT be modified in non-TTY wizard mode',
    );
  });
});
