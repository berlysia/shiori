import { execFile } from 'node:child_process';
import type { ShioriAnnotation, ProvenanceInfo } from './types.ts';

/** Maximum stdout buffer size for git blame processes (10 MiB) */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/** Raw output from git blame --porcelain for a single line */
interface BlameEntry {
  commitHash: string;
  author: string;
  authorEmail: string;
  /** Unix timestamp */
  authorTime: number;
  summary: string;
}

/**
 * Runner function type for git blame (single line).
 * Returns porcelain output for the specified file and line.
 * DI point — inject a mock for testing.
 */
export type GitBlameRunner = (
  file: string,
  line: number,
  cwd: string,
) => Promise<string>;

/**
 * Runner function type for git blame (whole file).
 * Returns porcelain output for the entire file.
 * DI point — inject a mock for testing.
 */
export type GitBlameFileRunner = (file: string, cwd: string) => Promise<string>;

/** Options for enrichWithProvenance */
export interface EnrichProvenanceOptions {
  /** Custom git blame runner for single-line mode (for testing / DI) */
  gitBlameRunner?: GitBlameRunner;
  /** Custom git blame file runner for batch mode (for testing / DI) */
  gitBlameFileRunner?: GitBlameFileRunner;
  /**
   * Maximum number of concurrent git blame processes.
   * In batch mode, this limits concurrent file-level blames.
   * Default: 5
   */
  concurrency?: number;
}

/**
 * Default git blame runner using child_process.execFile.
 * Runs: git blame --porcelain -L <line>,<line> <file>
 */
export const defaultGitBlameRunner: GitBlameRunner = (
  file: string,
  line: number,
  cwd: string,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['blame', '--porcelain', '-L', `${line},${line}`, '--', file],
      { cwd, maxBuffer: DEFAULT_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
};

/**
 * Default git blame file runner using child_process.execFile.
 * Runs: git blame --porcelain <file>
 * Returns porcelain output for the entire file.
 */
export const defaultGitBlameFileRunner: GitBlameFileRunner = (
  file: string,
  cwd: string,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['blame', '--porcelain', '--', file],
      { cwd, maxBuffer: DEFAULT_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
};

/**
 * Parse git blame --porcelain output into a BlameEntry.
 *
 * Porcelain format (per-line block):
 *   <40-char-hash> <orig-line> <final-line> [<num-lines>]
 *   author <name>
 *   author-mail <<email>>
 *   author-time <timestamp>
 *   ...
 *   summary <message>
 *   ...
 */
export function parseBlameOutput(output: string): BlameEntry | undefined {
  const lines = output.split('\n');
  if (lines.length === 0) return undefined;

  // First line: <hash> <orig-line> <final-line> [<num-lines>]
  const headerMatch = lines[0]?.match(/^([0-9a-f]{40})\s/);
  if (!headerMatch) return undefined;

  const entry: Partial<BlameEntry> = {
    commitHash: headerMatch[1],
  };

  for (const line of lines) {
    if (line.startsWith('author ')) {
      entry.author = line.slice('author '.length);
    } else if (line.startsWith('author-mail ')) {
      // author-mail <email@example.com> → strip angle brackets
      entry.authorEmail = line
        .slice('author-mail '.length)
        .replace(/^<|>$/g, '');
    } else if (line.startsWith('author-time ')) {
      entry.authorTime = Number(line.slice('author-time '.length));
    } else if (line.startsWith('summary ')) {
      entry.summary = line.slice('summary '.length);
    }
  }

  if (
    entry.commitHash &&
    entry.author &&
    entry.authorEmail &&
    entry.authorTime !== undefined &&
    entry.summary
  ) {
    return entry as BlameEntry;
  }

  return undefined;
}

/**
 * Parse git blame --porcelain output for an entire file into a Map keyed by line number.
 *
 * Porcelain format outputs blocks per line. Each block starts with:
 *   <40-char-hash> <orig-line> <final-line> [<num-lines>]
 *
 * For the first occurrence of a commit, the full header (author, author-mail, etc.) follows.
 * Subsequent lines from the same commit may have abbreviated headers.
 * We track seen commits to reuse previously parsed data.
 */
export function parseFileBlameOutput(output: string): Map<number, BlameEntry> {
  const result = new Map<number, BlameEntry>();
  const commitCache = new Map<string, BlameEntry>();

  const lines = output.split('\n');
  let i = 0;

  while (i < lines.length) {
    const headerMatch = lines[i]?.match(
      /^([0-9a-f]{40})\s+\d+\s+(\d+)(?:\s+\d+)?$/,
    );
    if (!headerMatch) {
      i++;
      continue;
    }

    const commitHash = headerMatch[1]!;
    const finalLine = Number(headerMatch[2]);
    i++;

    // Parse metadata lines until we hit a tab-prefixed content line
    const entry: Partial<BlameEntry> = { commitHash };
    while (i < lines.length && !lines[i]!.startsWith('\t')) {
      const line = lines[i]!;
      if (line.startsWith('author ')) {
        entry.author = line.slice('author '.length);
      } else if (line.startsWith('author-mail ')) {
        entry.authorEmail = line
          .slice('author-mail '.length)
          .replace(/^<|>$/g, '');
      } else if (line.startsWith('author-time ')) {
        entry.authorTime = Number(line.slice('author-time '.length));
      } else if (line.startsWith('summary ')) {
        entry.summary = line.slice('summary '.length);
      }
      i++;
    }

    // Skip the tab-prefixed content line
    if (i < lines.length && lines[i]!.startsWith('\t')) {
      i++;
    }

    // Build complete entry: use parsed fields or fall back to cached commit data
    const cached = commitCache.get(commitHash);
    const complete: BlameEntry | undefined =
      entry.author &&
      entry.authorEmail &&
      entry.authorTime !== undefined &&
      entry.summary
        ? (entry as BlameEntry)
        : cached
          ? { ...cached, commitHash }
          : undefined;

    if (complete) {
      commitCache.set(commitHash, complete);
      result.set(finalLine, complete);
    }
  }

  return result;
}

/**
 * Convert a BlameEntry to ProvenanceInfo.
 */
function blameToProvenance(blame: BlameEntry): ProvenanceInfo {
  return {
    author: blame.author,
    authorEmail: blame.authorEmail,
    date: new Date(blame.authorTime * 1000).toISOString(),
    commitHash: blame.commitHash.slice(0, 7),
    commitSummary: blame.summary,
  };
}

/**
 * Run async tasks with a concurrency limit.
 */
async function pMapLimited<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = Array.from<R>({ length: items.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Enrich annotations with git blame provenance information.
 *
 * Uses batch mode by default: groups annotations by file and runs one
 * `git blame --porcelain` per file, extracting relevant lines from the
 * parsed output. Falls back to single-line mode when gitBlameRunner is
 * explicitly provided (backward compatibility).
 *
 * Annotations that fail to resolve provenance are left unchanged (graceful fallback).
 */
export async function enrichWithProvenance(
  annotations: ShioriAnnotation[],
  cwd: string,
  options?: EnrichProvenanceOptions,
): Promise<ShioriAnnotation[]> {
  if (annotations.length === 0) return [];

  const concurrency = options?.concurrency ?? 5;

  // When a single-line runner is explicitly provided, use per-annotation mode
  // (backward compatibility with existing tests and custom runners)
  if (options?.gitBlameRunner) {
    return enrichPerAnnotation(annotations, cwd, options.gitBlameRunner);
  }

  // Batch mode: group by file, one blame per file
  const fileRunner = options?.gitBlameFileRunner ?? defaultGitBlameFileRunner;
  return enrichBatch(annotations, cwd, fileRunner, concurrency);
}

/**
 * Per-annotation enrichment (original strategy).
 * Runs one git blame per annotation line.
 */
async function enrichPerAnnotation(
  annotations: ShioriAnnotation[],
  cwd: string,
  runner: GitBlameRunner,
): Promise<ShioriAnnotation[]> {
  const results = await Promise.all(
    annotations.map(async (annotation) => {
      try {
        const output = await runner(
          annotation.location.file,
          annotation.location.line,
          cwd,
        );
        const blame = parseBlameOutput(output);
        if (blame) {
          return { ...annotation, provenance: blameToProvenance(blame) };
        }
      } catch {
        // Graceful fallback: git not available, file not tracked, etc.
      }
      return annotation;
    }),
  );

  return results;
}

/**
 * Batch enrichment strategy.
 * Groups annotations by file, runs one `git blame --porcelain` per file,
 * then looks up each annotation's line in the parsed output.
 */
async function enrichBatch(
  annotations: ShioriAnnotation[],
  cwd: string,
  fileRunner: GitBlameFileRunner,
  concurrency: number,
): Promise<ShioriAnnotation[]> {
  // Group annotation indices by file path
  const fileGroups = new Map<string, number[]>();
  for (let i = 0; i < annotations.length; i++) {
    const file = annotations[i]!.location.file;
    const group = fileGroups.get(file);
    if (group) {
      group.push(i);
    } else {
      fileGroups.set(file, [i]);
    }
  }

  // Clone annotations array (preserve immutability)
  const results: ShioriAnnotation[] = [...annotations];

  // Run file-level blames with concurrency limit
  const files = [...fileGroups.keys()];
  await pMapLimited(
    files,
    async (file) => {
      try {
        const output = await fileRunner(file, cwd);
        const lineMap = parseFileBlameOutput(output);

        for (const idx of fileGroups.get(file)!) {
          const annotation = annotations[idx]!;
          const blame = lineMap.get(annotation.location.line);
          if (blame) {
            results[idx] = {
              ...annotation,
              provenance: blameToProvenance(blame),
            };
          }
        }
      } catch {
        // Graceful fallback: git not available, file not tracked, etc.
        // Annotations from this file remain without provenance.
      }
    },
    concurrency,
  );

  return results;
}
