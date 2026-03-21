import { define } from 'gunshi';
import { readJournalEntries, resolveJournalPath } from '../core/journal.ts';
import type { CliOperationType } from '../core/types.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import {
  filterJournalEntries,
  formatJournal,
  type JournalFormat,
} from './journal.ts';

const VALID_EVENT_TYPES: readonly CliOperationType[] = [
  'cli.resolve',
  'cli.resolve.bulk',
  'cli.adopt',
  'cli.update',
  'cli.annotate',
  'cli.migrate',
] as const;

const validateJournalFormat = createFormatValidator<JournalFormat>([
  'json',
  'table',
] as const);

export const journalCommand = define({
  name: 'journal',
  description: 'Browse and filter CLI operation journal entries',
  examples: `  # Show all journal entries as JSON (default)
  shiori journal

  # Show last 10 entries in table format
  shiori journal --last 10 --format table

  # Filter by ref pattern
  shiori journal --ref SUP-1234

  # Filter by event type
  shiori journal --event-type cli.resolve

  # Filter entries since a date
  shiori journal --since 2026-03-01

  # Combine filters
  shiori journal --ref SUP --event-type cli.adopt --last 5 --format table

  # Save filtered result to file
  shiori journal --ref SUP --format json -o journal-sup.json`,
  rendering: { header: null },
  args: {
    last: {
      type: 'string',
      short: 'n',
      description: 'Show only the last N entries (applied after other filters)',
    },
    ref: {
      type: 'string',
      short: 'r',
      description: 'Filter by ref pattern (substring match, case-insensitive)',
    },
    eventType: {
      type: 'string',
      short: 'e',
      description: `Filter by event type. Valid values: ${VALID_EVENT_TYPES.join(', ')}`,
      toKebab: true,
    },
    since: {
      type: 'string',
      short: 's',
      description:
        'Filter entries on or after this date (ISO 8601, e.g. 2026-03-01)',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: json (default), table',
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

    // Validate format
    const format = validateJournalFormat(ctx.values.format);
    if (format === null) return;

    // Parse --last
    let last: number | undefined;
    if (ctx.values.last !== undefined) {
      last = Number(ctx.values.last);
      if (Number.isNaN(last) || last < 1 || !Number.isInteger(last)) {
        console.error(
          `Error: --last must be a positive integer, got "${ctx.values.last}"`,
        );
        return;
      }
    }

    // Validate --event-type
    let eventType: CliOperationType | undefined;
    if (ctx.values.eventType !== undefined) {
      if (
        !VALID_EVENT_TYPES.includes(ctx.values.eventType as CliOperationType)
      ) {
        console.error(
          `Error: Invalid --event-type value "${ctx.values.eventType}". Valid values: ${VALID_EVENT_TYPES.join(', ')}`,
        );
        return;
      }
      eventType = ctx.values.eventType as CliOperationType;
    }

    // Validate --since
    if (ctx.values.since !== undefined) {
      const sinceDate = new Date(ctx.values.since);
      if (Number.isNaN(sinceDate.getTime())) {
        console.error(
          `Error: Invalid --since value "${ctx.values.since}". Expected ISO 8601 date string (e.g. 2026-03-01)`,
        );
        return;
      }
    }

    // Resolve journal path
    const journalPath = resolveJournalPath(cwd);
    if (!journalPath) {
      console.error(
        'Error: Journal is disabled (SHIORI_JOURNAL_DISABLE is set)',
      );
      return;
    }

    // Read journal entries
    const entries = readJournalEntries(journalPath, {
      onReadError: (msg) => console.error(`Error: ${msg}`),
      onSkipped: (count) =>
        console.error(`Skipped ${count} malformed journal line(s)`),
    });

    // Filter entries
    const result = filterJournalEntries(entries, {
      last,
      ref: ctx.values.ref,
      eventType,
      since: ctx.values.since,
    });

    // Format output
    const output = formatJournal(result, format);

    // Write output
    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Journal',
    });
    if (!written) return;

    // Log summary to stderr
    if (result.filteredOutCount > 0) {
      console.error(
        `${result.entries.length} of ${result.totalCount} entries (${result.filteredOutCount} filtered out)`,
      );
    } else {
      console.error(`${result.entries.length} entries`);
    }
  },
});
