// Strict semver 2.0.0 version check. A version read from `changeset status`
// or package.json ends up in a tag name, a commit message, a source file and
// command arguments, so only a value that passes here may be used there.

declare const validVersion: unique symbol;

// The brand makes "was validated" visible in function signatures.
export type ValidVersion = string & { readonly [validVersion]: true };

export type ParsedVersion =
  | {
      readonly ok: true;
      readonly version: ValidVersion;
      readonly prerelease: boolean;
    }
  | { readonly ok: false; readonly reason: string };

const MAX_LENGTH = 256;

// Not a multiline pattern: `$` must mean the end of the text, so a trailing
// newline or a second line cannot slip through. Build metadata (`+`) is not
// accepted: the release flow has no use for it.
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(text: string): ParsedVersion {
  if (text.length > MAX_LENGTH) {
    return {
      ok: false,
      reason: `version is longer than ${MAX_LENGTH} characters`,
    };
  }
  const match = VERSION_PATTERN.exec(text);
  if (match === null) {
    return {
      ok: false,
      reason: 'version is not a plain semver "X.Y.Z[-prerelease]"',
    };
  }
  const prerelease = match[4];
  if (prerelease !== undefined) {
    // semver 2.0.0 section 9: numeric identifiers carry no leading zero
    const identifiers = prerelease.slice(1).split('.');
    if (identifiers.some((id) => /^0\d+$/.test(id))) {
      return {
        ok: false,
        reason: 'numeric prerelease identifier has a leading zero',
      };
    }
  }
  return {
    ok: true,
    version: text as ValidVersion,
    prerelease: prerelease !== undefined,
  };
}

// semver 2.0.0 section 11. Both arguments must have passed parseVersion.
export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const [leftCore = '', leftPre] = splitPrerelease(left);
  const [rightCore = '', rightPre] = splitPrerelease(right);
  const leftParts = leftCore.split('.').map(Number);
  const rightParts = rightCore.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  // a prerelease sorts below the stable version with the same core
  if (leftPre === undefined && rightPre === undefined) return 0;
  if (leftPre === undefined) return 1;
  if (rightPre === undefined) return -1;
  const a = leftPre.split('.');
  const b = rightPre.split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index];
    const y = b[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const order = compareIdentifier(x, y);
    if (order !== 0) return order;
  }
  return 0;
}

function splitPrerelease(version: string): [string, string | undefined] {
  const dash = version.indexOf('-');
  return dash === -1
    ? [version, undefined]
    : [version.slice(0, dash), version.slice(dash + 1)];
}

function compareIdentifier(x: string, y: string): -1 | 0 | 1 {
  const xNumeric = /^\d+$/.test(x);
  const yNumeric = /^\d+$/.test(y);
  if (xNumeric && yNumeric) {
    const a = Number(x);
    const b = Number(y);
    return a === b ? 0 : a < b ? -1 : 1;
  }
  // numeric identifiers sort below alphanumeric ones
  if (xNumeric) return -1;
  if (yNumeric) return 1;
  return x === y ? 0 : x < y ? -1 : 1;
}
