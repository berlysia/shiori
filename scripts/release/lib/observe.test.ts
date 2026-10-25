import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstErrorLine,
  parseCommitSha,
  parseLsRemote,
  parseNameStatus,
  parseNpmView,
  parsePorcelain,
} from './observe.ts';
import type { RunResult } from './types.ts';

const out = (stdout: string, code = 0, stderrTail = ''): RunResult => ({
  code,
  stdout,
  stderrTail,
});

describe('parsePorcelain', () => {
  it('reads untracked and modified entries', () => {
    assert.deepEqual(parsePorcelain('?? a\0 M b\0'), [
      { path: 'a', state: '??' },
      { path: 'b', state: 'M' },
    ]);
  });
  it('keeps paths with spaces and newlines', () => {
    assert.deepEqual(parsePorcelain('?? a b\nc\0'), [
      { path: 'a b\nc', state: '??' },
    ]);
  });
  it('collapses staged-and-edited states and skips a rename source', () => {
    assert.deepEqual(parsePorcelain('AM x\0R  new\0old\0 D y\0'), [
      { path: 'x', state: 'A' },
      { path: 'new', state: 'R' },
      { path: 'y', state: 'D' },
    ]);
  });
  it('is empty for a clean tree', () => {
    assert.deepEqual(parsePorcelain(''), []);
  });
});

describe('parseNameStatus', () => {
  it('reads status and path pairs', () => {
    assert.deepEqual(parseNameStatus('M\0a\0D\0b\0'), {
      kind: 'ok',
      value: [
        { path: 'a', state: 'M' },
        { path: 'b', state: 'D' },
      ],
    });
  });
  it('fails on an odd field count and on a rename score', () => {
    assert.equal(parseNameStatus('M\0a\0D\0').kind, 'error');
    assert.equal(parseNameStatus('R100\0a\0').kind, 'error');
  });
});

describe('firstErrorLine', () => {
  it('returns the first error line without colour codes', () => {
    assert.equal(
      firstErrorLine(
        'resize: cannot open terminal\n🦋  \u001b[31merror\u001b[39m Some packages have been changed but no changesets were found.\n🦋  \u001b[31merror\u001b[39m second',
      ),
      '🦋  error Some packages have been changed but no changesets were found.',
    );
  });
  it('returns undefined when no line mentions an error, and cuts long lines', () => {
    assert.equal(firstErrorLine('all good\n'), undefined);
    assert.equal(firstErrorLine(`error ${'x'.repeat(300)}`)?.length, 200);
  });
});

describe('parseNpmView', () => {
  const tags = out('{"latest":"0.3.0"}');
  it('reads versions and dist-tags', () => {
    assert.deepEqual(parseNpmView(out('["0.2.0","0.3.0"]'), tags), {
      kind: 'published',
      versions: ['0.2.0', '0.3.0'],
      distTags: { latest: '0.3.0' },
    });
  });
  it('reads a single version printed as a string', () => {
    assert.deepEqual(parseNpmView(out('"0.3.0"'), tags), {
      kind: 'published',
      versions: ['0.3.0'],
      distTags: { latest: '0.3.0' },
    });
  });
  it('reads dist-tags wrapped in a one-element array (npm 12.2.0)', () => {
    assert.deepEqual(
      parseNpmView(
        out('["0.3.0"]'),
        out('[{"next":"0.2.2-beta.1","latest":"0.3.0"}]'),
      ),
      {
        kind: 'published',
        versions: ['0.3.0'],
        distTags: { next: '0.2.2-beta.1', latest: '0.3.0' },
      },
    );
  });
  it('a dist-tags array that is not one object is failed', () => {
    assert.equal(parseNpmView(out('["0.3.0"]'), out('[]')).kind, 'failed');
    assert.equal(
      parseNpmView(out('["0.3.0"]'), out('[{"latest":"0.3.0"},{}]')).kind,
      'failed',
    );
    assert.equal(
      parseNpmView(out('["0.3.0"]'), out('[["0.3.0"]]')).kind,
      'failed',
    );
  });
  it('E404 is unpublished', () => {
    assert.deepEqual(
      parseNpmView(out('{"error":{"code":"E404"}}', 1), out('', 1)),
      { kind: 'unpublished' },
    );
    assert.deepEqual(
      parseNpmView(out('', 1, 'npm error code E404'), out('', 1)),
      {
        kind: 'unpublished',
      },
    );
  });
  it('any other failure, and non-JSON, is failed', () => {
    assert.equal(
      parseNpmView(out('{"error":{"code":"E500"}}', 1), tags).kind,
      'failed',
    );
    assert.equal(parseNpmView(out('['), tags).kind, 'failed');
    assert.equal(parseNpmView(out('["0.3.0"]'), out('', 1)).kind, 'failed');
    assert.equal(
      parseNpmView(out('["0.3.0"]'), out('{"latest":1}')).kind,
      'failed',
    );
  });
});

describe('parseLsRemote', () => {
  const sha = 'a'.repeat(40);
  const peeled = 'b'.repeat(40);
  it('is absent for empty output', () => {
    assert.deepEqual(parseLsRemote('', 'v0.3.1'), {
      kind: 'ok',
      value: undefined,
    });
  });
  it('prefers the peeled commit of an annotated tag', () => {
    const text = `${sha}\trefs/tags/v0.3.1\n${peeled}\trefs/tags/v0.3.1^{}\n`;
    assert.deepEqual(parseLsRemote(text, 'v0.3.1'), {
      kind: 'ok',
      value: peeled,
    });
  });
  it('uses the plain line for a lightweight tag', () => {
    assert.deepEqual(parseLsRemote(`${sha}\trefs/tags/v0.3.1\n`, 'v0.3.1'), {
      kind: 'ok',
      value: sha,
    });
  });
  it('fails on a malformed or unexpected line', () => {
    assert.equal(parseLsRemote('garbage\n', 'v0.3.1').kind, 'error');
    assert.equal(
      parseLsRemote(`${sha}\trefs/tags/other\n`, 'v0.3.1').kind,
      'error',
    );
  });
});

describe('parseCommitSha', () => {
  it('accepts 40 hex digits', () => {
    assert.equal(parseCommitSha(`${'c'.repeat(40)}\n`), 'c'.repeat(40));
    assert.equal(parseCommitSha('nope'), undefined);
  });
});
