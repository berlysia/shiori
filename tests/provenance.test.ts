import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriAnnotation } from '../src/core/types.ts';
import {
  parseBlameOutput,
  enrichWithProvenance,
  type GitBlameRunner,
} from '../src/core/provenance.ts';

/** Minimal annotation factory */
function makeAnnotation(
  ref: string,
  file: string,
  line: number,
): ShioriAnnotation {
  return {
    ref,
    tagged: true,
    ignored: false,
    location: { file, line },
  };
}

/** Realistic git blame --porcelain output */
const SAMPLE_PORCELAIN = `abcdef1234567890abcdef1234567890abcdef12 10 10 1
author Jane Doe
author-mail <jane@example.com>
author-time 1709856000
author-tz +0900
committer Jane Doe
committer-mail <jane@example.com>
committer-time 1709856000
committer-tz +0900
summary fix: resolve annotation parsing edge case
filename src/core/parser.ts
\t// shiori: SUP-1234
`;

describe('parseBlameOutput', () => {
  it('parses valid porcelain output', () => {
    const result = parseBlameOutput(SAMPLE_PORCELAIN);

    assert.ok(result, 'returns a result');
    assert.equal(result.commitHash, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.equal(result.author, 'Jane Doe');
    assert.equal(result.authorEmail, 'jane@example.com');
    assert.equal(result.authorTime, 1709856000);
    assert.equal(result.summary, 'fix: resolve annotation parsing edge case');
  });

  it('returns undefined for empty string', () => {
    assert.equal(parseBlameOutput(''), undefined);
  });

  it('returns undefined for malformed output', () => {
    assert.equal(parseBlameOutput('not a valid blame output'), undefined);
  });

  it('returns undefined when required fields are missing', () => {
    // Has hash but no author/author-mail/author-time/summary
    const partial = `abcdef1234567890abcdef1234567890abcdef12 10 10 1
author Jane Doe
`;
    assert.equal(parseBlameOutput(partial), undefined);
  });
});

describe('enrichWithProvenance', () => {
  it('enriches annotations with provenance from mock runner', async () => {
    const annotations = [
      makeAnnotation('SUP-1234', 'src/core/parser.ts', 10),
      makeAnnotation('ADR:0007', 'src/core/types.ts', 5),
    ];

    const mockRunner: GitBlameRunner = async (
      _file: string,
      _line: number,
      _cwd: string,
    ): Promise<string> => {
      return SAMPLE_PORCELAIN;
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameRunner: mockRunner,
    });

    assert.equal(result.length, 2);

    for (const a of result) {
      assert.ok(a.provenance, `annotation ${a.ref} has provenance`);
      assert.equal(a.provenance!.author, 'Jane Doe');
      assert.equal(a.provenance!.authorEmail, 'jane@example.com');
      assert.equal(a.provenance!.commitHash, 'abcdef1');
      assert.equal(
        a.provenance!.commitSummary,
        'fix: resolve annotation parsing edge case',
      );
      // Date is ISO string from unix timestamp 1709856000
      assert.ok(a.provenance!.date.startsWith('2024-03-08'));
    }
  });

  it('gracefully handles runner failure (no provenance added)', async () => {
    const annotations = [makeAnnotation('SUP-1234', 'src/core/parser.ts', 10)];

    const failingRunner: GitBlameRunner = async (): Promise<string> => {
      throw new Error('git not found');
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameRunner: failingRunner,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.provenance, undefined);
    // Original annotation data preserved
    assert.equal(result[0]!.ref, 'SUP-1234');
    assert.equal(result[0]!.location.file, 'src/core/parser.ts');
  });

  it('handles mixed success and failure', async () => {
    const annotations = [
      makeAnnotation('SUP-OK', 'src/ok.ts', 1),
      makeAnnotation('SUP-FAIL', 'src/fail.ts', 2),
    ];

    const mixedRunner: GitBlameRunner = async (
      file: string,
    ): Promise<string> => {
      if (file === 'src/fail.ts') {
        throw new Error('not tracked');
      }
      return SAMPLE_PORCELAIN;
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameRunner: mixedRunner,
    });

    assert.equal(result.length, 2);
    assert.ok(result[0]!.provenance, 'first annotation enriched');
    assert.equal(result[1]!.provenance, undefined, 'second not enriched');
  });

  it('handles empty annotations array', async () => {
    const result = await enrichWithProvenance([], '/tmp/test', {
      gitBlameRunner: async () => SAMPLE_PORCELAIN,
    });

    assert.deepEqual(result, []);
  });

  it('handles malformed blame output gracefully', async () => {
    const annotations = [makeAnnotation('SUP-1', 'src/a.ts', 1)];

    const malformedRunner: GitBlameRunner = async (): Promise<string> => {
      return 'not valid blame output at all';
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameRunner: malformedRunner,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.provenance, undefined);
  });

  it('does not mutate original annotations', async () => {
    const original = makeAnnotation('SUP-1', 'src/a.ts', 1);
    const annotations = [original];

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameRunner: async () => SAMPLE_PORCELAIN,
    });

    // Result should be enriched
    assert.ok(result[0]!.provenance);
    // Original should not be mutated
    assert.equal(original.provenance, undefined);
  });
});
