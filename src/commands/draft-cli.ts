import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import type { ScanResult } from './scan.ts';
import { listDrafts } from './draft.ts';

export const draftCommand = define({
  name: 'draft',
  description: 'List draft annotations (shiori-tagged without ref)',
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      required: true,
      description: 'Path to scan result JSON file',
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

    const result = listDrafts(scanResult.annotations);
    const json = JSON.stringify(result, null, 2);

    if (ctx.values.output) {
      await writeFile(ctx.values.output, json + '\n', 'utf-8');
      console.error(`Wrote ${result.count} draft(s) to ${ctx.values.output}`);
    } else {
      console.log(json);
    }

    console.error(`Found ${result.count} draft annotation(s)`);
  },
});
