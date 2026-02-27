import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ScanResult } from './types.ts';
import type { ResolvedConfig } from './config.ts';
import { DEFAULT_SCAN_RESULT_PATH } from './config.ts';
import { isNodeError } from './errors.ts';

export interface LoadScanResultOptions {
  /** Value of --scan argument (undefined if not provided, "-" for stdin) */
  explicitPath: string | undefined;
  config: ResolvedConfig;
  cwd: string;
}

/**
 * Load scan result from the best available source.
 *
 * Resolution order:
 * 1. --scan <path> explicit argument
 * 2. --scan - → stdin
 * 3. --scan not set, stdin is piped → stdin
 * 4. config.paths.scanResult
 * 5. .config/shiori/scan-result.json (hardcoded default)
 * 6. Error with tried sources listed
 */
export async function loadScanResult(
  options: LoadScanResultOptions,
): Promise<ScanResult> {
  const { explicitPath, config, cwd } = options;

  // 1. Explicit path (resolve relative paths against cwd)
  if (explicitPath && explicitPath !== '-') {
    return readScanResultFile(resolve(cwd, explicitPath));
  }

  // 2. Explicit stdin request
  if (explicitPath === '-') {
    return readFromStdin();
  }

  // 3. Piped stdin (non-TTY)
  if (!process.stdin.isTTY) {
    return readFromStdin();
  }

  // 4-5. File-based resolution
  const candidates: { label: string; path: string }[] = [];

  const configPath = config.paths.scanResult;
  const configFullPath = resolve(cwd, configPath);

  if (configPath !== DEFAULT_SCAN_RESULT_PATH) {
    // Config specifies a custom path — try it first, then the default
    candidates.push({ label: `config: ${configPath}`, path: configFullPath });
    candidates.push({
      label: DEFAULT_SCAN_RESULT_PATH,
      path: resolve(cwd, DEFAULT_SCAN_RESULT_PATH),
    });
  } else {
    // Default path only
    candidates.push({
      label: DEFAULT_SCAN_RESULT_PATH,
      path: configFullPath,
    });
  }

  for (const candidate of candidates) {
    try {
      await access(candidate.path);
      return await readScanResultFile(candidate.path);
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        // not found, try next
        continue;
      }
      throw err;
    }
  }

  const tried = [
    '  stdin (not piped)',
    ...candidates.map((c) => `  ${c.label} (not found)`),
  ].join('\n');
  throw new Error(`No scan result found. Tried:\n${tried}`);
}

async function readScanResultFile(filePath: string): Promise<ScanResult> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(
        `Scan result file not found: ${filePath}\nRun 'shiori scan' first to generate it.`,
      );
    }
    if (isNodeError(err) && err.code === 'EACCES') {
      throw new Error(
        `Permission denied reading scan result file: ${filePath}`,
      );
    }
    throw err;
  }

  try {
    return JSON.parse(content) as ScanResult;
  } catch {
    throw new Error(
      `Failed to parse scan result as JSON: ${filePath}\nEnsure the file contains valid JSON from 'shiori scan'.`,
    );
  }
}

async function readFromStdin(): Promise<ScanResult> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const content = Buffer.concat(chunks).toString('utf-8');

  if (content.trim() === '') {
    throw new Error(
      "No input received on stdin.\nRun 'shiori scan' first and pipe the output, or use '--scan <path>' to specify a file.",
    );
  }

  try {
    return JSON.parse(content) as ScanResult;
  } catch {
    throw new Error(
      "Failed to parse stdin input as JSON.\nEnsure the piped input is valid JSON from 'shiori scan'.",
    );
  }
}
