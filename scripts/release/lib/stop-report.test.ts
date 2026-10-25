import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, exitCodeOfRow, formatStopReport } from './stop-report.ts';

describe('formatStopReport', () => {
  it('prints the reason, one try line per command and the section', () => {
    const lines = formatStopReport({
      at: 'entry',
      row: 5,
      reason: 'local tag only',
      commands: ['git push', 'git tag -d v1'],
      section: 'Resuming an interrupted release',
    });
    assert.equal(lines[0], 'release stopped at entry: local tag only (row 5)');
    assert.deepEqual(lines.slice(1), [
      'try: git push',
      'try: git tag -d v1',
      'see: docs/releasing.md "Resuming an interrupted release"',
    ]);
  });
  it('names the stage and omits the row for a stage stop', () => {
    const [first] = formatStopReport({
      at: 3,
      reason: 'x',
      commands: [],
      section: 's',
    });
    assert.equal(first, 'release stopped at stage 3: x');
  });
  it('removes escape sequences from the reason and detail', () => {
    const text = formatStopReport({
      at: 'entry',
      row: 1,
      reason: 'bad \u001b[31mred',
      commands: [],
      section: 's',
      detail: ['M \u001b]0;title\u0007file'],
    }).join('\n');
    assert.equal(text.includes('\u001b'), false);
    assert.equal(text.includes('\u0007'), false);
  });
  it('exits 0 only for row 10', () => {
    assert.equal(exitCodeOfRow(10), 0);
    assert.equal(exitCodeOfRow(5), 1);
    assert.equal(exitCodeOfRow(undefined), 1);
  });
});

describe('SECTIONS', () => {
  it('names headings that exist in docs/releasing.md', () => {
    const doc = readFileSync(
      new URL('../../../docs/releasing.md', import.meta.url),
      'utf8',
    );
    const headings = new Set(
      doc
        .split('\n')
        .filter((line) => /^#{2,3} /.test(line))
        .map((line) => line.replace(/^#+ /, '')),
    );
    for (const [key, heading] of Object.entries(SECTIONS)) {
      assert.ok(headings.has(heading), `${key}: "${heading}" is not a heading`);
    }
  });
});
