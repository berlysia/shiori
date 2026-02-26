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

/** Verify issue type */
export type VerifyIssueType =
  | 'missing-in-registry'
  | 'unused-in-source'
  | 'expired'
  | 'syntax-error'
  | 'ref-format'
  | 'ref-collision'
  | 'unrouted-ref'
  | 'registry-routing-mismatch';

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
