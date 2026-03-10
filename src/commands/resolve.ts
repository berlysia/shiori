import type { ShioriAnnotation, Registry } from '../core/types.ts';
import type { FileEditResult } from './migrate.ts';
import { escapeRegex } from '../core/regex-utils.ts';

// ── Types ────────────────────────────────────────────────────

/** Line-level action for resolving an annotation */
export interface ResolveAction {
  /** Target ref */
  ref: string;
  /** Source file path (relative) */
  file: string;
  /** Line number in source file */
  line: number;
  /** Action type: remove annotation portion or entire line */
  type: 'remove-annotation' | 'remove-line';
  /** Original line content */
  originalLine: string;
  /** Modified line content (null = remove entire line) */
  modifiedLine: string | null;
}

/** Info about an annotation skipped due to stale scan result */
export interface SkippedAnnotation {
  /** Source file path */
  file: string;
  /** Line number from scan result */
  line: number;
  /** Why it was skipped */
  reason: string;
}

/** Result of resolve planning */
export interface ResolveResult {
  /** Source change actions */
  actions: ResolveAction[];
  /** Refs to remove from registry */
  registryRemovals: string[];
  /** Number of unique files affected */
  filesAffected: number;
  /** Annotations skipped due to stale scan data */
  skipped: SkippedAnnotation[];
}

/** Options for resolve planning */
export interface ResolveOptions {
  /** Target ref to resolve */
  ref: string;
  /** Annotations from scan result */
  annotations: ShioriAnnotation[];
  /** Current registry */
  registry: Registry;
  /** File contents map (path → content), pre-loaded by CLI layer */
  fileContents: Map<string, string>;
  /** Remove the lint disable directive itself (default: false) */
  removeDirective?: boolean;
}

// ── removeAnnotation ─────────────────────────────────────────

/**
 * Remove a shiori annotation for the given ref from a source line.
 *
 * Returns the modified line, or null if the entire line should be deleted.
 *
 * Cases:
 *  1. separator + annotation (`-- <annotation>`) → remove separator and after
 *  2. standalone line comment annotation → null (delete line)
 *  3. block comment annotation → remove annotation portion
 *  4. separator + other text + annotation → remove annotation portion only
 *  5. multiple annotations → remove only the target ref
 */
export function removeAnnotation(line: string, ref: string): string | null {
  const escapedRef = escapeRegex(ref);
  // Match annotation prefix (with optional space) then the ref, then optional key=value pairs
  const shioriPattern = new RegExp(
    `\\s*shiori:\\s*${escapedRef}(?:\\s+[a-z]+=\\S+)*`,
  );

  if (!shioriPattern.test(line)) {
    // ref not found in line — return as-is
    return line;
  }

  // Detect standalone annotation line comment (entire comment is just the annotation)
  const standaloneLineComment = new RegExp(
    `^(\\s*)\\/\\/\\s*shiori:\\s*${escapedRef}(?:\\s+[a-z]+=\\S+)*\\s*$`,
  );
  if (standaloneLineComment.test(line)) {
    return null; // Delete entire line
  }

  // Detect standalone block comment annotation (entire comment is just the annotation)
  const standaloneBlockComment = new RegExp(
    `^(\\s*)\\/\\*\\s*shiori:\\s*${escapedRef}(?:\\s+[a-z]+=\\S+)*\\s*\\*\\/\\s*$`,
  );
  if (standaloneBlockComment.test(line)) {
    return null; // Delete entire line
  }

  // Check if the separator `--` leads directly to the shiori annotation
  // and there's nothing else after it (Case 1: remove `--` and everything after)
  const separatorOnlyShiori = new RegExp(
    `\\s+--\\s+shiori:\\s*${escapedRef}(?:\\s+[a-z]+=\\S+)*\\s*$`,
  );
  if (separatorOnlyShiori.test(line)) {
    return line.replace(separatorOnlyShiori, '').trimEnd();
  }

  // Check for separator with shiori annotation plus trailing `*/` (block comment)
  const separatorShioriBlock = new RegExp(
    `\\s+--\\s+shiori:\\s*${escapedRef}(?:\\s+[a-z]+=\\S+)*\\s*(\\*\\/)\\s*$`,
  );
  const blockMatch = line.match(separatorShioriBlock);
  if (blockMatch) {
    return line.replace(separatorShioriBlock, ` ${blockMatch[1]}`).trimEnd();
  }

  // General case: remove the shiori portion inline (Cases 3, 4, 5)
  const result = line.replace(shioriPattern, '');

  // Clean up residual double spaces and trailing whitespace
  const cleaned = result.replace(/  +/g, ' ').trimEnd();

  // If after removal the line is just a comment opener with nothing, delete it
  if (/^\s*\/\/\s*$/.test(cleaned) || /^\s*\/\*\s*\*\/\s*$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

// ── planResolve ──────────────────────────────────────────────

/**
 * Plan resolve actions for a given ref (pure logic, no I/O).
 */
export function planResolve(options: ResolveOptions): ResolveResult {
  const {
    ref,
    annotations,
    registry,
    fileContents,
    removeDirective = false,
  } = options;

  const actions: ResolveAction[] = [];
  const registryRemovals: string[] = [];
  const affectedFiles = new Set<string>();
  const skipped: SkippedAnnotation[] = [];

  // Find all annotations matching the ref
  const matching = annotations.filter((a) => a.ref === ref);

  for (const annotation of matching) {
    const { file, line } = annotation.location;
    const content = fileContents.get(file);
    if (!content) continue;

    const lines = content.split('\n');
    const lineIndex = line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      skipped.push({
        file,
        line,
        reason: `line ${line} out of range (file has ${lines.length} lines)`,
      });
      continue;
    }

    const originalLine = lines[lineIndex]!;

    // Stale scan-result guard: verify the line actually contains the target annotation
    if (!originalLine.includes('shiori:') || !originalLine.includes(ref)) {
      skipped.push({
        file,
        line,
        reason:
          'line content does not match scan result (file may have changed since last scan)',
      });
      continue;
    }

    affectedFiles.add(file);

    if (removeDirective && annotation.rule) {
      // Remove the entire lint disable line
      actions.push({
        ref,
        file,
        line,
        type: 'remove-line',
        originalLine,
        modifiedLine: null,
      });
    } else {
      const modifiedLine = removeAnnotation(originalLine, ref);
      actions.push({
        ref,
        file,
        line,
        type: modifiedLine === null ? 'remove-line' : 'remove-annotation',
        originalLine,
        modifiedLine,
      });
    }
  }

  // Check registry
  if (ref in registry) {
    registryRemovals.push(ref);
  }

  return {
    actions,
    registryRemovals,
    filesAffected: affectedFiles.size,
    skipped,
  };
}

// ── applyResolveToFile ───────────────────────────────────────

/**
 * Apply resolve actions to a file's content.
 * Reuses FileEditResult from migrate.ts.
 */
export function applyResolveToFile(
  content: string,
  actions: ResolveAction[],
): FileEditResult {
  const lines = content.split('\n');
  let modifiedLines = 0;
  const warnings: string[] = [];

  // Sort by line number descending to avoid offset issues on deletion
  const sorted = [...actions].sort((a, b) => b.line - a.line);

  for (const action of sorted) {
    const lineIndex = action.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      warnings.push(
        `Line ${action.line} out of range in ${action.file} (${lines.length} lines)`,
      );
      continue;
    }

    if (action.type === 'remove-line') {
      lines.splice(lineIndex, 1);
      modifiedLines++;
    } else {
      // remove-annotation: replace with modified line
      if (action.modifiedLine !== null) {
        lines[lineIndex] = action.modifiedLine;
        modifiedLines++;
      }
    }
  }

  return {
    content: lines.join('\n'),
    modifiedLines,
    warnings,
  };
}

// ── groupResolveActionsByFile ────────────────────────────────

/**
 * Group resolve actions by file path.
 */
export function groupResolveActionsByFile(
  actions: ResolveAction[],
): Map<string, ResolveAction[]> {
  const byFile = new Map<string, ResolveAction[]>();
  for (const action of actions) {
    const existing = byFile.get(action.file);
    if (existing) {
      existing.push(action);
    } else {
      byFile.set(action.file, [action]);
    }
  }
  return byFile;
}

// ── formatResolvePreview ─────────────────────────────────────

/**
 * Format resolve result as a human-readable preview (dry-run output).
 */
export function formatResolvePreview(
  result: ResolveResult,
  ref: string,
): string {
  const lines: string[] = [];

  if (result.actions.length === 0 && result.registryRemovals.length === 0) {
    lines.push(`No annotations or registry entries found for "${ref}".`);
    return lines.join('\n');
  }

  lines.push(`Resolving ref "${ref}":`);
  lines.push('');

  if (result.actions.length > 0) {
    lines.push(`Source changes (${result.filesAffected} file(s)):`);

    const byFile = groupResolveActionsByFile(result.actions);
    for (const [file, fileActions] of byFile) {
      for (const action of fileActions) {
        if (action.type === 'remove-line') {
          lines.push(`  ${file}:${action.line}: remove entire line`);
          lines.push(`    - ${action.originalLine.trim()}`);
        } else {
          lines.push(`  ${file}:${action.line}: remove shiori annotation`);
          lines.push(`    - ${action.originalLine.trim()}`);
          lines.push(`    + ${action.modifiedLine?.trim() ?? ''}`);
        }
      }
    }
  }

  if (result.registryRemovals.length > 0) {
    lines.push('');
    lines.push('Registry:');
    for (const removal of result.registryRemovals) {
      lines.push(`  Remove entry "${removal}"`);
    }
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push(
      `Skipped ${result.skipped.length} annotation(s) (stale scan result):`,
    );
    for (const s of result.skipped) {
      lines.push(`  ${s.file}:${s.line}: ${s.reason}`);
    }
    lines.push('');
    lines.push('Run "shiori scan" to refresh scan results before resolving.');
  }

  lines.push('');
  lines.push('Run with --apply to execute.');

  return lines.join('\n');
}

// ── Scan result freshness check ─────────────────────────────

/** Result of scan-result freshness check for resolve */
export interface ScanFreshnessResult {
  /** Whether the scan result is fresh enough */
  fresh: boolean;
  /** Source files that are newer than scan result */
  staleFiles: string[];
}

/**
 * Check if scan result is fresh relative to source files.
 *
 * Compares scan-result mtime against each source file's mtime.
 * If any source file is newer than the scan result, the result is stale.
 *
 * Pure comparison logic — file stats must be provided by the caller.
 */
export function checkScanFreshness(
  scanResultMtimeMs: number,
  sourceFileMtimes: Map<string, number>,
): ScanFreshnessResult {
  const staleFiles: string[] = [];

  for (const [file, mtimeMs] of sourceFileMtimes) {
    if (mtimeMs > scanResultMtimeMs) {
      staleFiles.push(file);
    }
  }

  return {
    fresh: staleFiles.length === 0,
    staleFiles,
  };
}
