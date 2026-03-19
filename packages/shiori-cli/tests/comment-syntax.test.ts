import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCommentSyntax,
  COMMENT_SYNTAXES,
  EXTENSION_MAP,
} from '../src/core/comment-syntax.ts';

describe('comment-syntax', () => {
  describe('getCommentSyntax', () => {
    it('returns C-style for .ts files', () => {
      const syntax = getCommentSyntax('src/main.ts');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['c']);
    });

    it('returns C-style for .js files', () => {
      const syntax = getCommentSyntax('index.js');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['c']);
    });

    it('returns C-style for .css files', () => {
      const syntax = getCommentSyntax('styles.css');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['c']);
    });

    it('returns hash-style for .py files', () => {
      const syntax = getCommentSyntax('script.py');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });

    it('returns hash-style for .rb files', () => {
      const syntax = getCommentSyntax('app.rb');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });

    it('returns hash-style for .sh files', () => {
      const syntax = getCommentSyntax('deploy.sh');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });

    it('returns hash-style for .yaml files', () => {
      const syntax = getCommentSyntax('config.yaml');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });

    it('returns hash-style for .yml files', () => {
      const syntax = getCommentSyntax('ci.yml');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });

    it('returns hash-style for .toml files', () => {
      const syntax = getCommentSyntax('Cargo.toml');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });

    it('returns hash-style for .exs files', () => {
      const syntax = getCommentSyntax('test.exs');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });

    it('returns dashdash-style for .sql files', () => {
      const syntax = getCommentSyntax('query.sql');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['dashdash']);
    });

    it('returns lua-style for .lua files', () => {
      const syntax = getCommentSyntax('init.lua');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['lua']);
    });

    it('returns html-style for .html files', () => {
      const syntax = getCommentSyntax('index.html');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['html']);
    });

    it('returns html-style for .xml files', () => {
      const syntax = getCommentSyntax('data.xml');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['html']);
    });

    it('returns html-style for .svg files', () => {
      const syntax = getCommentSyntax('icon.svg');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['html']);
    });

    it('returns C-style for .vue files', () => {
      const syntax = getCommentSyntax('App.vue');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['c']);
    });

    it('returns C-style for unknown extensions (fallback)', () => {
      const syntax = getCommentSyntax('file.unknown');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['c']);
    });

    it('returns C-style for files without extension', () => {
      const syntax = getCommentSyntax('Makefile');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['c']);
    });

    it('handles paths with directories', () => {
      const syntax = getCommentSyntax('src/lib/utils.py');
      assert.deepEqual(syntax, COMMENT_SYNTAXES['hash']);
    });
  });

  describe('EXTENSION_MAP completeness', () => {
    it('maps all common C-style extensions', () => {
      const cExtensions = [
        '.js',
        '.ts',
        '.tsx',
        '.jsx',
        '.css',
        '.scss',
        '.pcss',
        '.less',
        '.java',
        '.go',
        '.rs',
        '.swift',
        '.kt',
        '.c',
        '.cpp',
        '.h',
        '.cs',
        '.php',
      ];
      for (const ext of cExtensions) {
        assert.equal(EXTENSION_MAP[ext], 'c', `Expected ${ext} → c`);
      }
    });

    it('maps all common hash-style extensions', () => {
      const hashExtensions = [
        '.py',
        '.rb',
        '.sh',
        '.bash',
        '.zsh',
        '.fish',
        '.yaml',
        '.yml',
        '.toml',
        '.r',
        '.pl',
        '.pm',
        '.ex',
        '.exs',
      ];
      for (const ext of hashExtensions) {
        assert.equal(EXTENSION_MAP[ext], 'hash', `Expected ${ext} → hash`);
      }
    });
  });

  describe('COMMENT_SYNTAXES structure', () => {
    it('c-style has line and block syntax', () => {
      const c = COMMENT_SYNTAXES['c']!;
      assert.ok(c.line);
      assert.ok(c.block);
      assert.deepEqual(c.line, ['//']);
      assert.equal(c.block!.length, 1);
      assert.equal(c.block![0]!.open, '/*');
      assert.equal(c.block![0]!.close, '*/');
    });

    it('hash-style has only line syntax', () => {
      const hash = COMMENT_SYNTAXES['hash']!;
      assert.ok(hash.line);
      assert.equal(hash.block, undefined);
      assert.deepEqual(hash.line, ['#']);
    });

    it('html-style has only block syntax', () => {
      const html = COMMENT_SYNTAXES['html']!;
      assert.equal(html.line, undefined);
      assert.ok(html.block);
      assert.equal(html.block!.length, 1);
      assert.equal(html.block![0]!.open, '<!--');
      assert.equal(html.block![0]!.close, '-->');
    });

    it('lua-style has both line and block syntax', () => {
      const lua = COMMENT_SYNTAXES['lua']!;
      assert.ok(lua.line);
      assert.ok(lua.block);
      assert.deepEqual(lua.line, ['--']);
      assert.equal(lua.block![0]!.open, '--[[');
    });

    it('dashdash-style has both line and block syntax', () => {
      const dashdash = COMMENT_SYNTAXES['dashdash']!;
      assert.ok(dashdash.line);
      assert.ok(dashdash.block);
      assert.deepEqual(dashdash.line, ['--']);
      assert.equal(dashdash.block![0]!.open, '/*');
    });
  });
});
