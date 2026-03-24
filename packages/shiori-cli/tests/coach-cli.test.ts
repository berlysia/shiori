import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createTempBase,
  createFixtureDir,
} from './helpers/cli-test-utils.ts';

describe('coach-cli: integration tests', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-coach-test-'));
  });

  after(async () => {
    await cleanup();
  });

  /**
   * Create a minimal project directory for coach tests.
   * Includes source file with annotation and a registry entry.
   */
  async function createCoachFixture(
    prefix: string,
    options?: { skipRegistry?: boolean },
  ): Promise<string> {
    return createFixtureDir(baseDir, prefix, {
      sourceFiles: {
        'src/sample.ts':
          '// eslint-disable-next-line no-console -- shiori: COACH-001\nconsole.log("test");\n',
      },
      registryEntries: options?.skipRegistry
        ? undefined
        : {
            'COACH-001': {
              reason: 'Test annotation for coach',
              owner: 'test-team',
            },
          },
      skipRegistry: options?.skipRegistry,
    });
  }

  describe('default invocation', () => {
    it('generates triage prompt on stdout with exit code 0', async () => {
      const dir = await createCoachFixture('default');
      const { exitCode, stdout, stderr } = await runCli(
        ['coach', '--cwd', dir, '--patterns', 'src/**/*.ts'],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      // Default template is triage — prompt should contain governance expert text
      assert.ok(stdout.includes('ガバナンスの専門家'));
      // Stderr should contain scan stats and coach summary
      assert.ok(stderr.includes('annotation(s)'));
      assert.ok(stderr.includes('Coach: template=triage'));
    });
  });

  describe('--template flag', () => {
    it('generates weekly template prompt', async () => {
      const dir = await createCoachFixture('weekly');
      const { exitCode, stdout } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--template',
          'weekly',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('ガバナンスコーチ'));
    });

    it('generates health template prompt', async () => {
      const dir = await createCoachFixture('health');
      const { exitCode, stdout } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--template',
          'health',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('健全性を診断'));
    });

    it('generates combined template prompt', async () => {
      const dir = await createCoachFixture('combined');
      const { exitCode, stdout } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--template',
          'combined',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Triage レポート'));
      assert.ok(stdout.includes('週次レポート'));
    });

    it('rejects invalid --template value with exit code 2', async () => {
      const dir = await createCoachFixture('invalid-tmpl');
      const { exitCode, stderr } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--template',
          'nonexistent',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 2);
      assert.ok(stderr.includes('Invalid --template'));
      assert.ok(stderr.includes('"nonexistent"'));
    });
  });

  describe('--format flag', () => {
    it('outputs JSON format with valid structure', async () => {
      const dir = await createCoachFixture('json-format');
      const { exitCode, stdout } = await runCli(
        ['coach', '--cwd', dir, '--patterns', 'src/**/*.ts', '-f', 'json'],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      const parsed = JSON.parse(stdout) as {
        template: string;
        prompt: string;
        sources: Record<string, unknown>;
      };
      assert.equal(parsed.template, 'triage');
      assert.ok(typeof parsed.prompt === 'string');
      assert.ok(parsed.sources !== undefined);
    });

    it('outputs github-issue format with collapsible details', async () => {
      const dir = await createCoachFixture('gh-issue');
      const { exitCode, stdout } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '-f',
          'github-issue',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Governance Coach Prompt'));
      assert.ok(stdout.includes('<details>'));
      assert.ok(stdout.includes('</details>'));
    });

    it('rejects invalid --format value', async () => {
      const dir = await createCoachFixture('invalid-fmt');
      const { exitCode, stderr } = await runCli(
        ['coach', '--cwd', dir, '--patterns', 'src/**/*.ts', '-f', 'invalid'],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('Invalid'));
    });
  });

  describe('--template-file flag', () => {
    it('uses custom template file for prompt generation', async () => {
      const dir = await createCoachFixture('custom-tmpl');
      const templatePath = join(dir, 'my-template.md');
      await writeFile(
        templatePath,
        'Custom prompt: {{TRIAGE_JSON}} end',
        'utf-8',
      );

      const { exitCode, stdout, stderr } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--template-file',
          'my-template.md',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Custom prompt:'));
      // Placeholder should be replaced with actual JSON
      assert.ok(!stdout.includes('{{TRIAGE_JSON}}'));
      assert.ok(stderr.includes('template=custom'));
    });

    it('reports error for missing template file', async () => {
      const dir = await createCoachFixture('missing-tmpl');
      const { exitCode, stderr } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--template-file',
          'nonexistent.md',
        ],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('Template file not found'));
      assert.ok(stderr.includes('nonexistent.md'));
    });

    it('rejects template file outside project boundary', async () => {
      const dir = await createCoachFixture('boundary');
      const { exitCode, stderr } = await runCli(
        [
          'coach',
          '--cwd',
          dir,
          '--patterns',
          'src/**/*.ts',
          '--template-file',
          '../../etc/passwd',
        ],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('outside') || stderr.includes('boundary'),
        `Expected path boundary error, got: ${stderr}`,
      );
    });
  });

  describe('registry not found', () => {
    it('fails gracefully when registry does not exist', async () => {
      const dir = await createCoachFixture('no-registry', {
        skipRegistry: true,
      });
      const { exitCode, stderr } = await runCli(
        ['coach', '--cwd', dir, '--patterns', 'src/**/*.ts'],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      // Should report a meaningful error, not an unhandled crash
      assert.ok(stderr.length > 0, 'Expected error output on stderr');
    });
  });

  describe('--output flag', () => {
    it('writes prompt to file', async () => {
      const dir = await createCoachFixture('output-file');
      const outputPath = join(dir, 'coach-output.md');
      const { exitCode, stdout } = await runCli(
        ['coach', '--cwd', dir, '--patterns', 'src/**/*.ts', '-o', outputPath],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      // stdout should be empty when --output is used
      assert.equal(stdout, '');

      // Verify file was written
      const content = await readFile(outputPath, 'utf-8');
      assert.ok(content.includes('ガバナンスの専門家'));
    });
  });
});
