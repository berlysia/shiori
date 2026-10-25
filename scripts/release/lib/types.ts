// Types shared by lib/ and the layers above it. `Deps` lives here because
// release-after-push.ts may see only its type, never deps.ts itself.
import type { ValidVersion } from './semver.ts';

export type Observed<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly error: string };

export type Flags =
  | { readonly mode: 'normal' }
  | { readonly mode: 'pre'; readonly tag: string }
  | { readonly mode: 'exit-pre' };

// One path and its state, as git reports them. Renames are switched off in
// every command that produces these (--no-renames), so R and C only appear
// from `git status`, where they count as a violation anyway.
export type ChangeState = 'M' | 'A' | 'D' | 'T' | 'R' | 'C' | 'U' | '??';

export interface ChangeEntry {
  readonly path: string;
  readonly state: ChangeState;
}

// A working tree change with the text before (HEAD) and after (disk), so the
// entry decision can tell a leftover version bump from someone's own edit.
export interface WorkingChange extends ChangeEntry {
  readonly before: string | undefined;
  readonly after: string | undefined;
}

export interface RunResult {
  // null when the child could not start or was killed
  readonly code: number | null;
  readonly stdout: string;
  // the last 64 KiB of stderr, also for stdio 'inherit'
  readonly stderrTail: string;
}

export interface RunOptions {
  readonly stdio: 'pipe' | 'inherit';
  // true: add none of the pinned arguments (`--version`, `npm config get`)
  readonly raw?: boolean;
}

export interface FileStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
}

export interface FsApi {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  // does not follow symlinks; undefined when the path does not exist
  lstat(path: string): Promise<FileStat | undefined>;
  realpath(path: string): Promise<string>;
  // a file or a symlink itself, never a directory tree
  rm(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

// The one exit for text shown to a person. Implemented by output.ts.
export interface Output {
  emit(line: string): void;
  emitError(line: string): void;
  // a piece of a child's stderr, without a newline added
  emitChunk(text: string): void;
}

export interface EvidenceStore {
  // creates the pending directory; returns its path
  open(): Promise<string>;
  // moves it under the version once that is known; returns the new path
  moveTo(version: ValidVersion): Promise<string>;
  // writes a new file (never overwrites); returns its path
  save(name: string, content: string): Promise<string>;
}

export interface Deps {
  run(
    cmd: string,
    args: readonly string[],
    options: RunOptions,
  ): Promise<RunResult>;
  readonly fs: FsApi;
  readonly clock: {
    now(): Date;
    sleep(ms: number): Promise<void>;
  };
  // true only for `y` / `Y`; EOF and everything else is no
  prompt(question: string): Promise<boolean>;
  readonly output: Output;
  readonly evidence: EvidenceStore;
  readonly isTTY: { readonly stdin: boolean; readonly stdout: boolean };
  readonly argv: readonly string[];
  readonly cwd: string;
}
