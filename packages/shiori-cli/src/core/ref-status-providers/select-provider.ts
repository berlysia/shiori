import type { RefStatusProvider } from './types.ts';
import { CommandRefStatusProvider } from './command-provider.ts';
import { GitHubIssuesRefStatusProvider } from './github-issues-provider.ts';

/** Options for selecting the appropriate ref status provider */
export interface SelectProviderOptions {
  /** User-specified external ref-status command (from --ref-status-command or config) */
  refStatusCommand?: string;
  /** GitHub token (from GITHUB_TOKEN env var) */
  githubToken?: string;
  /** GitHub repository in "owner/repo" format (from GITHUB_REPOSITORY env var) */
  githubRepository?: string;
}

/**
 * Select the appropriate ref status provider based on available configuration.
 *
 * Priority chain (ADR 025):
 *   1. Explicit  — User-specified --ref-status-command (always wins)
 *   2. Auto-detect — Environment variable based (GITHUB_TOKEN, future providers)
 *   3. None — Graceful fallback (ref status checking is skipped)
 *
 * The "Explicit > Implicit > None" principle ensures user intent always
 * overrides auto-detection. External providers connect via step 1
 * (--ref-status-command) using the JSONL stdin/stdout protocol.
 *
 * Extension point (EP-0070 Step 2): Additional env-var based providers
 * can be inserted between steps 2 and 3. The candidate naming convention
 * is SHIORI_REFSTATUS_<PROVIDER>_<KEY> (not yet finalized).
 */
export function selectRefStatusProvider(
  options: SelectProviderOptions,
): RefStatusProvider | undefined {
  // 1. Explicit: user-specified command takes absolute priority
  if (options.refStatusCommand) {
    return new CommandRefStatusProvider(options.refStatusCommand);
  }

  // 2. Auto-detect: environment variable based providers
  // Currently: GITHUB_TOKEN → GitHubIssuesRefStatusProvider
  // Future: additional env-var based providers added here (ADR 025)
  if (options.githubToken) {
    return new GitHubIssuesRefStatusProvider({
      token: options.githubToken,
      repository: options.githubRepository,
    });
  }

  // 3. None: no provider available
  return undefined;
}
