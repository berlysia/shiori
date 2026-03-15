import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateVscodeConfig,
  VSCODE_CONFIG_PATH,
} from '../src/commands/init-vscode-templates.ts';

describe('init-vscode-templates', () => {
  describe('VSCODE_CONFIG_PATH', () => {
    it('points to .vscode/tasks.json', () => {
      assert.equal(VSCODE_CONFIG_PATH, '.vscode/tasks.json');
    });
  });

  describe('generateVscodeConfig', () => {
    it('returns valid JSON', () => {
      const content = generateVscodeConfig();
      const parsed = JSON.parse(content);
      assert.ok(parsed);
      assert.equal(typeof parsed, 'object');
    });

    it('has tasks.json version 2.0.0', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      assert.equal(parsed.version, '2.0.0');
    });

    it('contains exactly two tasks', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      assert.equal(parsed.tasks.length, 2);
    });

    it('includes Check (diagnostic) task', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      const checkTask = parsed.tasks.find(
        (t: { label: string }) => t.label === 'shiori: Check (diagnostic)',
      );
      assert.ok(checkTask, 'Check task should exist');
      assert.equal(checkTask.type, 'shell');
      assert.ok(checkTask.command.includes('check --format diagnostic'));
      assert.ok(!checkTask.isBackground, 'Check is not a background task');
    });

    it('includes Watch Diagnostic task as background', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      const watchTask = parsed.tasks.find(
        (t: { label: string }) =>
          t.label === 'shiori: Watch Diagnostic (real-time)',
      );
      assert.ok(watchTask, 'Watch task should exist');
      assert.equal(watchTask.type, 'shell');
      assert.ok(watchTask.command.includes('watch --format diagnostic'));
      assert.equal(watchTask.isBackground, true);
    });

    it('has correct problemMatcher pattern for Check task', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      const checkTask = parsed.tasks.find(
        (t: { label: string }) => t.label === 'shiori: Check (diagnostic)',
      );
      const pattern = checkTask.problemMatcher.pattern;
      assert.equal(
        pattern.regexp,
        '^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$',
      );
      assert.equal(pattern.file, 1);
      assert.equal(pattern.line, 2);
      assert.equal(pattern.column, 3);
      assert.equal(pattern.severity, 4);
      assert.equal(pattern.message, 5);
      assert.equal(pattern.code, 6);
    });

    it('has correct problemMatcher owner values', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      const checkTask = parsed.tasks.find(
        (t: { label: string }) => t.label === 'shiori: Check (diagnostic)',
      );
      const watchTask = parsed.tasks.find(
        (t: { label: string }) =>
          t.label === 'shiori: Watch Diagnostic (real-time)',
      );
      assert.equal(checkTask.problemMatcher.owner, 'shiori');
      assert.equal(watchTask.problemMatcher.owner, 'shiori-watch');
    });

    it('Watch task has background patterns', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      const watchTask = parsed.tasks.find(
        (t: { label: string }) =>
          t.label === 'shiori: Watch Diagnostic (real-time)',
      );
      const bg = watchTask.problemMatcher.background;
      assert.ok(bg, 'background config should exist');
      assert.equal(bg.activeOnStart, true);
      assert.ok(bg.beginsPattern);
      assert.ok(bg.endsPattern);
    });

    it('problemMatcher regexp matches diagnostic format', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      const pattern = parsed.tasks[0].problemMatcher.pattern;
      const regex = new RegExp(pattern.regexp);

      // Typical diagnostic output
      const line =
        'src/index.ts:42:1: error: Missing tracking reference [missing-ref]';
      const match = regex.exec(line);
      assert.ok(match, 'regexp should match diagnostic output');
      assert.equal(match[1], 'src/index.ts');
      assert.equal(match[2], '42');
      assert.equal(match[3], '1');
      assert.equal(match[4], 'error');
      assert.equal(match[5], 'Missing tracking reference');
      assert.equal(match[6], 'missing-ref');
    });

    it('problemMatcher regexp matches warning severity', () => {
      const parsed = JSON.parse(generateVscodeConfig());
      const pattern = parsed.tasks[0].problemMatcher.pattern;
      const regex = new RegExp(pattern.regexp);

      const line =
        'lib/utils.css:10:5: warning: Annotation expires soon [expiring-soon]';
      const match = regex.exec(line);
      assert.ok(match);
      assert.equal(match[4], 'warning');
    });

    it('ends with a trailing newline', () => {
      const content = generateVscodeConfig();
      assert.ok(content.endsWith('\n'));
    });
  });
});
