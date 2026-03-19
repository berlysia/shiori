/**
 * Escape special regex characters in a string so it can be used in `new RegExp(...)`.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
