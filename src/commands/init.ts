import { access, readFile } from 'node:fs/promises';

/**
 * Check if a line pattern already exists in a file.
 * Returns true if the file contains the pattern.
 * Returns false if the file does not exist (ENOENT).
 */
export async function fileContainsLine(
  filePath: string,
  pattern: string,
): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.split('\n').some((line) => line.trim() === pattern.trim());
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return false;
    throw err;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
