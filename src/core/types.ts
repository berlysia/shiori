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

/** Output format for trend command */
export type TrendFormat = 'json' | 'markdown' | 'csv';
