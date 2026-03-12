import type { RegistryEntry, AnnotateResult } from '../core/types.ts';

/**
 * JSON output schema for annotate command.
 *
 * Designed for IDE/editor integration — contains all information needed
 * for programmatic consumers (VS Code extensions, CI pipelines) without
 * including the full file content.
 */
export interface AnnotateJsonOutput {
  /** Target file path (relative to cwd) */
  file: string;
  /** Target line number (1-based) */
  line: number;
  /** Tracking reference */
  ref: string;
  /** How the annotation was inserted */
  action: 'append' | 'insert';
  /** Whether a new line was inserted (shifts subsequent line numbers) */
  lineInserted: boolean;
  /** The annotation comment line content (inserted or modified) */
  annotationLine: string;
  /** Registry entry that was generated */
  registryEntry: RegistryEntry;
  /** Warnings (e.g. line length exceeded threshold) */
  warnings: string[];
}

/**
 * Format annotate result as structured JSON for IDE/editor integration.
 *
 * Extracts the annotation line from the modified content and omits the full
 * file content to keep output concise for programmatic consumers.
 */
export function formatAnnotateAsJson(
  options: { file: string; line: number },
  result: AnnotateResult,
): string {
  const contentLines = result.content.split('\n');

  // Both insert and append cases: the annotation line is at the target position
  const annotationLine = contentLines[options.line - 1]!;

  const output: AnnotateJsonOutput = {
    file: options.file,
    line: options.line,
    ref: result.ref,
    action: result.lineInserted ? 'insert' : 'append',
    lineInserted: result.lineInserted,
    annotationLine,
    registryEntry: result.registryEntry,
    warnings: result.warnings,
  };

  return JSON.stringify(output, null, 2);
}
