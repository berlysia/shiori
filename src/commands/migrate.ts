import type {
  ShioriCandidate,
  Registry,
  RegistryEntry,
} from '../core/types.ts';
import { escapeRegex } from '../core/regex-utils.ts';

/** Options for migrate planning */
export interface MigrateOptions {
  /** Candidates to migrate (from scan result) */
  candidates: ShioriCandidate[];
  /** Existing registry to check for ref collisions */
  existingRegistry: Registry;
  /** Ref prefix (default: "MIG") */
  prefix: string;
}

/** A planned migration action for one source line (may cover multiple candidates) */
export interface MigrateAction {
  /** Generated ref for this line */
  ref: string;
  /** Source file path (relative) */
  file: string;
  /** Line number in source file */
  line: number;
  /** The representative candidate (first of the group) */
  candidate: ShioriCandidate;
  /** All rule names on this line (empty if no rules). Populated when multiple candidates share the same line. */
  rules: string[];
}

/** Result of migration planning */
export interface MigrateResult {
  /** Planned migration actions */
  actions: MigrateAction[];
  /** Generated registry entries (keyed by ref) */
  registry: Registry;
}

/** Result of applying migrations to file content */
export interface FileEditResult {
  /** Updated file content */
  content: string;
  /** Number of lines modified */
  modifiedLines: number;
  /** Warnings (e.g. line too long) */
  warnings: string[];
}

/**
 * Find the next available number for a given prefix in the registry.
 * Scans existing keys matching `PREFIX-NNN` and returns max+1.
 */
function findNextNumber(prefix: string, existingRegistry: Registry): number {
  const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);
  let max = 0;
  for (const key of Object.keys(existingRegistry)) {
    const m = key.match(pattern);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Format a ref number with zero-padding based on total count.
 * - < 100 candidates: 3 digits (001)
 * - < 1000: 3 digits (001)
 * - >= 1000: 4 digits (0001)
 */
function formatRefNumber(num: number, totalCount: number): string {
  const width = totalCount >= 1000 ? 4 : 3;
  return String(num).padStart(width, '0');
}

/**
 * Group candidates by file:line so that multiple rules on the same line
 * share a single ref and annotation insertion.
 */
function groupCandidatesByLine(
  candidates: ShioriCandidate[],
): ShioriCandidate[][] {
  const groups: ShioriCandidate[][] = [];
  const keyToIndex = new Map<string, number>();

  for (const candidate of candidates) {
    const key = `${candidate.location.file}:${candidate.location.line}`;
    const idx = keyToIndex.get(key);
    if (idx !== undefined) {
      groups[idx]!.push(candidate);
    } else {
      keyToIndex.set(key, groups.length);
      groups.push([candidate]);
    }
  }
  return groups;
}

/**
 * Plan migration actions for candidates.
 *
 * Generates sequential refs and registry entries for each candidate group.
 * Candidates sharing the same file:line are merged into a single action
 * to avoid inserting multiple annotations on one line.
 * Does not modify files — returns a plan that can be previewed or applied.
 */
export function planMigration(options: MigrateOptions): MigrateResult {
  const { candidates, existingRegistry, prefix } = options;

  const groups = groupCandidatesByLine(candidates);
  const actions: MigrateAction[] = [];
  const registry: Registry = {};
  let nextNum = findNextNumber(prefix, existingRegistry);

  for (const group of groups) {
    const first = group[0]!;
    const ref = `${prefix}-${formatRefNumber(nextNum, groups.length)}`;
    nextNum++;

    const rules = group
      .map((c) => c.rule)
      .filter((r): r is string => r !== undefined);

    actions.push({
      ref,
      file: first.location.file,
      line: first.location.line,
      candidate: first,
      rules,
    });

    const entry: RegistryEntry = {
      reason: 'auto-migrated',
      target: first.location.file,
      expires: undefined,
      ticket: undefined,
      owner: undefined,
      notes: undefined,
      kind: 'migration',
    };
    if (rules.length > 0) {
      entry.notes =
        rules.length === 1 ? `rule: ${rules[0]}` : `rules: ${rules.join(', ')}`;
    }
    registry[ref] = entry;
  }

  return { actions, registry };
}

/**
 * Insert shiori annotation into a source line.
 *
 * Handles both line comments (`//`) and block comments (`/* ... * /`).
 * For lint disable comments with `--` separator convention (eslint, stylelint),
 * inserts ` -- shiori: REF` or appends ` shiori: REF` after existing `--`.
 *
 * Block comment aware: inserts before the closing `* /` delimiter.
 */
export function insertAnnotation(line: string, ref: string): string {
  const annotation = `shiori: ${ref}`;

  // Detect block comment closing delimiter (`*/`)
  const blockCloseMatch = line.match(/\s*\*\/\s*$/);
  const isBlockComment = blockCloseMatch !== null;

  // Work with the "inner" content (strip trailing `*/` if present)
  const innerEnd = isBlockComment
    ? line.length - blockCloseMatch![0].length
    : line.length;
  const inner = line.slice(0, innerEnd).trimEnd();
  const suffix = isBlockComment ? ' */' : '';

  // Check for lint directive (eslint/stylelint disable patterns)
  const lintDirective =
    /(?:eslint-disable(?:-next)?-line|stylelint-disable(?:-next)?-line)\s/.test(
      inner,
    );

  // Check if inner content already has `--` separator
  const hasSeparator = inner.indexOf(' -- ') >= 0;

  if (hasSeparator) {
    // Already has separator — append shiori: after existing meta content
    return `${inner} ${annotation}${suffix}`;
  }

  if (lintDirective) {
    // Lint directive without separator — add `--` separator
    return `${inner} -- ${annotation}${suffix}`;
  }

  // For @ts-ignore, @ts-expect-error, or other comments: append inline
  return `${inner} ${annotation}${suffix}`;
}

/** Warning threshold for line length after annotation insertion */
const LINE_LENGTH_WARN = 120;

/**
 * Apply migration actions to a file's content.
 *
 * Returns the modified content with shiori annotations inserted.
 * Groups actions by file, so this should be called once per file.
 */
export function applyMigrateToFile(
  content: string,
  actions: MigrateAction[],
): FileEditResult {
  const lines = content.split('\n');
  let modifiedLines = 0;
  const warnings: string[] = [];

  // Sort actions by line number (descending) to avoid offset issues
  const sorted = [...actions].sort((a, b) => b.line - a.line);

  for (const action of sorted) {
    const lineIndex = action.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      warnings.push(
        `Line ${action.line} out of range in ${action.file} (${lines.length} lines)`,
      );
      continue;
    }

    const original = lines[lineIndex]!;
    const modified = insertAnnotation(original, action.ref);
    lines[lineIndex] = modified;
    modifiedLines++;

    if (modified.length > LINE_LENGTH_WARN) {
      warnings.push(
        `${action.file}:${action.line}: line length ${modified.length} exceeds ${LINE_LENGTH_WARN} chars`,
      );
    }
  }

  return {
    content: lines.join('\n'),
    modifiedLines,
    warnings,
  };
}

/**
 * Group migration actions by file path.
 */
export function groupActionsByFile(
  actions: MigrateAction[],
): Map<string, MigrateAction[]> {
  const byFile = new Map<string, MigrateAction[]>();
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

/**
 * Format migration result as a human-readable preview.
 */
export function formatMigratePreview(result: MigrateResult): string {
  const lines: string[] = [];

  if (result.actions.length === 0) {
    lines.push('No candidates to migrate.');
    return lines.join('\n');
  }

  lines.push(`Found ${result.actions.length} candidate(s) to migrate.`);
  lines.push('');

  const byFile = groupActionsByFile(result.actions);
  for (const [file, actions] of byFile) {
    lines.push(`${file} (${actions.length}):`);
    for (const action of actions) {
      const rule =
        action.rules.length > 0 ? ` [${action.rules.join(', ')}]` : '';
      lines.push(`  L${action.line}: ${action.ref}${rule}`);
    }
  }

  return lines.join('\n');
}
