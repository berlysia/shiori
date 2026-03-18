/**
 * Public API surface for shiori core.
 *
 * External consumers (e.g. VSCode extension) should import from this barrel
 * rather than reaching into individual modules. Only stable, public-facing
 * APIs are re-exported here — CLI internals are intentionally excluded.
 */

// ── Registry ────────────────────────────────────────────────
export { loadRegistry } from './registry.ts';
export type {
  RegistryLoadResult,
  RegistryValidationError,
} from './registry.ts';

// ── Parser ──────────────────────────────────────────────────
export { parseShioriFields } from './parser.ts';

// ── Types ───────────────────────────────────────────────────
export type {
  ShioriAnnotation,
  Registry,
  RegistryEntry,
  VerifyIssue,
  VerifyIssueType,
  VerifyResult,
  HealthLevel,
} from './types.ts';
