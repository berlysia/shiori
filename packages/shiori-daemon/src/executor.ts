import { execFile } from 'node:child_process';
import type { DaemonConfig, ExecuteResult } from './types.ts';

/**
 * Environment variables allowed to pass through to the child process.
 *
 * Security: Only a fixed allowlist is forwarded — prevents accidental
 * leakage of secrets or sensitive host environment variables.
 */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'NODE_ENV',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'LANG',
] as const;

/** Build a minimal env object containing only allowlisted variables. */
export function buildAllowedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Execute `shiori resolve --closed --format json --yes` as a child process.
 *
 * Only allowlisted environment variables are forwarded to the child process.
 * See ENV_ALLOWLIST for the exact list.
 */
export function executeResolve(config: DaemonConfig): Promise<ExecuteResult> {
  return new Promise((resolve) => {
    const args = ['resolve', '--closed', '--format', 'json', '--yes'];

    execFile(
      config.shioriPath,
      args,
      {
        cwd: config.cwd,
        timeout: config.timeout,
        env: buildAllowedEnv(),
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
      (error, stdout, stderr) => {
        if (error) {
          // Node.js execFile timeout kills the process: err.killed=true, err.signal="SIGTERM"
          const isTimeout = (error as { killed?: boolean }).killed === true;
          const isMaxBuffer =
            error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          const exitCode = isMaxBuffer
            ? 1
            : isTimeout
              ? 124 // standard timeout exit code
              : ((error as { status?: number }).status ?? 1);

          resolve({
            success: false,
            output: stderr || error.message,
            exitCode: typeof exitCode === 'number' ? exitCode : 1,
          });
          return;
        }

        resolve({
          success: true,
          output: stdout,
          exitCode: 0,
        });
      },
    );
  });
}
