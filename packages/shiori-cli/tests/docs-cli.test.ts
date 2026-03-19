import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers/cli-test-utils.ts';

describe('docs-cli: behavior', () => {
  describe('successful README output', () => {
    it('outputs README.md content to stdout', async () => {
      // docs command reads from package root, so run from PROJECT_ROOT
      const { exitCode, stdout } = await runCli(['docs']);

      assert.equal(exitCode, 0);
      // README should contain the project name
      assert.ok(stdout.includes('shiori'));
    });
  });
});
