import type { AnnotationRecord } from '../types.ts';
import { DEFAULT_VERBS } from '../types.ts';
import type { FileInput, AnnotationProvider } from './AnnotationProvider.ts';

const STYLELINT_DISABLE_RE =
  /\/\*\s*stylelint-disable-(next-line|line)\s+([\s\S]+?)\s*\*\//;

const ESLINT_DISABLE_RE =
  /\/\/\s*eslint-disable-(next-line|line)\s+(.*)/;

const EXPIRES_RE = /expires=["']?(\d{4}-\d{2}-\d{2})["']?/;

function buildVerbRegex(verbs: readonly string[]): RegExp {
  const escaped = verbs.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})\\(([^)]+)\\)`);
}

interface ParsedDirective {
  tool: string;
  rules: string[];
  verb: string;
  id: string;
  meta: Record<string, unknown>;
  raw: string;
}

function parseRules(rulesStr: string): string[] {
  const byComma = rulesStr.split(',').map((s) => s.trim()).filter(Boolean);
  if (byComma.length > 1) {
    return byComma;
  }
  return rulesStr.split(/\s+/).filter(Boolean);
}

function parseDirective(
  fullMatch: string,
  afterDirective: string,
  tool: string,
  verbRe: RegExp,
): ParsedDirective {
  const dashIndex = afterDirective.indexOf('--');
  const rulesPart = dashIndex >= 0 ? afterDirective.slice(0, dashIndex) : afterDirective;
  const metaPart = dashIndex >= 0 ? afterDirective.slice(dashIndex + 2) : '';

  const cleanRulesPart = rulesPart.replace(/\s*\*\/\s*$/, '').trim();
  const rules = cleanRulesPart ? parseRules(cleanRulesPart) : [];

  const verbMatch = metaPart.match(verbRe);
  const verb = verbMatch?.[1] ?? 'waive';
  const id = verbMatch?.[2] ?? '';

  const expiresMatch = metaPart.match(EXPIRES_RE);
  const meta: Record<string, unknown> = {};
  if (expiresMatch?.[1]) {
    meta['expires'] = expiresMatch[1];
  }

  return {
    tool,
    rules,
    verb,
    id,
    meta,
    raw: fullMatch,
  };
}

export interface CommentProviderOptions {
  verbs?: readonly string[];
}

/** CommentProvider: extracts annotation records from disable comments */
export class CommentProvider implements AnnotationProvider {
  readonly name = 'CommentProvider';
  private readonly verbRe: RegExp;

  constructor(options?: CommentProviderOptions) {
    const verbs = options?.verbs ?? DEFAULT_VERBS;
    this.verbRe = buildVerbRegex(verbs);
  }

  scan(file: FileInput): AnnotationRecord[] {
    const records: AnnotationRecord[] = [];
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNumber = i + 1;

      let directive: ParsedDirective | undefined;

      const stylelintMatch = line.match(STYLELINT_DISABLE_RE);
      if (stylelintMatch) {
        directive = parseDirective(stylelintMatch[0]!, stylelintMatch[2]!, 'stylelint', this.verbRe);
      }

      if (!directive) {
        const eslintMatch = line.match(ESLINT_DISABLE_RE);
        if (eslintMatch) {
          directive = parseDirective(eslintMatch[0]!, eslintMatch[2]!, 'eslint', this.verbRe);
        }
      }

      if (!directive) {
        continue;
      }

      if (directive.rules.length === 0) {
        records.push({
          id: directive.id,
          verb: directive.verb,
          tool: directive.tool,
          subject: undefined,
          file: file.path,
          line: lineNumber,
          source: 'comment',
          raw: directive.raw,
          meta: directive.meta,
          provider: this.name,
        });
      } else {
        for (const rule of directive.rules) {
          records.push({
            id: directive.id,
            verb: directive.verb,
            tool: directive.tool,
            subject: rule,
            file: file.path,
            line: lineNumber,
            source: 'comment',
            raw: directive.raw,
            meta: directive.meta,
            provider: this.name,
          });
        }
      }
    }

    return records;
  }
}
