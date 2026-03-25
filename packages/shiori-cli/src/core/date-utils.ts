/**
 * Date manipulation utilities for expires field management.
 *
 * Supports both YYYY-MM and YYYY-MM-DD formats with format preservation:
 * YYYY-MM input produces YYYY-MM output, YYYY-MM-DD input produces YYYY-MM-DD output.
 */

/**
 * Extend an expires date by a given number of months.
 *
 * Preserves the input format (YYYY-MM or YYYY-MM-DD).
 * For YYYY-MM-DD, clamps the day to the last valid day of the target month
 * (e.g., 2026-01-31 + 1 month → 2026-02-28).
 *
 * @param expires - Expires date string in YYYY-MM or YYYY-MM-DD format
 * @param months - Number of months to add (must be positive)
 * @returns Extended date in the same format as input
 * @throws {Error} When input format is invalid
 */
export function extendExpires(expires: string, months: number): string {
  if (months <= 0) {
    throw new Error(`months must be positive, got ${months}`);
  }

  if (expires.length === 7) {
    // YYYY-MM format
    return extendYearMonth(expires, months);
  }

  if (expires.length === 10) {
    // YYYY-MM-DD format
    return extendYearMonthDay(expires, months);
  }

  throw new Error(
    `Invalid expires format: "${expires}". Expected YYYY-MM or YYYY-MM-DD.`,
  );
}

/**
 * Extend a YYYY-MM date by N months using integer arithmetic.
 */
function extendYearMonth(expires: string, months: number): string {
  const year = parseInt(expires.slice(0, 4), 10);
  const month = parseInt(expires.slice(5, 7), 10);

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid YYYY-MM date: "${expires}"`);
  }

  // Convert to zero-based total months, add, convert back
  const totalMonths = year * 12 + (month - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;

  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

/**
 * Extend a YYYY-MM-DD date by N months, clamping the day to the last valid day
 * of the target month.
 */
function extendYearMonthDay(expires: string, months: number): string {
  const year = parseInt(expires.slice(0, 4), 10);
  const month = parseInt(expires.slice(5, 7), 10);
  const day = parseInt(expires.slice(8, 10), 10);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error(`Invalid YYYY-MM-DD date: "${expires}"`);
  }

  // Compute target year/month using same integer arithmetic
  const totalMonths = year * 12 + (month - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;

  // Clamp day to last valid day of target month
  // new Date(year, month, 0) returns the last day of the previous month,
  // so new Date(newYear, newMonth, 0) gives the last day of newMonth
  const lastDay = new Date(newYear, newMonth, 0).getDate();
  const newDay = Math.min(day, lastDay);

  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}
