import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import type { ShioriAnnotation } from '../core/types.ts';
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
  /** Extracted annotations (stably sorted by ref, location.file, location.line) */
  records: ShioriAnnotation[];
  /** Number of files scanned */
  filesScanned: number;
}

function sortRecords(records: ShioriAnnotation[]): ShioriAnnotation[] {
  return records.sort((a, b) => {
    if (a.ref !== b.ref) return a.ref.localeCompare(b.ref);
    if (a.location.file !== b.location.file)
      return a.location.file.localeCompare(b.location.file);
    return a.location.line - b.location.line;
  });
}

/**
 * Scan source files and extract shiori annotations.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const files = await fg(options.patterns, {
    ignore: options.ignore,
    cwd: options.cwd,
    onlyFiles: true,
    absolute: false,
  });

  const allRecords: ShioriAnnotation[] = [];

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
