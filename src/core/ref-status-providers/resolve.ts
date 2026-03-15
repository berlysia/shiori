import type { RefStatus } from '../ref-status.ts';
import { collectUniqueRefs } from '../ref-status.ts';
import {
  selectRefStatusProvider,
  type SelectProviderOptions,
} from './select-provider.ts';

/**
 * Result of ref-status resolution.
 * `refStatuses` is undefined when no provider is available or no refs exist.
 */
export interface ResolveRefStatusMapResult {
  refStatuses: Map<string, RefStatus> | undefined;
}

/**
 * Resolve ref statuses for annotations via the configured provider.
 *
 * Encapsulates the shared pattern across CLI commands:
 * 1. Select provider from options/env
 * 2. Collect unique refs from annotations
 * 3. Resolve via provider with graceful degradation
 * 4. Return Map<ref, RefStatus>
 *
 * Designed as a provider-layer helper so that EP-0070 (Provider Registry)
 * changes stay contained within the ref-status-providers module.
 */
export async function resolveRefStatusMap(
  options: SelectProviderOptions,
  annotations: { ref: string }[],
): Promise<ResolveRefStatusMapResult> {
  const provider = selectRefStatusProvider(options);
  if (!provider) {
    return { refStatuses: undefined };
  }

  const uniqueRefs = collectUniqueRefs(annotations);
  if (uniqueRefs.length === 0) {
    return { refStatuses: undefined };
  }

  try {
    const entries = await provider.resolve(uniqueRefs);
    const refStatuses = new Map<string, RefStatus>(
      entries.map((e) => [e.ref, e.status]),
    );
    const closedCount = [...refStatuses.values()].filter(
      (s) => s === 'closed',
    ).length;
    console.error(
      `Ref status (${provider.name}): ${refStatuses.size} ref(s) resolved, ${closedCount} closed`,
    );
    return { refStatuses };
  } catch (err) {
    console.error(
      `Warning: ref-status provider "${provider.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Graceful degradation: continue without ref statuses
    return { refStatuses: undefined };
  }
}
