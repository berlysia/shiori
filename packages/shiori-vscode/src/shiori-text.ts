/**
 * Pure utility functions for shiori annotation detection.
 * Extracted from extension.ts to enable testing without vscode dependency.
 */

/**
 * Regex to find shiori annotations in line comments.
 * Matches both "shiori: REF" (with space) and "shiori:REF" (compact) forms.
 * Captures everything after "shiori:" as a single group.
 */
const SHIORI_RE = /shiori:\s*(\S.*?)$/;

/** Detect the shiori:ignore directive */
const SHIORI_IGNORE_RE = /\bshiori:ignore\b/;

/**
 * Result of extracting shiori annotation text from a line.
 */
export interface ShioriExtraction {
  /** Raw field string (everything after "shiori:") */
  fieldsText: string;
  /** Character offset of "shiori:" in the line */
  shioriOffset: number;
}

/**
 * Extract shiori annotation text from a line.
 * Returns the raw field string and its position, or undefined if no match.
 * Lines containing "shiori:ignore" are explicitly excluded.
 */
export function extractShioriText(
  lineText: string,
): ShioriExtraction | undefined {
  // shiori:ignore is a special directive, not a trackable annotation
  if (SHIORI_IGNORE_RE.test(lineText)) return undefined;

  const match = SHIORI_RE.exec(lineText);
  if (!match?.[1]) return undefined;

  return {
    fieldsText: match[1].trim(),
    shioriOffset: match.index,
  };
}

/**
 * Check if a date string (YYYY-MM-DD or YYYY-MM) is in the past.
 *
 * For YYYY-MM format, the entire month is considered active:
 * "2026-03" expires at the end of March 2026, so it is not expired during March.
 */
export function isDateExpired(dateStr: string): boolean {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    // YYYY-MM: expired when current month is strictly after the given month
    const currentYearMonth = todayStr.slice(0, 7);
    return currentYearMonth > dateStr;
  }

  // YYYY-MM-DD: expired when today is strictly after the given date
  return todayStr > dateStr;
}
