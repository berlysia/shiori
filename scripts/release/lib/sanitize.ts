// The one definition of the characters that must not reach CHANGELOG.md or a
// terminal. Changeset validation rejects them and terminal output strips them,
// so the two cannot drift apart.

// Code-point ranges instead of a regex literal: a character class of control
// characters trips `no-control-regex`, and a range table reads more plainly.
// Tab and LF are outside the ranges; callers treat LF as a line break.
const FORBIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008], // C0 before tab (NUL included)
  [0x000b, 0x001f], // C0 after LF (CR and ESC included)
  [0x007f, 0x009f], // DEL and C1
  [0x2028, 0x2029], // line and paragraph separators (Zl, Zp; not Cf)
];

// Cf covers bidi controls (U+202A-202E, U+2066-2069), zero-width characters
// (U+200B, U+2060) and the BOM (U+FEFF).
const FORMAT_CHARACTER = /^\p{Cf}$/u;

export function isForbiddenChar(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return false;
  if (
    FORBIDDEN_RANGES.some(
      ([low, high]) => codePoint >= low && codePoint <= high,
    )
  ) {
    return true;
  }
  return FORMAT_CHARACTER.test(char);
}

export function hasForbiddenChar(text: string): boolean {
  for (const char of text) if (isForbiddenChar(char)) return true;
  return false;
}

// Strips what hasForbiddenChar rejects, except tab and LF (never in the
// rejected set). The text may still contain ordinary characters such as "[";
// only characters that can move the cursor, recolour or reorder the terminal,
// or hide text, are removed. Every string that goes to a terminal and did not
// originate in this repo's own code, file names included, passes through here.
export function sanitizeForTerminal(text: string): string {
  let result = '';
  for (const char of text) if (!isForbiddenChar(char)) result += char;
  return result;
}
