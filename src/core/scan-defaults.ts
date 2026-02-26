/**
 * Default scan patterns and ignore lists (ADR 015-A).
 *
 * Shared across all CLI commands that perform scanning
 * (scan, check, init, watch) to ensure consistent behavior.
 */

/** Default glob patterns for scanning source files */
export const DEFAULT_SCAN_PATTERNS = ['**/*.{css,scss,pcss,js,ts,tsx,jsx}'];

/**
 * Default ignore patterns for scanning (ADR 015-A).
 *
 * Excludes:
 * - Build artifacts and dependencies (node_modules, dist)
 * - VCS metadata (.git)
 * - Test files (prevent false positives from string literals in tests)
 * - Config directory (prevent scanning registry/config files)
 */
export const DEFAULT_SCAN_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  // Test files (ADR 015-A: prevent false positives from string literals in tests)
  '**/tests/**',
  '**/test/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  // Config directory (prevent scanning registry/config files)
  '**/.config/**',
];
