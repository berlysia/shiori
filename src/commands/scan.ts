import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import type { AnnotationRecord } from '../core/types.ts';
import type { AnnotationProvider } from '../core/providers/AnnotationProvider.ts';

export interface ScanOptions {
  /** Glob patterns to scan */
  patterns: string[];
  /** Glob patterns to exclude */
  ignore: string[];
  /** Annotation provider to use */
  provider: AnnotationProvider;
  /** Working directory for glob resolution */
  cwd: string;
}

export interface ScanResult {
  /** Extracted records (stably sorted by id, verb, file, line) */
  records: AnnotationRecord[];
  /** Number of files scanned */
  filesScanned: number;
}

function sortRecords(records: AnnotationRecord[]): AnnotationRecord[] {
  return records.sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    if (a.verb !== b.verb) return a.verb.localeCompare(b.verb);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

/**
 * Scan source files and extract annotation records.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const files = await fg(options.patterns, {
    ignore: options.ignore,
    cwd: options.cwd,
    onlyFiles: true,
    absolute: false,
  });

  const allRecords: AnnotationRecord[] = [];

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
