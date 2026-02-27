import type {
  DeltaResult,
  AnnotationDelta,
  DeltaSummary,
} from '../core/types.ts';

/**
 * Format DeltaResult as Markdown suitable for GitHub PR comments.
 *
 * Sections:
 *   1. Summary table (added/removed/unchanged/net)
 *   2. Added annotations (if any)
 *   3. Removed annotations (if any)
 *   4. Unchanged count (collapsed — no per-item detail)
 *   5. Gate result footer (if maxIncrease is provided)
 */
export function formatDeltaAsMarkdown(
  result: DeltaResult,
  options?: { maxIncrease?: number },
): string {
  const lines: string[] = [];

  lines.push('# Annotation Delta Report');
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Added | ${result.summary.added} |`);
  lines.push(`| Removed | ${result.summary.removed} |`);
  lines.push(`| Unchanged | ${result.summary.unchanged} |`);
  lines.push(`| **Net** | **${formatNet(result.summary.net)}** |`);

  // Added
  const added = result.deltas.filter((d) => d.kind === 'added');
  if (added.length > 0) {
    lines.push('');
    lines.push('## Added');
    lines.push('');
    lines.push(...formatDeltaTable(added));
  }

  // Removed
  const removed = result.deltas.filter((d) => d.kind === 'removed');
  if (removed.length > 0) {
    lines.push('');
    lines.push('## Removed');
    lines.push('');
    lines.push(...formatDeltaTable(removed));
  }

  // Unchanged — collapsed summary only
  if (result.summary.unchanged > 0) {
    lines.push('');
    lines.push(
      `<details><summary>${result.summary.unchanged} unchanged annotation(s)</summary>`,
    );
    lines.push('');
    const unchanged = result.deltas.filter((d) => d.kind === 'unchanged');
    lines.push(...formatDeltaTable(unchanged));
    lines.push('');
    lines.push('</details>');
  }

  // Gate result footer
  if (options?.maxIncrease !== undefined) {
    lines.push('');
    lines.push('---');
    lines.push('');
    const passed = result.summary.net <= options.maxIncrease;
    if (passed) {
      lines.push(
        `✅ **Gate passed**: net change (${formatNet(result.summary.net)}) is within allowed threshold (${options.maxIncrease})`,
      );
    } else {
      lines.push(
        `❌ **Gate failed**: net change (${formatNet(result.summary.net)}) exceeds maximum allowed increase (${options.maxIncrease})`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Format a delta value with sign prefix */
function formatNet(net: number): string {
  return net >= 0 ? `+${net}` : `${net}`;
}

/** Render a delta table for a set of deltas */
function formatDeltaTable(deltas: AnnotationDelta[]): string[] {
  const lines: string[] = [];
  lines.push('| Ref | File | Line |');
  lines.push('|-----|------|------|');
  for (const delta of deltas) {
    const annotation = delta.head ?? delta.base;
    const file = annotation?.location.file ?? '-';
    const line = annotation?.location.line ?? '-';
    lines.push(`| ${delta.ref} | ${file} | ${line} |`);
  }
  return lines;
}
