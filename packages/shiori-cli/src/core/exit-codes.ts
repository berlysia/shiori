/**
 * Centralized exit code constants and per-command policy definitions.
 *
 * ADR 027: CLI Exit Code Policy Matrix
 *
 * Phase 1: Constants and policy metadata only. ✅ Done
 * Phase 2: All `process.exitCode = 1` replaced with named constants. ✅ Done
 */

// ---------------------------------------------------------------------------
// Exit Code Constants
// ---------------------------------------------------------------------------

/** Named exit codes for shiori CLI */
export const ExitCode = {
  /** Normal termination */
  SUCCESS: 0,
  /** Governance issues detected (verify errors, health threshold, doctor failures) */
  GOVERNANCE_VIOLATION: 1,
  /** Invalid CLI arguments or option values */
  USAGE_ERROR: 2,
  /** Environment problems (missing files, path boundary violations) */
  ENVIRONMENT_ERROR: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// ---------------------------------------------------------------------------
// Exit Code Policy
// ---------------------------------------------------------------------------

/**
 * Exit code policy category.
 *
 * - governance: exit 1 when governance issues are detected
 * - usage: exit 2 on invalid CLI arguments, exit 3 on environment errors
 * - passthrough: always exit 0 (informational or long-running commands)
 */
export type ExitCodeCategory = 'governance' | 'usage' | 'passthrough';

/** Description of when a command exits non-zero */
export interface ExitCodePolicy {
  /** Policy category */
  category: ExitCodeCategory;
  /** Human-readable description of non-zero exit trigger condition (null if passthrough) */
  failCondition: string | null;
}

// ---------------------------------------------------------------------------
// Registered CLI Commands
// ---------------------------------------------------------------------------

/**
 * All registered CLI subcommand names.
 * Must be kept in sync with cli.ts subCommands keys.
 * doctor self-verification detects drift via checkExitCodePolicies().
 */
export const REGISTERED_COMMANDS: readonly string[] = [
  'init',
  'scan',
  'verify',
  'check',
  'update',
  'adopt',
  'migrate',
  'draft',
  'candidates',
  'show',
  'jump',
  'watch',
  'health',
  'report',
  'trend',
  'delta',
  'docs',
  'doctor',
  'resolve',
  'why',
  'triage',
  'annotate',
  'weekly-report',
  'journal',
  'summary',
  'aggregate',
  'guide',
  'fix',
  'coach',
  'narrative',
  'recipes',
  'pitch',
  'onboard',
] as const;

// ---------------------------------------------------------------------------
// Per-command Policy Registry
// ---------------------------------------------------------------------------

/**
 * Exit code policy for every registered CLI command.
 *
 * This map is the single source of truth for CI integrators and for
 * the doctor self-verification check.
 */
export const EXIT_CODE_POLICIES: Record<string, ExitCodePolicy> = {
  // -- Governance commands (exit 1 on detected issues) --
  verify: {
    category: 'governance',
    failCondition: 'summary.errors > 0',
  },
  check: {
    category: 'governance',
    failCondition: 'summary.errors > 0',
  },
  triage: {
    category: 'governance',
    failCondition: 'summary.errors > 0',
  },
  health: {
    category: 'governance',
    failCondition: 'summary.errors > 0 OR health level threshold exceeded',
  },
  report: {
    category: 'governance',
    failCondition: 'summary.errors > 0',
  },
  doctor: {
    category: 'governance',
    failCondition: 'summary.fail > 0',
  },
  delta: {
    category: 'governance',
    failCondition: 'summary.errors > 0',
  },
  summary: {
    category: 'governance',
    failCondition: 'summary.errors > 0',
  },

  // -- Usage commands (exit 2 on validation failures, exit 3 on environment errors) --
  scan: {
    category: 'usage',
    failCondition: 'validation failures (invalid options, path boundary)',
  },
  init: {
    category: 'usage',
    failCondition: 'validation failures',
  },
  resolve: {
    category: 'usage',
    failCondition:
      'validation failures, ref/closed conflicts, missing provider',
  },
  adopt: {
    category: 'usage',
    failCondition: 'file write failures, no candidates found',
  },
  show: {
    category: 'usage',
    failCondition: 'ref not found in registry',
  },
  why: {
    category: 'usage',
    failCondition: 'ref not found in registry or source',
  },
  jump: {
    category: 'usage',
    failCondition: 'ref not found in source',
  },
  annotate: {
    category: 'usage',
    failCondition: 'validation failures',
  },
  draft: {
    category: 'usage',
    failCondition: 'validation failures',
  },
  migrate: {
    category: 'usage',
    failCondition: 'validation failures',
  },
  'weekly-report': {
    category: 'usage',
    failCondition: 'output write failures',
  },
  aggregate: {
    category: 'usage',
    failCondition: 'validation failures, missing input files',
  },
  trend: {
    category: 'usage',
    failCondition: 'validation failures, missing snapshot data',
  },

  // -- Usage commands that were previously classified as passthrough --
  // These commands validate CLI arguments and set USAGE_ERROR / ENVIRONMENT_ERROR.
  watch: {
    category: 'usage',
    failCondition:
      'invalid --format value, mutually exclusive options, path boundary violations',
  },
  guide: {
    category: 'usage',
    failCondition: 'unknown --use-case ID',
  },
  fix: {
    category: 'usage',
    failCondition:
      'invalid options (--fail-on, --warn-on, --format), mutually exclusive flags, path boundary violations',
  },
  coach: {
    category: 'usage',
    failCondition:
      'validation failures (invalid --template, --format), environment errors (registry/template file not found)',
  },
  narrative: {
    category: 'usage',
    failCondition: 'validation failures, missing snapshot data',
  },
  recipes: {
    category: 'usage',
    failCondition: 'invalid --level value',
  },
  pitch: {
    category: 'usage',
    failCondition:
      'validation failures (invalid --format), environment errors (registry not found)',
  },
  onboard: {
    category: 'usage',
    failCondition:
      'validation failures (missing --from-pitch, invalid --format, invalid pitch JSON), environment errors (file not found)',
  },

  // -- Passthrough commands (always exit 0) --
  update: {
    category: 'passthrough',
    failCondition: null,
  },
  candidates: {
    category: 'passthrough',
    failCondition: null,
  },
  journal: {
    category: 'passthrough',
    failCondition: null,
  },
  docs: {
    category: 'usage',
    failCondition: 'local README not found and remote fetch failed',
  },
} as const;

/**
 * Get the exit code policy for a command.
 * Returns undefined if the command has no registered policy.
 */
export function getExitCodePolicy(command: string): ExitCodePolicy | undefined {
  return EXIT_CODE_POLICIES[command];
}

/**
 * List all commands that have no exit code policy defined.
 * Used by doctor self-verification to detect missing policies.
 */
export function findMissingPolicies(
  registeredCommands: readonly string[],
): string[] {
  return registeredCommands.filter((cmd) => !(cmd in EXIT_CODE_POLICIES));
}

/**
 * List all policies that reference commands not in the registered list.
 * Used by doctor self-verification to detect stale policies.
 */
export function findStalePolicies(
  registeredCommands: readonly string[],
): string[] {
  const commandSet = new Set(registeredCommands);
  return Object.keys(EXIT_CODE_POLICIES).filter((cmd) => !commandSet.has(cmd));
}
