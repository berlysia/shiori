import type {
  RegistryEntry,
  AnnotateOptions,
  AnnotateResult,
} from '../core/types.ts';
import { isValidRef } from '../core/ref-validation.ts';
import { getCommentSyntax } from '../core/comment-syntax.ts';
import { insertAnnotation } from './migrate.ts';

export type { AnnotateOptions, AnnotateResult } from '../core/types.ts';

/** Error class for annotate command failures */
export class AnnotateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnotateError';
  }
}

/** Regex to detect existing shiori annotation on a line */
const SHIORI_PREFIX_RE = /\bshiori:\s*/;

/** Warning threshold for line length after annotation insertion */
const LINE_LENGTH_WARN = 120;

/**
 * Build the annotation string from ref and optional key-value fields.
 *
 * This string becomes the content after `shiori:` prefix. The `insertAnnotation()`
 * function from migrate.ts prepends `shiori: ` to this value.
 */
export function buildAnnotationString(
  ref: string,
  fields?: { expires?: string; reason?: string },
): string {
  const parts = [ref];
  if (fields?.expires) parts.push(`expires=${fields.expires}`);
  if (fields?.reason) {
    const value = fields.reason.includes(' ')
      ? `"${fields.reason}"`
      : fields.reason;
    parts.push(`reason=${value}`);
  }
  return parts.join(' ');
}

/**
 * Detect if a line contains a comment (line or block style).
 *
 * Uses getCommentSyntax() for language-aware detection, consistent
 * with CommentProvider's approach.
 */
export function lineHasComment(line: string, filePath: string): boolean {
  const trimmed = line.trimStart();
  const syntax = getCommentSyntax(filePath);
  if (syntax.line) {
    for (const prefix of syntax.line) {
      if (trimmed.startsWith(prefix)) return true;
    }
  }
  if (syntax.block) {
    for (const block of syntax.block) {
      if (trimmed.startsWith(block.open)) return true;
    }
  }
  return false;
}

/**
 * Check if a line contains an inline comment (code followed by comment).
 *
 * Detects patterns like `const x = 1; // eslint-disable-line ...`
 * by checking for lint directive patterns anywhere in the line.
 */
function lineHasInlineComment(line: string): boolean {
  return /(?:eslint-disable(?:-next)?-line|stylelint-disable(?:-next)?-line)\s/.test(
    line,
  );
}

/**
 * Plan an annotation insertion (pure function, no I/O).
 *
 * Validates inputs, computes modified file content and registry entry.
 * Does not write to files — the caller handles I/O.
 */
export function planAnnotation(options: AnnotateOptions): AnnotateResult {
  const { file, line, ref, reason, expires, kind, content, existingRegistry } =
    options;

  // Validate line range
  const lines = content.split('\n');
  if (line < 1 || line > lines.length) {
    throw new AnnotateError(
      `Line ${line} out of range (file has ${lines.length} lines)`,
    );
  }

  // Check for existing shiori annotation on target line
  const targetLine = lines[line - 1]!;
  if (SHIORI_PREFIX_RE.test(targetLine)) {
    throw new AnnotateError(`Line ${line} already has a shiori annotation`);
  }

  // Check for registry collision
  if (ref in existingRegistry) {
    throw new AnnotateError(
      `Ref "${ref}" already exists in registry. Use "shiori update" to modify.`,
    );
  }

  // Validate ref format
  if (!isValidRef(ref)) {
    throw new AnnotateError(
      `Invalid ref "${ref}". Must match pattern: start with uppercase letter, e.g. "SUP-1234", "ADR:0007"`,
    );
  }

  // Build annotation string (ref + optional key=value fields)
  const annotationString = buildAnnotationString(ref, { expires, reason });

  const warnings: string[] = [];
  let resultContent: string;
  let lineInserted: boolean;

  // Determine how to insert the annotation
  if (lineHasComment(targetLine, file) || lineHasInlineComment(targetLine)) {
    // Line has a comment — use insertAnnotation from migrate.ts
    const modifiedLine = insertAnnotation(targetLine, annotationString);
    const resultLines = [...lines];
    resultLines[line - 1] = modifiedLine;
    resultContent = resultLines.join('\n');
    lineInserted = false;

    if (modifiedLine.length > LINE_LENGTH_WARN) {
      warnings.push(
        `${file}:${line}: line length ${modifiedLine.length} exceeds ${LINE_LENGTH_WARN} chars`,
      );
    }
  } else {
    // Code-only line — insert a new comment line above
    const syntax = getCommentSyntax(file);
    const indent = targetLine.match(/^(\s*)/)?.[1] ?? '';

    let newCommentLine: string;
    const commentPrefix = syntax.line?.[0];

    if (commentPrefix) {
      newCommentLine = `${indent}${commentPrefix} shiori: ${annotationString}`;
    } else {
      // File type supports only block comments (e.g., HTML)
      const blockSyntax = syntax.block?.[0];
      if (!blockSyntax) {
        throw new AnnotateError(`Cannot determine comment syntax for ${file}`);
      }
      newCommentLine = `${indent}${blockSyntax.open} shiori: ${annotationString} ${blockSyntax.close}`;
    }

    const resultLines = [...lines];
    resultLines.splice(line - 1, 0, newCommentLine);
    resultContent = resultLines.join('\n');
    lineInserted = true;

    if (newCommentLine.length > LINE_LENGTH_WARN) {
      warnings.push(
        `${file}:${line}: line length ${newCommentLine.length} exceeds ${LINE_LENGTH_WARN} chars`,
      );
    }
  }

  // Build registry entry
  const registryEntry: RegistryEntry = {
    reason: reason ?? 'annotated by shiori annotate',
    target: file,
    expires: expires,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: kind ?? 'annotation',
  };

  return {
    content: resultContent,
    registryEntry,
    ref,
    lineInserted,
    warnings,
  };
}

/**
 * Format annotation result as a human-readable preview (dry-run display).
 */
export function formatAnnotatePreview(
  options: Pick<AnnotateOptions, 'file' | 'line'>,
  result: AnnotateResult,
): string {
  const lines: string[] = [];

  lines.push(`Target: ${options.file}:${options.line}`);
  lines.push(`Ref: ${result.ref}`);
  lines.push(
    `Action: ${result.lineInserted ? 'Insert new comment line above' : 'Append annotation to existing comment'}`,
  );
  lines.push('');

  // Show diff-like preview
  const contentLines = result.content.split('\n');
  if (result.lineInserted) {
    // New line was inserted — show the inserted line and the original
    const insertedLine = contentLines[options.line - 1]!;
    const originalLine = contentLines[options.line]!;
    lines.push(`  + ${insertedLine}`);
    lines.push(`    ${originalLine}`);
  } else {
    // Existing line was modified — show the modified line
    const modifiedLine = contentLines[options.line - 1]!;
    lines.push(`  ~ ${modifiedLine}`);
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of result.warnings) {
      lines.push(`  ${w}`);
    }
  }

  lines.push('');
  lines.push('Registry entry:');
  lines.push(`  ${result.ref}: ${JSON.stringify(result.registryEntry)}`);

  return lines.join('\n');
}
