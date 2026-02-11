import type { LinterKind, SuppressionMeta, SuppressionRecord } from '../types.ts';
import type { FileInput, SuppressionProvider } from './SuppressionProvider.ts';

const STYLELINT_DISABLE_RE =
  /\/\*\s*stylelint-disable-(next-line|line)\s+([\s\S]+?)\s*\*\//;

const ESLINT_DISABLE_RE =
  /\/\/\s*eslint-disable-(next-line|line)\s+(.*)/;

const WAIVE_RE = /waive\(([^)]+)\)/;

const EXPIRES_RE = /expires=["']?(\d{4}-\d{2}-\d{2})["']?/;

interface ParsedDirective {
  linter: LinterKind;
  rules: string[];
  id: string;
  meta: SuppressionMeta;
  raw: string;
}

function parseRules(rulesStr: string): string[] {
  // Split by comma, then trim; if no commas, split by whitespace
  const byComma = rulesStr.split(',').map((s) => s.trim()).filter(Boolean);
  if (byComma.length > 1) {
    return byComma;
  }
  // Single item or space-separated
  return rulesStr.split(/\s+/).filter(Boolean);
}

function parseDirective(
  fullMatch: string,
  afterDirective: string,
  linter: LinterKind,
): ParsedDirective {
  // Split on " -- " to separate rules from meta
  const dashIndex = afterDirective.indexOf('--');
  const rulesPart = dashIndex >= 0 ? afterDirective.slice(0, dashIndex) : afterDirective;
  const metaPart = dashIndex >= 0 ? afterDirective.slice(dashIndex + 2) : '';

  // For stylelint, strip trailing */ from rulesPart if present
  const cleanRulesPart = rulesPart.replace(/\s*\*\/\s*$/, '').trim();
  const rules = cleanRulesPart ? parseRules(cleanRulesPart) : [];

  // Extract waive ID
  const waiveMatch = metaPart.match(WAIVE_RE);
  const id = waiveMatch?.[1] ?? '';

  // Extract expires
  const expiresMatch = metaPart.match(EXPIRES_RE);
  const expires = expiresMatch?.[1];

  return {
    linter,
    rules,
    id,
    meta: { expires },
    raw: fullMatch,
  };
}

/** CommentProvider: extracts suppression records from disable comments */
export class CommentProvider implements SuppressionProvider {
  readonly name = 'CommentProvider';

  scan(file: FileInput): SuppressionRecord[] {
    const records: SuppressionRecord[] = [];
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNumber = i + 1;

      let directive: ParsedDirective | undefined;

      // Check stylelint disable comment
      const stylelintMatch = line.match(STYLELINT_DISABLE_RE);
      if (stylelintMatch) {
        directive = parseDirective(stylelintMatch[0]!, stylelintMatch[2]!, 'stylelint');
      }

      // Check eslint disable comment (only if not already matched)
      if (!directive) {
        const eslintMatch = line.match(ESLINT_DISABLE_RE);
        if (eslintMatch) {
          directive = parseDirective(eslintMatch[0]!, eslintMatch[2]!, 'eslint');
        }
      }

      if (!directive) {
        continue;
      }

      // Generate one record per rule (or one if no rules)
      if (directive.rules.length === 0) {
        records.push({
          id: directive.id,
          linter: directive.linter,
          rule: undefined,
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
            linter: directive.linter,
            rule,
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
