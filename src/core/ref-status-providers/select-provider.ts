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
 * Priority (Architect's design decision):
 * 1. User-specified --ref-status-command (explicit > implicit)
 * 2. GITHUB_TOKEN auto-detection (implicit when available)
 * 3. No provider (graceful fallback — ref status checking is skipped)
 */
export function selectRefStatusProvider(
  options: SelectProviderOptions,
): RefStatusProvider | undefined {
  // 1. User-specified command takes absolute priority
  if (options.refStatusCommand) {
    return new CommandRefStatusProvider(options.refStatusCommand);
  }

  // 2. GitHub token auto-detection
  if (options.githubToken) {
    return new GitHubIssuesRefStatusProvider({
      token: options.githubToken,
      repository: options.githubRepository,
    });
  }

  // 3. No provider available
  return undefined;
}
