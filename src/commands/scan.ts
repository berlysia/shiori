import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import type { SuppressionRecord } from '../core/types.ts';
import type { SuppressionProvider } from '../core/providers/SuppressionProvider.ts';

export interface ScanOptions {
  /** Glob patterns to scan */
  patterns: string[];
  /** Glob patterns to exclude */
  ignore: string[];
  /** Suppression provider to use */
  provider: SuppressionProvider;
  /** Working directory for glob resolution */
  cwd: string;
}

export interface ScanResult {
  /** Extracted records (stably sorted by id, file, line) */
  records: SuppressionRecord[];
  /** Number of files scanned */
  filesScanned: number;
}

function sortRecords(records: SuppressionRecord[]): SuppressionRecord[] {
  return records.sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

/**
 * Scan source files and extract lint suppression records.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const files = await fg(options.patterns, {
    ignore: options.ignore,
    cwd: options.cwd,
    onlyFiles: true,
    absolute: false,
  });

  const allRecords: SuppressionRecord[] = [];

  for (const filePath of files) {
    const absolutePath = `${options.cwd}/${filePath}`;
    const content = await readFile(absolutePath, 'utf-8');
    const records = options.provider.scan({ path: filePath, content });
    allRecords.push(...records);
  }

  return {
    records: sortRecords(allRecords),
    filesScanned: files.length,
  };
}
