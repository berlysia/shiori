/**
 * Box-drawing utilities for TTY output.
 *
 * Extracted from health.ts (EP-0158) to share between
 * health summary and summary pulse formatter.
 */

/**
 * Estimate the display width of a string, accounting for emoji characters.
 * Emoji (surrogate pairs / characters outside BMP) are treated as width 2.
 * ASCII and other BMP characters are treated as width 1.
 */
export function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    // Emoji and other wide characters: surrogate-pair range, Variation Selectors,
    // Emoji Modifier, Regional Indicators, Miscellaneous Symbols, Dingbats, etc.
    if (
      cp > 0xffff ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x1f000 && cp <= 0x1faff)
    ) {
      width += 2;
    } else if (cp === 0xfe0f) {
      // Variation Selector-16 (emoji presentation) — already counted in base char
      // Skip adding width for this zero-width modifier
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad a string to target display width with spaces on the right.
 * Unlike String.padEnd, this accounts for emoji display widths.
 */
export function padEndDisplay(str: string, targetWidth: number): string {
  const currentWidth = displayWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}

/** Section separator for box layouts */
export type BoxSection = string[];

/**
 * Render an array of content sections inside a Unicode box.
 * Sections are separated by ├─┤ dividers.
 * Each string in a section becomes a │ content │ row.
 */
export function renderBox(sections: BoxSection[]): string {
  const allContentLines = sections.flat();
  if (allContentLines.length === 0) return '';

  const maxContentWidth = Math.max(
    ...allContentLines.map((line) => displayWidth(line)),
  );
  // Inner width = 1 (left pad) + content + 1 (right pad)
  const innerWidth = maxContentWidth + 2;

  const outputLines: string[] = [];
  const hBar = '─'.repeat(innerWidth);

  outputLines.push(`┌${hBar}┐`);

  for (let si = 0; si < sections.length; si++) {
    if (si > 0) {
      outputLines.push(`├${hBar}┤`);
    }
    for (const content of sections[si]!) {
      outputLines.push(`│${padEndDisplay(` ${content}`, innerWidth)}│`);
    }
  }

  outputLines.push(`└${hBar}┘`);

  return outputLines.join('\n');
}
