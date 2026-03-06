/** A single annotation extracted from source code */
export interface ShioriAnnotation {
  /** Reference ID. e.g. "SUP-1234", "ADR:0007". Empty string if untracked or draft */
  ref: string;
  /** Lint rule name. e.g. "plugin/baseline", "@typescript-eslint/no-explicit-any" */
  rule?: string;
  /** Expiration date (YYYY-MM-DD or YYYY-MM) */
  expires?: string;
  /** Reason text */
  reason?: string;
  /** Whether the annotation has an explicit annotation marker in source */
  tagged: boolean;
  /** Whether the annotation is explicitly ignored via the ignore directive */
  ignored: boolean;
  /** Parser syntax errors, if any */
  syntaxErrors?: string[];
  /** Source location */
  location: {
    file: string;
    line: number;
  };
}

/** Candidate pattern category (tool name like 'eslint', 'stylelint', 'typescript' or keyword like 'todo', 'fixme') */
export type CandidatePattern = string;

/** A candidate comment detected by pattern matching (no annotation marker) */
export interface ShioriCandidate {
  /** Detection pattern category (tool name or keyword) */
  pattern: CandidatePattern;
  /** Directive type (e.g. 'disable-next-line', 'ts-ignore') */
  directive?: string;
  /** Lint rule name (for lint tool patterns) */
  rule?: string;
  /** Comment text (for TODO/FIXME/HACK/XXX) */
  text?: string;
  /** Source location */
  location: {
    file: string;
    line: number;
  };
}

/** Result of scanning source files for annotations and candidates */
export interface ScanResult {
  /** Extracted annotations (stably sorted by ref, location.file, location.line) */
  annotations: ShioriAnnotation[];
  /** Detected candidates (sorted by location.file, location.line) */
  candidates: ShioriCandidate[];
  /** Number of files scanned */
  filesScanned: number;
}

/** A single registry entry */
export interface RegistryEntry {
  reason: string;
  target: string | string[];
  expires: string | undefined;
  ticket: string | undefined;
  owner: string | undefined;
  notes: string | undefined;
  kind: string | undefined;
}

/** Full registry keyed by annotation ref */
export type Registry = Record<string, RegistryEntry>;

/**
 * Canonical list of all verify issue types.
 * Single source of truth — VerifyIssueType is derived from this array.
 */
export const VERIFY_ISSUE_TYPES = [
  'missing-in-registry',
  'unused-in-source',
  'expired',
  'syntax-error',
  'ref-format',
  'ref-collision',
  'unrouted-ref',
  'registry-routing-mismatch',
  'expiring-soon',
] as const;

/** Verify issue type (derived from VERIFY_ISSUE_TYPES) */
export type VerifyIssueType = (typeof VERIFY_ISSUE_TYPES)[number];

/** Issue severity */
export type IssueSeverity = 'error' | 'warning';

/** A single verification issue */
export interface VerifyIssue {
  type: VerifyIssueType;
  severity: IssueSeverity;
  ref: string;
  message: string;
  file: string | undefined;
  line: number | undefined;
}

/** Output format for verify/scan commands */
export type OutputFormat = 'json' | 'markdown' | 'sarif' | 'summary' | 'jsonl';

/** Verify command output */
export interface VerifyResult {
  timestamp: string;
  issues: VerifyIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    byType: Record<VerifyIssueType, number>;
  };
  scannedRecords: number;
  registryEntries: number;
}

// ── Delta types ──────────────────────────────────────────────

/** How an annotation changed between base and head */
export type DeltaKind = 'added' | 'removed' | 'unchanged';

/** A single annotation's delta record */
export interface AnnotationDelta {
  kind: DeltaKind;
  ref: string;
  /** Annotation from the head scan (present for 'added' and 'unchanged') */
  head?: ShioriAnnotation;
  /** Annotation from the base scan (present for 'removed' and 'unchanged') */
  base?: ShioriAnnotation;
}

/** Summary counts for a delta computation */
export interface DeltaSummary {
  added: number;
  removed: number;
  unchanged: number;
  /** Net change: added - removed */
  net: number;
}

/** Result of computing a delta between two scan results */
export interface DeltaResult {
  deltas: AnnotationDelta[];
  summary: DeltaSummary;
}

/** Options for computing a delta between two scan results */
export interface ComputeDeltaOptions {
  base: ScanResult;
  head: ScanResult;
}

// ── Trend types ──────────────────────────────────────────────

/** A single data point in the governance score trend */
export interface TrendPoint {
  /** ISO timestamp from the ReportResult */
  timestamp: string;
  /** Health score (0-100) */
  score: number;
  /** Health level */
  level: HealthLevel;
  /** Total number of issues */
  issues: number;
  /** Total tracked annotations */
  annotations: number;
  /** Total untracked candidates */
  candidates: number;
  /** Total registry entries */
  registryEntries: number;
}

/** Score change direction */
export type TrendDirection = 'improving' | 'declining' | 'stable';

/** Result of computing a governance score trend */
export interface TrendResult {
  /** Ordered data points (oldest first) */
  points: TrendPoint[];
  /** Summary of the trend */
  summary: {
    /** Number of data points */
    count: number;
    /** Oldest timestamp */
    oldest: string;
    /** Newest timestamp */
    newest: string;
    /** Latest score */
    latestScore: number;
    /** Score change from first to last point */
    scoreChange: number;
    /** Overall direction */
    direction: TrendDirection;
    /** Minimum score in the range */
    minScore: number;
    /** Maximum score in the range */
    maxScore: number;
  };
}

/** Health level for report */
export type HealthLevel = 'healthy' | 'warning' | 'critical';

// ── Report types (EP-0020: promoted from commands/report.ts) ─────

/** A single governance insight */
export interface ReportInsight {
  /** Severity of the insight */
  level: 'info' | 'warning' | 'error';
  /** Short label for the insight */
  label: string;
  /** Descriptive message */
  message: string;
}

/** Aggregated breakdown entry */
export interface BreakdownEntry {
  key: string;
  count: number;
}

/** Report output */
export interface ReportResult {
  /** ISO timestamp when report was generated */
  timestamp: string;
  /** Overall governance health assessment */
  health: {
    level: HealthLevel;
    /** Health score 0-100 (100 = fully healthy) */
    score: number;
    /** Short summary of governance state */
    summary: string;
  };
  /** Numeric totals */
  totals: {
    annotations: number;
    candidates: number;
    registryEntries: number;
    issues: number;
    errors: number;
    warnings: number;
  };
  /** Key governance insights (actionable items) */
  insights: ReportInsight[];
  /** Issue breakdown by type */
  byType: Record<VerifyIssueType, number>;
  /** Annotation breakdown by rule */
  byRule: BreakdownEntry[];
  /** Registry breakdown by kind */
  byKind: BreakdownEntry[];
  /** Registry breakdown by owner */
  byOwner: BreakdownEntry[];
  /** Underlying verify result (for downstream consumers) */
  verifyResult: VerifyResult;
}

/** Report output format */
export type ReportFormat = 'json' | 'markdown' | 'badge';

/** Output format for trend command */
export type TrendFormat = 'json' | 'markdown' | 'csv';

// ── CI template types ────────────────────────────────────────

/** Available CI template kinds */
export type CiTemplateKind =
  | 'basic'
  | 'sarif'
  | 'delta-pr-comment'
  | 'checks-gate'
  | 'badge'
  | 'badge-gist';

// ── Upgrade types (promoted from commands/doctor/upgrade.ts) ─

/** Kind of upgrade action that maps to an executable operation */
export type UpgradeActionKind =
  | 'init'
  | 'ci-workflow'
  | 'badge-workflow'
  | 'snapshot-setup'
  | 'scheduled-workflow';

/** Badge workflow mode: artifacts-only (no secrets) or gist (requires PAT + Gist ID) */
export type BadgeMode = 'artifacts' | 'gist';

/** A concrete upgrade step the wizard can execute */
export interface UpgradeAction {
  /** Action identifier */
  kind: UpgradeActionKind;
  /** Target maturity level this action contributes to */
  targetLevel: MaturityLevel;
  /** Human-readable title */
  title: string;
  /** Detailed description of what this action does */
  description: string;
  /** CLI command equivalent (for display and --yes mode logging) */
  command: string;
  /** CI template kind (only for ci-workflow / badge-workflow actions) */
  ciTemplateKind?: CiTemplateKind;
  /** Badge mode (only for badge-workflow actions) */
  badgeMode?: BadgeMode;
}

/** Result of upgrade plan generation */
export interface UpgradePlan {
  /** Current maturity level */
  currentLevel: MaturityLevel;
  /** Target maturity level after all actions */
  targetLevel: MaturityLevel;
  /** Ordered list of upgrade actions */
  actions: UpgradeAction[];
}

/** Result of a single action execution */
export interface UpgradeActionResult {
  kind: UpgradeActionKind;
  /** Whether the action was executed (false = skipped/already done) */
  executed: boolean;
  /** Human-readable status message */
  message: string;
}

/** Overall upgrade execution result */
export interface UpgradeResult {
  /** The plan that was executed */
  plan: UpgradePlan;
  /** Results for each action */
  actionResults: UpgradeActionResult[];
  /** Maturity level after upgrade (re-assessed) */
  newLevel: MaturityLevel;
}

// ── Doctor types (EP-0026) ───────────────────────────────────

/** Status of a single doctor diagnostic check */
export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

/** A single diagnostic check result */
export interface DoctorCheck {
  /** Short identifier for the check (e.g. "config", "registry", "node-version") */
  name: string;
  /** Human-readable label */
  label: string;
  /** Check result */
  status: DoctorCheckStatus;
  /** Descriptive message explaining the result */
  message: string;
  /** Suggested fix (shown when --fix is used or status is not pass) */
  fix?: string;
}

/** Result of running all doctor diagnostic checks */
export interface DoctorResult {
  /** Individual check results */
  checks: DoctorCheck[];
  /** Summary counts */
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  /** Maturity assessment (present when --maturity or --upgrade is used) */
  maturity?: MaturityResult;
  /** Upgrade plan/result (present when --upgrade is used) */
  upgrade?: UpgradeResult;
}

/** Output format for doctor command */
export type DoctorFormat = 'text' | 'json';

// ── Maturity types (EP-0040) ─────────────────────────────────

/** Governance maturity level (0-4) */
export type MaturityLevel = 0 | 1 | 2 | 3 | 4;

/** Description for each maturity level */
export const MATURITY_LEVEL_LABELS: Record<MaturityLevel, string> = {
  0: 'Not initialized',
  1: 'Basic setup',
  2: 'CI integrated',
  3: 'Visible governance',
  4: 'Continuous monitoring',
};

/** A signal detected (or not) contributing to maturity level assessment */
export interface MaturitySignal {
  /** Signal identifier */
  name: string;
  /** Human-readable label */
  label: string;
  /** Whether this signal was detected */
  detected: boolean;
  /** Detail message */
  message: string;
}

/** Next action recommendation for advancing to the next maturity level */
export interface MaturityNextAction {
  /** Target maturity level */
  targetLevel: MaturityLevel;
  /** Recommended command or action */
  action: string;
  /** Description of what this achieves */
  description: string;
}

/** Result of a maturity level assessment */
export interface MaturityResult {
  /** Current maturity level (0-4) */
  level: MaturityLevel;
  /** Human-readable label for the current level */
  levelLabel: string;
  /** Detected signals */
  signals: MaturitySignal[];
  /** Recommended next actions to reach higher levels */
  nextActions: MaturityNextAction[];
}

// ── Health types (EP-0024) ───────────────────────────────────

/** Health output format */
export type HealthFormat = 'json' | 'summary';

/** Triage output format */
export type TriageFormat = 'json' | 'markdown';

/** Health command result — synthesises report + optional trend */
export interface HealthResult {
  /** ISO timestamp when health was computed */
  timestamp: string;
  /** Overall governance health (from report) */
  health: {
    level: HealthLevel;
    score: number;
    summary: string;
  };
  /** Issue counts */
  issues: {
    total: number;
    errors: number;
    warnings: number;
  };
  /** Expiration counts from verify byType */
  expiring: {
    expired: number;
    expiringSoon: number;
  };
  /** Key governance insights (from report) */
  insights: ReportInsight[];
  /** Trend summary (present when --history is supplied) */
  trend?: TrendResult['summary'];
}
