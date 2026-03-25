import { define } from 'gunshi';
import { loadConfig } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import {
  listCandidates,
  formatCandidatesAsMarkdown,
  CANDIDATES_OUTPUT_FORMATS,
  type CandidatesOutputFormat,
} from './candidates.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';

const validateCandidatesFormat = createFormatValidator<CandidatesOutputFormat>(
  CANDIDATES_OUTPUT_FORMATS,
);

export const candidatesCommand = define({
  name: 'candidates',
  description: 'List candidate annotations from scan results',
  examples: `  # List candidates (auto-detect scan result)
  shiori candidates

  # Pipe from scan
  shiori scan | shiori candidates -f markdown

  # Explicit path
  shiori candidates -s scan-result.json -f markdown -o candidates.md`,
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      description:
        'Path to scan result JSON (default: .config/shiori/scan-result.json or stdin)',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "json" or "markdown". Default: "json"',
      default: 'json',
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
    config: {
      type: 'string',
      short: 'c',
      description:
        'Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const config = await loadConfig(cwd, ctx.values.config);

    const scanResult = await loadScanResult({
      explicitPath: ctx.values.scan,
      config,
      cwd,
    });

    const result = listCandidates(scanResult.candidates);

    const format = validateCandidatesFormat(ctx.values.format);
    if (format === null) return;

    const output =
      format === 'markdown'
        ? formatCandidatesAsMarkdown(result)
        : wrapOutputJson(result, { command: 'candidates', schemaVersion: 1 });

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: `Candidates (${result.count})`,
    });
    if (!written) return;

    console.error(`Found ${result.count} candidate(s)`);
  },
});
