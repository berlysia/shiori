/** Annotation source type */
export type AnnotationSource = 'comment' | 'native' | 'external';

/** Default annotation verbs */
export const DEFAULT_VERBS = ['waive', 'note', 'risk', 'migrate'] as const;

/** A single annotation record extracted from source code */
export interface AnnotationRecord {
  /** ID extracted from verb(...). e.g. "SUP-1234" */
  id: string;
  /** Annotation verb. e.g. "waive", "note", "risk", "migrate" */
  verb: string;
  /** Tool that owns the suppressed rule. e.g. "stylelint", "eslint" */
  tool?: string;
  /** Subject (rule name). e.g. "plugin/baseline", "@typescript-eslint/no-explicit-any" */
  subject?: string;
  /** File path (relative) */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** Source type */
  source: AnnotationSource;
  /** Raw comment string */
  raw: string;
  /** Meta information */
  meta: Record<string, unknown>;
  /** Provider name. e.g. "CommentProvider" */
  provider: string;
}

/** Ledger entry kind */
export type LedgerKind = 'stylelint' | 'eslint' | 'mixed';

/** A single ledger entry */
export interface LedgerEntry {
  reason: string;
  target: string | string[];
  expires: string | undefined;
  ticket: string | undefined;
  owner: string | undefined;
  notes: string | undefined;
  kind: LedgerKind | undefined;
  verb: string | undefined;
}

/** Full ledger keyed by annotation ID */
export type Ledger = Record<string, LedgerEntry>;

/** Verify issue type */
export type VerifyIssueType =
  | 'missing-in-ledger'
  | 'unused-in-source'
  | 'expired'
  | 'malformed';

/** Issue severity */
export type IssueSeverity = 'error' | 'warning';

/** A single verification issue */
export interface VerifyIssue {
  type: VerifyIssueType;
  severity: IssueSeverity;
  id: string;
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
  ledgerEntries: number;
}
