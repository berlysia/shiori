/** Parsed shiori fields from a key=value string */
export interface ParsedShioriFields {
  ref: string;
  expires?: string;
  reason?: string;
  errors: string[];
  [key: string]: string | string[] | undefined;
}

/**
 * Parse a shiori key=value field string.
 * Supports unquoted values (ref=SUP-1234) and quoted values (reason="some text").
 * Returns ref='' when ref key is absent (malformed).
 */
export function parseShioriFields(input: string): ParsedShioriFields {
  const fields: Record<string, string> = {};
  const errors: string[] = [];
  const trimmed = input.trim();

  // Bare ref shorthand: a single non-empty token with no '='
  if (trimmed.length > 0 && !trimmed.includes('=') && !/\s/.test(trimmed)) {
    return { ref: trimmed, errors } as ParsedShioriFields;
  }

  let i = 0;
  while (i < trimmed.length) {
    // Skip whitespace
    while (i < trimmed.length && trimmed[i] === ' ') i++;
    if (i >= trimmed.length) break;

    // Read key
    const eqIdx = trimmed.indexOf('=', i);
    if (eqIdx === -1) {
      // Bare token without '=' (not at start, so not bare ref shorthand)
      const token = trimmed.slice(i).trim();
      if (token) {
        errors.push(`unexpected bare token '${token}'`);
      }
      break;
    }
    const key = trimmed.slice(i, eqIdx);

    // Missing key before '='
    if (key === '') {
      errors.push("missing key before '='");
      i = eqIdx + 1;
      // Skip value to continue parsing
      while (i < trimmed.length && trimmed[i] !== ' ') i++;
      continue;
    }

    i = eqIdx + 1;

    // Read value
    if (i < trimmed.length && (trimmed[i] === '"' || trimmed[i] === "'")) {
      // Quoted value
      const quote = trimmed[i]!;
      i++;
      const closeIdx = trimmed.indexOf(quote, i);
      if (closeIdx === -1) {
        // Unterminated quote: take rest as value
        errors.push(`unterminated quote for key '${key}'`);
        fields[key] = trimmed.slice(i);
        break;
      }
      fields[key] = trimmed.slice(i, closeIdx);
      i = closeIdx + 1;
    } else {
      // Unquoted value: read until whitespace
      const start = i;
      while (i < trimmed.length && trimmed[i] !== ' ') i++;
      const value = trimmed.slice(start, i);

      // Empty value (key= followed by space or EOF)
      if (value === '') {
        errors.push(`empty value for key '${key}'`);
      }

      fields[key] = value;
    }
  }

  return {
    ...fields,
    ref: fields['ref'] ?? '',
    errors,
  } as ParsedShioriFields;
}
