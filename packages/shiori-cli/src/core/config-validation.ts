/**
 * Lightweight config validation — detects unknown keys and value types in raw config.
 *
 * Phase 1: Known key checking + unknown key detection
 * Phase 2: Value type validation (number, string, string[], object structure)
 *
 * Validation errors are warnings only — they do not stop config loading.
 * Consumers should apply default values as fallback for invalid values.
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

// ── Validation predicates ──────────────────────────────────

/** Check if a value is a positive finite integer */
export function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

/** Check if a value is a string */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Check if a value is a non-empty array of strings */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Check if a value is a plain object (not array, not null) */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/**
 * Validate raw config object for unknown keys and value types.
 *
 * Returns an array of validation errors (empty if config is valid).
 * All errors are warnings — they do not stop config loading.
 *
 * `candidates` section is intentionally not validated here because
 * its keys are dynamically defined by annotation providers.
 */
export function validateConfig(raw: unknown): ConfigValidationError[] {
  if (raw === null || raw === undefined) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) return [];

  const errors: ConfigValidationError[] = [];
  const config = raw as Record<string, unknown>;

  // ── Phase 1: Unknown key detection ──────────────────────

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
    if (!isPlainObject(sectionValue)) {
      continue;
    }

    for (const key of Object.keys(sectionValue)) {
      if (!knownKeys.has(key)) {
        errors.push({
          path: `${section}.${key}`,
          message: `unknown key '${key}' in '${section}'`,
        });
      }
    }
  }

  // ── Phase 2: Value type validation ──────────────────────

  // scan section
  if (config.scan !== undefined) {
    if (!isPlainObject(config.scan)) {
      errors.push({
        path: 'scan',
        message: `expected object, got ${typeLabel(config.scan)}`,
      });
    } else {
      const scan = config.scan;
      if (scan.patterns !== undefined && !isStringArray(scan.patterns)) {
        errors.push({
          path: 'scan.patterns',
          message: `expected string[], got ${typeLabel(scan.patterns)}`,
        });
      }
      if (scan.ignore !== undefined && !isStringArray(scan.ignore)) {
        errors.push({
          path: 'scan.ignore',
          message: `expected string[], got ${typeLabel(scan.ignore)}`,
        });
      }
    }
  }

  // paths section
  if (config.paths !== undefined) {
    if (!isPlainObject(config.paths)) {
      errors.push({
        path: 'paths',
        message: `expected object, got ${typeLabel(config.paths)}`,
      });
    } else {
      const paths = config.paths;
      if (paths.scanResult !== undefined && !isString(paths.scanResult)) {
        errors.push({
          path: 'paths.scanResult',
          message: `expected string, got ${typeLabel(paths.scanResult)}`,
        });
      }
      if (paths.registry !== undefined && !isString(paths.registry)) {
        errors.push({
          path: 'paths.registry',
          message: `expected string, got ${typeLabel(paths.registry)}`,
        });
      }
    }
  }

  // verify section
  if (config.verify !== undefined) {
    if (!isPlainObject(config.verify)) {
      errors.push({
        path: 'verify',
        message: `expected object, got ${typeLabel(config.verify)}`,
      });
    } else {
      const verify = config.verify;
      if (
        verify.expiringThresholdDays !== undefined &&
        !isPositiveInteger(verify.expiringThresholdDays)
      ) {
        errors.push({
          path: 'verify.expiringThresholdDays',
          message: `expected positive integer, got ${JSON.stringify(verify.expiringThresholdDays)}`,
        });
      }
    }
  }

  // refPatterns — must be an array, each entry must have a 'match' string
  if (config.refPatterns !== undefined) {
    if (!Array.isArray(config.refPatterns)) {
      errors.push({
        path: 'refPatterns',
        message: `expected array, got ${typeLabel(config.refPatterns)}`,
      });
    } else {
      for (let i = 0; i < config.refPatterns.length; i++) {
        const entry = config.refPatterns[i] as unknown;
        if (!isPlainObject(entry)) {
          errors.push({
            path: `refPatterns[${i}]`,
            message: `expected object, got ${typeLabel(entry)}`,
          });
        } else if (!isString(entry.match)) {
          errors.push({
            path: `refPatterns[${i}].match`,
            message: `required field 'match' must be a string`,
          });
        }
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

/** Produce a human-readable type label for error messages */
function typeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
