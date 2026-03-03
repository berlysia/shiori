import { define } from 'gunshi';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { computeDelta } from './delta.ts';
import type { ScanResult } from '../core/types.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import {
  formatDeltaOutput,
  type DeltaOutputFormat,
} from '../formatters/index.ts';

const DELTA_FORMATS: readonly DeltaOutputFormat[] = ['json', 'markdown'];

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
      description: `Output format: ${DELTA_FORMATS.join(', ')} (default: json)`,
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
    // shiori: DEV-004 reason="validated by DELTA_FORMATS.includes() but type not narrowed by control flow"
    const format = (ctx.values.format ?? 'json') as DeltaOutputFormat;
    if (!DELTA_FORMATS.includes(format)) {
      console.error(
        `Error: unsupported format "${ctx.values.format}". Supported: ${DELTA_FORMATS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }

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
