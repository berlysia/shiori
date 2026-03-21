import { execFile } from 'node:child_process';
import type { RefStatusEntry } from '../ref-status.ts';
import type { RefStatus } from '../ref-status.ts';
import type { RefStatusProvider } from './types.ts';
import { parseGitHubRef } from './github-issues-provider.ts';

/** Options for configuring the gh CLI provider */
export interface GhCliProviderOptions {
  /**
   * Default repository in "owner/repo" format.
   * Used for refs without explicit repository (e.g., GH-123).
   * Falls back to GITHUB_REPOSITORY env var.
   */
  repository?: string;
  /** Maximum concurrent API requests (default: 10) */
  concurrency?: number;
}

/**
 * Check whether the `gh` CLI is installed and authenticated.
 *
 * Runs `gh auth token` which exits 0 and prints a token when authenticated,
 * or exits non-zero when not authenticated / gh is missing.
 * This is cheaper than `gh auth status` (no network call) and also
 * proves `gh` is on PATH.
 *
 * Note: OAuth scope validation is not performed here. The `gh api` calls
 * will fail gracefully (returning 'unknown' status) if scopes are
 * insufficient. Scope pre-validation may be added in a future iteration.
 *
 * @returns true when gh CLI is installed and authenticated, false otherwise
 */
export function isGhCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      const token = stdout.trim();
      resolve(token.length > 0);
    });
  });
}

/**
 * Fetch a single GitHub issue status via `gh api`.
 *
 * Uses `gh api` with --jq to extract only the state field,
 * avoiding the need to parse full JSON responses.
 *
 * Error handling aligns with GitHubIssuesRefStatusProvider:
 * - 410 Gone → 'closed' (issue was deleted/transferred, treat as resolved)
 * - 404/401/403/other errors → 'unknown' (graceful degradation)
 */
function fetchIssueStatusViaGh(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<RefStatus> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['api', `repos/${owner}/${repo}/issues/${issueNumber}`, '--jq', '.state'],
      { timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          // gh api exits non-zero for HTTP errors.
          // Match GitHubIssuesRefStatusProvider behavior: 410 Gone → 'closed'
          if (stderr && /\b410\b/.test(stderr)) {
            resolve('closed');
            return;
          }
          // 404, 401, 403, network errors → unknown (graceful degradation)
          resolve('unknown');
          return;
        }

        const state = stdout.trim();
        if (state === 'closed') {
          resolve('closed');
        } else if (state === 'open') {
          resolve('open');
        } else {
          resolve('unknown');
        }
      },
    );
  });
}

/**
 * Execute promises with limited concurrency.
 */
async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = Array.from<T>({ length: tasks.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      const task = tasks[index];
      if (task) {
        results[index] = await task();
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Built-in ref status provider using the GitHub CLI (`gh`).
 *
 * Uses `gh api` to fetch issue statuses, leveraging the CLI's
 * built-in authentication (no manual GITHUB_TOKEN setup required).
 *
 * Detection: `gh auth token` verifies both CLI availability and auth state.
 * Inserted in the provider priority chain between explicit command and
 * GITHUB_TOKEN-based provider (ADR 025 extension).
 */
export class GhCliRefStatusProvider implements RefStatusProvider {
  readonly name = 'gh-cli';

  private readonly repository: string | undefined;
  private readonly concurrency: number;

  constructor(options?: GhCliProviderOptions) {
    this.repository =
      options?.repository ?? process.env.GITHUB_REPOSITORY ?? undefined;
    this.concurrency = options?.concurrency ?? 10;
  }

  async resolve(refs: string[]): Promise<RefStatusEntry[]> {
    if (refs.length === 0) return [];

    // Parse refs and filter to GitHub-compatible ones
    const parsed: Array<{
      ref: string;
      parsed: { owner: string; repo: string; issueNumber: number };
    }> = [];
    for (const ref of refs) {
      const result = parseGitHubRef(ref, this.repository);
      if (result) {
        parsed.push({ ref, parsed: result });
      }
    }

    if (parsed.length === 0) return [];

    // Fetch statuses with concurrency limit
    const tasks = parsed.map(
      ({ ref, parsed: p }) =>
        async (): Promise<RefStatusEntry> => {
          const status = await fetchIssueStatusViaGh(
            p.owner,
            p.repo,
            p.issueNumber,
          );
          return { ref, status };
        },
    );

    return withConcurrency(tasks, this.concurrency);
  }
}
