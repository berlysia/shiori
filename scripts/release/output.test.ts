import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOutput } from './output.ts';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const output = createOutput({
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { output, out, err };
}

describe('createOutput', () => {
  it('strips control, bidi and C1 characters and keeps tab', () => {
    const { output, out } = capture();
    output.emit('a\u001b[31mb‮c\u0085d\te');
    assert.deepEqual(out, ['a[31mbcd\te\n']);
  });
  it('sends errors and chunks to stderr, sanitized', () => {
    const { output, out, err } = capture();
    output.emitError('x\u001by');
    output.emitChunk('p\u0007q');
    output.emitChunk('\u001b');
    assert.deepEqual(out, []);
    assert.deepEqual(err, ['xy\n', 'pq']);
  });
});
