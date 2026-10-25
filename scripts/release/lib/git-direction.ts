// Is git working on the repository in the current directory? GIT_DIR or
// GIT_WORK_TREE in a developer's shell can make the files this script reads
// and the commits git writes belong to different repositories. Pure: the
// caller reads `.git` and resolves the real paths.
import { resolve } from 'node:path';

// What `<cwd>/.git` is. A linked worktree has a file there, not a directory.
export type DotGit =
  | { readonly kind: 'directory' }
  | { readonly kind: 'file'; readonly content: string }
  | { readonly kind: 'other' }
  | { readonly kind: 'unreadable' };

export type ExpectedGitDir =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

// The git directory that `<cwd>/.git` itself names, before realpath.
export function expectedGitDir(cwd: string, dotGit: DotGit): ExpectedGitDir {
  switch (dotGit.kind) {
    case 'directory':
      return { ok: true, path: resolve(cwd, '.git') };
    case 'file': {
      // exactly one `gitdir: <path>` line; anything else is not a worktree link
      const match = /^gitdir: ([^\n\0]+)\n?$/.exec(dotGit.content);
      const target = match?.[1];
      if (target === undefined || target.trim() === '') {
        return {
          ok: false,
          reason: '.git is a file but not a single "gitdir: <path>" line',
        };
      }
      return { ok: true, path: resolve(cwd, target) };
    }
    case 'other':
      return {
        ok: false,
        reason: '.git is neither a directory nor a regular file',
      };
    case 'unreadable':
      return { ok: false, reason: '.git could not be read' };
  }
}

// All four paths are already passed through realpath.
export function checkGitDirection(input: {
  readonly realCwd: string;
  readonly realToplevel: string;
  readonly realExpectedGitDir: string;
  readonly realActualGitDir: string;
}): string[] {
  const reasons: string[] = [];
  if (input.realToplevel !== input.realCwd) {
    reasons.push('the git work tree top level is not the current directory');
  }
  if (input.realActualGitDir !== input.realExpectedGitDir) {
    reasons.push('git uses a git directory other than the one .git names');
  }
  return reasons;
}
