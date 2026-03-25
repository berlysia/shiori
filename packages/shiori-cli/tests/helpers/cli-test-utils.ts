/**
 * Shared test utilities for CLI integration tests.
 *
 * Consolidates runCli() and createFixtureDir() that were duplicated
 * across 13+ test files. CLI test files should import from here
 * instead of defining their own copies.
 */
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_PATH = new URL('../../dist/src/cli.js', import.meta.url).pathname;
const PROJECT_ROOT = new URL('../..', import.meta.url).pathname;

export { CLI_PATH, PROJECT_ROOT };

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCliOptions {
  /** Working directory for the CLI process */
  cwd?: string;
  /** Timeout in ms — when set, the child process is killed after this duration */
  timeout?: number;
  /**
   * Base directory for temporary stdout/stderr capture files.
   * When set, temp files are created under this directory instead of os.tmpdir().
   * Useful for tests that need output files within the project boundary.
   */
  baseDir?: string;
}

/**
 * Run the shiori CLI in a subprocess (non-TTY mode).
 * Captures stdout/stderr to temp files for reliable collection.
 */
export async function runCli(
  args: string[],
  options?: RunCliOptions,
): Promise<CliResult> {
  let runDirBase: string;
  if (options?.baseDir) {
    await mkdir(options.baseDir, { recursive: true });
    runDirBase = options.baseDir;
  } else {
    runDirBase = tmpdir();
  }
  const runDir = await mkdtemp(join(runDirBase, 'shiori-test-run-'));
  const stdoutPath = join(runDir, 'stdout.log');
  const stderrPath = join(runDir, 'stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn('node', [CLI_PATH, ...args], {
        cwd: options?.cwd ?? PROJECT_ROOT,
        stdio: ['ignore', stdoutFd, stderrFd],
      });
      child.once('error', reject);

      if (options?.timeout != null) {
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
        }, options.timeout);
        child.once('close', (code) => {
          clearTimeout(timer);
          resolve(code ?? 1);
        });
      } else {
        child.once('close', (code) => resolve(code ?? 1));
      }
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const [stdout, stderr] = await Promise.all([
    readFile(stdoutPath, 'utf-8').catch(() => ''),
    readFile(stderrPath, 'utf-8').catch(() => ''),
  ]);
  await rm(runDir, { recursive: true, force: true });

  return { stdout, stderr, exitCode };
}

export interface FixtureDirOptions {
  /** Source files to write (key: relative path, value: content) */
  sourceFiles?: Record<string, string>;
  /** Pre-built scan result object (for verify-cli tests that skip scan step) */
  scanResult?: object;
  /** Registry entries (key: ref, value: entry object) */
  registryEntries?: Record<string, object>;
  /** Skip writing registry file */
  skipRegistry?: boolean;
  /** Skip writing scan result file */
  skipScanResult?: boolean;
}

/**
 * Create a minimal project directory for CLI tests.
 * Supports both check-cli style (source files + registry) and
 * verify-cli style (scan result + registry).
 */
export async function createFixtureDir(
  baseDir: string,
  prefix: string,
  options?: FixtureDirOptions,
): Promise<string> {
  const dir = await mkdtemp(join(baseDir, `${prefix}-`));
  await mkdir(join(dir, '.config', 'shiori'), { recursive: true });

  // Write source files if provided (check-cli pattern)
  if (options?.sourceFiles) {
    for (const [path, content] of Object.entries(options.sourceFiles)) {
      const fullPath = join(dir, path);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
    }
  }

  // Write scan result if provided (verify-cli pattern)
  if (options?.scanResult && !options?.skipScanResult) {
    await writeFile(
      join(dir, '.config', 'shiori', 'scan-result.json'),
      JSON.stringify(options.scanResult, null, 2) + '\n',
      'utf-8',
    );
  }

  // Write registry
  if (!options?.skipRegistry) {
    const registry = options?.registryEntries ?? {};
    await writeFile(
      join(dir, '.config', 'shiori', 'registry.json'),
      JSON.stringify(registry, null, 2) + '\n',
      'utf-8',
    );
  }

  return dir;
}

/**
 * Create a temp directory and return it with a cleanup function.
 * Usage: const { baseDir, cleanup } = await createTempBase('shiori-test-');
 */
export async function createTempBase(prefix: string): Promise<{
  baseDir: string;
  cleanup: () => Promise<void>;
}> {
  const baseDir = await mkdtemp(join(tmpdir(), prefix));
  return {
    baseDir,
    cleanup: () => rm(baseDir, { recursive: true, force: true }),
  };
}

/**
 * Unwrap ADR 028 schema envelope from CLI JSON output.
 * Parses the JSON string, validates the envelope structure, and returns the data payload.
 */
export function unwrapEnvelope<T = unknown>(
  jsonString: string,
  expectedCommand?: string,
): T {
  const envelope = JSON.parse(jsonString);
  if (!envelope.meta || typeof envelope.meta.schemaVersion !== 'number') {
    throw new Error(
      `Expected ADR 028 envelope but got: ${JSON.stringify(envelope).slice(0, 200)}`,
    );
  }
  if (
    expectedCommand !== undefined &&
    envelope.meta.command !== expectedCommand
  ) {
    throw new Error(
      `Expected command "${expectedCommand}" but got "${envelope.meta.command}"`,
    );
  }
  return envelope.data as T;
}
