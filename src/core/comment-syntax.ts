/** Comment syntax definition for a language family */
export interface CommentSyntax {
  /** Line comment prefixes (e.g., ["//"], ["#"]) */
  line?: string[];
  /** Block comment delimiters */
  block?: BlockCommentSyntax[];
}

export interface BlockCommentSyntax {
  open: string;
  close: string;
}

/** Built-in comment syntax families */
export const COMMENT_SYNTAXES: Record<string, CommentSyntax> = {
  // C-style (JavaScript, TypeScript, Java, Go, Rust, etc.)
  c: { line: ['//'], block: [{ open: '/*', close: '*/' }] },
  // Hash-style (Python, Ruby, Shell, YAML, TOML, etc.)
  hash: { line: ['#'] },
  // SQL-style (SQL: -- line comments and /* */ blocks)
  dashdash: { line: ['--'], block: [{ open: '/*', close: '*/' }] },
  // HTML/XML-style
  html: { block: [{ open: '<!--', close: '-->' }] },
  // Lua-style (-- line comments and --[[ ]] blocks)
  lua: { line: ['--'], block: [{ open: '--[[', close: ']]' }] },
};

/** File extension to comment syntax family mapping */
export const EXTENSION_MAP: Record<string, string> = {
  // C-style
  '.js': 'c',
  '.ts': 'c',
  '.tsx': 'c',
  '.jsx': 'c',
  '.css': 'c',
  '.scss': 'c',
  '.pcss': 'c',
  '.less': 'c',
  '.java': 'c',
  '.go': 'c',
  '.rs': 'c',
  '.swift': 'c',
  '.kt': 'c',
  '.c': 'c',
  '.cpp': 'c',
  '.h': 'c',
  '.cs': 'c',
  '.php': 'c',
  // Hash-style
  '.py': 'hash',
  '.rb': 'hash',
  '.sh': 'hash',
  '.bash': 'hash',
  '.zsh': 'hash',
  '.fish': 'hash',
  '.yaml': 'hash',
  '.yml': 'hash',
  '.toml': 'hash',
  '.r': 'hash',
  '.pl': 'hash',
  '.pm': 'hash',
  '.ex': 'hash',
  '.exs': 'hash',
  // SQL
  '.sql': 'dashdash',
  // Lua
  '.lua': 'lua',
  // HTML/XML
  '.html': 'html',
  '.xml': 'html',
  '.svg': 'html',
  // Vue SFC: script/style use C-style
  '.vue': 'c',
};

/** Default comment syntax family for unknown extensions */
export const DEFAULT_SYNTAX_FAMILY = 'c';

/**
 * Get comment syntax for a file path based on its extension.
 * Returns C-style syntax for unknown extensions (backward compatible).
 */
export function getCommentSyntax(filePath: string): CommentSyntax {
  const dotIndex = filePath.lastIndexOf('.');
  const ext = dotIndex > 0 ? filePath.slice(dotIndex) : '';
  const family = EXTENSION_MAP[ext] ?? DEFAULT_SYNTAX_FAMILY;
  return COMMENT_SYNTAXES[family] ?? COMMENT_SYNTAXES[DEFAULT_SYNTAX_FAMILY]!;
}
