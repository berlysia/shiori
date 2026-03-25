/**
 * Journal browsing — filter and format CLI operation journal entries.
 *
 * Pure functions — no I/O. The CLI wrapper handles file reading and output.
 *
 * @see EP-0082 for design rationale
 */

import type {
  CliJournalEntry,
  CliOperationType,
  JournalFormat,
} from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';

/** Options for filtering journal entries */
export interface JournalFilterOptions {
  /** Keep only the last N entries (applied after other filters) */
  last?: number;
  /** Filter by ref pattern (substring match, case-insensitive) */
  ref?: string;
  /** Filter by event type (exact match) */
  eventType?: CliOperationType;
  /** Filter entries on or after this ISO 8601 date string */
  since?: string;
}

/** Result of filtering journal entries */
export interface JournalFilterResult {
  /** Filtered entries (order preserved from input) */
  entries: CliJournalEntry[];
  /** Total entries before filtering */
  totalCount: number;
  /** Number of entries excluded by filters */
  filteredOutCount: number;
}

/**
 * Filter journal entries by the given options.
 *
 * Filter application order:
 *   1. --since (timestamp >= since)
 *   2. --event-type (exact match)
 *   3. --ref (substring match, case-insensitive, matches any ref in the entry)
 *   4. --last N (keep most recent N from filtered results)
 *
 * Entries are returned in their original order (oldest first).
 */
export function filterJournalEntries(
  entries: CliJournalEntry[],
  options: JournalFilterOptions,
): JournalFilterResult {
  const totalCount = entries.length;
  let filtered = entries;

  // 1. --since filter
  if (options.since !== undefined) {
    const sinceDate = new Date(options.since);
    filtered = filtered.filter(
      (entry) => new Date(entry.timestamp) >= sinceDate,
    );
  }

  // 2. --event-type filter
  if (options.eventType !== undefined) {
    const eventType = options.eventType;
    filtered = filtered.filter((entry) => entry.event_type === eventType);
  }

  // 3. --ref filter (substring, case-insensitive)
  if (options.ref !== undefined) {
    const refPattern = options.ref.toLowerCase();
    filtered = filtered.filter((entry) =>
      entry.refs.some((r) => r.toLowerCase().includes(refPattern)),
    );
  }

  // 4. --last N (keep most recent N)
  if (
    options.last !== undefined &&
    options.last > 0 &&
    filtered.length > options.last
  ) {
    filtered = filtered.slice(filtered.length - options.last);
  }

  return {
    entries: filtered,
    totalCount,
    filteredOutCount: totalCount - filtered.length,
  };
}

// ── Formatting ───────────────────────────────────────────────

/**
 * Format journal entries as a human-readable table.
 *
 * Columns: timestamp, event_type, refs, success, +added, -removed
 */
export function formatJournalAsTable(result: JournalFilterResult): string {
  if (result.entries.length === 0) {
    return 'No journal entries found.';
  }

  const lines: string[] = [];

  // Header
  lines.push(
    'TIMESTAMP                        EVENT TYPE       REFS                  OK   +ADDED  -REMOVED',
  );
  lines.push(
    '───────────────────────────────  ───────────────  ────────────────────  ───  ──────  ────────',
  );

  for (const entry of result.entries) {
    const ts = entry.timestamp.padEnd(31);
    const eventType = entry.event_type.padEnd(15);
    const refs = entry.refs.join(',').slice(0, 20).padEnd(20);
    const ok = (entry.success ? 'yes' : 'no').padEnd(3);
    const added = (
      entry.entries_added !== null ? String(entry.entries_added) : '-'
    ).padStart(6);
    const removed = (
      entry.entries_removed !== null ? String(entry.entries_removed) : '-'
    ).padStart(8);

    lines.push(`${ts}  ${eventType}  ${refs}  ${ok}  ${added}  ${removed}`);
  }

  // Summary line
  lines.push('');
  if (result.filteredOutCount > 0) {
    lines.push(
      `Showing ${result.entries.length} of ${result.totalCount} entries (${result.filteredOutCount} filtered out)`,
    );
  } else {
    lines.push(`${result.entries.length} entries`);
  }

  return lines.join('\n');
}

/**
 * Format journal filter result as JSON string.
 */
export function formatJournalAsJson(result: JournalFilterResult): string {
  return wrapOutputJson(
    {
      entries: result.entries,
      totalCount: result.totalCount,
      filteredOutCount: result.filteredOutCount,
    },
    {
      command: 'journal',
      schemaVersion: 1,
    },
  );
}

export { JOURNAL_FORMATS, type JournalFormat } from '../core/types.ts';

/**
 * Format journal filter result for output.
 */
export function formatJournal(
  result: JournalFilterResult,
  format: JournalFormat,
): string {
  switch (format) {
    case 'table':
      return formatJournalAsTable(result);
    case 'json':
      return formatJournalAsJson(result);
  }
}
