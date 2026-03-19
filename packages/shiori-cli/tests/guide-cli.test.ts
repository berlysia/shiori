/**
 * CLI integration tests for `shiori guide`.
 *
 * Covers: --json output, --list output, --use-case lookup (valid/invalid),
 * pipe mode fallback, --wizard mode, and USE_CASES × registered commands sync.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers/cli-test-utils.ts';
import {
  USE_CASES,
  groupUseCases,
  type GroupedUseCases,
  type UseCaseCategory,
  type GuideContext,
} from '../src/commands/guide.ts';

// ── --json mode ────────────────────────────────────────────────

describe('guide-cli: --json mode', () => {
  it('exits 0 and outputs valid JSON to stdout', async () => {
    const { exitCode, stdout } = await runCli(['guide', '--json']);

    assert.equal(exitCode, 0);
    // Must parse without throwing
    const parsed = JSON.parse(stdout) as GroupedUseCases;
    assert.ok(Array.isArray(parsed), 'top-level should be an array');
  });

  it('JSON contains all 5 categories', async () => {
    const { stdout } = await runCli(['guide', '--json']);
    const parsed = JSON.parse(stdout) as GroupedUseCases;

    const categories = parsed.map((g) => g.category);
    const expected: UseCaseCategory[] = [
      'setup',
      'daily',
      'review',
      'governance',
      'diagnostics',
    ];
    assert.deepEqual(categories, expected);
  });

  it('each group has category, categoryLabel, and useCases array', async () => {
    const { stdout } = await runCli(['guide', '--json']);
    const parsed = JSON.parse(stdout) as GroupedUseCases;

    for (const group of parsed) {
      assert.ok(typeof group.category === 'string', 'category is string');
      assert.ok(
        typeof group.categoryLabel === 'string',
        'categoryLabel is string',
      );
      assert.ok(Array.isArray(group.useCases), 'useCases is array');

      for (const uc of group.useCases) {
        assert.ok(typeof uc.id === 'string', 'use case id is string');
        assert.ok(typeof uc.label === 'string', 'use case label is string');
        assert.ok(Array.isArray(uc.commands), 'commands is array');
        assert.ok(uc.commands.length > 0, 'commands is non-empty');
        assert.ok(typeof uc.explanation === 'string', 'explanation is string');
      }
    }
  });

  it('JSON total use-case count matches USE_CASES length', async () => {
    const { stdout } = await runCli(['guide', '--json']);
    const parsed = JSON.parse(stdout) as GroupedUseCases;

    const totalCount = parsed.reduce(
      (sum, group) => sum + group.useCases.length,
      0,
    );
    assert.equal(totalCount, USE_CASES.length);
  });
});

// ── --list mode ────────────────────────────────────────────────

describe('guide-cli: --list mode', () => {
  it('exits 0 and outputs text to stderr', async () => {
    const { exitCode, stderr, stdout } = await runCli(['guide', '--list']);

    assert.equal(exitCode, 0);
    // --list outputs to stderr
    assert.ok(stderr.includes('shiori guide'), 'stderr contains header');
    // stdout should be empty for --list
    assert.equal(stdout, '');
  });

  it('lists all category labels', async () => {
    const { stderr } = await runCli(['guide', '--list']);

    assert.ok(stderr.includes('Setup & Onboarding'));
    assert.ok(stderr.includes('Daily Workflow'));
    assert.ok(stderr.includes('Code Review & CI'));
    assert.ok(stderr.includes('Governance & Reporting'));
    assert.ok(stderr.includes('Diagnostics & Troubleshooting'));
  });
});

// ── --use-case (valid ID) ──────────────────────────────────────

describe('guide-cli: --use-case (valid)', () => {
  it('exits 0 and shows use-case details on stderr', async () => {
    const { exitCode, stderr, stdout } = await runCli([
      'guide',
      '--use-case',
      'quick-check',
    ]);

    assert.equal(exitCode, 0);
    // Output goes to stderr for --use-case
    assert.ok(
      stderr.includes('Verify all annotations are valid'),
      'includes label',
    );
    assert.ok(stderr.includes('shiori check'), 'includes command');
    assert.equal(stdout, '');
  });

  it('shows options when the use case has them', async () => {
    const { stderr } = await runCli(['guide', '--use-case', 'quick-check']);

    assert.ok(stderr.includes('Options:'), 'includes Options section');
    assert.ok(stderr.includes('--fail-on'), 'includes an option');
  });

  it('shows recipes when the use case has them', async () => {
    const { stderr } = await runCli(['guide', '--use-case', 'first-setup']);

    assert.ok(stderr.includes('Recipes:'), 'includes Recipes section');
    assert.ok(stderr.includes('docs/recipes/'), 'includes recipe path prefix');
  });
});

// ── --use-case (invalid ID) ────────────────────────────────────

describe('guide-cli: --use-case (invalid)', () => {
  it('exits 1 with error message for unknown use-case ID', async () => {
    const { exitCode, stderr, stdout } = await runCli([
      'guide',
      '--use-case',
      'nonexistent-use-case',
    ]);

    assert.equal(exitCode, 1);
    assert.ok(
      stderr.includes('Unknown use-case'),
      'error message mentions unknown',
    );
    assert.ok(
      stderr.includes('nonexistent-use-case'),
      'error message includes the invalid ID',
    );
    assert.equal(stdout, '');
  });

  it('lists available use-case IDs in error output', async () => {
    const { stderr } = await runCli(['guide', '--use-case', 'does-not-exist']);

    // Should list available IDs so the user knows what's valid
    assert.ok(
      stderr.includes('Available use-case IDs'),
      'error output includes ID listing header',
    );
    // Spot-check a few known IDs
    assert.ok(stderr.includes('quick-check'), 'lists quick-check');
    assert.ok(stderr.includes('first-setup'), 'lists first-setup');
    assert.ok(stderr.includes('pr-delta'), 'lists pr-delta');
  });
});

// ── pipe mode (non-TTY, no flags) ──────────────────────────────

describe('guide-cli: pipe mode (non-TTY fallback)', () => {
  it('outputs JSON to stdout when no flags and non-TTY', async () => {
    // runCli uses stdio: ['ignore', ...] so stdin is not a TTY
    const { exitCode, stdout } = await runCli(['guide']);

    assert.equal(exitCode, 0);
    // Should fall back to JSON output on stdout
    const parsed = JSON.parse(stdout) as GroupedUseCases;
    assert.ok(Array.isArray(parsed), 'pipe mode outputs valid JSON array');
  });
});

// ── USE_CASES × registered commands sync ───────────────────────

describe('guide: USE_CASES sync validation', () => {
  /**
   * Every command referenced in USE_CASES must correspond to a
   * registered shiori subcommand. We extract the command name from
   * entries like "shiori check", "shiori init --ci basic", etc.
   */
  it('all USE_CASES commands reference existing shiori subcommands', async () => {
    // Get the list of registered commands from --help output
    const { exitCode, stdout, stderr } = await runCli(['--help']);
    // gunshi outputs help to stdout or stderr — check both
    const helpText = stdout + stderr;

    assert.equal(exitCode, 0, '--help should exit 0');

    // Extract unique subcommand names from USE_CASES
    const referencedCommands = new Set<string>();
    for (const uc of USE_CASES) {
      for (const cmd of uc.commands) {
        // Pattern: "shiori <subcommand> [options...]"
        const match = cmd.match(/^shiori\s+(\S+)/);
        if (match?.[1]) {
          referencedCommands.add(match[1]);
        }
      }
    }

    assert.ok(
      referencedCommands.size > 0,
      'should extract at least one command',
    );

    // Verify each referenced command appears in help output
    const missingCommands: string[] = [];
    for (const cmd of referencedCommands) {
      if (!helpText.includes(cmd)) {
        missingCommands.push(cmd);
      }
    }

    assert.equal(
      missingCommands.length,
      0,
      `USE_CASES reference commands not found in --help: ${missingCommands.join(', ')}`,
    );
  });

  it('every use-case ID is unique', () => {
    const ids = USE_CASES.map((uc) => uc.id);
    const uniqueIds = new Set(ids);
    assert.equal(
      ids.length,
      uniqueIds.size,
      `duplicate use-case IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`,
    );
  });

  it('every use-case has a non-empty commands array', () => {
    for (const uc of USE_CASES) {
      assert.ok(
        uc.commands.length > 0,
        `use-case "${uc.id}" has empty commands`,
      );
    }
  });

  it('every use-case category is a valid UseCaseCategory', () => {
    const validCategories: UseCaseCategory[] = [
      'setup',
      'daily',
      'review',
      'governance',
      'diagnostics',
    ];
    for (const uc of USE_CASES) {
      assert.ok(
        validCategories.includes(uc.category),
        `use-case "${uc.id}" has invalid category "${uc.category}"`,
      );
    }
  });

  it('groupUseCases() covers all USE_CASES entries', () => {
    const grouped = groupUseCases();
    const groupedCount = grouped.reduce((sum, g) => sum + g.useCases.length, 0);
    assert.equal(
      groupedCount,
      USE_CASES.length,
      'grouped total should match USE_CASES length',
    );
  });
});

// ── --wizard mode (EP-0100) ───────────────────────────────────

describe('guide-cli: --wizard mode', () => {
  it('exits 0 and outputs recommendations to stderr (no config)', async () => {
    // Default cwd is packages/shiori-cli (no shiori config)
    // wizard should still work — maturity=0, no health data
    const { exitCode, stderr } = await runCli(['guide', '--wizard']);

    assert.equal(exitCode, 0);
    assert.ok(
      stderr.includes('Analyzing project context'),
      'shows progress message',
    );
    assert.ok(
      stderr.includes('shiori guide --wizard'),
      'includes wizard header',
    );
    assert.ok(stderr.includes('1.'), 'shows numbered recommendation');
    assert.ok(stderr.includes('score:'), 'shows score in output');
  });

  it('--wizard --json outputs valid JSON structure', async () => {
    // Use default cwd (unconfigured) for fast, deterministic test
    const { exitCode, stdout } = await runCli(['guide', '--wizard', '--json']);

    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout) as {
      context: GuideContext;
      recommendations: Array<{
        id: string;
        label: string;
        category: string;
        commands: string[];
        explanation: string;
        score: number;
      }>;
    };

    assert.ok(parsed.context, 'has context object');
    assert.ok(
      Array.isArray(parsed.recommendations),
      'has recommendations array',
    );
    assert.equal(parsed.recommendations.length, 3, 'returns 3 recommendations');

    for (const rec of parsed.recommendations) {
      assert.ok(typeof rec.id === 'string', 'recommendation has id');
      assert.ok(typeof rec.score === 'number', 'recommendation has score');
      assert.ok(Array.isArray(rec.commands), 'recommendation has commands');
    }
  });

  it('--wizard --json gracefully handles unconfigured project', async () => {
    // Default cwd (packages/shiori-cli) has no shiori config
    const { exitCode, stdout } = await runCli(['guide', '--wizard', '--json']);

    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout) as { context: GuideContext };

    // Maturity should be 0 for unconfigured project
    assert.equal(parsed.context.maturity, 0, 'maturity should be 0');
    // healthScore should be absent (no config to run report)
    assert.equal(
      parsed.context.healthScore,
      undefined,
      'healthScore should be absent',
    );
  });
});
