import type { RefStatusProvider } from './types.ts';
import { CommandRefStatusProvider } from './command-provider.ts';
import { GitHubIssuesRefStatusProvider } from './github-issues-provider.ts';
import { GhCliRefStatusProvider, isGhCliAvailable } from './gh-cli-provider.ts';

/** Options for selecting the appropriate ref status provider */
export interface SelectProviderOptions {
  /** User-specified external ref-status command (from --ref-status-command or config) */
  refStatusCommand?: string;
  /** GitHub token (from GITHUB_TOKEN env var) */
  githubToken?: string;
  /** GitHub repository in "owner/repo" format (from GITHUB_REPOSITORY env var) */
  githubRepository?: string;
  /** Skip gh CLI auto-detection (for testing or explicit opt-out) */
  skipGhCli?: boolean;
}

/**
 * Select the appropriate ref status provider based on available configuration.
 *
 * Priority chain (ADR 025, extended by EP-0111):
 *   1. Explicit  — User-specified --ref-status-command (always wins)
 *   2. gh CLI    — Auto-detected via `gh auth token` (EP-0111)
 *   3. Token     — GITHUB_TOKEN environment variable
 *   4. None      — Graceful fallback (ref status checking is skipped)
 *
 * The "Explicit > Implicit > None" principle ensures user intent always
 * overrides auto-detection. The gh CLI slot is inserted before GITHUB_TOKEN
 * because gh's built-in auth removes the need for manual token setup.
 */
export async function selectRefStatusProvider(
  options: SelectProviderOptions,
): Promise<RefStatusProvider | undefined> {
  // 1. Explicit: user-specified command takes absolute priority
  if (options.refStatusCommand) {
    return new CommandRefStatusProvider(options.refStatusCommand);
  }

  // 2. gh CLI: auto-detected via `gh auth token` (EP-0111)
  // Skipped when: explicitly opted out, or gh is not installed/authenticated
  if (!options.skipGhCli) {
    const ghAvailable = await isGhCliAvailable();
    if (ghAvailable) {
      return new GhCliRefStatusProvider({
        repository: options.githubRepository,
      });
    }
  }

  // 3. Token: GITHUB_TOKEN environment variable
  if (options.githubToken) {
    return new GitHubIssuesRefStatusProvider({
      token: options.githubToken,
      repository: options.githubRepository,
    });
  }

  // 4. None: no provider available
  return undefined;
}
