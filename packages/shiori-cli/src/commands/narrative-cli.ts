/**
 * CLI wrapper for narrative command (EP-0146).
 *
 * Loads snapshots from a history directory, computes a governance narrative
 * comparing the first and last snapshots (or user-specified indices).
 */

import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  NARRATIVE_FORMATS,
  type NarrativeFormat,
  type NarrativeResult,
  type ReportResult,
} from '../core/types.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import { ExitCode } from '../core/exit-codes.ts';
import { loadSnapshots } from '../core/snapshot.ts';
import { isReportShape } from '../core/report-files.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { computeSnapshotDiff } from '../core/diff-snapshots.ts';
import { computeNarrative } from './narrative.ts';
import { formatNarrativeAsMarkdown } from '../formatters/narrative-markdown.ts';
import { trendArrow } from '../core/emoji.ts';

const validateNarrativeFormat =
  createFormatValidator<NarrativeFormat>(NARRATIVE_FORMATS);

function formatNarrativeOutput(
  result: NarrativeResult,
  format: NarrativeFormat,
): string {
  switch (format) {
    case 'markdown':
      return formatNarrativeAsMarkdown(result);
    case 'json':
      return wrapOutputJson(result, {
        command: 'narrative',
        schemaVersion: 1,
      });
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unknown format: ${_exhaustive}`);
    }
  }
}

export const narrativeCommand = define({
  name: 'narrative',
  description:
    'Generate a human-readable governance narrative comparing two report snapshots',
  examples: `  # Compare snapshots from a history directory (oldest vs newest)
  shiori narrative --history ./reports/

  # Compare two specific snapshot files
  shiori narrative --base report-old.json --head report-new.json

  # Output as Markdown (for PR comments)
  shiori narrative --history ./reports/ --format markdown

  # Save narrative to file
  shiori narrative --history ./reports/ -o narrative.md --format markdown`,
  rendering: { header: null },
  args: {
    history: {
      type: 'string',
      short: 'H',
      description:
        'Directory containing ReportResult JSON files. Uses oldest and newest as base/head.',
    },
    base: {
      type: 'string',
      short: 'b',
      description:
        'Path to the base (before) ReportResult JSON file. Use with --head.',
    },
    head: {
      type: 'string',
      short: 'h',
      description:
        'Path to the head (after) ReportResult JSON file. Use with --base.',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: json, markdown (default: json)',
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
    const hasHistory = ctx.values.history !== undefined;
    const hasBase = ctx.values.base !== undefined;
    const hasHead = ctx.values.head !== undefined;

    // Validate input mode: either --history or --base + --head
    if (hasHistory && (hasBase || hasHead)) {
      console.error(
        'Error: --history cannot be used together with --base/--head',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    if (!hasHistory && !hasBase && !hasHead) {
      console.error(
        'Error: Either --history <dir> or --base <file> --head <file> is required',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    if ((hasBase && !hasHead) || (!hasBase && hasHead)) {
      console.error('Error: --base and --head must be used together');
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Validate format
    const format = validateNarrativeFormat(ctx.values.format);
    if (format === null) return;

    let baseReport: ReportResult;
    let headReport: ReportResult;

    if (hasHistory) {
      // Load from history directory
      const reports = await loadSnapshots(ctx.values.history!, cwd, {
        onDirectoryError: (msg) => {
          console.error(`Error: ${msg}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        },
        onNoFiles: (dir) => {
          console.error(`Error: No JSON files found in ${dir}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        },
        onLoaded: (count, dir) => {
          console.error(`Loaded ${count} report(s) from ${dir}`);
        },
        onSkipped: (file, reason) => {
          console.error(`Warning: Skipped ${file}: ${reason}`);
        },
      });

      if (reports === null) {
        if (!process.exitCode) {
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        }
        return;
      }

      if (reports.length < 2) {
        console.error(
          'Error: At least 2 snapshots are required for narrative comparison',
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      // Sort by timestamp ascending (oldest first)
      const sorted = [...reports].sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );

      baseReport = sorted[0]!;
      headReport = sorted[sorted.length - 1]!;
    } else {
      // Load from explicit base/head files
      const basePath = resolve(cwd, ctx.values.base!);
      const headPath = resolve(cwd, ctx.values.head!);

      // Path boundary checks
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

      try {
        const baseContent = await readFile(basePath, 'utf-8');
        const baseParsed = JSON.parse(baseContent) as Record<string, unknown>;
        if (!isReportShape(baseParsed)) {
          console.error(`Error: ${basePath} is not a valid ReportResult JSON`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        // shiori: DEV-019 reason="runtime JSON shape validated by isReportShape but static type requires assertion"
        baseReport = baseParsed as unknown as ReportResult;
      } catch (err) {
        console.error(
          `Error loading base report: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }

      try {
        const headContent = await readFile(headPath, 'utf-8');
        const headParsed = JSON.parse(headContent) as Record<string, unknown>;
        if (!isReportShape(headParsed)) {
          console.error(`Error: ${headPath} is not a valid ReportResult JSON`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        // shiori: DEV-019 reason="runtime JSON shape validated by isReportShape but static type requires assertion"
        headReport = headParsed as unknown as ReportResult;
      } catch (err) {
        console.error(
          `Error loading head report: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
    }

    // Compute diff and narrative
    const diff = computeSnapshotDiff(baseReport, headReport);
    const narrative = computeNarrative(diff);

    // Format output
    const output = formatNarrativeOutput(narrative, format);

    // Write output
    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Narrative report',
    });
    if (!written) return;

    // Log summary to stderr
    const arrow = trendArrow(diff.health.direction);
    console.error(
      `Narrative: ${diff.health.baseScore}/100 ${arrow} ${diff.health.headScore}/100 (${diff.health.direction}, ${narrative.observations.length} changes)`,
    );
  },
});
