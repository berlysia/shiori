/**
 * Ref format validation (ADR 015-B).
 *
 * Extracted from registry-generator.ts to core/ so that both
 * registry-generator (commands layer) and verify (commands layer)
 * import from the same canonical location without cross-command
 * dependency.
 */

/**
 * Ref format validation pattern (ADR 015-B).
 * Allows: SUP-1234, ADR:0007, JIRA:PROJ-123, DEV-001, MIG-1
 * Rejects: prefix, marker, ');', backtick, arrow, (no
 */
export const REF_PATTERN =
  /^[A-Z][A-Z0-9]*(?:[-:][A-Za-z0-9][-A-Za-z0-9._]*)*$/;

/** Check if a ref matches the expected format */
export function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref);
}
