/**
 * Shared test helper for constructing RegistryEntry objects.
 *
 * Default kind is undefined — matching what real registries look like when
 * `kind` has not been explicitly set. resolveKind() treats undefined as
 * 'temporary' (ADR 024), so tests that need 'intentional' behavior must
 * pass `kind: 'intentional'` explicitly.
 */
import type { RegistryEntry } from '../../src/core/types.ts';

export function makeRegistryEntry(
  overrides: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    reason: 'test reason',
    target: 'test.ts',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}
