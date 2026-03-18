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
