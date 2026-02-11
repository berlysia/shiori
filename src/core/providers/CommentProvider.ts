import type { ShioriAnnotation } from '../types.ts';
import type { FileInput, AnnotationProvider } from './AnnotationProvider.ts';
import { parseShioriFields } from '../parser.ts';

// Regex for block comments
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

// Regex for line comments
const LINE_COMMENT_RE = /\/\/.*/g;

/** Lint directive patterns (captures: [1]=tool, [2]=directive-type, [3]=after-directive) */
const STYLELINT_DIRECTIVE_RE =
  /\b(stylelint)-disable-(next-line|line)\s+([\s\S]+)/;
const ESLINT_DIRECTIVE_RE =
  /\b(eslint)-disable-(next-line|line)\s+(.*)/;

/** shiori: prefix detection */
const SHIORI_PREFIX_RE = /\bshiori:\s*/;

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
}

function parseDirectiveContent(afterDirective: string): ParsedDirective {
  const dashIndex = afterDirective.indexOf('--');
  const rulesPart =
    dashIndex >= 0 ? afterDirective.slice(0, dashIndex) : afterDirective;
  const metaPart = dashIndex >= 0 ? afterDirective.slice(dashIndex + 2) : '';

  const cleanRulesPart = rulesPart.replace(/\s*\*\/\s*$/, '').trim();
  const rules = cleanRulesPart ? parseRules(cleanRulesPart) : [];

  // Check for shiori: prefix in meta part
  const shioriMatch = metaPart.match(SHIORI_PREFIX_RE);
  const shioriFieldsStr = shioriMatch
    ? metaPart.slice(shioriMatch.index! + shioriMatch[0].length).trim()
    : undefined;

  return { rules, shioriFieldsStr };
}

/** CommentProvider: extracts shiori annotations from comments */
export class CommentProvider implements AnnotationProvider {
  readonly name = 'CommentProvider';

  scan(file: FileInput): ShioriAnnotation[] {
    const annotations: ShioriAnnotation[] = [];
    const comments = extractComments(file.content);

    for (const comment of comments) {
      const { text, line } = comment;

      // Try lint directive patterns first
      const stylelintMatch = text.match(STYLELINT_DIRECTIVE_RE);
      const eslintMatch = text.match(ESLINT_DIRECTIVE_RE);

      if (stylelintMatch || eslintMatch) {
        const match = stylelintMatch ?? eslintMatch!;
        const afterDirective = match[3]!;
        const { rules, shioriFieldsStr } = parseDirectiveContent(afterDirective);

        if (shioriFieldsStr !== undefined) {
          // Path A: lint directive + shiori:
          const fields = parseShioriFields(shioriFieldsStr);
          if (rules.length === 0) {
            annotations.push({
              ref: fields.ref,
              kind: fields.kind,
              rule: undefined,
              expires: fields.expires,
              reason: fields.reason,
              location: { file: file.path, line },
            });
          } else {
            for (const rule of rules) {
              annotations.push({
                ref: fields.ref,
                kind: fields.kind,
                rule,
                expires: fields.expires,
                reason: fields.reason,
                location: { file: file.path, line },
              });
            }
          }
        } else {
          // Path C: lint directive without shiori: → malformed
          if (rules.length === 0) {
            annotations.push({
              ref: '',
              rule: undefined,
              location: { file: file.path, line },
            });
          } else {
            for (const rule of rules) {
              annotations.push({
                ref: '',
                rule,
                location: { file: file.path, line },
              });
            }
          }
        }
        continue;
      }

      // Path B: standalone shiori:
      const shioriMatch = text.match(SHIORI_PREFIX_RE);
      if (shioriMatch) {
        const fieldsStr = text.slice(shioriMatch.index! + shioriMatch[0].length).trim();
        const fields = parseShioriFields(fieldsStr);
        annotations.push({
          ref: fields.ref,
          kind: fields.kind,
          rule: undefined,
          expires: fields.expires,
          reason: fields.reason,
          location: { file: file.path, line },
        });
        continue;
      }

      // Path D: regular comment → ignore
    }

    return annotations;
  }
}
