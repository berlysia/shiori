import type { ShioriAnnotation } from '../core/types.ts';

export interface DraftResult {
  drafts: ShioriAnnotation[];
  count: number;
}

/**
 * Filter draft annotations: shiori-tagged but without a ref.
 */
export function listDrafts(records: ShioriAnnotation[]): DraftResult {
  const drafts = records.filter((r) => r.ref === '' && r.tagged && !r.ignored);
  return { drafts, count: drafts.length };
}
