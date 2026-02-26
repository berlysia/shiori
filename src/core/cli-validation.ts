import type { VerifyIssueType } from './types.ts';
import type { OutputFormat } from '../formatters/types.ts';

const VALID_ISSUE_TYPES: readonly string[] = [
  'missing-in-registry',
  'unused-in-source',
  'expired',
  'syntax-error',
  'ref-format',
  'ref-collision',
  'unrouted-ref',
];

const VALID_OUTPUT_FORMATS: readonly string[] = [
  'json',
  'markdown',
  'sarif',
  'summary',
  'jsonl',
];

const VALID_PROVIDERS: readonly string[] = ['comment'];

/**
 * Parse a comma-separated issue type string and validate each value.
 * Prints an error and sets exitCode=1 on invalid values.
 *
 * @param value - Comma-separated issue types (e.g. "expired,syntax-error"), or undefined
 * @param flag - CLI flag name for error messages (e.g. "--fail-on")
 * @returns Parsed array, empty array if undefined, or null on validation failure
 */
export function parseAndValidateIssueTypes(
  value: string | undefined,
  flag: string,
): VerifyIssueType[] | null {
  if (!value) return [];
  const types = value.split(',').map((s) => s.trim());
  const invalid = types.filter((t) => !VALID_ISSUE_TYPES.includes(t));
  if (invalid.length > 0) {
    console.error(
      `Error: Invalid ${flag} value: ${invalid.map((v) => `"${v}"`).join(', ')}. Valid values: ${VALID_ISSUE_TYPES.join(', ')}`,
    );
    process.exitCode = 1;
    return null;
  }
  return types as VerifyIssueType[];
}

/**
 * Validate the output format flag value.
 * Defaults to "json" when undefined. Prints an error on invalid values.
 *
 * @param value - Format string from --format flag, or undefined
 * @returns Validated format, or null on validation failure
 */
export function validateOutputFormat(
  value: string | undefined,
): OutputFormat | null {
  const format = value ?? 'json';
  if (!VALID_OUTPUT_FORMATS.includes(format)) {
    console.error(
      `Error: Invalid --format value "${format}". Valid values: ${VALID_OUTPUT_FORMATS.join(', ')}`,
    );
    process.exitCode = 1;
    return null;
  }
  return format as OutputFormat;
}

/**
 * Validate the provider flag value.
 * Defaults to "comment" when undefined. Prints an error on invalid values.
 *
 * @param value - Provider name from --provider flag, or undefined
 * @returns Validated provider name, or null on validation failure
 */
export function validateProvider(value: string | undefined): string | null {
  const provider = value ?? 'comment';
  if (!VALID_PROVIDERS.includes(provider)) {
    console.error(
      `Error: Unknown --provider "${provider}". Valid values: ${VALID_PROVIDERS.join(', ')}`,
    );
    process.exitCode = 1;
    return null;
  }
  return provider;
}
