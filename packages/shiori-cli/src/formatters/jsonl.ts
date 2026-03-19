import type { VerifyResult } from '../core/types.ts';

/**
 * Format VerifyResult as JSONL (one JSON object per line per issue).
 * Returns empty string when there are no issues.
 */
export function formatAsJsonl(result: VerifyResult): string {
  if (result.issues.length === 0) return '';
  return result.issues.map((issue) => JSON.stringify(issue)).join('\n');
}
