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
import type { CommentSyntax } from '../comment-syntax.ts';
import { getCommentSyntax } from '../comment-syntax.ts';
import { escapeRegex } from '../regex-utils.ts';

/** Annotation prefix detection (matches "shiori" followed by colon) */
const SHIORI_PREFIX_RE = /\bshiori:\s*/;

/** Ignore directive detection — must be checked before parseShioriFields */
const SHIORI_IGNORE_RE = /\bshiori:ignore\b/;

/** Default resolved patterns (used when no options provided) */
const DEFAULT_RESOLVED_PATTERNS: ResolvedCandidatePatterns =
  resolveCandidatePatterns(DEFAULT_CANDIDATE_PATTERNS);

interface ExtractedComment {
  text: string;
  line: number;
}

function extractComments(
  content: string,
  syntax: CommentSyntax,
): ExtractedComment[] {
  const comments: ExtractedComment[] = [];

  // Extract block comments
  if (syntax.block) {
    for (const blockSyn of syntax.block) {
      const openEsc = escapeRegex(blockSyn.open);
      const closeEsc = escapeRegex(blockSyn.close);
      const blockRe = new RegExp(openEsc + '[\\s\\S]*?' + closeEsc, 'g');
      const openLen = blockSyn.open.length;
      const closeLen = blockSyn.close.length;

      for (const match of content.matchAll(blockRe)) {
        const line = content.slice(0, match.index).split('\n').length;
        let text = match[0]!.slice(openLen, -closeLen);
        if (blockSyn.open === '/*') {
          // For /* */ style, strip leading * from lines (JSDoc convention)
          text = text
            .split('\n')
            .map((l) => l.replace(/^\s*\*\s?/, ''))
            .join(' ')
            .trim();
        } else {
          text = text
            .split('\n')
            .map((l) => l.trim())
            .join(' ')
            .trim();
        }
        comments.push({ text, line });
      }
    }
  }

  // Extract line comments
  if (syntax.line) {
    // Build line regexes with negative lookahead for block openers sharing the same prefix
    const blockOpenPrefixes = (syntax.block ?? []).map((b) => b.open);
    const lineRegexes = syntax.line.map((prefix) => {
      const escaped = escapeRegex(prefix);
      const exclusions = blockOpenPrefixes
        .filter((bp) => bp.startsWith(prefix) && bp !== prefix)
        .map((bp) => `(?!${escapeRegex(bp.slice(prefix.length))})`);
      const pattern =
        exclusions.length > 0
          ? escaped + exclusions.join('') + '.*'
          : escaped + '.*';
      return { prefix, regex: new RegExp(pattern) };
    });

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineContent = lines[i]!;
      for (const { prefix, regex } of lineRegexes) {
        const match = lineContent.match(regex);
        if (match) {
          const text = match[0]!.slice(prefix.length).trim();
          comments.push({ text, line: i + 1 });
          break; // First matching prefix wins for this line
        }
      }
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
 * Always searches metaPart for annotation prefix / ignore directive
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

  // Check for ignore directive first
  const ignoreMatch = metaPart.match(SHIORI_IGNORE_RE);
  if (ignoreMatch) {
    return {
      rules,
      shioriFieldsStr: undefined,
      isIgnored: true,
      capturedText: undefined,
    };
  }

  // Check for annotation prefix in meta part
  const shioriMatch = metaPart.match(SHIORI_PREFIX_RE);
  const shioriFieldsStr = shioriMatch
    ? metaPart.slice(shioriMatch.index! + shioriMatch[0].length).trim()
    : undefined;

  // Capture text if configured
  const capturedText = matcher.captureText
    ? rest.trim() || undefined
    : undefined;

  return { rules, shioriFieldsStr, isIgnored: false, capturedText };
}

/**
 * CommentProvider: extracts shiori annotations and candidates from source code comments.
 *
 * Classification paths:
 * - **Path A**: Lint directive + `shiori:` prefix → full annotation with rule
 * - **Path B**: Standalone `shiori:` comment → annotation without rule
 * - **Path C**: Lint directive without `shiori:` → candidate for potential tracking
 * - **Path D**: Regular comment → ignored
 */
export class CommentProvider implements AnnotationProvider {
  readonly name = 'CommentProvider';

  /**
   * Scan a single file for shiori annotations and candidates.
   *
   * Extracts comments using language-appropriate syntax (detected from file extension),
   * then classifies each comment through paths A–D.
   *
   * @param file - File path and content to scan
   * @param options - Optional candidate pattern overrides
   * @returns Extracted annotations and candidates
   */
  scan(file: FileInput, options?: ProviderScanOptions): ProviderResult {
    const annotations: ShioriAnnotation[] = [];
    const candidates: ShioriCandidate[] = [];
    const patterns: ResolvedCandidatePatterns =
      options?.candidatePatterns ?? DEFAULT_RESOLVED_PATTERNS;
    const syntax = getCommentSyntax(file.path);
    const comments = extractComments(file.content, syntax);

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
            // Ignore directive detected
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
            // Path A: matcher + annotation prefix
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
            // Path C: matcher without annotation prefix → candidate
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

      // Path B: standalone annotation prefix (no matcher matched)
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
