import { access, readFile } from 'node:fs/promises';

/**
 * Check if a line pattern already exists in a file.
 * Returns true if the file contains the pattern.
 */
export async function fileContainsLine(
  filePath: string,
  pattern: string,
): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.split('\n').some((line) => line.trim() === pattern.trim());
  } catch {
    return false;
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
