import type { Registry, ShioriAnnotation } from '../core/types.ts';
import type { NamespaceConfig } from '../core/namespace.ts';
import { parseRef } from '../core/namespace.ts';

export interface InitRegistryOptions {
  /** Shiori annotations from scan */
  records: ShioriAnnotation[];
  /** Existing registry to merge with (existing entries are preserved) */
  existingRegistry?: Registry;
}

function inferExpires(records: ShioriAnnotation[]): string | undefined {
  let earliest: string | undefined;
  for (const r of records) {
    if (r.expires) {
      if (!earliest || r.expires < earliest) {
        earliest = r.expires;
      }
    }
  }
  return earliest;
}

/**
 * Generate a registry scaffold from scan results.
 * Existing entries are preserved; new entries get placeholder values.
 */
export function initRegistry(options: InitRegistryOptions): Registry {
  const { records, existingRegistry = {} } = options;

  // Group records by ref (skip empty refs)
  const byRef = new Map<string, ShioriAnnotation[]>();
  for (const record of records) {
    if (record.ref === '') continue;
    const existing = byRef.get(record.ref);
    if (existing) {
      existing.push(record);
    } else {
      byRef.set(record.ref, [record]);
    }
  }

  // Build result registry sorted by ref
  const sortedRefs = [...byRef.keys()].sort((a, b) => a.localeCompare(b));
  const registry: Registry = {};

  for (const ref of sortedRefs) {
    if (ref in existingRegistry) {
      registry[ref] = existingRegistry[ref]!;
    } else {
      const refRecords = byRef.get(ref)!;
      registry[ref] = {
        reason: 'TODO: fill in reason',
        target: 'TODO: fill in target',
        expires: inferExpires(refRecords),
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      };
    }
  }

  // Also include existing registry entries not in scan
  for (const [ref, entry] of Object.entries(existingRegistry)) {
    if (!(ref in registry)) {
      registry[ref] = entry;
    }
  }

  return registry;
}

/**
 * Route a registry into per-namespace registries based on namespace config.
 * Returns a map of registryFile → Registry, plus a "default" key for entries
 * without a matching namespace.
 */
export function routeRegistryByNamespace(
  registry: Registry,
  namespaces: Record<string, NamespaceConfig> | undefined,
): Map<string | null, Registry> {
  const routed = new Map<string | null, Registry>();

  for (const [ref, entry] of Object.entries(registry)) {
    const parsed = parseRef(ref);
    let target: string | null = null;

    if (parsed.namespace && namespaces) {
      const nsConfig = namespaces[parsed.namespace];
      if (nsConfig?.registryFile) {
        target = nsConfig.registryFile;
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
