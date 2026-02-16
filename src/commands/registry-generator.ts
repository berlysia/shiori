import type { Registry, ShioriAnnotation } from '../core/types.ts';
import type { RefPatternConfig } from '../core/ref-pattern.ts';
import { matchRefPattern } from '../core/ref-pattern.ts';

/**
 * Ref format validation pattern (ADR 015-B).
 * Allows: SUP-1234, ADR:0007, JIRA:PROJ-123, DEV-001, MIG-1
 * Rejects: prefix, marker, ');', backtick, arrow, (no
 */
export const REF_PATTERN =
  /^[A-Z][A-Z0-9]*(?:[-:][A-Za-z0-9][-A-Za-z0-9._]*)*$/;

/** Check if a ref matches the expected format */
export function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref);
}

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

  // Group records by ref (skip empty refs and invalid ref formats)
  const byRef = new Map<string, ShioriAnnotation[]>();
  for (const record of records) {
    if (record.ref === '') continue;
    if (!isValidRef(record.ref)) continue;
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
