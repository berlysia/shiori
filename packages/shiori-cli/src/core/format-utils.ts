/**
 * Format a group label for display (e.g., "eslint / disable-next-line" or "keywords").
 * Accepts any object with pattern and optional directive (AdoptGroupSummary, ShioriCandidate, etc.).
 */
export function formatGroupLabel(group: {
  pattern: string;
  directive?: string;
}): string {
  return group.directive
    ? `${group.pattern} / ${group.directive}`
    : group.pattern;
}
