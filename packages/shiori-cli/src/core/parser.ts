/** Parsed shiori fields from a key=value string */
export interface ParsedShioriFields {
  ref: string;
  expires?: string;
  reason?: string;
  errors: string[];
  [key: string]: string | string[] | undefined;
}

/**
 * Parse a shiori field string with positional ref.
 * The first token (before whitespace) is treated as a positional ref if it
 * does not contain '='. Remaining tokens are parsed as key=value pairs.
 * The key 'ref' is not valid in key=value pairs and produces a parse error.
 */
export function parseShioriFields(input: string): ParsedShioriFields {
  const fields: Record<string, string> = {};
  const errors: string[] = [];
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { ref: '', errors } as ParsedShioriFields;
  }

  // Determine positional ref from the first token
  const firstSpaceIdx = trimmed.search(/\s/);
  const firstToken =
    firstSpaceIdx === -1 ? trimmed : trimmed.slice(0, firstSpaceIdx);

  let positionalRef = '';
  let remainder = trimmed;

  if (!firstToken.includes('=')) {
    positionalRef = firstToken;
    remainder = firstSpaceIdx === -1 ? '' : trimmed.slice(firstSpaceIdx).trim();
  }

  // Parse remainder as key=value pairs
  let i = 0;
  while (i < remainder.length) {
    // Skip whitespace
    while (i < remainder.length && remainder[i] === ' ') i++;
    if (i >= remainder.length) break;

    // Read key
    const eqIdx = remainder.indexOf('=', i);
    if (eqIdx === -1) {
      // Bare token without '=' in key=value section
      const token = remainder.slice(i).trim();
      if (token) {
        errors.push(`unexpected bare token '${token}'`);
      }
      break;
    }
    const key = remainder.slice(i, eqIdx);

    // Missing key before '='
    if (key === '') {
      errors.push("missing key before '='");
      i = eqIdx + 1;
      // Skip value to continue parsing
      while (i < remainder.length && remainder[i] !== ' ') i++;
      continue;
    }

    // Reject 'ref' as a key=value key
    if (key === 'ref') {
      errors.push("'ref' is not a valid key; use positional syntax");
      i = eqIdx + 1;
      // Skip the value using the same logic as normal value parsing
      if (
        i < remainder.length &&
        (remainder[i] === '"' || remainder[i] === "'")
      ) {
        const quote = remainder[i]!;
        i++;
        // NOTE: mirrors quoted-value escape logic at L93–112 (normal value parsing)
        while (i < remainder.length) {
          if (remainder[i] === '\\' && i + 1 < remainder.length) {
            i += 2;
          } else if (remainder[i] === quote) {
            i++;
            break;
          } else {
            i++;
          }
        }
      } else {
        while (i < remainder.length && remainder[i] !== ' ') i++;
      }
      continue;
    }

    i = eqIdx + 1;

    // Read value
    if (
      i < remainder.length &&
      (remainder[i] === '"' || remainder[i] === "'")
    ) {
      // Quoted value (supports backslash escapes: \" \\ \' )
      const quote = remainder[i]!;
      i++;
      let value = '';
      let closed = false;
      while (i < remainder.length) {
        if (remainder[i] === '\\' && i + 1 < remainder.length) {
          // Escaped character: consume backslash + next char
          value += remainder[i + 1];
          i += 2;
        } else if (remainder[i] === quote) {
          closed = true;
          i++;
          break;
        } else {
          value += remainder[i];
          i++;
        }
      }
      if (!closed) {
        errors.push(`unterminated quote for key '${key}'`);
      }
      fields[key] = value;
    } else {
      // Unquoted value: read until whitespace
      const start = i;
      while (i < remainder.length && remainder[i] !== ' ') i++;
      const value = remainder.slice(start, i);

      // Empty value (key= followed by space or EOF)
      if (value === '') {
        errors.push(`empty value for key '${key}'`);
      }

      fields[key] = value;
    }
  }

  return {
    ...fields,
    ref: positionalRef,
    errors,
  } as ParsedShioriFields;
}
