/**
 * Onboard CLI wrapper (EP-0179, EP-0187, EP-0182, EP-0186).
 *
 * Supports two modes:
 * 1. Self-contained (default): `shiori onboard` — scans, reports, and generates
 *    onboard steps internally via governance pipeline. No pitch dependency.
 * 2. Legacy: `shiori onboard --from-pitch <path>` — reads from pitch JSON output.
 *
 * Flags:
 * - --interactive: launch interactive wizard for step-by-step guidance
 * - --format: text | json | markdown | slack
 * - --from-pitch: path to pitch JSON (legacy mode)
 */

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { define } from 'gunshi';
import {
  buildOnboardSteps,
  buildOnboardStepsFromActions,
  buildOnboardSummary,
  formatOnboardAsText,
  formatOnboardSummaryAsMarkdown,
  formatOnboardSummaryAsSlack,
  formatOnboardSummaryAsText,
  isPitchEnvelope,
} from './onboard.ts';
import { wizardOnboardSession } from './onboard-interactive.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { writeOutput } from '../core/cli-output.ts';
import { ExitCode } from '../core/exit-codes.ts';
import { buildRecommendedActions } from '../core/recommended-actions.ts';
import { runGovernancePipeline } from '../core/governance-pipeline.ts';
import { ONBOARD_FORMATS, type OnboardFormat } from '../core/types.ts';

const validateOnboardFormat = createFormatValidator<OnboardFormat>(
  ONBOARD_FORMATS,
  'text',
);

export const onboardCommand = define({
  name: 'onboard',
  description:
    'Analyze project governance and generate onboarding steps (zero-dependency startup)',
  examples: `  # Self-contained mode (recommended) — scan + analyze + guide
  shiori onboard

  # Interactive wizard mode
  shiori onboard --interactive

  # JSON output for automation
  shiori onboard -f json

  # Markdown summary for sharing (GitHub)
  shiori onboard -f markdown

  # Slack Block Kit JSON for webhook integration
  shiori onboard -f slack

  # Legacy: from pitch JSON output (backward compatible)
  shiori onboard --from-pitch pitch.json`,
  rendering: { header: null },
  args: {
    fromPitch: {
      type: 'string',
      toKebab: true,
      description:
        'Path to pitch JSON output file (legacy mode). Omit for self-contained analysis.',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "text", "json", "markdown", "slack". Default: "text"',
      default: 'text',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    interactive: {
      type: 'boolean',
      short: 'I',
      description: 'Launch interactive wizard to review steps one by one',
    },
    team: {
      type: 'string',
      short: 't',
      description: 'Team or project name. Default: directory name',
    },
    patterns: {
      type: 'string',
      short: 'p',
      description:
        'Glob patterns to scan (comma-separated). Default: configured patterns',
    },
    ignore: {
      type: 'string',
      short: 'i',
      description:
        'Patterns to ignore (comma-separated). Default: configured ignores',
    },
    registry: {
      type: 'string',
      short: 'r',
      description: 'Path to registry file (auto-detected from config)',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    config: {
      type: 'string',
      short: 'c',
      description: 'Path to config directory. Default: <cwd>/.config/shiori',
    },
    expiringThreshold: {
      type: 'string',
      toKebab: true,
      description:
        'Days before expiration to trigger expiring-soon warning. Default: 14',
    },
  },
  run: async (ctx) => {
    const format = validateOnboardFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();
    const teamName = ctx.values.team ?? basename(cwd);

    // ── Legacy mode: --from-pitch ──
    if (ctx.values.fromPitch) {
      await runLegacyMode(ctx.values.fromPitch, cwd, format, ctx.values.output);
      return;
    }

    // ── Self-contained mode (EP-0187) ──
    const pipeline = await runGovernancePipeline({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
      patterns: ctx.values.patterns,
      ignore: ctx.values.ignore,
      expiringThreshold: ctx.values.expiringThreshold,
    });

    const { reportResult } = pipeline;
    const beforeScore = reportResult.health.score;

    // Build recommended actions and steps
    const actions = buildRecommendedActions(reportResult);
    const steps = buildOnboardStepsFromActions(actions);

    // ── Interactive mode ──
    if (ctx.values.interactive) {
      if (!process.stdin.isTTY) {
        console.error(
          'Error: --interactive requires a TTY. Omit --interactive for non-interactive output.',
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      const sessionResult = await wizardOnboardSession(
        steps,
        { input: process.stdin, output: process.stderr },
        { beforeScore, teamName },
      );

      // Build summary with wizard session results
      // Filter steps to only those the user chose to run
      const completedSteps = sessionResult.processed
        .filter((r) => r.choice === 'run')
        .map((r) => r.step);
      const summary = buildOnboardSummary({
        teamName,
        beforeScore,
        afterScore: beforeScore, // Score unchanged — no actual step execution yet
        steps: completedSteps,
      });

      console.error('');
      console.error(formatOnboardSummaryAsText(summary));
      console.error(
        `Wizard: ${completedSteps.length} run, ${sessionResult.processed.filter((r) => r.choice === 'skip').length} skipped, ${sessionResult.remaining} remaining`,
      );

      // Output the summary in requested format
      if (format === 'json') {
        const output = wrapOutputJson(
          {
            ...summary,
            session: {
              processed: sessionResult.processed.length,
              remaining: sessionResult.remaining,
              total: sessionResult.total,
            },
          },
          {
            command: 'onboard',
            schemaVersion: 2,
          },
        );
        const written = await writeOutput(output, {
          outputPath: ctx.values.output,
          cwd,
          label: 'Onboard summary',
        });
        if (!written) return;
      } else if (format === 'markdown') {
        const output = formatOnboardSummaryAsMarkdown(summary);
        const written = await writeOutput(output, {
          outputPath: ctx.values.output,
          cwd,
          label: 'Onboard summary',
        });
        if (!written) return;
      } else if (format === 'slack') {
        const output = formatOnboardSummaryAsSlack(summary);
        const written = await writeOutput(output, {
          outputPath: ctx.values.output,
          cwd,
          label: 'Onboard summary',
        });
        if (!written) return;
      }

      return;
    }

    // ── Non-interactive mode ──
    const summary = buildOnboardSummary({
      teamName,
      beforeScore,
      afterScore: beforeScore,
      steps,
    });

    let output: string;
    if (format === 'json') {
      output = wrapOutputJson(summary, {
        command: 'onboard',
        schemaVersion: 2,
      });
    } else if (format === 'markdown') {
      output = formatOnboardSummaryAsMarkdown(summary);
    } else if (format === 'slack') {
      output = formatOnboardSummaryAsSlack(summary);
    } else {
      output = formatOnboardAsText(steps, teamName);
    }

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Onboard steps',
    });
    if (!written) return;

    // Summary on stderr
    console.error('');
    console.error(formatOnboardSummaryAsText(summary));
  },
});

/**
 * Legacy --from-pitch mode (backward compatible).
 */
async function runLegacyMode(
  fromPitch: string,
  cwd: string,
  format: OnboardFormat,
  outputPath: string | undefined,
): Promise<void> {
  const pitchPath = resolve(cwd, fromPitch);
  let rawContent: string;
  try {
    rawContent = await readFile(pitchPath, 'utf-8');
  } catch {
    console.error(`Error: Could not read file: ${pitchPath}`);
    process.exitCode = ExitCode.ENVIRONMENT_ERROR;
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    console.error(
      `Error: Invalid JSON in ${pitchPath}. Expected pitch JSON output.`,
    );
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  if (!isPitchEnvelope(parsed)) {
    console.error(
      'Error: Not a valid pitch output. Run "shiori pitch -f json" to generate a compatible file.',
    );
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  const pitchResult = parsed.data;
  const steps = buildOnboardSteps(pitchResult);

  if (steps.length === 0) {
    console.error(
      'No recommended actions found. Run "shiori pitch -f json" with a project that has governance data.',
    );
    return;
  }

  let output: string;
  if (format === 'json') {
    output = wrapOutputJson(steps, {
      command: 'onboard',
      schemaVersion: 1,
    });
  } else if (format === 'markdown' || format === 'slack') {
    // Build summary for markdown/slack output from pitch data
    const pitchScore = pitchResult.health?.score ?? 0;
    const summary = buildOnboardSummary({
      teamName: pitchResult.teamName,
      beforeScore: pitchScore,
      afterScore: pitchScore,
      steps,
    });
    output =
      format === 'slack'
        ? formatOnboardSummaryAsSlack(summary)
        : formatOnboardSummaryAsMarkdown(summary);
  } else {
    output = formatOnboardAsText(steps, pitchResult.teamName);
  }

  const written = await writeOutput(output, {
    outputPath,
    cwd,
    label: 'Onboard steps',
  });
  if (!written) return;

  console.error(
    `Onboard: ${steps.length} step(s) generated from pitch for "${pitchResult.teamName}"`,
  );
}
