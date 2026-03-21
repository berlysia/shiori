/**
 * Centralized exit code constants and per-command policy definitions.
 *
 * ADR 027: CLI Exit Code Policy Matrix
 *
 * Phase 1: Constants and policy metadata only.
 * Phase 2: Gradual replacement of inline `process.exitCode = 1` with named constants.
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
 * - usage: exit 1 (future: 2) on invalid CLI arguments
 * - passthrough: always exit 0 (informational or long-running commands)
 */
export type ExitCodeCategory = 'governance' | 'usage' | 'passthrough';

/** Description of when a command exits non-zero */
export interface ExitCodePolicy {
  /** Policy category */
  category: ExitCodeCategory;
  /** Human-readable description of exit 1 trigger condition (null if passthrough) */
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

  // -- Usage commands (exit 1 on validation failures) --
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

  // -- Passthrough commands (always exit 0) --
  update: {
    category: 'passthrough',
    failCondition: null,
  },
  candidates: {
    category: 'passthrough',
    failCondition: null,
  },
  watch: {
    category: 'passthrough',
    failCondition: null,
  },
  journal: {
    category: 'passthrough',
    failCondition: null,
  },
  docs: {
    category: 'passthrough',
    failCondition: null,
  },
  guide: {
    category: 'passthrough',
    failCondition: null,
  },
  fix: {
    category: 'passthrough',
    failCondition: null,
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
