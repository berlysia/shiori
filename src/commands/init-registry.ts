import type {
  Registry,
  RegistryKind,
  AnnotationRecord,
} from '../core/types.ts';

export interface InitRegistryOptions {
  /** Annotation records from scan */
  records: AnnotationRecord[];
  /** Existing registry to merge with (existing entries are preserved) */
  existingRegistry?: Registry;
}

function inferKind(records: AnnotationRecord[]): RegistryKind {
  const tools = new Set(records.map((r) => r.tool));
  if (tools.size === 1) {
    const tool = [...tools][0]!;
    if (tool === 'stylelint' || tool === 'eslint') return tool;
  }
  return 'mixed';
}

function inferExpires(records: AnnotationRecord[]): string | undefined {
  let earliest: string | undefined;
  for (const r of records) {
    const expires = r.meta['expires'];
    if (typeof expires === 'string') {
      if (!earliest || expires < earliest) {
        earliest = expires;
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

  // Group records by ID (skip empty IDs)
  const byId = new Map<string, AnnotationRecord[]>();
  for (const record of records) {
    if (record.id === '') continue;
    const existing = byId.get(record.id);
    if (existing) {
      existing.push(record);
    } else {
      byId.set(record.id, [record]);
    }
  }

  // Build result registry sorted by ID
  const sortedIds = [...byId.keys()].sort((a, b) => a.localeCompare(b));
  const registry: Registry = {};

  for (const id of sortedIds) {
    if (id in existingRegistry) {
      registry[id] = existingRegistry[id]!;
    } else {
      const idRecords = byId.get(id)!;
      registry[id] = {
        reason: 'TODO: fill in reason',
        target: 'TODO: fill in target',
        expires: inferExpires(idRecords),
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: inferKind(idRecords),
        verb: undefined,
      };
    }
  }

  // Also include existing registry entries not in scan
  for (const [id, entry] of Object.entries(existingRegistry)) {
    if (!(id in registry)) {
      registry[id] = entry;
    }
  }

  return registry;
}
