import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertWithinCwd, PathBoundaryError } from './path-boundary.ts';
import { ExitCode } from './exit-codes.ts';

/**
 * Write formatted output to a file or stdout.
 *
 * When outputPath is provided:
 * - Resolves relative to cwd
 * - Validates path is within cwd (path boundary check)
 * - Creates parent directories as needed
 * - Writes content with trailing newline
 * - Logs destination to stderr
 *
 * When outputPath is undefined:
 * - Writes to stdout via console.log
 *
 * @param content - The formatted output string
 * @param options - Output configuration
 * @returns true if output was written successfully, false if path boundary error
 */
export async function writeOutput(
  content: string,
  options: {
    outputPath?: string;
    cwd: string;
    /** Label for stderr message (e.g. "Report", "Delta report"). Default: "Output" */
    label?: string;
  },
): Promise<boolean> {
  if (options.outputPath) {
    const resolvedPath = resolve(options.cwd, options.outputPath);
    try {
      await assertWithinCwd(resolvedPath, options.cwd);
    } catch (err) {
      if (err instanceof PathBoundaryError) {
        console.error(`Error: ${err.message}`);
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return false;
      }
      throw err;
    }
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, content + '\n', 'utf-8');
    console.error(`${options.label ?? 'Output'} written to ${resolvedPath}`);
  } else {
    console.log(content);
  }
  return true;
}
