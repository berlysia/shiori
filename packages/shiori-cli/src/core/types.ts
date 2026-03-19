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
export type OutputFormat =
  | 'json'
  | 'markdown'
  | 'sarif'
  | 'summary'
  | 'jsonl'
  | 'diagnostic';

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

/** Report output format */
export type ReportFormat = 'json' | 'markdown' | 'badge' | 'html';

/** Output format for trend command */
export type TrendFormat = 'json' | 'markdown' | 'csv' | 'spark';

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

/** Output format for annotate command */
export type AnnotateFormat = 'text' | 'json';

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
  | 'cli.annotate'
  | 'cli.migrate';

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

/** Output format for generated reports */
export type WeeklyReportFormat = 'markdown' | 'html' | 'json';

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
}

// ── Summary types (EP-0090) ──────────────────────────────────

/** Output format for summary command */
export type SummaryFormat = 'json' | 'markdown';

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

// ── Aggregate types (EP-0093) ─────────────────────────────────

/** Output format for aggregate command */
export type AggregateFormat = 'json' | 'markdown' | 'html';

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
