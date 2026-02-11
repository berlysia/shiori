/** Suppression source type */
export type SuppressionSource = 'comment' | 'native' | 'external';

/** Target linter */
export type LinterKind = 'stylelint' | 'eslint' | 'unknown';

/** Meta information extracted from suppression comments (initially only expires) */
export interface SuppressionMeta {
  /** Expiration date in YYYY-MM-DD format */
  expires: string | undefined;
}

/** A single lint suppression record extracted from source code */
export interface SuppressionRecord {
  /** ID extracted from waive(...). e.g. "SUP-1234" */
  id: string;
  /** Target linter */
  linter: LinterKind;
  /** Suppressed rule name. e.g. "plugin/baseline", "@typescript-eslint/no-explicit-any" */
  rule: string | undefined;
  /** File path (relative) */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** Source type */
  source: SuppressionSource;
  /** Raw suppression comment string */
  raw: string;
  /** Meta information */
  meta: SuppressionMeta;
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
}

/** Full ledger keyed by suppression ID */
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
