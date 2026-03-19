/** Type guard for Node.js system errors (ENOENT, EACCES, etc.) */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
