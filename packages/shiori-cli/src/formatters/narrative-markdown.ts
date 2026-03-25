/**
 * Markdown formatter for narrative results (EP-0146).
 *
 * Pure function — no I/O.
 */

import type { NarrativeResult } from '../commands/narrative.ts';
import { healthEmoji, trendEmoji } from '../core/emoji.ts';

/**
 * Format a NarrativeResult as Markdown.
 *
 * Output structure:
 * - HTML comment marker for PR comment deduplication
 * - Headline
 * - Health transition summary
 * - Observations table (sorted by significance)
 * - Metric changes table
 */
export function formatNarrativeAsMarkdown(result: NarrativeResult): string {
  const lines: string[] = [];

  // PR comment deduplication marker
  lines.push('<!-- shiori-narrative -->');
  lines.push('');

  // Title
  const dirEmoji = trendEmoji(result.diff.health.direction);
  lines.push(`# ${dirEmoji} Shiori Governance Narrative`);
  lines.push('');

  // Headline
  lines.push(`> ${result.headline}`);
  lines.push('');

  // Period
  lines.push(`**Period**: ${result.baseTimestamp} → ${result.headTimestamp}`);
  lines.push('');

  // Health transition
  const baseEmoji = healthEmoji(result.diff.health.base);
  const headEmoji = healthEmoji(result.diff.health.head);
  lines.push('## Health Transition');
  lines.push('');
  lines.push(result.healthSummary);
  lines.push('');
  lines.push(
    `${baseEmoji} ${result.diff.health.base} (${result.diff.health.baseScore}/100) → ${headEmoji} ${result.diff.health.head} (${result.diff.health.headScore}/100)`,
  );
  lines.push('');

  // Observations
  if (result.observations.length > 0) {
    lines.push('## Notable Changes');
    lines.push('');
    lines.push('| Category | Change | Significance |');
    lines.push('|----------|--------|-------------|');
    for (const obs of result.observations) {
      lines.push(`| ${obs.category} | ${obs.message} | ${obs.significance} |`);
    }
    lines.push('');
  } else {
    lines.push('## Notable Changes');
    lines.push('');
    lines.push('No significant metric changes detected.');
    lines.push('');
  }

  // Full metric changes table
  const changedCategories = result.diff.categories.filter((c) => c.delta !== 0);
  if (changedCategories.length > 0) {
    lines.push('## Metric Details');
    lines.push('');
    lines.push('| Metric | Base | Head | Delta |');
    lines.push('|--------|------|------|-------|');
    for (const cat of result.diff.categories) {
      const deltaStr =
        cat.delta === 0 ? '—' : `${cat.delta >= 0 ? '+' : ''}${cat.delta}`;
      lines.push(
        `| ${cat.category} | ${cat.base} | ${cat.head} | ${deltaStr} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
