/**
 * Single source of truth for shiori CLI version.
 *
 * All modules that need the version string should import from here
 * instead of hardcoding the value.
 *
 * A constant rather than a package.json read: the published package ships only
 * dist/src/, and src, dist/src and the esbuild bundle sit at different depths.
 * The release script's bumpp call rewrites it, and tests/version.test.ts fails
 * when it drifts from package.json.
 */
export const VERSION = '0.2.2-beta.1';
