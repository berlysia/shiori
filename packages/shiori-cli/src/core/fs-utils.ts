import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isNodeError } from './errors.ts';
import { CONFIG_FILENAMES } from './config.ts';

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
 * Search for an existing config file in the given directory.
 * Returns the filename if found, undefined otherwise.
 */
export async function findExistingConfig(
  configDir: string,
): Promise<string | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    if (await fileExists(join(configDir, filename))) {
      return filename;
    }
  }
  return undefined;
}
