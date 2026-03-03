import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeDelta } from './delta.ts';
import type { ScanResult } from '../core/types.ts';
import {
  formatDeltaOutput,
  type DeltaOutputFormat,
} from '../formatters/index.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';

const validateDeltaFormat = createFormatValidator<DeltaOutputFormat>([
  'json',
  'markdown',
] as const);

export const deltaCommand = define({
  name: 'delta',
  description:
    'Compare two scan results and report annotation changes (added/removed)',
  examples: `  # Compare base vs head scan results
  shiori delta --base base-scan.json --head head-scan.json

  # CI gate: fail if net annotations increased by more than 2
  shiori delta --base base-scan.json --head head-scan.json --max-increase 2

  # Output as Markdown (for GitHub PR comments)
  shiori delta --base base-scan.json --head head-scan.json --format markdown

  # Save delta report to file
  shiori delta --base base-scan.json --head head-scan.json -o delta-report.json

  # Initial PR with no prior baseline (base file may not exist)
  shiori delta --base base-scan.json --head head-scan.json --base-fallback-empty`,
  rendering: { header: null },
  args: {
    base: {
      type: 'string',
      short: 'b',
      description: 'Path to the base (before) scan result JSON file',
      required: true,
    },
    head: {
      type: 'string',
      short: 'h',
      description: 'Path to the head (after) scan result JSON file',
      required: true,
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: json, markdown (default: json)',
    },
    maxIncrease: {
      type: 'string',
      toKebab: true,
      description:
        'Maximum allowed net increase in annotations. Exit with code 1 if exceeded. Use 0 to forbid any increase.',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    baseFallbackEmpty: {
      type: 'boolean',
      toKebab: true,
      description:
        'If the base file does not exist, treat it as an empty scan result instead of failing. Useful for initial PRs with no prior baseline.',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();

    if (!ctx.values.base) {
      console.error('Error: --base is required');
      process.exitCode = 1;
      return;
    }
    if (!ctx.values.head) {
      console.error('Error: --head is required');
      process.exitCode = 1;
      return;
    }

    // Validate format
    const format = validateDeltaFormat(ctx.values.format);
    if (format === null) return;

    // Parse maxIncrease early so we can pass it to the formatter
    let maxIncrease: number | undefined;
    if (ctx.values.maxIncrease !== undefined) {
      maxIncrease = Number(ctx.values.maxIncrease);
      if (Number.isNaN(maxIncrease) || maxIncrease < 0) {
        console.error(
          `Error: --max-increase must be a non-negative integer, got "${ctx.values.maxIncrease}"`,
        );
        process.exitCode = 1;
        return;
      }
    }

    // Load base and head scan results
    const basePath = resolve(cwd, ctx.values.base);
    const headPath = resolve(cwd, ctx.values.head);

    const emptyScanResult: ScanResult = {
      annotations: [],
      candidates: [],
      filesScanned: 0,
    };

    let baseScan: ScanResult;
    let headScan: ScanResult;
    try {
      baseScan = await readScanResultFile(basePath);
    } catch (err) {
      if (
        ctx.values.baseFallbackEmpty &&
        err instanceof Error &&
        'code' in err &&
        // shiori: DEV-017 reason="Error narrowed by instanceof but 'code' property access requires NodeJS.ErrnoException cast; isNodeError() helper exists but not used here"
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        baseScan = emptyScanResult;
        console.error(
          `Base file not found: ${basePath} — using empty scan result as fallback`,
        );
      } else {
        console.error(
          `Error loading base scan result: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }
    }

    try {
      headScan = await readScanResultFile(headPath);
    } catch (err) {
      console.error(
        `Error loading head scan result: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }

    // Compute delta
    const deltaResult = computeDelta({ base: baseScan, head: headScan });

    const output = formatDeltaOutput({
      format,
      deltaResult,
      maxIncrease,
    });

    // Write output
    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Delta report',
    });
    if (!written) return;

    // Log summary to stderr
    console.error(
      `Delta: +${deltaResult.summary.added} added, -${deltaResult.summary.removed} removed, ${deltaResult.summary.unchanged} unchanged (net: ${deltaResult.summary.net >= 0 ? '+' : ''}${deltaResult.summary.net})`,
    );

    // CI gate: --max-increase
    if (maxIncrease !== undefined) {
      if (deltaResult.summary.net > maxIncrease) {
        console.error(
          `Error: Net annotation increase (${deltaResult.summary.net}) exceeds maximum allowed (${maxIncrease})`,
        );
        process.exitCode = 1;
      }
    }
  },
});

async function readScanResultFile(filePath: string): Promise<ScanResult> {
  const content = await readFile(filePath, 'utf-8');
  try {
    return JSON.parse(content) as ScanResult;
  } catch {
    throw new Error(
      `Failed to parse scan result as JSON: ${filePath}\nEnsure the file contains valid JSON from 'shiori scan'.`,
    );
  }
}
