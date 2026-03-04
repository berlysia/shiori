import { define } from 'gunshi';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { computeTrend, formatTrend } from './trend.ts';
import type { ReportResult, TrendFormat } from '../core/types.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';

const validateTrendFormat = createFormatValidator<TrendFormat>([
  'json',
  'markdown',
  'csv',
] as const);

export const trendCommand = define({
  name: 'trend',
  description:
    'Compare governance scores over time from historical report JSON files',
  examples: `  # Analyze trend from a directory of report JSONs
  shiori trend --history ./reports/

  # Show only last 5 data points
  shiori trend --history ./reports/ --last 5

  # Output as Markdown
  shiori trend --history ./reports/ --format markdown

  # Output as CSV for spreadsheet import
  shiori trend --history ./reports/ --format csv -o trend.csv

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
      required: true,
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
      description: 'Output format: json, markdown, csv (default: json)',
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

    if (!ctx.values.history) {
      console.error('Error: --history is required');
      process.exitCode = 1;
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
        process.exitCode = 1;
        return;
      }
    }

    // Load report files from history directory
    const historyDir = resolve(cwd, ctx.values.history);
    let files: string[];
    try {
      const entries = await readdir(historyDir);
      files = entries.filter((f) => f.endsWith('.json'));
    } catch (err) {
      console.error(
        `Error: Cannot read history directory: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }

    if (files.length === 0) {
      console.error(`Error: No JSON files found in ${historyDir}`);
      process.exitCode = 1;
      return;
    }

    // Load and parse each file, skipping invalid ones
    const reports: ReportResult[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const filePath = join(historyDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;

        // Validate it looks like a ReportResult (has timestamp and health.score)
        if (
          typeof parsed.timestamp === 'string' &&
          parsed.health &&
          typeof (parsed.health as Record<string, unknown>).score === 'number'
        ) {
          // shiori: DEV-002 reason="runtime JSON shape validated above but static type requires assertion"
          reports.push(parsed as unknown as ReportResult);
        } else {
          skipped.push(file);
        }
      } catch {
        skipped.push(file);
      }
    }

    if (skipped.length > 0) {
      console.error(
        `Skipped ${skipped.length} non-report file(s): ${skipped.join(', ')}`,
      );
    }

    if (reports.length === 0) {
      console.error('Error: No valid ReportResult files found');
      process.exitCode = 1;
      return;
    }

    console.error(`Loaded ${reports.length} report(s) from ${historyDir}`);

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
    const dirArrow =
      summary.direction === 'improving'
        ? '↑'
        : summary.direction === 'declining'
          ? '↓'
          : '→';
    console.error(
      `Trend: ${summary.latestScore}/100 ${dirArrow} (${summary.direction}, ${summary.scoreChange >= 0 ? '+' : ''}${summary.scoreChange} over ${summary.count} points)`,
    );
  },
});
