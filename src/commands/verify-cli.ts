import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import type { VerifyIssueType } from '../core/types.ts';
import type { ScanResult } from './scan.ts';
import { loadRegistry } from '../core/registry.ts';
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
    registry: {
      type: 'string',
      short: 'r',
      required: true,
      description: 'Path to registry JSON file',
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
        'Issue types to fail on (comma-separated). Example: "missing-in-registry,expired"',
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
    const registryPath = ctx.values.registry;

    const scanContent = await readFile(ctx.values.scan, 'utf-8');
    const scanResult = JSON.parse(scanContent) as ScanResult;

    const { registry, errors: registryErrors } =
      await loadRegistry(registryPath);
    if (registryErrors.length > 0) {
      console.error('Registry validation errors:');
      for (const err of registryErrors) {
        console.error(`  ${err.id}: ${err.message}`);
      }
    }

    const result = verify({
      records: scanResult.annotations,
      registry,
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
