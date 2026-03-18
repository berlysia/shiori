/** Daemon configuration resolved from environment variables. */
export interface DaemonConfig {
  /** Port number for the HTTP server. */
  port: number;
  /** GitHub webhook secret for HMAC-SHA256 verification. */
  webhookSecret: string;
  /** Working directory where shiori CLI will be executed. */
  cwd: string;
  /** Path to shiori CLI binary. Defaults to "shiori". */
  shioriPath: string;
  /** CLI execution timeout in milliseconds. */
  timeout: number;
  /** Maximum number of pending resolve tasks in the queue. */
  maxQueueDepth: number;
  /** Path to the JSONL journal file for event logging. */
  journalPath: string;
}

/** Parsed GitHub webhook event (issues closed only). */
export interface WebhookEvent {
  type: 'issues';
  action: 'closed';
  issue: { number: number; title: string };
  repository: { full_name: string };
}

/** Result from CLI execution. */
export interface ExecuteResult {
  success: boolean;
  output: string;
  exitCode: number;
}

/** Single journal entry recording a webhook event and its resolve outcome. */
export interface JournalEntry {
  timestamp: string;
  event_type: string;
  repository: string;
  issue_number: number;
  resolve_success: boolean;
  annotations_resolved_count: number | null;
}
