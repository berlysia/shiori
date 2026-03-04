/**
 * Lightweight config validation — detects unknown keys in raw config.
 *
 * Phase 1: Known key checking + unknown key detection
 * Phase 2 (future): Typo detection via Levenshtein distance
 *
 * Validation errors are warnings only — they do not stop config loading.
 * No external dependencies.
 */

/** Config validation error */
export interface ConfigValidationError {
  /** Dot-separated path to the offending key (e.g. "scan.paterns") */
  path: string;
  /** Human-readable message */
  message: string;
}

/** Known top-level keys in ShioriConfig */
const KNOWN_TOP_KEYS = new Set([
  'candidates',
  'refPatterns',
  'scan',
  'paths',
  'verify',
]);

/** Known keys per section */
const KNOWN_SECTION_KEYS: Record<string, Set<string>> = {
  scan: new Set(['patterns', 'ignore']),
  paths: new Set(['scanResult', 'registry']),
  verify: new Set(['expiringThresholdDays']),
};

/**
 * Validate raw config object for unknown keys.
 *
 * Returns an array of validation errors (empty if config is valid).
 * Does not validate value types — only key presence.
 *
 * `candidates` section is intentionally not validated here because
 * its keys are dynamically defined by annotation providers.
 */
export function validateConfig(raw: unknown): ConfigValidationError[] {
  if (raw === null || raw === undefined) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) return [];

  const errors: ConfigValidationError[] = [];
  const config = raw as Record<string, unknown>;

  // Check top-level keys
  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      errors.push({
        path: key,
        message: `unknown key '${key}'`,
      });
    }
  }

  // Check section keys (skip 'candidates' — dynamically defined)
  for (const [section, knownKeys] of Object.entries(KNOWN_SECTION_KEYS)) {
    const sectionValue = config[section];
    if (
      sectionValue === null ||
      sectionValue === undefined ||
      typeof sectionValue !== 'object' ||
      Array.isArray(sectionValue)
    ) {
      continue;
    }

    for (const key of Object.keys(sectionValue as Record<string, unknown>)) {
      if (!knownKeys.has(key)) {
        errors.push({
          path: `${section}.${key}`,
          message: `unknown key '${key}' in '${section}'`,
        });
      }
    }
  }

  return errors;
}

/**
 * Format validation errors as human-readable warning lines.
 */
export function formatConfigWarnings(
  errors: ConfigValidationError[],
): string[] {
  return errors.map((e) => `config warning: ${e.path}: ${e.message}`);
}
