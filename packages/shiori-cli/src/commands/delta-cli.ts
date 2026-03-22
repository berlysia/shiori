import { define } from 'gunshi';
import { resolve } from 'node:path';
import { computeDelta, filterDelta } from './delta.ts';
import type { ScanResult } from '../core/types.ts';
import {
  formatDeltaOutput,
  DELTA_OUTPUT_FORMATS,
  type DeltaOutputFormat,
} from '../formatters/index.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import { loadScanResultFromFile } from '../core/scan-result-loader.ts';
import { ScanResultNotFoundError } from '../core/errors.ts';
import { ExitCode } from '../core/exit-codes.ts';

const validateDeltaFormat =
  createFormatValidator<DeltaOutputFormat>(DELTA_OUTPUT_FORMATS);

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

  # Show only newly added annotations (for PR review)
  shiori delta --base base-scan.json --head head-scan.json --added-only --format markdown

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
    addedOnly: {
      type: 'boolean',
      toKebab: true,
      description:
        'Show only added annotations in the output. Useful for PR reviews that focus on newly introduced lint suppressions.',
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
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }
    if (!ctx.values.head) {
      console.error('Error: --head is required');
      process.exitCode = ExitCode.USAGE_ERROR;
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
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
    }

    // Load base and head scan results
    const basePath = resolve(cwd, ctx.values.base);
    const headPath = resolve(cwd, ctx.values.head);

    // Path boundary checks: refuse to read files outside cwd
    try {
      await assertWithinCwd(basePath, cwd);
      await assertWithinCwd(headPath, cwd);
    } catch (err) {
      if (err instanceof PathBoundaryError) {
        console.error(`Error: ${err.message}`);
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
      throw err;
    }

    const emptyScanResult: ScanResult = {
      annotations: [],
      candidates: [],
      filesScanned: 0,
    };

    let baseScan: ScanResult;
    let headScan: ScanResult;
    try {
      baseScan = await loadScanResultFromFile(basePath);
    } catch (err) {
      if (
        ctx.values.baseFallbackEmpty &&
        err instanceof ScanResultNotFoundError
      ) {
        baseScan = emptyScanResult;
        console.error(
          `Base file not found: ${basePath} — using empty scan result as fallback`,
        );
      } else {
        console.error(
          `Error loading base scan result: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
    }

    try {
      headScan = await loadScanResultFromFile(headPath);
    } catch (err) {
      console.error(
        `Error loading head scan result: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = ExitCode.ENVIRONMENT_ERROR;
      return;
    }

    // Compute delta (full result used for CI gate judgment)
    const fullDeltaResult = computeDelta({ base: baseScan, head: headScan });

    // Apply kind filter for display output only
    const displayDeltaResult = ctx.values.addedOnly
      ? filterDelta(fullDeltaResult, ['added'])
      : fullDeltaResult;

    const output = formatDeltaOutput({
      format,
      deltaResult: displayDeltaResult,
      maxIncrease,
    });

    // Write output
    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Delta report',
    });
    if (!written) return;

    // Log summary to stderr (always uses full result for accurate counts)
    console.error(
      `Delta: +${fullDeltaResult.summary.added} added, -${fullDeltaResult.summary.removed} removed, ${fullDeltaResult.summary.unchanged} unchanged (net: ${fullDeltaResult.summary.net >= 0 ? '+' : ''}${fullDeltaResult.summary.net})`,
    );

    // CI gate: --max-increase (uses full result, not filtered)
    if (maxIncrease !== undefined) {
      if (fullDeltaResult.summary.net > maxIncrease) {
        console.error(
          `Error: Net annotation increase (${fullDeltaResult.summary.net}) exceeds maximum allowed (${maxIncrease})`,
        );
        process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
      }
    }
  },
});
