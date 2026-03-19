import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRefStatusLine,
  collectUniqueRefs,
  resolveRefStatuses,
  type RefStatusRunner,
  type RefStatusEntry,
} from '../src/core/ref-status.ts';

describe('parseRefStatusLine', () => {
  it('parses a valid open entry', () => {
    const result = parseRefStatusLine('{"ref":"SUP-1234","status":"open"}');
    assert.deepEqual(result, { ref: 'SUP-1234', status: 'open' });
  });

  it('parses a valid closed entry', () => {
    const result = parseRefStatusLine('{"ref":"SUP-5678","status":"closed"}');
    assert.deepEqual(result, { ref: 'SUP-5678', status: 'closed' });
  });

  it('parses a valid unknown entry', () => {
    const result = parseRefStatusLine('{"ref":"ADR:0001","status":"unknown"}');
    assert.deepEqual(result, { ref: 'ADR:0001', status: 'unknown' });
  });

  it('returns undefined for empty string', () => {
    assert.equal(parseRefStatusLine(''), undefined);
  });

  it('returns undefined for whitespace-only string', () => {
    assert.equal(parseRefStatusLine('   '), undefined);
  });

  it('returns undefined for malformed JSON', () => {
    assert.equal(parseRefStatusLine('not json'), undefined);
  });

  it('returns undefined for invalid status value', () => {
    assert.equal(
      parseRefStatusLine('{"ref":"SUP-1","status":"pending"}'),
      undefined,
    );
  });

  it('returns undefined for missing ref field', () => {
    assert.equal(parseRefStatusLine('{"status":"open"}'), undefined);
  });

  it('returns undefined for missing status field', () => {
    assert.equal(parseRefStatusLine('{"ref":"SUP-1"}'), undefined);
  });

  it('trims whitespace around the line', () => {
    const result = parseRefStatusLine(
      '  {"ref":"SUP-1234","status":"closed"}  ',
    );
    assert.deepEqual(result, { ref: 'SUP-1234', status: 'closed' });
  });

  it('ignores extra fields in JSONL', () => {
    const result = parseRefStatusLine(
      '{"ref":"SUP-1","status":"open","url":"https://example.com"}',
    );
    assert.deepEqual(result, { ref: 'SUP-1', status: 'open' });
  });
});

describe('collectUniqueRefs', () => {
  it('returns unique non-empty refs', () => {
    const annotations = [
      { ref: 'SUP-1' },
      { ref: 'SUP-2' },
      { ref: 'SUP-1' },
      { ref: '' },
      { ref: 'ADR:0001' },
    ];
    const result = collectUniqueRefs(annotations);
    assert.deepEqual(result.sort(), ['ADR:0001', 'SUP-1', 'SUP-2']);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(collectUniqueRefs([]), []);
  });

  it('returns empty array when all refs are empty', () => {
    assert.deepEqual(collectUniqueRefs([{ ref: '' }, { ref: '' }]), []);
  });
});

describe('resolveRefStatuses', () => {
  it('returns status map from runner', async () => {
    const mockRunner: RefStatusRunner = async (
      _command: string,
      _refs: string[],
    ): Promise<RefStatusEntry[]> => {
      return [
        { ref: 'SUP-1', status: 'open' },
        { ref: 'SUP-2', status: 'closed' },
      ];
    };

    const result = await resolveRefStatuses(
      'mock-command',
      ['SUP-1', 'SUP-2'],
      {
        runner: mockRunner,
      },
    );

    assert.equal(result.get('SUP-1'), 'open');
    assert.equal(result.get('SUP-2'), 'closed');
    assert.equal(result.size, 2);
  });

  it('returns empty map for empty refs', async () => {
    const mockRunner: RefStatusRunner = async () => {
      throw new Error('should not be called');
    };

    const result = await resolveRefStatuses('mock-command', [], {
      runner: mockRunner,
    });

    assert.equal(result.size, 0);
  });

  it('passes command and refs to runner', async () => {
    let capturedCommand = '';
    let capturedRefs: string[] = [];

    const mockRunner: RefStatusRunner = async (
      command: string,
      refs: string[],
    ): Promise<RefStatusEntry[]> => {
      capturedCommand = command;
      capturedRefs = refs;
      return [{ ref: 'TEST-1', status: 'unknown' }];
    };

    await resolveRefStatuses('my-status-checker --json', ['TEST-1'], {
      runner: mockRunner,
    });

    assert.equal(capturedCommand, 'my-status-checker --json');
    assert.deepEqual(capturedRefs, ['TEST-1']);
  });
});
