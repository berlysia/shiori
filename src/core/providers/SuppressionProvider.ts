import type { SuppressionRecord } from '../types.ts';

/** Provider input: a single file to scan */
export interface FileInput {
  /** File path (relative) */
  path: string;
  /** File content (text) */
  content: string;
}

/** Pluggable interface for extracting suppression records */
export interface SuppressionProvider {
  /** Provider name */
  readonly name: string;
  /** Extract SuppressionRecords from a single file */
  scan(file: FileInput): SuppressionRecord[];
}
