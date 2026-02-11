/** Parsed shiori fields from a key=value string */
export interface ParsedShioriFields {
  ref: string;
  expires?: string;
  reason?: string;
  [key: string]: string | undefined;
}

/**
 * Parse a shiori key=value field string.
 * Supports unquoted values (ref=SUP-1234) and quoted values (reason="some text").
 * Returns ref='' when ref key is absent (malformed).
 */
export function parseShioriFields(input: string): ParsedShioriFields {
  const fields: Record<string, string> = {};
  const trimmed = input.trim();

  // Bare ref shorthand: a single non-empty token with no '='
  if (trimmed.length > 0 && !trimmed.includes('=') && !/\s/.test(trimmed)) {
    return { ref: trimmed } as ParsedShioriFields;
  }

  let i = 0;
  while (i < trimmed.length) {
    // Skip whitespace
    while (i < trimmed.length && trimmed[i] === ' ') i++;
    if (i >= trimmed.length) break;

    // Read key
    const eqIdx = trimmed.indexOf('=', i);
    if (eqIdx === -1) break;
    const key = trimmed.slice(i, eqIdx);
    i = eqIdx + 1;

    // Read value
    if (i < trimmed.length && (trimmed[i] === '"' || trimmed[i] === "'")) {
      // Quoted value
      const quote = trimmed[i]!;
      i++;
      const closeIdx = trimmed.indexOf(quote, i);
      if (closeIdx === -1) {
        // Unterminated quote: take rest as value
        fields[key] = trimmed.slice(i);
        break;
      }
      fields[key] = trimmed.slice(i, closeIdx);
      i = closeIdx + 1;
    } else {
      // Unquoted value: read until whitespace
      const start = i;
      while (i < trimmed.length && trimmed[i] !== ' ') i++;
      fields[key] = trimmed.slice(start, i);
    }
  }

  return {
    ...fields,
    ref: fields['ref'] ?? '',
  } as ParsedShioriFields;
}
