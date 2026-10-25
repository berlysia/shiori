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
