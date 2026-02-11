import type {
  Ledger,
  LedgerKind,
  SuppressionRecord,
} from '../core/types.ts';

export interface InitLedgerOptions {
  /** Suppression records from scan */
  records: SuppressionRecord[];
  /** Existing ledger to merge with (existing entries are preserved) */
  existingLedger?: Ledger;
}

function inferKind(records: SuppressionRecord[]): LedgerKind {
  const linters = new Set(records.map((r) => r.linter));
  if (linters.size === 1) {
    const linter = [...linters][0]!;
    if (linter === 'stylelint' || linter === 'eslint') return linter;
  }
  return 'mixed';
}

function inferExpires(records: SuppressionRecord[]): string | undefined {
  let earliest: string | undefined;
  for (const r of records) {
    if (r.meta.expires) {
      if (!earliest || r.meta.expires < earliest) {
        earliest = r.meta.expires;
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
  const byId = new Map<string, SuppressionRecord[]>();
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
