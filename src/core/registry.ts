import { readFile, writeFile } from 'node:fs/promises';
import type { Registry, RegistryEntry } from './types.ts';

/** Validation error for a registry entry */
export interface RegistryValidationError {
  id: string;
  message: string;
}

/** Result of loading a registry file */
export interface RegistryLoadResult {
  registry: Registry;
  errors: RegistryValidationError[];
}

const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

function validateEntry(
  id: string,
  value: unknown,
): { entry: RegistryEntry | undefined; errors: RegistryValidationError[] } {
  const errors: RegistryValidationError[] = [];

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
      message: 'invalid expires format, expected YYYY-MM-DD or YYYY-MM',
    });
  }

  // Build entry even with errors (best-effort)
  const entry: RegistryEntry = {
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
    kind: typeof raw['kind'] === 'string' ? raw['kind'] : undefined,
  };

  return { entry, errors };
}

/**
 * Load a JSON registry file.
 * @throws if file cannot be read or JSON is invalid
 */
export async function loadRegistry(filePath: string): Promise<RegistryLoadResult> {
  const content = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(content);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Registry file must contain a JSON object');
  }

  const registry: Registry = {};
  const errors: RegistryValidationError[] = [];

  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const result = validateEntry(id, value);
    if (result.entry) {
      registry[id] = result.entry;
    }
    errors.push(...result.errors);
  }

  return { registry, errors };
}

/**
 * Write a registry to a JSON file.
 */
export async function saveRegistry(
  filePath: string,
  registry: Registry,
): Promise<void> {
  const json = JSON.stringify(registry, null, 2) + '\n';
  await writeFile(filePath, json, 'utf-8');
}
