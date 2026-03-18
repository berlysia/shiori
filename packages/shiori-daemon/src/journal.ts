import { appendFileSync } from 'node:fs';
import type { JournalEntry } from './types.ts';

/**
 * Append a journal entry as a single JSONL line.
 *
 * Uses synchronous I/O — acceptable for single-line writes.
 * Errors are logged but not re-thrown so journal failures
 * never affect webhook response handling.
 */
export function appendEvent(journalPath: string, entry: JournalEntry): void {
  try {
    appendFileSync(journalPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error('[shiori-daemon] journal write failed:', err);
  }
}
