import type { Registry } from './types.ts';
import type { RefPatternConfig } from './ref-pattern.ts';
import { matchRefPattern } from './ref-pattern.ts';

/**
 * Route a registry into per-pattern registries based on ref pattern config.
 * Returns a map of registryFile → Registry, plus null key for entries
 * without a matching pattern.
 */
export function routeRegistryByPattern(
  registry: Registry,
  patterns: RefPatternConfig[] | undefined,
): Map<string | null, Registry> {
  const routed = new Map<string | null, Registry>();

  for (const [ref, entry] of Object.entries(registry)) {
    let target: string | null = null;

    if (patterns) {
      const match = matchRefPattern(ref, patterns);
      if (match?.config.registryFile) {
        target = match.config.registryFile;
      }
    }

    const existing = routed.get(target);
    if (existing) {
      existing[ref] = entry;
    } else {
      routed.set(target, { [ref]: entry });
    }
  }

  return routed;
}
