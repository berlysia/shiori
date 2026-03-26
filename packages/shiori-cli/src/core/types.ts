/**
 * Exhaustive check helper for switch statements.
 * Ensures all cases of a discriminated union are handled at compile time.
 * If a new variant is added to the union, TypeScript will report an error
 * at every switch that doesn't handle it.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

/** Git blame provenance information for an annotation */
export interface ProvenanceInfo {
  /** Author name from git blame */
  author: string;
  /** Author email from git blame */
  authorEmail: string;
  /** Commit date as ISO 8601 string */
  date: string;
  /** Short commit hash (typically 7-8 chars) */
  commitHash: string;
  /** First line of commit message */
  commitSummary: string;
}

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
  /** Git blame provenance (populated by enrichWithProvenance) */
  provenance?: ProvenanceInfo;
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

// ── Kind semantics (ADR 024) ─────────────────────────────────

/**
 * Canonical kind vocabulary for registry entries.
 * - temporary: one-time suppression, expects resolution (expires required)
 * - intentional: justified permanent disable (reason required)
 */
export const REGISTRY_KIND_VALUES = ['temporary', 'intentional'] as const;

/** Semantic kind for a registry entry (derived from REGISTRY_KIND_VALUES) */
export type RegistryKind = (typeof REGISTRY_KIND_VALUES)[number];

/**
 * Resolve the effective kind for a registry entry.
 * Unspecified kind defaults to 'temporary' (ADR 024).
 */
export function resolveKind(kind: string | undefined): RegistryKind {
  if (kind === 'intentional') return 'intentional';
  return 'temporary';
}

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
  'ref-status-closed',
  'intentional-without-reason',
  'temporary-without-expires',
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

/**
 * Canonical list of all output formats for verify/scan commands.
 * Single source of truth — OutputFormat is derived from this array.
 */
export const OUTPUT_FORMATS = [
  'json',
  'markdown',
  'sarif',
  'summary',
  'jsonl',
  'diagnostic',
  'github-summary',
] as const;

/** Output format for verify/scan commands (derived from OUTPUT_FORMATS) */
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

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

/** Canonical list of all delta output formats (derived → DeltaOutputFormat) */
export const DELTA_OUTPUT_FORMATS = ['json', 'markdown'] as const;

/** Delta output format (derived from DELTA_OUTPUT_FORMATS) */
export type DeltaOutputFormat = (typeof DELTA_OUTPUT_FORMATS)[number];

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

/** Numeric ordering for HealthLevel (lower = worse) */
const HEALTH_LEVEL_ORDER: Record<HealthLevel, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};

/**
 * Check if actual level is at or below the threshold level.
 * Level ordering: critical < warning < healthy
 */
export function isAtOrBelowLevel(
  actual: HealthLevel,
  threshold: HealthLevel,
): boolean {
  return HEALTH_LEVEL_ORDER[actual] <= HEALTH_LEVEL_ORDER[threshold];
}

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

/** Per-file annotation density entry for heatmap visualization */
export interface FileBreakdownEntry {
  /** File path (relative to project root) */
  path: string;
  /** Total annotation count in this file */
  annotationCount: number;
  /** Annotations whose ref has expired in registry */
  expiredCount: number;
  /** Annotations whose ref is expiring soon in registry */
  expiringCount: number;
  /** Annotations without expiry issues (includes no-expiry refs) */
  healthyCount: number;
}

/** Per-directory aggregated annotation density */
export interface DirectoryBreakdownEntry {
  /** Directory path */
  directory: string;
  /** Total annotation count across files in this directory */
  annotationCount: number;
  /** Count of files with annotations */
  fileCount: number;
  /** Expired count across files */
  expiredCount: number;
  /** Expiring count across files */
  expiringCount: number;
  /** Healthy count across files */
  healthyCount: number;
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
  /** Per-file annotation density breakdown (EP-0086, optional for backward compat) */
  byFile?: FileBreakdownEntry[];
  /** Per-directory annotation density breakdown (EP-0086, optional for backward compat) */
  byDirectory?: DirectoryBreakdownEntry[];
}

/** Canonical list of all report output formats (derived → ReportFormat) */
export const REPORT_FORMATS = [
  'json',
  'markdown',
  'badge',
  'html',
  'github-summary',
] as const;

/** Report output format (derived from REPORT_FORMATS) */
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** Canonical list of all trend output formats (derived → TrendFormat) */
export const TREND_FORMATS = ['json', 'markdown', 'csv', 'spark'] as const;

/** Output format for trend command (derived from TREND_FORMATS) */
export type TrendFormat = (typeof TREND_FORMATS)[number];

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

/** Canonical list of all doctor output formats (derived → DoctorFormat) */
export const DOCTOR_FORMATS = ['text', 'json'] as const;

/** Output format for doctor command (derived from DOCTOR_FORMATS) */
export type DoctorFormat = (typeof DOCTOR_FORMATS)[number];

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

// ── Maturity stage (EP-0099) ─────────────────────────────────

/**
 * High-level governance maturity stage derived from MaturityLevel.
 * Reduces the 5-level scale to 3 actionable stages for badge display.
 */
export type MaturityStage = 'Discover' | 'Adopt' | 'Enforce';

/**
 * Map a MaturityLevel (0-4) to a MaturityStage.
 *
 * - Level 0 → Discover: project has not yet set up shiori
 * - Level 1-2 → Adopt: basic setup or CI integration in progress
 * - Level 3-4 → Enforce: visible governance or continuous monitoring
 */
export function maturityStageFromLevel(level: MaturityLevel): MaturityStage {
  if (level === 0) return 'Discover';
  if (level <= 2) return 'Adopt';
  return 'Enforce';
}

// ── Chronicle types (EP-0048) ────────────────────────────────

/**
 * Event types that can appear in a chronicle timeline.
 * - 'introduced': When the annotation was first committed (from provenance)
 * - 'expires': When the annotation is scheduled to expire (from source/registry)
 * - 'expired': When the annotation's expiration date has passed
 * - 'status-closed': When the referenced ticket/issue was closed (from ref-status)
 */
export type ChronicleEventType =
  | 'introduced'
  | 'expires'
  | 'expired'
  | 'status-closed';

/** A single event in an annotation's timeline */
export interface ChronicleEvent {
  /** Event type */
  type: ChronicleEventType;
  /** ISO 8601 date string (YYYY-MM-DD or full ISO) */
  date: string;
  /** Human-readable description of the event */
  label: string;
}

/** Chronicle entry for a single ref — aggregates timeline events */
export interface ChronicleEntry {
  /** The tracking reference (e.g. "SUP-1234") */
  ref: string;
  /** All source locations where this ref appears */
  locations: Array<{ file: string; line: number }>;
  /** Timeline events sorted by date (oldest first) */
  events: ChronicleEvent[];
  /** Current ref status from external command (undefined if unavailable) */
  currentStatus?: RefStatusValue;
  /** Registry owner (if present) */
  owner?: string;
  /** Registry kind (if present) */
  kind?: string;
}

/** Ref status values (re-exported from ref-status for convenience) */
export type RefStatusValue = 'open' | 'closed' | 'unknown';

/** Options for building a chronicle */
export interface BuildChronicleOptions {
  /** Annotations (ideally enriched with provenance) */
  annotations: ShioriAnnotation[];
  /** Registry data */
  registry: Registry;
  /** Ref status map (from external command, may be undefined) */
  refStatuses?: Map<string, RefStatusValue>;
  /** Reference date for expiration checks (defaults to current date) */
  now?: Date;
}

/** Result of building a chronicle */
export interface ChronicleResult {
  /** Chronicle entries sorted by ref */
  entries: ChronicleEntry[];
  /** Summary statistics */
  summary: {
    /** Total unique refs processed */
    totalRefs: number;
    /** Refs with provenance data */
    withProvenance: number;
    /** Refs with ref-status data */
    withRefStatus: number;
    /** Refs with expiration dates */
    withExpires: number;
  };
}

// ── Annotate types (EP-0058) ─────────────────────────────────

/** Canonical list of all annotate output formats (derived → AnnotateFormat) */
export const ANNOTATE_FORMATS = ['text', 'json'] as const;

/** Output format for annotate command (derived from ANNOTATE_FORMATS) */
export type AnnotateFormat = (typeof ANNOTATE_FORMATS)[number];

/** Options for planning an annotation */
export interface AnnotateOptions {
  /** Target file path (relative to cwd) */
  file: string;
  /** Target line number (1-based) */
  line: number;
  /** Annotation ref (e.g. "SUP-1234") */
  ref: string;
  /** Optional reason text */
  reason?: string;
  /** Optional expiration date */
  expires?: string;
  /** Optional kind (registry-only, not in source comment) */
  kind?: string;
  /** Existing file content */
  content: string;
  /** Existing registry */
  existingRegistry: Registry;
}

/** Result of planning an annotation */
export interface AnnotateResult {
  /** Modified file content */
  content: string;
  /** Generated registry entry */
  registryEntry: RegistryEntry;
  /** The ref key for the registry */
  ref: string;
  /** Whether a new line was inserted (vs modifying existing line) */
  lineInserted: boolean;
  /** Warnings (e.g. line too long) */
  warnings: string[];
}

// ── Health types (EP-0024) ───────────────────────────────────

// ── Resolve types (promoted from commands/resolve.ts) ────────

/** Line-level action for resolving an annotation */
export interface ResolveAction {
  /** Target ref */
  ref: string;
  /** Source file path (relative) */
  file: string;
  /** Line number in source file */
  line: number;
  /** Action type: remove annotation portion or entire line */
  type: 'remove-annotation' | 'remove-line';
  /** Original line content */
  originalLine: string;
  /** Modified line content (null = remove entire line) */
  modifiedLine: string | null;
}

/** Info about an annotation skipped due to stale scan result */
export interface SkippedAnnotation {
  /** Source file path */
  file: string;
  /** Line number from scan result */
  line: number;
  /** Why it was skipped */
  reason: string;
}

/** Result of resolve planning */
export interface ResolveResult {
  /** Source change actions */
  actions: ResolveAction[];
  /** Refs to remove from registry */
  registryRemovals: string[];
  /** Number of unique files affected */
  filesAffected: number;
  /** Annotations skipped due to stale scan data */
  skipped: SkippedAnnotation[];
}

/** Per-ref result in bulk resolve */
export interface BulkResolveRefEntry {
  /** The ref that was resolved */
  ref: string;
  /** Resolve result for this ref */
  result: ResolveResult;
}

/** Aggregated result of bulk resolve for multiple refs */
export interface BulkResolveResult {
  /** Per-ref results for preview */
  perRef: BulkResolveRefEntry[];
  /** All actions merged across refs — use this for apply to avoid line offset issues */
  allActions: ResolveAction[];
  /** All registry removals (deduplicated) */
  allRegistryRemovals: string[];
  /** Total unique files affected */
  totalFilesAffected: number;
  /** All skipped annotations */
  allSkipped: SkippedAnnotation[];
}

/** Canonical list of all resolve output formats (derived → ResolveOutputFormat) */
export const RESOLVE_OUTPUT_FORMATS = ['text', 'json'] as const;

/** Output format for resolve --closed (derived from RESOLVE_OUTPUT_FORMATS) */
export type ResolveOutputFormat = (typeof RESOLVE_OUTPUT_FORMATS)[number];

// ── File edit types ──────────────────────────────────────────

/** Result of applying edits to file content (shared by resolve/migrate) */
export interface FileEditResult {
  /** Updated file content */
  content: string;
  /** Number of lines modified */
  modifiedLines: number;
  /** Warnings (e.g. line too long) */
  warnings: string[];
}

// ── Journal types (EP-0081) ──────────────────────────────────

/** CLI operation types that generate journal entries */
export type CliOperationType =
  | 'cli.resolve'
  | 'cli.resolve.bulk'
  | 'cli.adopt'
  | 'cli.update'
  | 'cli.fix'
  | 'cli.annotate'
  | 'cli.migrate'
  | 'cli.triage-wizard';

/**
 * CLI journal entry for tracking registry-modifying operations.
 *
 * Uses `source: 'cli'` discriminant for future unification with daemon journal
 * entries (`source: 'daemon'`, `webhook.*` event_type namespace).
 */
export interface CliJournalEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Discriminant for CLI vs daemon journal entries */
  source: 'cli';
  /** Operation type in `cli.*` namespace */
  event_type: CliOperationType;
  /** Refs affected by this operation */
  refs: string[];
  /** Whether the operation succeeded */
  success: boolean;
  /** Number of registry entries added (null on failure or N/A) */
  entries_added: number | null;
  /** Number of registry entries removed (null on failure or N/A) */
  entries_removed: number | null;
}

/** Canonical list of all journal output formats (derived → JournalFormat) */
export const JOURNAL_FORMATS = ['json', 'table'] as const;

/** Output format for journal command (derived from JOURNAL_FORMATS) */
export type JournalFormat = (typeof JOURNAL_FORMATS)[number];

// ── Journal Velocity types (EP-0080) ─────────────────────────

/** Time bucket granularity for journal velocity aggregation */
export type VelocityBucket = 'hour' | 'day' | 'week';

/**
 * A single data point in a journal-derived velocity trend.
 *
 * Unlike TrendPoint (which captures governance state snapshots),
 * JournalVelocityPoint captures operation flow rates per time bucket.
 */
export interface JournalVelocityPoint {
  /** ISO 8601 bucket start timestamp (truncated to bucket boundary) */
  bucket: string;
  /** Total operations in this bucket */
  operations: number;
  /** Successful operations */
  successes: number;
  /** Failed operations */
  failures: number;
  /** Total entries added across all operations in this bucket */
  entriesAdded: number;
  /** Total entries removed across all operations in this bucket */
  entriesRemoved: number;
  /** Net change: entriesAdded - entriesRemoved */
  netChange: number;
  /** Unique refs touched in this bucket */
  refsCount: number;
}

/** Velocity direction derived from net change trend */
export type VelocityDirection = 'growing' | 'shrinking' | 'neutral';

/** Result of computing a journal velocity trend */
export interface JournalVelocityResult {
  /** Ordered data points (oldest first) */
  points: JournalVelocityPoint[];
  /** Summary of the velocity trend */
  summary: {
    /** Number of buckets */
    count: number;
    /** Oldest bucket */
    oldest: string;
    /** Newest bucket */
    newest: string;
    /** Total operations across all buckets */
    totalOperations: number;
    /** Overall success rate (0-100) */
    successRate: number;
    /** Net change across all buckets */
    totalNetChange: number;
    /** Direction: growing (net positive), shrinking (net negative), neutral */
    direction: VelocityDirection;
  };
}

// ── Weekly Report types (EP-0084) ────────────────────────────

/** Report preset determines the data scope and time range */
export type WeeklyReportPreset = 'weekly' | 'health' | 'custom';

/** Canonical list of all weekly report output formats (derived → WeeklyReportFormat) */
export const WEEKLY_REPORT_FORMATS = ['markdown', 'html', 'json'] as const;

/** Output format for generated reports (derived from WEEKLY_REPORT_FORMATS) */
export type WeeklyReportFormat = (typeof WEEKLY_REPORT_FORMATS)[number];

/**
 * Options for the report generation pipeline.
 */
export interface WeeklyReportOptions {
  /** Report preset (determines default time range and sections) */
  preset: WeeklyReportPreset;
  /** Output format */
  format: WeeklyReportFormat;
  /** Start date filter (ISO 8601 date string, inclusive) */
  since?: string;
  /** End date filter (ISO 8601 date string, inclusive) */
  until?: string;
  /** Output file path (stdout if omitted) */
  output?: string;
  /** Working directory */
  cwd: string;
}

/**
 * Collected raw data from journal, registry, and trend sources.
 * Output of the DataCollector layer.
 */
export interface CollectedReportData {
  /** Journal entries within the time range */
  journalEntries: CliJournalEntry[];
  /** Current registry snapshot */
  registry: Registry;
  /** Governance report snapshot */
  reportResult: ReportResult;
  /** Journal velocity data */
  velocity: JournalVelocityResult;
  /** Time range used for collection */
  period: {
    since: string;
    until: string;
  };
}

/**
 * Activity summary metrics derived from journal data.
 */
export interface ActivitySummary {
  /** Total operations in the period */
  totalOperations: number;
  /** Successful operations */
  successfulOperations: number;
  /** Failed operations */
  failedOperations: number;
  /** Success rate as percentage (0-100) */
  successRate: number;
  /** Net registry entry change */
  netChange: number;
  /** Unique refs touched */
  uniqueRefs: string[];
  /** Operations broken down by event type */
  byEventType: Record<string, number>;
}

/**
 * Analyzed report metrics.
 * Output of the Analyzer layer.
 */
export interface AnalyzedReportMetrics {
  /** Report generation timestamp */
  timestamp: string;
  /** Time period covered */
  period: {
    since: string;
    until: string;
  };
  /** Activity summary from journal */
  activity: ActivitySummary;
  /** Current governance health snapshot */
  health: {
    level: HealthLevel;
    score: number;
    summary: string;
  };
  /** Registry overview */
  registryOverview: {
    totalEntries: number;
    totalAnnotations: number;
    totalCandidates: number;
    totalIssues: number;
  };
  /** Key insights from governance report */
  insights: ReportInsight[];
  /** Velocity summary */
  velocity: JournalVelocityResult['summary'];
  /** Governance score trend from accumulated snapshots (EP-0144) */
  trend?: TrendResult['summary'];
}

// ── Summary types (EP-0090) ──────────────────────────────────

/** Canonical list of all summary output formats (derived → SummaryFormat) */
export const SUMMARY_FORMATS = ['json', 'markdown', 'pulse', 'slack'] as const;

/** Output format for summary command (derived from SUMMARY_FORMATS) */
export type SummaryFormat = (typeof SUMMARY_FORMATS)[number];

/** Canonical list of all health output formats (derived → HealthFormat) */
export const HEALTH_FORMATS = ['json', 'summary', 'github-summary'] as const;

/** Health output format (derived from HEALTH_FORMATS) */
export type HealthFormat = (typeof HEALTH_FORMATS)[number];

/** Canonical list of all triage output formats (derived → TriageFormat) */
export const TRIAGE_FORMATS = ['json', 'markdown'] as const;

/** Triage output format (derived from TRIAGE_FORMATS) */
export type TriageFormat = (typeof TRIAGE_FORMATS)[number];

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
  /** Actionable prescriptions derived from health analysis (EP-0104) */
  prescriptions?: HealthPrescription[];
}

/** Urgency level for health prescriptions */
export type PrescriptionUrgency = 'critical' | 'recommended' | 'suggestion';

/** Action type for programmatic dispatch of prescriptions (EP-0112) */
export type PrescriptionActionType =
  | 'update'
  | 'triage'
  | 'verify'
  | 'doctor'
  | 'candidates';

/** A single actionable prescription for improving governance health (EP-0104) */
export interface HealthPrescription {
  /** Urgency level of this prescription */
  urgency: PrescriptionUrgency;
  /** Human-readable summary of what to do */
  message: string;
  /** CLI command to run (copy-paste ready) */
  command: string;
  /** Expected score improvement if this prescription is addressed */
  scoreImpact: number;
  /** Action type for programmatic dispatch (EP-0112) */
  actionType: PrescriptionActionType;
}

// ── Demo output types (EP-0174) ──────────────────────────────

/** Result of running the scan --demo pipeline */
export interface DemoResult {
  scanResult: ScanResult;
  verifyResult: VerifyResult;
  healthScore: number;
  healthLevel: HealthLevel;
  demoDir: string;
}

/** Canonical list of demo output formats (derived → DemoOutputFormat) */
export const DEMO_OUTPUT_FORMATS = [
  'json',
  'markdown',
  'github-summary',
] as const;

/** Output format for scan --demo (derived from DEMO_OUTPUT_FORMATS) */
export type DemoOutputFormat = (typeof DEMO_OUTPUT_FORMATS)[number];

// ── Aggregate types (EP-0093) ─────────────────────────────────

/** Canonical list of all aggregate output formats (derived → AggregateFormat) */
export const AGGREGATE_FORMATS = ['json', 'markdown', 'html'] as const;

/** Output format for aggregate command (derived from AGGREGATE_FORMATS) */
export type AggregateFormat = (typeof AGGREGATE_FORMATS)[number];

/** Per-repository row in the aggregate report */
export interface AggregateRepositoryEntry {
  /** Repository identifier (from summary --repository or fallback filename) */
  repository: string;
  /** Health score (0-100) */
  score: number;
  /** Health level */
  level: HealthLevel;
  /** Issue counts */
  issues: {
    total: number;
    errors: number;
    warnings: number;
  };
  /** Expired annotation count */
  expired: number;
  /** Expiring-soon annotation count */
  expiringSoon: number;
}

// ── Fix types (EP-0118) ──────────────────────────────────────

/** A single automatable fix action */
export interface FixAction {
  /** Action type. Phase 1: "update" only; extensible for future actions */
  type: 'update';
  /** Human-readable description of what this action does */
  description: string;
  /** Refs affected by this action */
  refs: string[];
}

/** A manual suggestion (not automatable) */
export interface ManualSuggestion {
  /** Issue type that triggers this suggestion */
  issueType: VerifyIssueType;
  /** Number of issues of this type */
  count: number;
  /** Suggested CLI command */
  command: string;
  /** Human-readable message */
  message: string;
}

/** Plan output (dry-run result) */
export interface FixPlan {
  /** Automatable actions to execute */
  actions: FixAction[];
  /** Manual suggestions (require human judgment) */
  manualSuggestions: ManualSuggestion[];
  /** Summary counts */
  summary: { automatable: number; manual: number };
}

/** Result of applying fix actions */
export interface FixApplyResult {
  /** Actions that were applied */
  applied: FixAction[];
  /** Registry changes made */
  registryChanges: { added: string[] };
  /** Health score before fix */
  scoreBefore: number;
  /** Health score after fix */
  scoreAfter: number;
}

/** Canonical list of all fix output formats (derived → FixFormat) */
export const FIX_FORMATS = ['text', 'json', 'markdown'] as const;

/** Output format for fix command (derived from FIX_FORMATS) */
export type FixFormat = (typeof FIX_FORMATS)[number];

// ── Candidates types ─────────────────────────────────────────

/** Canonical list of all candidates output formats (derived → CandidatesOutputFormat) */
export const CANDIDATES_OUTPUT_FORMATS = ['json', 'markdown'] as const;

/** Candidates output format (derived from CANDIDATES_OUTPUT_FORMATS) */
export type CandidatesOutputFormat = (typeof CANDIDATES_OUTPUT_FORMATS)[number];

// ── Narrative types (EP-0146) ─────────────────────────────────

/** Canonical list of all narrative output formats (derived → NarrativeFormat) */
export const NARRATIVE_FORMATS = ['json', 'markdown'] as const;

/** Output format for narrative command (derived from NARRATIVE_FORMATS) */
export type NarrativeFormat = (typeof NARRATIVE_FORMATS)[number];

// ── SnapshotDiff types (EP-0146) ──────────────────────────────

/** A numeric change in a single metric category */
export interface CategoryDelta {
  /** Metric name (e.g. "annotations", "issues") */
  category: string;
  /** Value in the base snapshot */
  base: number;
  /** Value in the head snapshot */
  head: number;
  /** Absolute change: head - base */
  delta: number;
}

/** Health level transition between two snapshots */
export interface HealthTransition {
  /** Base health level */
  base: HealthLevel;
  /** Head health level */
  head: HealthLevel;
  /** Base health score */
  baseScore: number;
  /** Head health score */
  headScore: number;
  /** Score change: head - base */
  scoreDelta: number;
  /** Transition direction */
  direction: TrendDirection;
}

/** Result of comparing two report snapshots */
export interface SnapshotDiff {
  /** Base snapshot timestamp */
  baseTimestamp: string;
  /** Head snapshot timestamp */
  headTimestamp: string;
  /** Per-category deltas */
  categories: CategoryDelta[];
  /** Health level transition */
  health: HealthTransition;
}

// ── Narrative result types (EP-0146) ──────────────────────────

/** A single observation about a metric change */
export interface NarrativeObservation {
  /** Category that changed */
  category: string;
  /** Human-readable description of the change */
  message: string;
  /** Magnitude of importance (higher = more significant) */
  significance: number;
}

/** Result of computing a narrative */
export interface NarrativeResult {
  /** Headline summary of the governance transition */
  headline: string;
  /** Health transition description */
  healthSummary: string;
  /** Individual observations about metric changes, sorted by significance */
  observations: NarrativeObservation[];
  /** Base snapshot timestamp */
  baseTimestamp: string;
  /** Head snapshot timestamp */
  headTimestamp: string;
  /** Underlying diff data (for JSON output) */
  diff: SnapshotDiff;
}

// ── Pitch types (EP-0177) ─────────────────────────────────────

/** Canonical list of all pitch output formats (derived → PitchFormat) */
export const PITCH_FORMATS = ['json', 'markdown'] as const;

/** Output format for pitch command (derived from PITCH_FORMATS) */
export type PitchFormat = (typeof PITCH_FORMATS)[number];

/**
 * Canonical list of all pitch highlight categories.
 * Single source of truth — PitchHighlightCategory is derived from this array.
 */
export const PITCH_HIGHLIGHT_CATEGORIES = [
  'health',
  'coverage',
  'trend',
  'risk',
  'expired',
  'expiring',
] as const;

/** Pitch highlight category (derived from PITCH_HIGHLIGHT_CATEGORIES) */
export type PitchHighlightCategory =
  (typeof PITCH_HIGHLIGHT_CATEGORIES)[number];

/** A single data-driven talking point for governance adoption pitch */
export interface PitchHighlight {
  /** Emoji indicator for visual scanning */
  emoji: string;
  /** Category of this highlight */
  category: PitchHighlightCategory;
  /** Human-readable summary of this highlight */
  message: string;
}

/** Result of computing a governance adoption pitch */
export interface PitchResult {
  /** ISO timestamp when pitch was generated */
  timestamp: string;
  /** Team/project name (from config or fallback to cwd basename) */
  teamName: string;
  /** One-line pitch summary headline */
  headline: string;
  /** Current governance health snapshot */
  health: {
    score: number;
    level: HealthLevel;
  };
  /** Key data-driven highlights for the pitch */
  highlights: PitchHighlight[];
  /** Governance trend (when history is available) */
  trend?: {
    direction: TrendDirection;
    scoreChange: number;
    dataPoints: number;
  };
  /** Recommended next steps (copy-paste ready commands) */
  nextSteps: string[];
  /** Machine-readable recommended actions for onboard pipeline (EP-0179) */
  recommendedActions?: RecommendedAction[];
}

// ── Onboard types (EP-0179) ─────────────────────────────────

/**
 * Canonical list of onboard action types.
 * Single source of truth — OnboardActionType is derived from this array.
 */
export const ONBOARD_ACTION_TYPES = [
  'triage',
  'update',
  'adopt',
  'check',
  'health',
] as const;

/** Onboard action type (derived from ONBOARD_ACTION_TYPES) */
export type OnboardActionType = (typeof ONBOARD_ACTION_TYPES)[number];

/** Machine-readable recommended action generated from pitch analysis */
export interface RecommendedAction {
  /** Action type corresponding to a shiori subcommand */
  action: OnboardActionType;
  /** Full command string to execute */
  command: string;
  /** Command arguments (excluding the subcommand name) */
  args: string[];
  /** Human-readable reason for this recommendation */
  reason: string;
  /** Execution priority (lower = higher priority, 1-based) */
  priority: number;
}

/** Output formats for onboard command */
export const ONBOARD_FORMATS = ['text', 'json', 'markdown', 'slack'] as const;

/** Output format for onboard command (derived from ONBOARD_FORMATS) */
export type OnboardFormat = (typeof ONBOARD_FORMATS)[number];

// ── Aggregate types ──────────────────────────────────────────

/** Result of aggregating multiple repository summaries */
export interface AggregateResult {
  /** ISO timestamp when the aggregate was generated */
  timestamp: string;
  /** Per-repository entries (sorted by score ascending, then repository name) */
  repositories: AggregateRepositoryEntry[];
  /** Organization-level overall metrics */
  overall: {
    /** Number of repositories aggregated */
    repositoryCount: number;
    /** Simple average of all repository scores */
    averageScore: number;
    /** Repository with the lowest score (lexicographically smallest on tie) */
    worstRepository: string;
    /** Lowest score among all repositories */
    worstScore: number;
    /** Sum of issues across all repositories */
    totalIssues: number;
    /** Sum of errors across all repositories */
    totalErrors: number;
    /** Sum of warnings across all repositories */
    totalWarnings: number;
  };
}
