import { readFile, writeFile } from 'node:fs/promises';
import type { Ledger, LedgerEntry } from './types.ts';

/** Validation error for a ledger entry */
export interface LedgerValidationError {
  id: string;
  message: string;
}

/** Result of loading a ledger file */
export interface LedgerLoadResult {
  ledger: Ledger;
  errors: LedgerValidationError[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateEntry(
  id: string,
  value: unknown,
): { entry: LedgerEntry | undefined; errors: LedgerValidationError[] } {
  const errors: LedgerValidationError[] = [];

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      entry: undefined,
      errors: [{ id, message: 'entry must be an object' }],
    };
  }

  const raw = value as Record<string, unknown>;

  if (typeof raw['reason'] !== 'string') {
    errors.push({ id, message: "missing required field 'reason'" });
  }

  if (
    typeof raw['target'] !== 'string' &&
    !(
      Array.isArray(raw['target']) &&
      raw['target'].every((t: unknown) => typeof t === 'string')
    )
  ) {
    errors.push({ id, message: "missing required field 'target'" });
  }

  if (
    raw['expires'] !== undefined &&
    raw['expires'] !== null &&
    (typeof raw['expires'] !== 'string' || !DATE_RE.test(raw['expires']))
  ) {
    errors.push({
      id,
      message: 'invalid expires format, expected YYYY-MM-DD',
    });
  }

  // Build entry even with errors (best-effort)
  const entry: LedgerEntry = {
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : '',
    target:
      typeof raw['target'] === 'string' || Array.isArray(raw['target'])
        ? (raw['target'] as string | string[])
        : '',
    expires:
      typeof raw['expires'] === 'string' && DATE_RE.test(raw['expires'])
        ? raw['expires']
        : undefined,
    ticket:
      typeof raw['ticket'] === 'string' ? raw['ticket'] : undefined,
    owner: typeof raw['owner'] === 'string' ? raw['owner'] : undefined,
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : undefined,
    kind:
      raw['kind'] === 'stylelint' ||
      raw['kind'] === 'eslint' ||
      raw['kind'] === 'mixed'
        ? raw['kind']
        : undefined,
    verb: typeof raw['verb'] === 'string' ? raw['verb'] : undefined,
  };

  return { entry, errors };
}

/**
 * Load a JSON ledger file.
 * @throws if file cannot be read or JSON is invalid
 */
export async function loadLedger(filePath: string): Promise<LedgerLoadResult> {
  const content = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(content);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Ledger file must contain a JSON object');
  }

  const ledger: Ledger = {};
  const errors: LedgerValidationError[] = [];

  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const result = validateEntry(id, value);
    if (result.entry) {
      ledger[id] = result.entry;
    }
    errors.push(...result.errors);
  }

  return { ledger, errors };
}

/**
 * Write a ledger to a JSON file.
 */
export async function saveLedger(
  filePath: string,
  ledger: Ledger,
): Promise<void> {
  const json = JSON.stringify(ledger, null, 2) + '\n';
  await writeFile(filePath, json, 'utf-8');
}
