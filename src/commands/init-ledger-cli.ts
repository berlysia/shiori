import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import type { AnnotationRecord } from '../core/types.ts';
import { loadLedger, saveLedger } from '../core/ledger.ts';
import { initLedger } from './init-ledger.ts';

export const initLedgerCommand = define({
  name: 'init-ledger',
  description: 'Generate a ledger template from scan results',
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
      required: true,
      description: 'Output ledger JSON file path',
    },
    merge: {
      type: 'string',
      short: 'm',
      description:
        'Existing ledger to merge with (preserves existing entries)',
    },
  },
  run: async (ctx) => {
    const scanContent = await readFile(ctx.values.scan, 'utf-8');
    const scanData = JSON.parse(scanContent) as AnnotationRecord[];

    let existingLedger;
    if (ctx.values.merge) {
      const { ledger } = await loadLedger(ctx.values.merge);
      existingLedger = ledger;
    }

    const ledger = initLedger({ records: scanData, existingLedger });
    await saveLedger(ctx.values.output, ledger);

    const entryCount = Object.keys(ledger).length;
    console.error(
      `Generated ledger with ${entryCount} entries at ${ctx.values.output}`,
    );
  },
});
