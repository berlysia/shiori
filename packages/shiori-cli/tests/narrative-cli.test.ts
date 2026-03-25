import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createTempBase,
  unwrapEnvelope,
} from './helpers/cli-test-utils.ts';

/**
 * Minimal ReportResult JSON that passes isReportShape() validation.
 * Fields beyond what isReportShape checks are needed by computeSnapshotDiff.
 */
function makeReportJson(
  overrides: {
    timestamp?: string;
    healthLevel?: string;
    healthScore?: number;
    annotations?: number;
    candidates?: number;
    registryEntries?: number;
    issues?: number;
    errors?: number;
    warnings?: number;
  } = {},
): string {
  return JSON.stringify(
    {
      timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
      health: {
        level: overrides.healthLevel ?? 'healthy',
        score: overrides.healthScore ?? 100,
        summary: 'Test report',
      },
      totals: {
        annotations: overrides.annotations ?? 5,
        candidates: overrides.candidates ?? 2,
        registryEntries: overrides.registryEntries ?? 5,
        issues: overrides.issues ?? 0,
        errors: overrides.errors ?? 0,
        warnings: overrides.warnings ?? 0,
      },
      insights: [],
      byType: {},
      byRule: [],
      byKind: [],
      byOwner: [],
      verifyResult: {
        issues: [],
        summary: { total: 0, errors: 0, warnings: 0 },
      },
    },
    null,
    2,
  );
}

describe('narrative-cli: integration tests', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-narrative-test-'));
  });

  after(async () => {
    await cleanup();
  });

  /**
   * Create a history directory with two report snapshots inside a project dir.
   * Returns the project directory path.
   */
  async function createNarrativeFixture(
    prefix: string,
    options?: {
      baseReport?: string;
      headReport?: string;
      reportCount?: number;
    },
  ): Promise<string> {
    const dir = join(baseDir, `${prefix}-${Date.now()}`);
    const historyDir = join(dir, 'reports');
    await mkdir(historyDir, { recursive: true });

    const baseReport =
      options?.baseReport ??
      makeReportJson({
        timestamp: '2026-01-01T00:00:00.000Z',
        healthLevel: 'warning',
        healthScore: 60,
        annotations: 10,
        candidates: 5,
        issues: 3,
      });
    const headReport =
      options?.headReport ??
      makeReportJson({
        timestamp: '2026-01-02T00:00:00.000Z',
        healthLevel: 'healthy',
        healthScore: 90,
        annotations: 8,
        candidates: 3,
        issues: 0,
      });

    await writeFile(
      join(historyDir, '2026-01-01T00-00-00-000Z.json'),
      baseReport,
      'utf-8',
    );
    await writeFile(
      join(historyDir, '2026-01-02T00-00-00-000Z.json'),
      headReport,
      'utf-8',
    );

    if (options?.reportCount && options.reportCount > 2) {
      for (let i = 2; i < options.reportCount; i++) {
        const ts = `2026-01-0${i + 1}T00:00:00.000Z`;
        const report = makeReportJson({
          timestamp: ts,
          healthScore: 60 + i * 10,
        });
        await writeFile(
          join(historyDir, `2026-01-0${i + 1}T00-00-00-000Z.json`),
          report,
          'utf-8',
        );
      }
    }

    return dir;
  }

  describe('--history mode', () => {
    it('generates JSON narrative from history directory with exit code 0', async () => {
      const dir = await createNarrativeFixture('history-json');
      const { exitCode, stdout, stderr } = await runCli(
        ['narrative', '--history', join(dir, 'reports'), '--cwd', dir],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      // Default format is JSON
      const parsed = unwrapEnvelope<{
        headline: string;
        observations: unknown[];
      }>(stdout);
      assert.ok(parsed.headline, 'Should have a headline');
      assert.ok(
        Array.isArray(parsed.observations),
        'Should have observations array',
      );
      // Stderr should contain summary
      assert.ok(
        stderr.includes('Narrative:'),
        `Expected stderr to contain narrative summary, got: ${stderr}`,
      );
    });

    it('generates markdown narrative from history directory', async () => {
      const dir = await createNarrativeFixture('history-md');
      const { exitCode, stdout } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '--format',
          'markdown',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(
        stdout.includes('<!-- shiori-narrative -->'),
        'Should include dedup marker',
      );
      assert.ok(
        stdout.includes('Shiori Governance Narrative'),
        'Should include title',
      );
      assert.ok(
        stdout.includes('Health Transition'),
        'Should include health section',
      );
    });

    it('uses oldest and newest snapshots when multiple files exist', async () => {
      const dir = await createNarrativeFixture('history-multi', {
        reportCount: 4,
      });
      const { exitCode, stdout } = await runCli(
        ['narrative', '--history', join(dir, 'reports'), '--cwd', dir],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      const parsed = unwrapEnvelope<{
        baseTimestamp: string;
        headTimestamp: string;
      }>(stdout);
      // Oldest (2026-01-01) as base, newest (2026-01-04) as head
      assert.equal(parsed.baseTimestamp, '2026-01-01T00:00:00.000Z');
      assert.equal(parsed.headTimestamp, '2026-01-04T00:00:00.000Z');
    });

    it('fails when history directory has fewer than 2 snapshots', async () => {
      const dir = join(baseDir, `history-single-${Date.now()}`);
      const historyDir = join(dir, 'reports');
      await mkdir(historyDir, { recursive: true });
      await writeFile(
        join(historyDir, 'single.json'),
        makeReportJson(),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli(
        ['narrative', '--history', join(dir, 'reports'), '--cwd', dir],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('2 snapshots'),
        `Expected error about needing 2 snapshots, got: ${stderr}`,
      );
    });

    it('fails when history directory does not exist', async () => {
      const dir = join(baseDir, `history-nodir-${Date.now()}`);
      await mkdir(dir, { recursive: true });

      const { exitCode, stderr } = await runCli(
        ['narrative', '--history', join(dir, 'nonexistent'), '--cwd', dir],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(stderr.length > 0, 'Expected error output on stderr');
    });
  });

  describe('--base/--head mode', () => {
    it('generates narrative from explicit base and head files', async () => {
      const dir = join(baseDir, `explicit-${Date.now()}`);
      await mkdir(dir, { recursive: true });

      await writeFile(
        join(dir, 'base.json'),
        makeReportJson({
          timestamp: '2026-02-01T00:00:00.000Z',
          healthScore: 50,
          healthLevel: 'critical',
          issues: 5,
        }),
        'utf-8',
      );
      await writeFile(
        join(dir, 'head.json'),
        makeReportJson({
          timestamp: '2026-02-02T00:00:00.000Z',
          healthScore: 80,
          healthLevel: 'healthy',
          issues: 1,
        }),
        'utf-8',
      );

      const { exitCode, stdout } = await runCli(
        [
          'narrative',
          '--base',
          'base.json',
          '--head',
          'head.json',
          '--cwd',
          dir,
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      const parsed = unwrapEnvelope<{ headline: string }>(stdout);
      assert.ok(
        parsed.headline.includes('improved'),
        `Expected improving headline, got: ${parsed.headline}`,
      );
    });

    it('fails when only --base is provided without --head', async () => {
      const dir = join(baseDir, `base-only-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'base.json'), makeReportJson(), 'utf-8');

      const { exitCode, stderr } = await runCli(
        ['narrative', '--base', 'base.json', '--cwd', dir],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('--base and --head must be used together'),
        `Expected usage error about --base/--head, got: ${stderr}`,
      );
    });

    it('fails when only --head is provided without --base', async () => {
      const dir = join(baseDir, `head-only-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'head.json'), makeReportJson(), 'utf-8');

      const { exitCode, stderr } = await runCli(
        ['narrative', '--head', 'head.json', '--cwd', dir],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('--base and --head must be used together'),
        `Expected usage error about --base/--head, got: ${stderr}`,
      );
    });

    it('fails when base file is not a valid ReportResult', async () => {
      const dir = join(baseDir, `invalid-base-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'base.json'), '{"not": "a report"}', 'utf-8');
      await writeFile(join(dir, 'head.json'), makeReportJson(), 'utf-8');

      const { exitCode, stderr } = await runCli(
        [
          'narrative',
          '--base',
          'base.json',
          '--head',
          'head.json',
          '--cwd',
          dir,
        ],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('not a valid ReportResult'),
        `Expected validation error, got: ${stderr}`,
      );
    });

    it('rejects file path outside cwd boundary', async () => {
      const dir = join(baseDir, `boundary-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'head.json'), makeReportJson(), 'utf-8');

      const { exitCode, stderr } = await runCli(
        [
          'narrative',
          '--base',
          '../../etc/passwd',
          '--head',
          'head.json',
          '--cwd',
          dir,
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

  describe('input mode conflicts', () => {
    it('rejects --history combined with --base/--head', async () => {
      const dir = await createNarrativeFixture('conflict');

      const { exitCode, stderr } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--base',
          'base.json',
          '--cwd',
          dir,
        ],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('cannot be used together'),
        `Expected conflict error, got: ${stderr}`,
      );
    });

    it('fails when no input mode is specified', async () => {
      const dir = join(baseDir, `no-input-${Date.now()}`);
      await mkdir(dir, { recursive: true });

      const { exitCode, stderr } = await runCli(['narrative', '--cwd', dir], {
        baseDir,
      });

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('--history') && stderr.includes('--base'),
        `Expected usage error about required input, got: ${stderr}`,
      );
    });
  });

  describe('--format flag', () => {
    it('outputs JSON format by default', async () => {
      const dir = await createNarrativeFixture('default-fmt');
      const { exitCode, stdout } = await runCli(
        ['narrative', '--history', join(dir, 'reports'), '--cwd', dir],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      // Should be parseable JSON with schema envelope
      unwrapEnvelope(stdout, 'narrative');
    });

    it('outputs markdown format with --format markdown', async () => {
      const dir = await createNarrativeFixture('md-fmt');
      const { exitCode, stdout } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '-f',
          'markdown',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('<!-- shiori-narrative -->'));
      assert.ok(
        stdout.includes('# 📈 Shiori Governance Narrative') ||
          stdout.includes('# 📉 Shiori Governance Narrative'),
      );
    });

    it('rejects invalid --format value', async () => {
      const dir = await createNarrativeFixture('bad-fmt');
      const { exitCode, stderr } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '-f',
          'invalid',
        ],
        { baseDir },
      );

      assert.notEqual(exitCode, 0);
      assert.ok(
        stderr.includes('Invalid'),
        `Expected format validation error, got: ${stderr}`,
      );
    });
  });

  describe('--output flag', () => {
    it('writes output to file and stdout is empty', async () => {
      const dir = await createNarrativeFixture('output-file');
      const outputPath = join(dir, 'narrative-output.json');

      const { exitCode, stdout } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '-o',
          outputPath,
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.equal(stdout, '', 'stdout should be empty when --output is used');

      const content = await readFile(outputPath, 'utf-8');
      const parsed = unwrapEnvelope<{ headline: string }>(content);
      assert.ok(
        parsed.headline,
        'Output file should contain valid narrative JSON',
      );
    });

    it('writes markdown output to file', async () => {
      const dir = await createNarrativeFixture('output-md');
      const outputPath = join(dir, 'narrative-output.md');

      const { exitCode } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '-f',
          'markdown',
          '-o',
          outputPath,
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      assert.ok(content.includes('<!-- shiori-narrative -->'));
    });
  });

  describe('narrative content validation', () => {
    it('detects improving health transition', async () => {
      const dir = await createNarrativeFixture('improving', {
        baseReport: makeReportJson({
          timestamp: '2026-03-01T00:00:00.000Z',
          healthScore: 40,
          healthLevel: 'critical',
          issues: 10,
        }),
        headReport: makeReportJson({
          timestamp: '2026-03-02T00:00:00.000Z',
          healthScore: 90,
          healthLevel: 'healthy',
          issues: 0,
        }),
      });

      const { exitCode, stdout } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '-f',
          'markdown',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(
        stdout.includes('improved') || stdout.includes('improving'),
        `Expected improving language in narrative, got headline section`,
      );
    });

    it('detects declining health transition', async () => {
      const dir = await createNarrativeFixture('declining', {
        baseReport: makeReportJson({
          timestamp: '2026-03-01T00:00:00.000Z',
          healthScore: 90,
          healthLevel: 'healthy',
          issues: 0,
        }),
        headReport: makeReportJson({
          timestamp: '2026-03-02T00:00:00.000Z',
          healthScore: 30,
          healthLevel: 'critical',
          issues: 10,
        }),
      });

      const { exitCode, stdout } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '-f',
          'markdown',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(
        stdout.includes('declined') || stdout.includes('declining'),
        `Expected declining language in narrative`,
      );
    });

    it('shows stable narrative for identical snapshots', async () => {
      const sameReport = makeReportJson({
        timestamp: '2026-03-01T00:00:00.000Z',
        healthScore: 80,
      });
      const sameReport2 = makeReportJson({
        timestamp: '2026-03-02T00:00:00.000Z',
        healthScore: 80,
      });
      const dir = await createNarrativeFixture('stable', {
        baseReport: sameReport,
        headReport: sameReport2,
      });

      const { exitCode, stdout } = await runCli(
        [
          'narrative',
          '--history',
          join(dir, 'reports'),
          '--cwd',
          dir,
          '-f',
          'markdown',
        ],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      assert.ok(
        stdout.includes('stable'),
        `Expected stable language in narrative`,
      );
    });

    it('stderr contains trend summary with scores', async () => {
      const dir = await createNarrativeFixture('stderr-summary');
      const { exitCode, stderr } = await runCli(
        ['narrative', '--history', join(dir, 'reports'), '--cwd', dir],
        { baseDir },
      );

      assert.equal(exitCode, 0);
      // Stderr should contain score summary like "60/100 → 90/100"
      assert.ok(
        stderr.includes('Narrative:'),
        `Expected narrative summary, got: ${stderr}`,
      );
      assert.ok(
        stderr.includes('/100'),
        `Expected score in stderr, got: ${stderr}`,
      );
    });
  });
});
