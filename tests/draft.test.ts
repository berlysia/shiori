import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriAnnotation } from '../src/core/types.ts';
import { listDrafts } from '../src/commands/draft.ts';

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> = {},
): ShioriAnnotation {
  return {
    ref: 'TEST-001',
    rule: 'no-console',
    tagged: true,
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

describe('listDrafts', () => {
  it('returns only draft annotations (tagged with empty ref)', () => {
    const records = [
      makeAnnotation({ ref: 'SUP-1', tagged: true }),
      makeAnnotation({
        ref: '',
        tagged: true,
        location: { file: 'a.ts', line: 2 },
      }),
      makeAnnotation({
        ref: '',
        tagged: false,
        location: { file: 'b.ts', line: 3 },
      }),
      makeAnnotation({ ref: 'SUP-2', tagged: true }),
    ];
    const result = listDrafts(records);
    assert.equal(result.count, 1);
    assert.equal(result.drafts.length, 1);
    assert.equal(result.drafts[0]!.location.file, 'a.ts');
  });

  it('excludes malformed annotations (untagged with empty ref)', () => {
    const records = [makeAnnotation({ ref: '', tagged: false })];
    const result = listDrafts(records);
    assert.equal(result.count, 0);
    assert.equal(result.drafts.length, 0);
  });

  it('returns empty result for empty input', () => {
    const result = listDrafts([]);
    assert.equal(result.count, 0);
    assert.equal(result.drafts.length, 0);
  });

  it('excludes annotations with ref (even if tagged)', () => {
    const records = [
      makeAnnotation({ ref: 'SUP-1', tagged: true }),
      makeAnnotation({ ref: 'SUP-2', tagged: true }),
    ];
    const result = listDrafts(records);
    assert.equal(result.count, 0);
  });

  it('returns multiple drafts', () => {
    const records = [
      makeAnnotation({
        ref: '',
        tagged: true,
        location: { file: 'a.ts', line: 1 },
      }),
      makeAnnotation({
        ref: '',
        tagged: true,
        location: { file: 'b.ts', line: 5 },
      }),
    ];
    const result = listDrafts(records);
    assert.equal(result.count, 2);
    assert.equal(result.drafts[0]!.location.file, 'a.ts');
    assert.equal(result.drafts[1]!.location.file, 'b.ts');
  });
});
