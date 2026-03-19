import { request } from 'node:https';
import type { RefStatusEntry } from '../ref-status.ts';
import type { RefStatus } from '../ref-status.ts';
import type { RefStatusProvider } from './types.ts';

/** Options for configuring the GitHub Issues provider */
export interface GitHubIssuesProviderOptions {
  /** GitHub personal access token or GITHUB_TOKEN */
  token: string;
  /**
   * Default repository in "owner/repo" format.
   * Used for refs without explicit repository (e.g., GH-123).
   * Falls back to GITHUB_REPOSITORY env var.
   */
  repository?: string;
  /** GitHub API base URL (default: https://api.github.com) */
  apiBaseUrl?: string;
  /** Maximum concurrent API requests (default: 10) */
  concurrency?: number;
}

/**
 * Pattern for extracting GitHub issue numbers from shiori refs.
 *
 * Supported formats:
 * - GH-123       → default repository, issue #123
 * - OWNER/REPO#123 → explicit repository
 *
 * Note: bare #123 is not supported because it conflicts with REF_PATTERN
 * (which requires uppercase prefix). See Architect's design notes.
 */
interface ParsedGitHubRef {
  owner: string;
  repo: string;
  issueNumber: number;
}

/**
 * Parse a shiori ref into GitHub issue coordinates.
 * Returns undefined if the ref doesn't match any GitHub pattern.
 */
export function parseGitHubRef(
  ref: string,
  defaultRepo?: string,
): ParsedGitHubRef | undefined {
  // Pattern 1: GH-123 (default repository)
  const ghMatch = /^GH-(\d+)$/.exec(ref);
  if (ghMatch && ghMatch[1]) {
    const issueNumber = Number.parseInt(ghMatch[1], 10);
    if (!defaultRepo) return undefined;
    const parts = defaultRepo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    return { owner: parts[0], repo: parts[1], issueNumber };
  }

  // Pattern 2: OWNER/REPO#123 (explicit repository)
  const explicitMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(
    ref,
  );
  if (
    explicitMatch &&
    explicitMatch[1] &&
    explicitMatch[2] &&
    explicitMatch[3]
  ) {
    return {
      owner: explicitMatch[1],
      repo: explicitMatch[2],
      issueNumber: Number.parseInt(explicitMatch[3], 10),
    };
  }

  return undefined;
}

/**
 * Fetch a single GitHub issue status via REST API.
 * Uses node:https with no external dependencies.
 */
function fetchIssueStatus(
  owner: string,
  repo: string,
  issueNumber: number,
  token: string,
  apiBaseUrl: string,
): Promise<RefStatus> {
  return new Promise((resolve, _reject) => {
    const url = new URL(
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
      apiBaseUrl,
    );

    const req = request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname,
        method: 'GET',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'shiori',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;

          // 404: Issue not found → unknown
          if (statusCode === 404) {
            resolve('unknown');
            return;
          }

          // 410: Gone → treat as closed
          if (statusCode === 410) {
            resolve('closed');
            return;
          }

          // 401/403: Auth failure → unknown (graceful degradation)
          if (statusCode === 401 || statusCode === 403) {
            resolve('unknown');
            return;
          }

          // Non-200: unexpected → unknown
          if (statusCode < 200 || statusCode >= 300) {
            resolve('unknown');
            return;
          }

          try {
            const parsed: unknown = JSON.parse(data);
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              'state' in parsed
            ) {
              const state = (parsed as Record<string, unknown>).state;
              if (state === 'closed') {
                resolve('closed');
              } else {
                resolve('open');
              }
              return;
            }
            resolve('unknown');
          } catch {
            resolve('unknown');
          }
        });
      },
    );

    req.on('error', () => {
      // Network error → unknown (graceful degradation)
      resolve('unknown');
    });

    req.end();
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
 * Built-in ref status provider for GitHub Issues.
 * Automatically detects issue numbers from refs and checks their
 * open/closed status via the GitHub REST API.
 *
 * Zero configuration required when GITHUB_TOKEN is available.
 */
export class GitHubIssuesRefStatusProvider implements RefStatusProvider {
  readonly name = 'github-issues';

  private readonly token: string;
  private readonly repository: string | undefined;
  private readonly apiBaseUrl: string;
  private readonly concurrency: number;

  constructor(options: GitHubIssuesProviderOptions) {
    this.token = options.token;
    this.repository =
      options.repository ?? process.env.GITHUB_REPOSITORY ?? undefined;
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
    this.concurrency = options.concurrency ?? 10;
  }

  async resolve(refs: string[]): Promise<RefStatusEntry[]> {
    if (refs.length === 0) return [];

    // Parse refs and filter to GitHub-compatible ones
    const parsed: Array<{ ref: string; parsed: ParsedGitHubRef }> = [];
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
          const status = await fetchIssueStatus(
            p.owner,
            p.repo,
            p.issueNumber,
            this.token,
            this.apiBaseUrl,
          );
          return { ref, status };
        },
    );

    return withConcurrency(tasks, this.concurrency);
  }
}
