/**
 * CLI operation journal — append-only JSONL log for registry-modifying operations.
 *
 * Writes are synchronous (single-line append) and failure-tolerant:
 * journal errors are logged to stderr but never propagate to callers.
 *
 * @see EP-0081 for design rationale
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CliJournalEntry, CliOperationType } from './types.ts';

/** Default journal file path (relative to cwd) */
export const DEFAULT_JOURNAL_PATH = '.config/shiori/journal.jsonl';

/** Environment variable to override journal path */
export const JOURNAL_PATH_ENV = 'SHIORI_JOURNAL_PATH';

/** Environment variable to disable journal writes */
export const JOURNAL_DISABLE_ENV = 'SHIORI_JOURNAL_DISABLE';

/**
 * Resolve the journal file path.
 *
 * Priority: SHIORI_JOURNAL_PATH env > default path relative to cwd.
 * Returns `null` when SHIORI_JOURNAL_DISABLE is set (any truthy value).
 */
export function resolveJournalPath(cwd: string): string | null {
  if (process.env[JOURNAL_DISABLE_ENV]) {
    return null;
  }
  const envPath = process.env[JOURNAL_PATH_ENV];
  if (envPath) {
    return envPath;
  }
  return `${cwd}/${DEFAULT_JOURNAL_PATH}`;
}

/**
 * Append a CLI journal entry as a single JSONL line.
 *
 * Uses synchronous I/O — acceptable for single-line writes.
 * Errors are logged to stderr but never re-thrown so journal failures
 * never affect CLI command execution.
 */
export function appendJournalEntry(
  journalPath: string,
  entry: CliJournalEntry,
): void {
  try {
    mkdirSync(dirname(journalPath), { recursive: true });
    appendFileSync(journalPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error('[shiori] journal write failed:', err);
  }
}

/**
 * Build and append a CLI journal entry.
 *
 * Convenience wrapper that resolves the journal path, creates the entry,
 * and appends it. No-op when journaling is disabled.
 */
export function recordJournalEvent(options: {
  cwd: string;
  eventType: CliOperationType;
  refs: string[];
  success: boolean;
  entriesAdded?: number;
  entriesRemoved?: number;
}): void {
  const journalPath = resolveJournalPath(options.cwd);
  if (!journalPath) return;

  const entry: CliJournalEntry = {
    timestamp: new Date().toISOString(),
    source: 'cli',
    event_type: options.eventType,
    refs: options.refs,
    success: options.success,
    entries_added: options.entriesAdded ?? null,
    entries_removed: options.entriesRemoved ?? null,
  };

  appendJournalEntry(journalPath, entry);
}

/**
 * Validate that a parsed JSON value looks like a CliJournalEntry.
 * Checks structural shape without relying on TypeScript narrowing.
 */
function isJournalEntryShape(value: unknown): value is CliJournalEntry {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.timestamp === 'string' &&
    obj.source === 'cli' &&
    typeof obj.event_type === 'string' &&
    Array.isArray(obj.refs) &&
    typeof obj.success === 'boolean'
  );
}

/**
 * Read and parse journal entries from a JSONL file.
 *
 * Skips malformed lines (logs count to onSkipped callback).
 * Returns empty array if file does not exist or cannot be read.
 *
 * @param journalPath - Absolute path to journal.jsonl
 * @param callbacks - Optional callbacks for diagnostics
 * @returns Parsed journal entries (order matches file order)
 */
export function readJournalEntries(
  journalPath: string,
  callbacks?: {
    onReadError?: (message: string) => void;
    onSkipped?: (count: number) => void;
  },
): CliJournalEntry[] {
  let content: string;
  try {
    content = readFileSync(journalPath, 'utf-8');
  } catch (err) {
    callbacks?.onReadError?.(
      `Cannot read journal file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  const entries: CliJournalEntry[] = [];
  let skipped = 0;

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isJournalEntryShape(parsed)) {
        entries.push(parsed);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  if (skipped > 0) {
    callbacks?.onSkipped?.(skipped);
  }

  return entries;
}
