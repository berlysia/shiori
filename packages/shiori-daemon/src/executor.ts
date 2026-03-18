import { execFile } from 'node:child_process';
import type { DaemonConfig, ExecuteResult } from './types.ts';

/**
 * Execute `shiori resolve --closed --format json --yes` as a child process.
 *
 * Inherits GITHUB_TOKEN from the daemon's environment so the CLI can
 * detect closed GitHub issues.
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
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode =
            error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? 1
              : (error as NodeJS.ErrnoException & { code?: number | string })
                    .code === 'ETIMEDOUT'
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
