import type { AnnotationRecord } from '../types.ts';

/** Provider input: a single file to scan */
export interface FileInput {
  /** File path (relative) */
  path: string;
  /** File content (text) */
  content: string;
}

/** Pluggable interface for extracting annotation records */
export interface AnnotationProvider {
  /** Provider name */
  readonly name: string;
  /** Extract AnnotationRecords from a single file */
  scan(file: FileInput): AnnotationRecord[];
}
