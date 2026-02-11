import type {
  Ledger,
  LedgerKind,
  AnnotationRecord,
} from '../core/types.ts';

export interface InitLedgerOptions {
  /** Annotation records from scan */
  records: AnnotationRecord[];
  /** Existing ledger to merge with (existing entries are preserved) */
  existingLedger?: Ledger;
}

function inferKind(records: AnnotationRecord[]): LedgerKind {
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
 * Generate a ledger scaffold from scan results.
 * Existing entries are preserved; new entries get placeholder values.
 */
export function initLedger(options: InitLedgerOptions): Ledger {
  const { records, existingLedger = {} } = options;

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

  // Build result ledger sorted by ID
  const sortedIds = [...byId.keys()].sort((a, b) => a.localeCompare(b));
  const ledger: Ledger = {};

  for (const id of sortedIds) {
    if (id in existingLedger) {
      ledger[id] = existingLedger[id]!;
    } else {
      const idRecords = byId.get(id)!;
      ledger[id] = {
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

  // Also include existing ledger entries not in scan
  for (const [id, entry] of Object.entries(existingLedger)) {
    if (!(id in ledger)) {
      ledger[id] = entry;
    }
  }

  return ledger;
}
