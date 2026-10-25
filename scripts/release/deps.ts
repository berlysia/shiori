// The effectful layer: child processes, the file system, the clock, the
// prompt and the evidence store. Everything that decides is in lib/; tests of
// the flow hand release.ts a different Deps.
import { spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import { filterEnv } from './lib/env.ts';
import type {
  Deps,
  EvidenceStore,
  FsApi,
  Output,
  RunOptions,
  RunResult,
} from './lib/types.ts';
import type { ValidVersion } from './lib/semver.ts';
import { processOutput } from './output.ts';

const MIB = 1024 * 1024;
export const PIPE_CAP_BYTES = 64 * MIB;
export const STDERR_TAIL_BYTES = 64 * 1024;
// a child that exits but leaves a grandchild holding a pipe open
const CLOSE_GRACE_MS = 5000;

const REGISTRY = 'https://registry.npmjs.org/';
const REPO = 'berlysia/shiori';

export interface ChildLike {
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(): unknown;
}

export interface SpawnOptionsLike {
  stdio: readonly [
    'ignore' | 'inherit',
    'inherit' | 'pipe',
    'inherit' | 'pipe',
  ];
  env: Record<string, string>;
  cwd: string;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  options: SpawnOptionsLike,
) => ChildLike;

// An argument array and no shell: nothing in an argument is interpreted.
export const nodeSpawn: SpawnFn = (cmd, args, options) =>
  spawn(cmd, args, {
    stdio: [...options.stdio],
    env: options.env,
    cwd: options.cwd,
  });

function pinnedArgs(
  cmd: string,
  args: readonly string[],
  raw: boolean | undefined,
): string[] {
  if (raw === true) return [...args];
  // The pins make a configured registry or a GH_REPO-style default unable to
  // redirect a command; `gh api` takes the repository in its path instead.
  if (cmd === 'npm') {
    return [
      ...args,
      `--registry=${REGISTRY}`,
      `--@berlysia:registry=${REGISTRY}`,
    ];
  }
  if (cmd === 'gh' && args[0] !== 'api') return [...args, '--repo', REPO];
  return [...args];
}

export interface RunnerOptions {
  readonly spawnFn: SpawnFn;
  readonly output: Output;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly setTimer?: (fn: () => void, ms: number) => () => void;
}

function tailOf(
  chunks: Buffer[],
  limit: number,
): { chunks: Buffer[]; bytes: number } {
  let bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  while (bytes > limit && chunks.length > 0) {
    const first = chunks[0] as Buffer;
    const excess = bytes - limit;
    if (first.length <= excess) {
      chunks.shift();
      bytes -= first.length;
    } else {
      chunks[0] = first.subarray(excess);
      bytes -= excess;
    }
  }
  return { chunks, bytes };
}

export function createRunner(options: RunnerOptions) {
  const { spawnFn, output, cwd } = options;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
  const filtered = filterEnv(options.env);
  let announced = false;

  return (
    cmd: string,
    args: readonly string[],
    runOptions: RunOptions,
  ): Promise<RunResult> =>
    new Promise<RunResult>((resolve) => {
      if (!announced && filtered.removed.length > 0) {
        announced = true;
        // names only: the values may be secrets
        output.emit(
          `release: not passing these environment variables to child processes: ${filtered.removed.join(', ')}`,
        );
      }
      const env = { ...filtered.env };
      // git reads pathspecs literally, so a file named ":(top)x" is a file
      if (cmd === 'git') env['GIT_LITERAL_PATHSPECS'] = '1';

      let settled = false;
      const finish = (result: RunResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      let child: ChildLike;
      try {
        child = spawnFn(cmd, pinnedArgs(cmd, args, runOptions.raw), {
          stdio:
            runOptions.stdio === 'pipe'
              ? ['ignore', 'pipe', 'pipe']
              : ['inherit', 'inherit', 'pipe'],
          env,
          cwd,
        });
      } catch (error) {
        finish({ code: null, stdout: '', stderrTail: String(error) });
        return;
      }

      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrChunks: Buffer[] = [];
      const decoder = new StringDecoder('utf8');
      child.stdout?.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += buffer.length;
        if (stdoutBytes > PIPE_CAP_BYTES) {
          child.kill();
          // a partial output must never be read as a complete one
          finish({
            code: null,
            stdout: '',
            stderrTail: `output of ${cmd} exceeded ${PIPE_CAP_BYTES / MIB} MiB`,
          });
          return;
        }
        stdout.push(buffer);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stderrChunks.push(buffer);
        stderrChunks = tailOf(stderrChunks, STDERR_TAIL_BYTES).chunks;
        // a tee: the person sees stderr as it arrives (prompts, progress)
        if (runOptions.stdio === 'inherit')
          output.emitChunk(decoder.write(buffer));
      });
      child.on('error', (error) => {
        finish({ code: null, stdout: '', stderrTail: String(error) });
      });
      let cancelGrace: (() => void) | undefined;
      const complete = (code: unknown): void => {
        cancelGrace?.();
        if (runOptions.stdio === 'inherit') output.emitChunk(decoder.end());
        finish({
          code: typeof code === 'number' ? code : null,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderrTail: Buffer.concat(stderrChunks).toString('utf8'),
        });
      };
      child.on('close', complete);
      child.on('exit', (code) => {
        if (settled) return;
        cancelGrace = setTimer(() => {
          child.stderr?.destroy();
          child.stdout?.destroy();
          complete(code);
        }, CLOSE_GRACE_MS);
      });
    });
}

// ---------------------------------------------------------------------------
// fs, prompt
// ---------------------------------------------------------------------------

export const nodeFs: FsApi = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, content) => writeFile(path, content),
  readdir: (path) => readdir(path),
  lstat: async (path) => {
    try {
      const stat = await lstat(path);
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: stat.isSymbolicLink(),
        size: stat.size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  realpath: (path) => realpath(path),
  // unlink, not rm -r: only a file or a link, never a tree
  rm: (path) => unlink(path),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
};

export interface LineReader {
  question(query: string, callback: (answer: string) => void): void;
  close(): void;
  on(event: 'close', listener: () => void): unknown;
}

export function createPrompt(
  create: () => LineReader,
): (question: string) => Promise<boolean> {
  return (question) =>
    new Promise<boolean>((resolve) => {
      const reader = create();
      let answered = false;
      // EOF closes the reader before any answer: that is a no
      reader.on('close', () => {
        if (!answered) resolve(false);
      });
      reader.question(question, (answer) => {
        answered = true;
        reader.close();
        resolve(answer === 'y' || answer === 'Y');
      });
    });
}

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

const EVIDENCE_NAME = /^[A-Za-z0-9._-]+$/;

export function createEvidenceStore(options: {
  readonly root: string;
  readonly now: () => Date;
}): EvidenceStore {
  let current: string | undefined;
  let stamp = '';

  // never through a symlink: .tmp/release is created here or refused
  async function ensureDir(path: string, recursive: boolean): Promise<void> {
    const existing = await lstat(path).catch(() => undefined);
    if (existing !== undefined) {
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error(`${path} exists and is not a plain directory`);
      }
    } else {
      await mkdir(path, { recursive, mode: 0o700 });
    }
    await chmod(path, 0o700);
  }

  return {
    async open() {
      stamp = options.now().toISOString().replace(/[:.]/g, '-');
      await ensureDir(options.root, true);
      const dir = join(options.root, `pending-${stamp}`);
      // not recursive: an existing directory is an error, not reused
      await mkdir(dir, { mode: 0o700 });
      await chmod(dir, 0o700);
      current = dir;
      return dir;
    },
    async moveTo(version: ValidVersion) {
      if (current === undefined) throw new Error('evidence store is not open');
      const parent = join(options.root, `v${version}`);
      await ensureDir(parent, false);
      const target = join(parent, stamp);
      await rename(current, target);
      current = target;
      return target;
    },
    async save(name, content) {
      if (current === undefined) throw new Error('evidence store is not open');
      if (!EVIDENCE_NAME.test(name) || /^\.+$/.test(name)) {
        throw new Error(`invalid evidence file name ${JSON.stringify(name)}`);
      }
      const path = join(current, name);
      // wx: a second save of the same name fails instead of overwriting
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
      await chmod(path, 0o600);
      return path;
    },
  };
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

export function createDeps(options: {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly output?: Output;
  readonly spawnFn?: SpawnFn;
}): Deps {
  const output = options.output ?? processOutput;
  return {
    run: createRunner({
      spawnFn: options.spawnFn ?? nodeSpawn,
      output,
      env: options.env,
      cwd: options.cwd,
    }),
    fs: nodeFs,
    clock: {
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    prompt: createPrompt(() =>
      createInterface({ input: process.stdin, output: process.stdout }),
    ),
    output,
    evidence: createEvidenceStore({
      root: join(options.cwd, '.tmp', 'release'),
      now: () => new Date(),
    }),
    isTTY: {
      stdin: process.stdin.isTTY === true,
      stdout: process.stdout.isTTY === true,
    },
    argv: options.argv,
    cwd: options.cwd,
  };
}
