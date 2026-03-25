/** Type guard for Node.js system errors (ENOENT, EACCES, etc.) */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** Thrown when a scan result file is not found on disk. */
export class ScanResultNotFoundError extends Error {
  readonly filePath: string;

  constructor(filePath: string) {
    super(
      `Scan result file not found: ${filePath}\nRun 'shiori scan' first to generate it.`,
    );
    this.name = 'ScanResultNotFoundError';
    this.filePath = filePath;
  }
}

/** Thrown when no registry file is found (project not initialized). */
export class RegistryNotFoundError extends Error {
  readonly triedPaths: string[];

  constructor(triedPaths: string[]) {
    const tried = triedPaths.map((p) => `  ${p} (not found)`).join('\n');
    super(`No registry file found. Tried:\n${tried}`);
    this.name = 'RegistryNotFoundError';
    this.triedPaths = triedPaths;
  }
}
