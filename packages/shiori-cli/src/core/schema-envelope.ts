/**
 * ADR 028: Common schema version envelope for CLI JSON output.
 *
 * Provides a standardized `meta` + `data` wrapper for machine-consumed JSON,
 * enabling consumers to perform compatibility checks via `meta.schemaVersion`.
 */

import { VERSION } from './version.ts';

/**
 * Output metadata included in every enveloped JSON response.
 * Consumers should use `schemaVersion` (not `version`) for compatibility checks.
 */
export interface OutputMeta {
  /** CLI version string (for debugging, not for compatibility checks) */
  version: string;
  /** Schema version (integer, starts at 1). Consumers use this for compatibility. */
  schemaVersion: number;
  /** Command that produced this output */
  command: string;
  /** ISO 8601 timestamp (optional, for audit trails) */
  timestamp?: string;
}

/**
 * Enveloped command output with `meta` + `data` structure.
 * Generic over the data payload type.
 */
export interface CommandOutput<T> {
  meta: OutputMeta;
  data: T;
}

/**
 * Options for creating an enveloped output.
 */
export interface WrapOutputOptions {
  /** Command name (e.g. "fix", "resolve") */
  command: string;
  /** Schema version for this command's output (starts at 1) */
  schemaVersion: number;
  /** Include ISO 8601 timestamp in meta (default: false) */
  includeTimestamp?: boolean;
}

/**
 * Wrap a data payload in the ADR 028 `meta` + `data` envelope.
 *
 * @example
 * ```ts
 * const output = wrapOutput(fixPlan, {
 *   command: 'fix',
 *   schemaVersion: 1,
 * });
 * // { meta: { version: "0.2.0", schemaVersion: 1, command: "fix" }, data: fixPlan }
 * ```
 */
export function wrapOutput<T>(
  data: T,
  options: WrapOutputOptions,
): CommandOutput<T> {
  const meta: OutputMeta = {
    version: VERSION,
    schemaVersion: options.schemaVersion,
    command: options.command,
  };

  if (options.includeTimestamp) {
    meta.timestamp = new Date().toISOString();
  }

  return { meta, data };
}

/**
 * Wrap and serialize data as a JSON string with the ADR 028 envelope.
 * Convenience function combining `wrapOutput` + `JSON.stringify`.
 */
export function wrapOutputJson<T>(data: T, options: WrapOutputOptions): string {
  return JSON.stringify(wrapOutput(data, options), null, 2);
}
