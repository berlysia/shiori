import { define } from 'gunshi';
import { doctor, formatDoctor, type DoctorFormat } from './doctor.ts';
import { createFormatValidator } from '../core/cli-validation.ts';

const validateDoctorFormat = createFormatValidator<DoctorFormat>(
  ['text', 'json'] as const,
  'text',
);

export const doctorCommand = define({
  name: 'doctor',
  description: 'Diagnose shiori setup and report configuration issues',
  examples: `  # Run diagnostics
  shiori doctor

  # Show fix suggestions for each issue
  shiori doctor --fix

  # JSON output for tooling
  shiori doctor -f json`,
  rendering: { header: null },
  args: {
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    config: {
      type: 'string',
      short: 'c',
      description:
        'Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori',
    },
    fix: {
      type: 'boolean',
      description: 'Show fix suggestions for each issue',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "text", "json". Default: "text"',
      default: 'text',
    },
  },
  run: async (ctx) => {
    const format = validateDoctorFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();
    const showFix = ctx.values.fix ?? false;

    const result = await doctor({
      cwd,
      configDir: ctx.values.config,
      fix: showFix,
    });

    const output = formatDoctor(result, format, showFix);
    console.error(output);

    if (result.summary.fail > 0) {
      process.exitCode = 1;
    }
  },
});
