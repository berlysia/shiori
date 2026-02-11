import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, resolveConfig } from '../src/core/config.ts';

describe('config', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-config-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', async () => {
      const config = await loadConfig(tmpDir);
      assert.deepEqual(config.candidatePatterns, {
        'lint-disable': true,
        todo: false,
        fixme: false,
        hack: false,
        xxx: false,
      });
    });

    it('merges partial config with defaults', async () => {
      const configDir = join(tmpDir, 'partial');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, '.shiorirc.json'),
        JSON.stringify({ candidates: { todo: true, fixme: true } }),
        'utf-8',
      );

      const config = await loadConfig(configDir);
      assert.equal(config.candidatePatterns['lint-disable'], true);
      assert.equal(config.candidatePatterns.todo, true);
      assert.equal(config.candidatePatterns.fixme, true);
      assert.equal(config.candidatePatterns.hack, false);
      assert.equal(config.candidatePatterns.xxx, false);
    });

    it('allows disabling lint-disable pattern', async () => {
      const configDir = join(tmpDir, 'disable-lint');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, '.shiorirc.json'),
        JSON.stringify({ candidates: { 'lint-disable': false } }),
        'utf-8',
      );

      const config = await loadConfig(configDir);
      assert.equal(config.candidatePatterns['lint-disable'], false);
    });

    it('enables all TODO-like patterns', async () => {
      const configDir = join(tmpDir, 'all-todo');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, '.shiorirc.json'),
        JSON.stringify({
          candidates: { todo: true, fixme: true, hack: true, xxx: true },
        }),
        'utf-8',
      );

      const config = await loadConfig(configDir);
      assert.equal(config.candidatePatterns.todo, true);
      assert.equal(config.candidatePatterns.fixme, true);
      assert.equal(config.candidatePatterns.hack, true);
      assert.equal(config.candidatePatterns.xxx, true);
    });

    it('throws on invalid JSON', async () => {
      const configDir = join(tmpDir, 'invalid');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, '.shiorirc.json'), 'not json', 'utf-8');

      await assert.rejects(() => loadConfig(configDir), SyntaxError);
    });
  });

  describe('resolveConfig', () => {
    it('returns defaults for empty config', () => {
      const config = resolveConfig({});
      assert.deepEqual(config.candidatePatterns, {
        'lint-disable': true,
        todo: false,
        fixme: false,
        hack: false,
        xxx: false,
      });
      assert.equal(config.refPatterns, undefined);
    });

    it('overrides specific patterns', () => {
      const config = resolveConfig({
        candidates: { todo: true },
      });
      assert.equal(config.candidatePatterns.todo, true);
      assert.equal(config.candidatePatterns['lint-disable'], true);
    });

    it('passes through refPatterns', () => {
      const config = resolveConfig({
        refPatterns: [
          { match: 'JIRA:{id}', urlTemplate: 'https://jira.example.com/{id}' },
        ],
      });
      assert.equal(config.refPatterns!.length, 1);
      assert.equal(config.refPatterns![0]!.match, 'JIRA:{id}');
    });
  });
});
