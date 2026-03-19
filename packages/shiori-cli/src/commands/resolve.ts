import type {
  ShioriAnnotation,
  Registry,
  FileEditResult,
  ResolveAction,
  SkippedAnnotation,
  ResolveResult,
  BulkResolveRefEntry,
  BulkResolveResult,
} from '../core/types.ts';
import { escapeRegex } from '../core/regex-utils.ts';

// Re-export resolve types for backward compatibility
export type {
  ResolveAction,
  SkippedAnnotation,
  ResolveResult,
  BulkResolveRefEntry,
  BulkResolveResult,
} from '../core/types.ts';

// ── Types ────────────────────────────────────────────────────

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
  // Shared sub-pattern: ref with word boundary + optional key=value pairs (quoted or unquoted)
  const refAndFields = `${escapedRef}(?=\\s|$)(?:\\s+[a-z]+=(?:"[^"]*"|'[^']*'|\\S+))*`;

  // Match annotation prefix (with optional space) then the ref, then optional key=value pairs
  const shioriPattern = new RegExp(`\\s*shiori:\\s*${refAndFields}`);

  if (!shioriPattern.test(line)) {
    // ref not found in line — return as-is
    return line;
  }

  // Detect standalone annotation line comment (entire comment is just the annotation)
  const standaloneLineComment = new RegExp(
    `^(\\s*)\\/\\/\\s*shiori:\\s*${refAndFields}\\s*$`,
  );
  if (standaloneLineComment.test(line)) {
    return null; // Delete entire line
  }

  // Detect standalone block comment annotation (entire comment is just the annotation)
  const standaloneBlockComment = new RegExp(
    `^(\\s*)\\/\\*\\s*shiori:\\s*${refAndFields}\\s*\\*\\/\\s*$`,
  );
  if (standaloneBlockComment.test(line)) {
    return null; // Delete entire line
  }

  // Check if the separator `--` leads directly to the shiori annotation
  // and there's nothing else after it (Case 1: remove `--` and everything after)
  const separatorOnlyShiori = new RegExp(
    `\\s+--\\s+shiori:\\s*${refAndFields}\\s*$`,
  );
  if (separatorOnlyShiori.test(line)) {
    return line.replace(separatorOnlyShiori, '').trimEnd();
  }

  // Check for separator with shiori annotation plus trailing `*/` (block comment)
  const separatorShioriBlock = new RegExp(
    `\\s+--\\s+shiori:\\s*${refAndFields}\\s*(\\*\\/)\\s*$`,
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
    // Use regex with word boundary to avoid substring false-positives (e.g. SUP-1 matching SUP-12)
    const refPattern = new RegExp(`shiori:\\s*${escapeRegex(ref)}(?=\\s|$)`);
    if (!refPattern.test(originalLine)) {
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

// ── Bulk resolve (--closed mode) ─────────────────────────────

/**
 * Plan bulk resolve for multiple refs (pure logic, no I/O).
 *
 * Calls `planResolve()` for each ref and merges results.
 * `allActions` is the single merged list — apply it via
 * `groupResolveActionsByFile()` + `applyResolveToFile()` to avoid
 * line offset issues when multiple refs share the same file.
 */
export function planBulkResolve(
  refs: string[],
  options: Omit<ResolveOptions, 'ref'>,
): BulkResolveResult {
  const perRef: BulkResolveRefEntry[] = [];
  const allActions: ResolveAction[] = [];
  const allRegistryRemovals = new Set<string>();
  const allFilesAffected = new Set<string>();
  const allSkipped: SkippedAnnotation[] = [];

  for (const ref of refs) {
    const result = planResolve({ ...options, ref });
    perRef.push({ ref, result });
    allActions.push(...result.actions);
    for (const r of result.registryRemovals) {
      allRegistryRemovals.add(r);
    }
    for (const action of result.actions) {
      allFilesAffected.add(action.file);
    }
    allSkipped.push(...result.skipped);
  }

  return {
    perRef,
    allActions,
    allRegistryRemovals: [...allRegistryRemovals],
    totalFilesAffected: allFilesAffected.size,
    allSkipped,
  };
}

// ── formatBulkResolvePreview ─────────────────────────────────

/**
 * Format bulk resolve result as a human-readable preview (dry-run output).
 */
export function formatBulkResolvePreview(result: BulkResolveResult): string {
  const lines: string[] = [];

  if (
    result.allActions.length === 0 &&
    result.allRegistryRemovals.length === 0
  ) {
    lines.push('No closed refs with annotations or registry entries found.');
    return lines.join('\n');
  }

  lines.push(`Found ${result.perRef.length} closed ref(s) to resolve:`);
  lines.push('');

  // Per-ref summary
  for (const entry of result.perRef) {
    const { ref, result: r } = entry;
    const actionCount = r.actions.length;
    const registryCount = r.registryRemovals.length;
    if (actionCount === 0 && registryCount === 0) continue;

    const parts: string[] = [];
    if (actionCount > 0) {
      parts.push(
        `${actionCount} source change(s) in ${r.filesAffected} file(s)`,
      );
    }
    if (registryCount > 0) {
      parts.push(`${registryCount} registry removal(s)`);
    }
    lines.push(`  ${ref}: ${parts.join(', ')}`);
  }

  // Aggregated source changes detail
  if (result.allActions.length > 0) {
    lines.push('');
    lines.push(
      `Source changes (${result.totalFilesAffected} file(s), ${result.allActions.length} action(s)):`,
    );

    const byFile = groupResolveActionsByFile(result.allActions);
    for (const [file, fileActions] of byFile) {
      for (const action of fileActions) {
        if (action.type === 'remove-line') {
          lines.push(
            `  ${file}:${action.line}: [${action.ref}] remove entire line`,
          );
          lines.push(`    - ${action.originalLine.trim()}`);
        } else {
          lines.push(
            `  ${file}:${action.line}: [${action.ref}] remove shiori annotation`,
          );
          lines.push(`    - ${action.originalLine.trim()}`);
          lines.push(`    + ${action.modifiedLine?.trim() ?? ''}`);
        }
      }
    }
  }

  // Registry removals
  if (result.allRegistryRemovals.length > 0) {
    lines.push('');
    lines.push('Registry:');
    for (const removal of result.allRegistryRemovals) {
      lines.push(`  Remove entry "${removal}"`);
    }
  }

  // Skipped
  if (result.allSkipped.length > 0) {
    lines.push('');
    lines.push(
      `Skipped ${result.allSkipped.length} annotation(s) (stale scan result):`,
    );
    for (const s of result.allSkipped) {
      lines.push(`  ${s.file}:${s.line}: ${s.reason}`);
    }
    lines.push('');
    lines.push('Run "shiori scan" to refresh scan results before resolving.');
  }

  lines.push('');
  lines.push('Run with --apply to execute.');

  return lines.join('\n');
}

// ── Scan result freshness check (re-exported from core) ─────

export {
  checkScanFreshness,
  type ScanFreshnessResult,
} from '../core/scan-freshness.ts';
