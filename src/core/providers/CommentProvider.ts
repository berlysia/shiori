import type { ShioriAnnotation, ShioriCandidate } from '../types.ts';
import type {
  FileInput,
  AnnotationProvider,
  ProviderResult,
  ProviderScanOptions,
  CandidatePatternConfig,
} from './AnnotationProvider.ts';
import { DEFAULT_CANDIDATE_PATTERNS } from './AnnotationProvider.ts';
import { parseShioriFields } from '../parser.ts';

// Regex for block comments
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

// Regex for line comments
const LINE_COMMENT_RE = /\/\/.*/g;

/** Lint directive patterns (captures: [1]=tool, [2]=directive-type, [3]=after-directive) */
const STYLELINT_DIRECTIVE_RE =
  /\b(stylelint)-disable-(next-line|line)\s+([\s\S]+)/;
const ESLINT_DIRECTIVE_RE = /\b(eslint)-disable-(next-line|line)\s+(.*)/;

/** shiori: prefix detection */
const SHIORI_PREFIX_RE = /\bshiori:\s*/;

/** shiori:ignore detection — must be checked before parseShioriFields */
const SHIORI_IGNORE_RE = /\bshiori:ignore\b/;

/** TODO-like keyword patterns at comment start (case-sensitive) */
const TODO_KEYWORD_RE = /^(TODO|FIXME|HACK|XXX)\b:?\s*(.*)/;

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

function parseRules(rulesStr: string): string[] {
  const byComma = rulesStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (byComma.length > 1) {
    return byComma;
  }
  return rulesStr.split(/\s+/).filter(Boolean);
}

interface ParsedDirective {
  rules: string[];
  shioriFieldsStr: string | undefined;
  isIgnored: boolean;
  /** When ignore is combined with other fields, it's a syntax error */
  ignoreConflict: boolean;
}

function parseDirectiveContent(afterDirective: string): ParsedDirective {
  const dashIndex = afterDirective.indexOf('--');
  const rulesPart =
    dashIndex >= 0 ? afterDirective.slice(0, dashIndex) : afterDirective;
  const metaPart = dashIndex >= 0 ? afterDirective.slice(dashIndex + 2) : '';

  const cleanRulesPart = rulesPart.replace(/\s*\*\/\s*$/, '').trim();
  const rules = cleanRulesPart ? parseRules(cleanRulesPart) : [];

  // Check for shiori:ignore first (before general shiori: prefix)
  const ignoreMatch = metaPart.match(SHIORI_IGNORE_RE);
  if (ignoreMatch) {
    // Check if there are other fields after "ignore"
    const afterIgnore = metaPart
      .slice(ignoreMatch.index! + ignoreMatch[0].length)
      .trim();
    // Also check for fields before "shiori:ignore" within the shiori: context
    const shioriMatch = metaPart.match(SHIORI_PREFIX_RE);
    const beforeIgnore = shioriMatch
      ? metaPart
          .slice(shioriMatch.index! + shioriMatch[0].length)
          .replace(/ignore\b/, '')
          .trim()
      : '';

    const hasExtraFields = afterIgnore.length > 0 || beforeIgnore.length > 0;
    return {
      rules,
      shioriFieldsStr: undefined,
      isIgnored: true,
      ignoreConflict: hasExtraFields,
    };
  }

  // Check for shiori: prefix in meta part
  const shioriMatch = metaPart.match(SHIORI_PREFIX_RE);
  const shioriFieldsStr = shioriMatch
    ? metaPart.slice(shioriMatch.index! + shioriMatch[0].length).trim()
    : undefined;

  return { rules, shioriFieldsStr, isIgnored: false, ignoreConflict: false };
}

/** Map TODO keyword to CandidatePattern */
const KEYWORD_TO_PATTERN: Record<string, ShioriCandidate['pattern']> = {
  TODO: 'todo',
  FIXME: 'fixme',
  HACK: 'hack',
  XXX: 'xxx',
};

/** CommentProvider: extracts shiori annotations and candidates from comments */
export class CommentProvider implements AnnotationProvider {
  readonly name = 'CommentProvider';

  scan(file: FileInput, options?: ProviderScanOptions): ProviderResult {
    const annotations: ShioriAnnotation[] = [];
    const candidates: ShioriCandidate[] = [];
    const patterns: CandidatePatternConfig =
      options?.candidatePatterns ?? DEFAULT_CANDIDATE_PATTERNS;
    const comments = extractComments(file.content);

    for (const comment of comments) {
      const { text, line } = comment;

      // Try lint directive patterns first
      const stylelintMatch = text.match(STYLELINT_DIRECTIVE_RE);
      const eslintMatch = text.match(ESLINT_DIRECTIVE_RE);

      if (stylelintMatch || eslintMatch) {
        const match = stylelintMatch ?? eslintMatch!;
        const afterDirective = match[3]!;
        const { rules, shioriFieldsStr, isIgnored, ignoreConflict } =
          parseDirectiveContent(afterDirective);

        if (isIgnored) {
          // shiori:ignore detected
          const syntaxErrors = ignoreConflict
            ? ['shiori:ignore cannot be combined with other fields']
            : undefined;
          const pushIgnored = (rule: string | undefined) => {
            annotations.push({
              ref: '',
              rule,
              tagged: true,
              ignored: !ignoreConflict,
              syntaxErrors,
              location: { file: file.path, line },
            });
          };
          if (rules.length === 0) {
            pushIgnored(undefined);
          } else {
            for (const rule of rules) {
              pushIgnored(rule);
            }
          }
        } else if (shioriFieldsStr !== undefined) {
          // Path A: lint directive + shiori:
          const fields = parseShioriFields(shioriFieldsStr);
          const syntaxErrors =
            fields.errors.length > 0 ? fields.errors : undefined;
          if (rules.length === 0) {
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
            for (const rule of rules) {
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
        } else if (patterns['lint-disable']) {
          // Path C: lint directive without shiori: → candidate
          if (rules.length === 0) {
            candidates.push({
              pattern: 'lint-disable',
              location: { file: file.path, line },
            });
          } else {
            for (const rule of rules) {
              candidates.push({
                pattern: 'lint-disable',
                rule,
                location: { file: file.path, line },
              });
            }
          }
        }
        continue;
      }

      // Path B: standalone shiori: (shiori:ignore on standalone is treated as normal parse — bare ref 'ignore')
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

      // Path D: check for TODO/FIXME/HACK/XXX keywords
      const todoMatch = text.match(TODO_KEYWORD_RE);
      if (todoMatch) {
        const keyword = todoMatch[1]!;
        const pattern = KEYWORD_TO_PATTERN[keyword];
        if (pattern && patterns[pattern]) {
          candidates.push({
            pattern,
            text: todoMatch[2]?.trim() || undefined,
            location: { file: file.path, line },
          });
        }
        continue;
      }

      // Regular comment → ignore
    }

    return { annotations, candidates };
  }
}
