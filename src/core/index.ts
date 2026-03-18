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

// ── Config ──────────────────────────────────────────────────
export { loadConfig, resolveConfig } from './config.ts';
export type { ShioriConfig, ResolvedConfig } from './config.ts';

// ── Ref Validation ──────────────────────────────────────────
export { isValidRef, REF_PATTERN } from './ref-validation.ts';

// ── Types ───────────────────────────────────────────────────
export type {
  ShioriAnnotation,
  ShioriCandidate,
  ScanResult,
  Registry,
  RegistryEntry,
  VerifyIssue,
  VerifyIssueType,
  VerifyResult,
  IssueSeverity,
  HealthLevel,
  FileBreakdownEntry,
  DirectoryBreakdownEntry,
} from './types.ts';
