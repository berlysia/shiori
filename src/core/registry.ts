import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Registry, RegistryEntry } from './types.ts';
import type { RefPatternConfig } from './ref-pattern.ts';

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

type RegistryFormat = 'json' | 'yaml';

function detectFormat(filePath: string): RegistryFormat {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'json';
    case '.yaml':
    case '.yml':
      return 'yaml';
    default:
      throw new Error(
        `Unsupported registry file extension "${ext}". Expected .json, .yaml, or .yml`,
      );
  }
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
    ticket: typeof raw['ticket'] === 'string' ? raw['ticket'] : undefined,
    owner: typeof raw['owner'] === 'string' ? raw['owner'] : undefined,
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : undefined,
    kind: typeof raw['kind'] === 'string' ? raw['kind'] : undefined,
  };

  return { entry, errors };
}

/**
 * Load a registry file (.json, .yaml, .yml).
 * @throws if file cannot be read or content is invalid
 */
export async function loadRegistry(
  filePath: string,
): Promise<RegistryLoadResult> {
  const content = await readFile(filePath, 'utf-8');
  const format = detectFormat(filePath);
  const parsed: unknown =
    format === 'json' ? JSON.parse(content) : parseYaml(content);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Registry file must contain an object');
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

/** Duplicate key warning from multi-registry merge */
export interface RegistryDuplicateWarning {
  ref: string;
  defaultFile: string;
  patternFile: string;
}

/** Result of loading multiple registry files */
export interface MultiRegistryLoadResult {
  registry: Registry;
  errors: RegistryValidationError[];
  duplicates: RegistryDuplicateWarning[];
  /**
   * Maps each ref to the registryFile config value it was loaded from.
   * null = default registry, string = pattern's registryFile value.
   * Used by verify() to detect registry-routing-mismatch (ADR 012 phase 2).
   */
  refOrigins: Map<string, string | null>;
}

/**
 * Load and merge registries: default registry + pattern-specific registries.
 * Pattern-specific files take precedence on key conflicts.
 *
 * @param defaultRegistryPath - Path to the default registry file
 * @param patterns - Ref pattern configuration (may contain registryFile)
 * @param basePath - Base directory to resolve relative registryFile paths against
 */
export async function loadMultiRegistry(
  defaultRegistryPath: string,
  patterns: RefPatternConfig[] | undefined,
  basePath?: string,
): Promise<MultiRegistryLoadResult> {
  const allErrors: RegistryValidationError[] = [];
  const duplicates: RegistryDuplicateWarning[] = [];
  const refOrigins = new Map<string, string | null>();

  // 1. Load default registry
  const defaultResult = await loadRegistry(defaultRegistryPath);
  const merged: Registry = { ...defaultResult.registry };
  allErrors.push(...defaultResult.errors);

  // Track origins for default registry entries (null = default file)
  for (const ref of Object.keys(defaultResult.registry)) {
    refOrigins.set(ref, null);
  }

  // 2. Load pattern-specific registries
  if (patterns) {
    const resolveBase = basePath ?? dirname(defaultRegistryPath);
    const loaded = new Set<string>();

    for (const pattern of patterns) {
      if (!pattern.registryFile) continue;

      const patternPath = resolve(resolveBase, pattern.registryFile);
      if (loaded.has(patternPath)) continue;
      loaded.add(patternPath);

      const patternResult = await loadRegistry(patternPath);
      allErrors.push(...patternResult.errors);

      // Merge: pattern file wins, track duplicates and origins
      for (const [ref, entry] of Object.entries(patternResult.registry)) {
        if (ref in merged) {
          duplicates.push({
            ref,
            defaultFile: defaultRegistryPath,
            patternFile: pattern.registryFile,
          });
        }
        merged[ref] = entry;
        refOrigins.set(ref, pattern.registryFile);
      }
    }
  }

  return { registry: merged, errors: allErrors, duplicates, refOrigins };
}

/**
 * Write a registry to a file (.json, .yaml, .yml).
 */
export async function saveRegistry(
  filePath: string,
  registry: Registry,
): Promise<void> {
  const format = detectFormat(filePath);
  let output: string;
  if (format === 'json') {
    output = JSON.stringify(registry, null, 2) + '\n';
  } else {
    // undefined フィールドを除去してから YAML 化
    // yaml パッケージは undefined を null として出力するため
    output = stringifyYaml(JSON.parse(JSON.stringify(registry)), {
      indent: 2,
      lineWidth: 0,
    });
  }
  await writeFile(filePath, output, 'utf-8');
}
