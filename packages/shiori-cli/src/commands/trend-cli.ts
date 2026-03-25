import { define } from 'gunshi';
import { computeTrend, formatTrend } from './trend.ts';
import {
  computeJournalVelocity,
  formatJournalVelocity,
} from './journal-velocity.ts';
import { readJournalEntries, resolveJournalPath } from '../core/journal.ts';
import {
  TREND_FORMATS,
  type TrendFormat,
  type VelocityBucket,
} from '../core/types.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { trendArrow } from '../core/emoji.ts';
import { ExitCode } from '../core/exit-codes.ts';
import { loadSnapshots } from '../core/snapshot.ts';

const validateTrendFormat = createFormatValidator<TrendFormat>(TREND_FORMATS);

const VALID_BUCKETS: readonly VelocityBucket[] = [
  'hour',
  'day',
  'week',
] as const;

export const trendCommand = define({
  name: 'trend',
  description:
    'Compare governance scores over time from historical report JSON files or journal',
  examples: `  # Analyze trend from a directory of report JSONs
  shiori trend --history ./reports/

  # Show only last 5 data points
  shiori trend --history ./reports/ --last 5

  # Output as Markdown
  shiori trend --history ./reports/ --format markdown

  # Output as CSV for spreadsheet import
  shiori trend --history ./reports/ --format csv -o trend.csv

  # Compact sparkline for terminal dashboards
  shiori trend --history ./reports/ --format spark

  # Velocity trend from journal (daily buckets)
  shiori trend --from-journal

  # Velocity trend with hourly granularity
  shiori trend --from-journal --bucket hour

  # Velocity trend with weekly granularity, last 4 weeks
  shiori trend --from-journal --bucket week --last 4

  # CI recipe: save report, then compare trend
  shiori report -f json -o ./reports/$(date +%Y%m%dT%H%M%S).json
  shiori trend --history ./reports/ --last 10`,
  rendering: { header: null },
  args: {
    history: {
      type: 'string',
      short: 'H',
      description:
        'Directory containing ReportResult JSON files (from "shiori report -f json -o <path>")',
    },
    fromJournal: {
      type: 'boolean',
      short: 'j',
      description:
        'Compute velocity trend from CLI operation journal instead of report history',
      toKebab: true,
    },
    bucket: {
      type: 'string',
      short: 'b',
      description:
        'Time bucket granularity for journal velocity: hour, day, week (default: day). Only used with --from-journal',
    },
    last: {
      type: 'string',
      short: 'n',
      description:
        'Show only the last N data points. If omitted, all data points are included.',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: json, markdown, csv, spark (default: json)',
      default: 'json',
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
    const fromJournal = ctx.values.fromJournal === true;
    const hasHistory = ctx.values.history !== undefined;

    // Mutual exclusion: --history and --from-journal cannot be used together
    if (fromJournal && hasHistory) {
      console.error(
        'Error: --from-journal and --history are mutually exclusive',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // At least one data source is required
    if (!fromJournal && !hasHistory) {
      console.error(
        'Error: Either --history <dir> or --from-journal is required',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Validate format
    const format = validateTrendFormat(ctx.values.format);
    if (format === null) return;

    // Parse --last
    let last: number | undefined;
    if (ctx.values.last !== undefined) {
      last = Number(ctx.values.last);
      if (Number.isNaN(last) || last < 1 || !Number.isInteger(last)) {
        console.error(
          `Error: --last must be a positive integer, got "${ctx.values.last}"`,
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
    }

    // ── Journal velocity path ──────────────────────────────────
    if (fromJournal) {
      // Validate --bucket
      let bucket: VelocityBucket = 'day';
      if (ctx.values.bucket !== undefined) {
        if (!VALID_BUCKETS.includes(ctx.values.bucket as VelocityBucket)) {
          console.error(
            `Error: Invalid --bucket value "${ctx.values.bucket}". Valid values: ${VALID_BUCKETS.join(', ')}`,
          );
          process.exitCode = ExitCode.USAGE_ERROR;
          return;
        }
        bucket = ctx.values.bucket as VelocityBucket;
      }

      // Resolve journal path
      const journalPath = resolveJournalPath(cwd);
      if (!journalPath) {
        console.error(
          'Error: Journal is disabled (SHIORI_JOURNAL_DISABLE is set)',
        );
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }

      // Read journal entries
      const entries = readJournalEntries(journalPath, {
        onReadError: (msg) => console.error(`Error: ${msg}`),
        onSkipped: (count) =>
          console.error(`Skipped ${count} malformed journal line(s)`),
      });

      if (entries.length === 0) {
        console.error('Error: No valid journal entries found');
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }

      console.error(
        `Loaded ${entries.length} journal entry/entries from ${journalPath}`,
      );

      // Compute velocity
      const result = computeJournalVelocity(entries, { bucket, last });
      const output = formatJournalVelocity(result, format);

      // Write output
      const written = await writeOutput(output, {
        outputPath: ctx.values.output,
        cwd,
        label: 'Velocity report',
      });
      if (!written) return;

      // Log summary to stderr
      const { summary } = result;
      const sign = summary.totalNetChange >= 0 ? '+' : '';
      console.error(
        `Velocity: ${summary.totalOperations} ops, ${summary.successRate}% OK, net ${sign}${summary.totalNetChange} (${summary.direction}, ${summary.count} buckets)`,
      );
      return;
    }

    // ── Report history path ─────────────────────────────────────
    // Use loadSnapshots for path boundary check and consistent shape validation
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
    });

    if (reports === null) {
      // Error already reported via callbacks; ensure exitCode is set
      if (!process.exitCode) {
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
      }
      return;
    }

    // Compute trend
    const result = computeTrend(reports, { last });
    const output = formatTrend(result, format);

    // Write output
    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Trend report',
    });
    if (!written) return;

    // Log summary to stderr
    const { summary } = result;
    const dirArrow = trendArrow(summary.direction);
    console.error(
      `Trend: ${summary.latestScore}/100 ${dirArrow} (${summary.direction}, ${summary.scoreChange >= 0 ? '+' : ''}${summary.scoreChange} over ${summary.count} points)`,
    );
  },
});
