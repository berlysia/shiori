import type { ShioriCandidate } from '../core/types.ts';
import { formatGroupLabel } from '../core/format-utils.ts';

export {
  CANDIDATES_OUTPUT_FORMATS,
  type CandidatesOutputFormat,
} from '../core/types.ts';

export interface CandidatesResult {
  candidates: ShioriCandidate[];
  count: number;
}

/**
 * List candidates from scan results.
 */
export function listCandidates(
  candidates: ShioriCandidate[],
): CandidatesResult {
  return { candidates, count: candidates.length };
}

/**
 * Format candidates result as Markdown.
 */
export function formatCandidatesAsMarkdown(result: CandidatesResult): string {
  const lines: string[] = [];
  lines.push('# Candidate Report');
  lines.push('');

  if (result.count === 0) {
    lines.push('No candidates found.');
    return lines.join('\n');
  }

  lines.push(`Found **${result.count}** candidate(s).`);
  lines.push('');

  // Group by pattern + directive
  const byGroup = new Map<string, ShioriCandidate[]>();
  for (const c of result.candidates) {
    const key = formatGroupLabel(c);
    const group = byGroup.get(key) ?? [];
    group.push(c);
    byGroup.set(key, group);
  }

  for (const [groupKey, items] of byGroup) {
    lines.push(`## ${groupKey} (${items.length})`);
    lines.push('');
    for (const item of items) {
      const parts = [`- \`${item.location.file}:${item.location.line}\``];
      if (item.rule) parts.push(`rule: \`${item.rule}\``);
      if (item.text) parts.push(`"${item.text}"`);
      lines.push(parts.join(' — '));
    }
    lines.push('');
  }

  return lines.join('\n');
}
