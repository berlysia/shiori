import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import type { AnnotationRecord, VerifyIssueType } from '../core/types.ts';
import { loadLedger } from '../core/ledger.ts';
import {
  verify,
  formatVerifyResultAsMarkdown,
  type OutputFormat,
} from './verify.ts';

function parseIssueTypes(value: string | undefined): VerifyIssueType[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()) as VerifyIssueType[];
}

export const verifyCommand = define({
  name: 'verify',
  description: 'Verify annotations against the registry',
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      short: 's',
      required: true,
      description: 'Path to scan result JSON file',
    },
    ledger: {
      type: 'string',
      short: 'l',
      required: true,
      description: 'Path to ledger JSON file',
    },
    registry: {
      type: 'string',
      short: 'r',
      description: 'Alias for --ledger',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "json" or "markdown". Default: "json"',
      default: 'json',
    },
    failOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to fail on (comma-separated). Example: "missing-in-ledger,expired"',
    },
    warnOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to warn on (comma-separated). Example: "unused-in-source"',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
  },
  run: async (ctx) => {
    const scanContent = await readFile(ctx.values.scan, 'utf-8');
    const scanData = JSON.parse(scanContent) as AnnotationRecord[];

    const ledgerPath = ctx.values.ledger ?? ctx.values.registry;
    if (!ledgerPath) {
      console.error('Error: --ledger or --registry is required');
      process.exitCode = 1;
      return;
    }

    const { ledger, errors: ledgerErrors } = await loadLedger(ledgerPath);
    if (ledgerErrors.length > 0) {
      console.error('Ledger validation errors:');
      for (const err of ledgerErrors) {
        console.error(`  ${err.id}: ${err.message}`);
      }
    }

    const result = verify({
      records: scanData,
      ledger,
      failOn: parseIssueTypes(ctx.values.failOn),
      warnOn: parseIssueTypes(ctx.values.warnOn),
    });

    const format = (ctx.values.format ?? 'json') as OutputFormat;
    const output =
      format === 'markdown'
        ? formatVerifyResultAsMarkdown(result)
        : JSON.stringify(result, null, 2);

    if (ctx.values.output) {
      await writeFile(ctx.values.output, output + '\n', 'utf-8');
      console.error(`Report written to ${ctx.values.output}`);
    } else {
      console.log(output);
    }

    if (result.summary.errors > 0) {
      process.exitCode = 1;
    }
  },
});
