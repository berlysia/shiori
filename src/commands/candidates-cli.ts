import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import type { ScanResult } from './scan.ts';
import {
  listCandidates,
  formatCandidatesAsMarkdown,
  type CandidatesOutputFormat,
} from './candidates.ts';

export const candidatesCommand = define({
  name: 'candidates',
  description: 'List candidate annotations from scan results',
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      required: true,
      description: 'Path to scan result JSON file',
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
  },
  run: async (ctx) => {
    const scanContent = await readFile(ctx.values.scan, 'utf-8');
    const scanResult = JSON.parse(scanContent) as ScanResult;

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
