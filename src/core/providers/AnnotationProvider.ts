import type { ShioriAnnotation } from '../types.ts';

/** Provider input: a single file to scan */
export interface FileInput {
  /** File path (relative) */
  path: string;
  /** File content (text) */
  content: string;
}

/** Pluggable interface for extracting shiori annotations */
export interface AnnotationProvider {
  /** Provider name */
  readonly name: string;
  /** Extract ShioriAnnotations from a single file */
  scan(file: FileInput): ShioriAnnotation[];
}
