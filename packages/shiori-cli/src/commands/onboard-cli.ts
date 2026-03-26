import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { define } from 'gunshi';
import {
  buildOnboardSteps,
  formatOnboardAsText,
  isPitchEnvelope,
  ONBOARD_FORMATS,
  type OnboardFormat,
} from './onboard.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { writeOutput } from '../core/cli-output.ts';
import { ExitCode } from '../core/exit-codes.ts';

const validateOnboardFormat = createFormatValidator<OnboardFormat>(
  ONBOARD_FORMATS,
  'text',
);

export const onboardCommand = define({
  name: 'onboard',
  description:
    'Generate onboarding steps from a pitch report (pitch → onboard pipeline)',
  examples: `  # Generate onboard steps from pitch JSON output
  shiori pitch -f json -o pitch.json && shiori onboard --from-pitch pitch.json

  # JSON output for automation
  shiori onboard --from-pitch pitch.json -f json

  # Pipe: generate and onboard in one step
  shiori pitch -f json -o /tmp/pitch.json && shiori onboard --from-pitch /tmp/pitch.json`,
  rendering: { header: null },
  args: {
    fromPitch: {
      type: 'string',
      toKebab: true,
      description: 'Path to pitch JSON output file (required)',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "text", "json". Default: "text"',
      default: 'text',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
  },
  run: async (ctx) => {
    const format = validateOnboardFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();

    // --from-pitch is required
    if (!ctx.values.fromPitch) {
      console.error(
        'Error: --from-pitch <path> is required. Run "shiori pitch -f json -o pitch.json" first.',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Read and parse pitch JSON
    const pitchPath = resolve(cwd, ctx.values.fromPitch);
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

    // Validate pitch envelope
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

    // Format output
    let output: string;
    if (format === 'json') {
      output = wrapOutputJson(steps, {
        command: 'onboard',
        schemaVersion: 1,
      });
    } else {
      output = formatOnboardAsText(steps, pitchResult.teamName);
    }

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Onboard steps',
    });
    if (!written) return;

    // Summary on stderr
    console.error(
      `Onboard: ${steps.length} step(s) generated from pitch for "${pitchResult.teamName}"`,
    );
  },
});
