import type { ShioriAnnotation, ShioriCandidate } from '../types.ts';
import type {
  FileInput,
  AnnotationProvider,
  ProviderResult,
  ProviderScanOptions,
  ResolvedCandidatePatterns,
  ResolvedMatcher,
} from './AnnotationProvider.ts';
import {
  DEFAULT_CANDIDATE_PATTERNS,
  resolveCandidatePatterns,
} from './AnnotationProvider.ts';
import { parseShioriFields } from '../parser.ts';

// Regex for block comments
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

// Regex for line comments
const LINE_COMMENT_RE = /\/\/.*/g;

/** shiori: prefix detection */
const SHIORI_PREFIX_RE = /\bshiori:\s*/;

/** shiori:ignore detection — must be checked before parseShioriFields */
const SHIORI_IGNORE_RE = /\bshiori:ignore\b/;

/** Default resolved patterns (used when no options provided) */
const DEFAULT_RESOLVED_PATTERNS: ResolvedCandidatePatterns =
  resolveCandidatePatterns(DEFAULT_CANDIDATE_PATTERNS);

interface ExtractedComment {
  text: string;
  line: number;
}

function extractComments(content: string): ExtractedComment[] {
  const comments: ExtractedComment[] = [];

  // Extract block comments
  for (const match of content.matchAll(BLOCK_COMMENT_RE)) {
    const line = content.slice(0, match.index).split('\n').length;
    // Normalize block comment: remove /* */, strip * prefixes, join lines
    let text = match[0]!.slice(2, -2); // remove /* and */
    text = text
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, ''))
      .join(' ')
      .trim();
    comments.push({ text, line });
  }

  // Extract line comments
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i]!;
    const match = lineContent.match(LINE_COMMENT_RE);
    if (match) {
      const text = match[0]!.slice(2).trim(); // remove //
      comments.push({ text, line: i + 1 });
    }
  }

  return comments;
}

function parseRulesCsv(rulesStr: string): string[] {
  const byComma = rulesStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (byComma.length > 1) {
    return byComma;
  }
  return rulesStr.split(/\s+/).filter(Boolean);
}

interface ParsedMatcherResult {
  rules: string[];
  shioriFieldsStr: string | undefined;
  isIgnored: boolean;
  capturedText: string | undefined;
}

/**
 * Generic parse function for matcher rest content.
 *
 * separator null → rulesPart='', metaPart=rest
 * separator set → split at first separator
 *
 * rules:
 *   'csv' → comma-split → space fallback
 *   'single' → single rule
 *   null → no rules
 *
 * Always searches metaPart for shiori: / shiori:ignore
 */
function parseMatcherRest(
  rest: string,
  matcher: ResolvedMatcher,
): ParsedMatcherResult {
  let rulesPart: string;
  let metaPart: string;

  if (matcher.separator != null) {
    const sepIndex = rest.indexOf(matcher.separator);
    if (sepIndex >= 0) {
      rulesPart = rest.slice(0, sepIndex);
      metaPart = rest.slice(sepIndex + matcher.separator.length);
    } else {
      rulesPart = rest;
      metaPart = '';
    }
  } else {
    rulesPart = '';
    metaPart = rest;
  }

  // Clean trailing block comment artifacts
  const cleanRulesPart = rulesPart.replace(/\s*\*\/\s*$/, '').trim();

  // Extract rules
  let rules: string[];
  if (matcher.rules === 'csv') {
    rules = cleanRulesPart ? parseRulesCsv(cleanRulesPart) : [];
  } else if (matcher.rules === 'single') {
    rules = cleanRulesPart ? [cleanRulesPart] : [];
  } else {
    rules = [];
  }

  // Check for shiori:ignore first
  const ignoreMatch = metaPart.match(SHIORI_IGNORE_RE);
  if (ignoreMatch) {
    return { rules, shioriFieldsStr: undefined, isIgnored: true, capturedText: undefined };
  }

  // Check for shiori: prefix in meta part
  const shioriMatch = metaPart.match(SHIORI_PREFIX_RE);
  const shioriFieldsStr = shioriMatch
    ? metaPart.slice(shioriMatch.index! + shioriMatch[0].length).trim()
    : undefined;

  // Capture text if configured
  const capturedText = matcher.captureText
    ? (rest.trim() || undefined)
    : undefined;

  return { rules, shioriFieldsStr, isIgnored: false, capturedText };
}

/** CommentProvider: extracts shiori annotations and candidates from comments */
export class CommentProvider implements AnnotationProvider {
  readonly name = 'CommentProvider';

  scan(file: FileInput, options?: ProviderScanOptions): ProviderResult {
    const annotations: ShioriAnnotation[] = [];
    const candidates: ShioriCandidate[] = [];
    const patterns: ResolvedCandidatePatterns =
      options?.candidatePatterns ?? DEFAULT_RESOLVED_PATTERNS;
    const comments = extractComments(file.content);

    for (const comment of comments) {
      const { text, line } = comment;

      // Try all entry matchers
      let matched = false;
      for (const [entryName, matchers] of Object.entries(patterns.entries)) {
        if (matched) break;
        for (const matcher of matchers) {
          const m = text.match(matcher.pattern);
          if (!m) continue;

          matched = true;
          const rest = (m[1] ?? '').trim();
          const parsed = parseMatcherRest(rest, matcher);

          if (parsed.isIgnored) {
            // shiori:ignore detected
            const pushIgnored = (rule: string | undefined) => {
              annotations.push({
                ref: '',
                rule,
                tagged: true,
                ignored: true,
                location: { file: file.path, line },
              });
            };
            if (parsed.rules.length === 0) {
              pushIgnored(undefined);
            } else {
              for (const rule of parsed.rules) {
                pushIgnored(rule);
              }
            }
          } else if (parsed.shioriFieldsStr !== undefined) {
            // Path A: matcher + shiori:
            const fields = parseShioriFields(parsed.shioriFieldsStr);
            const syntaxErrors =
              fields.errors.length > 0 ? fields.errors : undefined;
            if (parsed.rules.length === 0) {
              annotations.push({
                ref: fields.ref,
                rule: undefined,
                expires: fields.expires,
                reason: fields.reason,
                tagged: true,
                ignored: false,
                syntaxErrors,
                location: { file: file.path, line },
              });
            } else {
              for (const rule of parsed.rules) {
                annotations.push({
                  ref: fields.ref,
                  rule,
                  expires: fields.expires,
                  reason: fields.reason,
                  tagged: true,
                  ignored: false,
                  syntaxErrors,
                  location: { file: file.path, line },
                });
              }
            }
          } else if (matcher.enabled) {
            // Path C: matcher without shiori: → candidate
            const directive =
              matcher.name !== 'default' ? matcher.name : undefined;
            if (parsed.rules.length === 0) {
              candidates.push({
                pattern: entryName,
                directive,
                text: parsed.capturedText,
                location: { file: file.path, line },
              });
            } else {
              for (const rule of parsed.rules) {
                candidates.push({
                  pattern: entryName,
                  directive,
                  rule,
                  text: parsed.capturedText,
                  location: { file: file.path, line },
                });
              }
            }
          }

          break; // First match wins within this entry
        }
      }

      if (matched) continue;

      // Path B: standalone shiori: (no matcher matched)
      const shioriMatch = text.match(SHIORI_PREFIX_RE);
      if (shioriMatch) {
        const fieldsStr = text
          .slice(shioriMatch.index! + shioriMatch[0].length)
          .trim();
        const fields = parseShioriFields(fieldsStr);
        const syntaxErrors =
          fields.errors.length > 0 ? fields.errors : undefined;
        annotations.push({
          ref: fields.ref,
          rule: undefined,
          expires: fields.expires,
          reason: fields.reason,
          tagged: true,
          ignored: false,
          syntaxErrors,
          location: { file: file.path, line },
        });
        continue;
      }

      // Regular comment → ignore
    }

    return { annotations, candidates };
  }
}
