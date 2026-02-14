import { define } from 'gunshi';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../core/config.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import {
  listCandidates,
  formatCandidatesAsMarkdown,
  type CandidatesOutputFormat,
} from './candidates.ts';

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
        'Path to directory containing config.json. Default: <cwd>/.config/shiori',
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

    const format = (ctx.values.format ?? 'json') as CandidatesOutputFormat;
    const output =
      format === 'markdown'
        ? formatCandidatesAsMarkdown(result)
        : JSON.stringify(result, null, 2);

    if (ctx.values.output) {
      await writeFile(ctx.values.output, output + '\n', 'utf-8');
      console.error(
        `Wrote ${result.count} candidate(s) to ${ctx.values.output}`,
      );
    } else {
      console.log(output);
    }

    console.error(`Found ${result.count} candidate(s)`);
  },
});
