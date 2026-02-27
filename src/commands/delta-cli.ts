import { define } from 'gunshi';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { computeDelta, formatDeltaAsJson } from './delta.ts';
import type { ScanResult } from '../core/types.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';

export const deltaCommand = define({
  name: 'delta',
  description:
    'Compare two scan results and report annotation changes (added/removed)',
  examples: `  # Compare base vs head scan results
  shiori delta --base base-scan.json --head head-scan.json

  # CI gate: fail if net annotations increased by more than 2
  shiori delta --base base-scan.json --head head-scan.json --max-increase 2

  # Save delta report to file
  shiori delta --base base-scan.json --head head-scan.json -o delta-report.json`,
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

    // Load base and head scan results
    const basePath = resolve(cwd, ctx.values.base);
    const headPath = resolve(cwd, ctx.values.head);

    let baseScan: ScanResult;
    let headScan: ScanResult;
    try {
      baseScan = await readScanResultFile(basePath);
    } catch (err) {
      console.error(
        `Error loading base scan result: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
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

    const output = formatDeltaAsJson(deltaResult);

    // Write output
    if (ctx.values.output) {
      const outputPath = resolve(cwd, ctx.values.output);
      try {
        await assertWithinCwd(outputPath, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output + '\n', 'utf-8');
      console.error(`Delta report written to ${outputPath}`);
    } else {
      console.log(output);
    }

    // Log summary to stderr
    console.error(
      `Delta: +${deltaResult.summary.added} added, -${deltaResult.summary.removed} removed, ${deltaResult.summary.unchanged} unchanged (net: ${deltaResult.summary.net >= 0 ? '+' : ''}${deltaResult.summary.net})`,
    );

    // CI gate: --max-increase
    if (ctx.values.maxIncrease !== undefined) {
      const maxIncrease = Number(ctx.values.maxIncrease);
      if (Number.isNaN(maxIncrease) || maxIncrease < 0) {
        console.error(
          `Error: --max-increase must be a non-negative integer, got "${ctx.values.maxIncrease}"`,
        );
        process.exitCode = 1;
        return;
      }
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
