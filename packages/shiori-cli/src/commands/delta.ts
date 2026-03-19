import type {
  ShioriAnnotation,
  DeltaKind,
  AnnotationDelta,
  DeltaSummary,
  DeltaResult,
  ComputeDeltaOptions,
} from '../core/types.ts';

// Re-export types for backward compatibility
export type {
  DeltaKind,
  AnnotationDelta,
  DeltaSummary,
  DeltaResult,
  ComputeDeltaOptions,
};

/**
 * Compute the delta between base and head scan results.
 *
 * Uses ref as the grouping key for set-based diff.
 * Draft annotations (ref === '') are excluded from the diff
 * since they lack a stable identity for matching.
 */
export function computeDelta(options: ComputeDeltaOptions): DeltaResult {
  const baseByRef = groupByRef(options.base.annotations);
  const headByRef = groupByRef(options.head.annotations);

  const allRefs = new Set([...baseByRef.keys(), ...headByRef.keys()]);

  const deltas: AnnotationDelta[] = [];

  for (const ref of allRefs) {
    const baseAnnotations = baseByRef.get(ref) ?? [];
    const headAnnotations = headByRef.get(ref) ?? [];

    if (baseAnnotations.length === 0) {
      // All head annotations for this ref are new
      for (const head of headAnnotations) {
        deltas.push({ kind: 'added', ref, head });
      }
    } else if (headAnnotations.length === 0) {
      // All base annotations for this ref are gone
      for (const base of baseAnnotations) {
        deltas.push({ kind: 'removed', ref, base });
      }
    } else {
      // Ref exists in both — pair by position (stable sort order preserved from scan)
      const maxLen = Math.max(baseAnnotations.length, headAnnotations.length);
      for (let i = 0; i < maxLen; i++) {
        const base = baseAnnotations[i];
        const head = headAnnotations[i];
        if (base && head) {
          deltas.push({ kind: 'unchanged', ref, base, head });
        } else if (head) {
          deltas.push({ kind: 'added', ref, head });
        } else if (base) {
          deltas.push({ kind: 'removed', ref, base });
        }
      }
    }
  }

  // Sort deltas: added first, then removed, then unchanged; within each kind sort by ref
  deltas.sort((a, b) => {
    const kindOrder: Record<DeltaKind, number> = {
      added: 0,
      removed: 1,
      unchanged: 2,
    };
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.ref.localeCompare(b.ref);
  });

  const summary: DeltaSummary = {
    added: deltas.filter((d) => d.kind === 'added').length,
    removed: deltas.filter((d) => d.kind === 'removed').length,
    unchanged: deltas.filter((d) => d.kind === 'unchanged').length,
    net: 0,
  };
  summary.net = summary.added - summary.removed;

  return { deltas, summary };
}

/**
 * Group annotations by ref, excluding drafts (empty ref).
 */
function groupByRef(
  annotations: ShioriAnnotation[],
): Map<string, ShioriAnnotation[]> {
  const map = new Map<string, ShioriAnnotation[]>();
  for (const annotation of annotations) {
    // Skip draft annotations (no ref for stable identity)
    if (annotation.ref === '') continue;

    const existing = map.get(annotation.ref);
    if (existing) {
      existing.push(annotation);
    } else {
      map.set(annotation.ref, [annotation]);
    }
  }
  return map;
}

/**
 * Filter a DeltaResult to include only deltas of the specified kind(s).
 * Summary is recalculated from the filtered deltas.
 */
export function filterDelta(
  result: DeltaResult,
  kinds: DeltaKind[],
): DeltaResult {
  const kindSet = new Set(kinds);
  const deltas = result.deltas.filter((d) => kindSet.has(d.kind));
  const summary: DeltaSummary = {
    added: deltas.filter((d) => d.kind === 'added').length,
    removed: deltas.filter((d) => d.kind === 'removed').length,
    unchanged: deltas.filter((d) => d.kind === 'unchanged').length,
    net: 0,
  };
  summary.net = summary.added - summary.removed;
  return { deltas, summary };
}

/**
 * Format a DeltaResult as JSON string.
 */
export function formatDeltaAsJson(result: DeltaResult): string {
  return JSON.stringify(result, null, 2);
}
