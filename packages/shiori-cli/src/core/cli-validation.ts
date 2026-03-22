import { VERIFY_ISSUE_TYPES, OUTPUT_FORMATS } from './types.ts';
import type { OutputFormat, VerifyIssueType } from './types.ts';
import { ExitCode } from './exit-codes.ts';

const VALID_PROVIDERS: readonly string[] = ['comment'];

/**
 * Parse a comma-separated issue type string and validate each value.
 * Prints an error and sets ExitCode.USAGE_ERROR on invalid values.
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
  const issueTypes: readonly string[] = VERIFY_ISSUE_TYPES;
  const invalid = types.filter((t) => !issueTypes.includes(t));
  if (invalid.length > 0) {
    console.error(
      `Error: Invalid ${flag} value: ${invalid.map((v) => `"${v}"`).join(', ')}. Valid values: ${VERIFY_ISSUE_TYPES.join(', ')}`,
    );
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  // shiori: DEV-013 reason="string[] narrowed to VerifyIssueType[] after filtering against VERIFY_ISSUE_TYPES; TS cannot infer this from .includes() guard"
  return types as VerifyIssueType[];
}

/**
 * Validate the output format flag value (derived from OUTPUT_FORMATS).
 * Defaults to "json" when undefined. Prints an error on invalid values.
 */
export const validateOutputFormat: (
  value: string | undefined,
) => OutputFormat | null = createFormatValidator<OutputFormat>(OUTPUT_FORMATS);

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
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  return provider;
}

/**
 * Create a format validator for a specific set of valid formats.
 * Returns a function that validates the --format flag value and returns
 * the validated format or null on failure.
 *
 * Eliminates repeated inline validation + `as` casts across CLI commands.
 *
 * @param validFormats - List of valid format strings (use const assertion arrays from types.ts)
 * @param defaultFormat - Default format when value is undefined (default: first element)
 * @returns Validator function: (value: string | undefined) => T | null
 */
export function createFormatValidator<T extends string>(
  validFormats: readonly T[],
  defaultFormat: T = validFormats[0]!,
): (value: string | undefined) => T | null {
  return (value: string | undefined): T | null => {
    const format = (value ?? defaultFormat) as string;
    if (!validFormats.includes(format as T)) {
      console.error(
        `Error: Invalid --format value "${format}". Valid values: ${validFormats.join(', ')}`,
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return null;
    }
    return format as T;
  };
}
