import { execFile } from 'node:child_process';
import type { ShioriAnnotation, ProvenanceInfo } from './types.ts';

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
 * Runner function type for git blame.
 * Returns porcelain output for the specified file and line.
 * DI point — inject a mock for testing.
 */
export type GitBlameRunner = (
  file: string,
  line: number,
  cwd: string,
) => Promise<string>;

/** Options for enrichWithProvenance */
export interface EnrichProvenanceOptions {
  /** Custom git blame runner (for testing / DI) */
  gitBlameRunner?: GitBlameRunner;
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
      { cwd },
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
 * Enrich annotations with git blame provenance information.
 *
 * Pure in interface — side effects (git commands) are injectable via options.gitBlameRunner.
 * Annotations that fail to resolve provenance are left unchanged (graceful fallback).
 *
 * Groups annotations by file to minimize git invocations where possible in future optimizations.
 * Currently runs one blame per annotation-line.
 */
export async function enrichWithProvenance(
  annotations: ShioriAnnotation[],
  cwd: string,
  options?: EnrichProvenanceOptions,
): Promise<ShioriAnnotation[]> {
  const runner = options?.gitBlameRunner ?? defaultGitBlameRunner;

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
