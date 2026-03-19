import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ShioriAnnotation } from '../src/core/types.ts';
import {
  parseBlameOutput,
  parseFileBlameOutput,
  enrichWithProvenance,
  type GitBlameRunner,
  type GitBlameFileRunner,
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

/** Realistic git blame --porcelain output for a single line */
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

/**
 * Multi-line porcelain output simulating a file with 3 lines.
 * Line 5 and line 7 share the same commit (abbreviated header for line 7).
 * Line 10 has a different commit.
 */
const MULTI_LINE_PORCELAIN = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 5 5 1
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary feat: add annotation support
filename src/core/parser.ts
\t// line 5 content
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 7 7
\t// line 7 content
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 10 10 1
author Bob
author-mail <bob@example.com>
author-time 1710000000
author-tz +0900
committer Bob
committer-mail <bob@example.com>
committer-time 1710000000
committer-tz +0900
summary fix: update parser for edge case
filename src/core/parser.ts
\t// line 10 content
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

describe('parseFileBlameOutput', () => {
  it('parses multi-line porcelain output into line map', () => {
    const result = parseFileBlameOutput(MULTI_LINE_PORCELAIN);

    assert.equal(result.size, 3, 'should have 3 line entries');

    // Line 5: Alice's commit
    const line5 = result.get(5);
    assert.ok(line5, 'line 5 should be present');
    assert.equal(line5.author, 'Alice');
    assert.equal(line5.authorEmail, 'alice@example.com');
    assert.equal(line5.authorTime, 1700000000);
    assert.equal(line5.summary, 'feat: add annotation support');
    assert.equal(line5.commitHash, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    // Line 7: same commit as line 5 (abbreviated header reuses cached data)
    const line7 = result.get(7);
    assert.ok(line7, 'line 7 should be present');
    assert.equal(line7.author, 'Alice');
    assert.equal(line7.authorEmail, 'alice@example.com');
    assert.equal(line7.summary, 'feat: add annotation support');

    // Line 10: Bob's commit
    const line10 = result.get(10);
    assert.ok(line10, 'line 10 should be present');
    assert.equal(line10.author, 'Bob');
    assert.equal(line10.authorEmail, 'bob@example.com');
    assert.equal(line10.authorTime, 1710000000);
    assert.equal(line10.summary, 'fix: update parser for edge case');
  });

  it('returns empty map for empty string', () => {
    const result = parseFileBlameOutput('');
    assert.equal(result.size, 0);
  });

  it('returns empty map for malformed output', () => {
    const result = parseFileBlameOutput('not valid blame output');
    assert.equal(result.size, 0);
  });

  it('handles single-line porcelain output', () => {
    const result = parseFileBlameOutput(SAMPLE_PORCELAIN);
    assert.equal(result.size, 1);

    const line10 = result.get(10);
    assert.ok(line10);
    assert.equal(line10.author, 'Jane Doe');
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

describe('enrichWithProvenance (batch mode)', () => {
  it('uses batch mode when no gitBlameRunner is provided', async () => {
    const annotations = [
      makeAnnotation('SUP-1', 'src/core/parser.ts', 5),
      makeAnnotation('SUP-2', 'src/core/parser.ts', 10),
    ];

    const mockFileRunner: GitBlameFileRunner = async (
      _file: string,
      _cwd: string,
    ): Promise<string> => {
      return MULTI_LINE_PORCELAIN;
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameFileRunner: mockFileRunner,
    });

    assert.equal(result.length, 2);

    // Line 5 → Alice
    assert.ok(result[0]!.provenance, 'line 5 should have provenance');
    assert.equal(result[0]!.provenance!.author, 'Alice');
    assert.equal(result[0]!.provenance!.commitHash, 'aaaaaaa');

    // Line 10 → Bob
    assert.ok(result[1]!.provenance, 'line 10 should have provenance');
    assert.equal(result[1]!.provenance!.author, 'Bob');
    assert.equal(result[1]!.provenance!.commitHash, 'bbbbbbb');
  });

  it('calls file runner once per unique file', async () => {
    const annotations = [
      makeAnnotation('A1', 'src/a.ts', 5),
      makeAnnotation('A2', 'src/a.ts', 10),
      makeAnnotation('B1', 'src/b.ts', 5),
    ];

    const calledFiles: string[] = [];
    const mockFileRunner: GitBlameFileRunner = async (
      file: string,
    ): Promise<string> => {
      calledFiles.push(file);
      return MULTI_LINE_PORCELAIN;
    };

    await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameFileRunner: mockFileRunner,
    });

    assert.equal(calledFiles.length, 2, 'should call runner twice (2 files)');
    assert.ok(calledFiles.includes('src/a.ts'));
    assert.ok(calledFiles.includes('src/b.ts'));
  });

  it('gracefully handles file runner failure for one file', async () => {
    const annotations = [
      makeAnnotation('OK-1', 'src/good.ts', 5),
      makeAnnotation('FAIL-1', 'src/bad.ts', 10),
    ];

    const mockFileRunner: GitBlameFileRunner = async (
      file: string,
    ): Promise<string> => {
      if (file === 'src/bad.ts') {
        throw new Error('file not tracked');
      }
      return MULTI_LINE_PORCELAIN;
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameFileRunner: mockFileRunner,
    });

    assert.equal(result.length, 2);
    assert.ok(result[0]!.provenance, 'good file annotation enriched');
    assert.equal(
      result[1]!.provenance,
      undefined,
      'bad file annotation not enriched',
    );
  });

  it('handles annotations on lines not present in blame output', async () => {
    const annotations = [
      makeAnnotation('SUP-1', 'src/a.ts', 999), // line 999 not in output
    ];

    const mockFileRunner: GitBlameFileRunner = async (): Promise<string> => {
      return MULTI_LINE_PORCELAIN; // only has lines 5, 7, 10
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameFileRunner: mockFileRunner,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.provenance, undefined);
  });

  it('does not mutate original annotations in batch mode', async () => {
    const original = makeAnnotation('SUP-1', 'src/a.ts', 5);
    const annotations = [original];

    const mockFileRunner: GitBlameFileRunner = async (): Promise<string> => {
      return MULTI_LINE_PORCELAIN;
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameFileRunner: mockFileRunner,
    });

    assert.ok(result[0]!.provenance);
    assert.equal(original.provenance, undefined);
  });

  it('respects concurrency limit', async () => {
    // Create annotations across 10 files
    const annotations = Array.from({ length: 10 }, (_, i) =>
      makeAnnotation(`REF-${i}`, `src/file${i}.ts`, 5),
    );

    let activeConcurrency = 0;
    let maxConcurrency = 0;

    const mockFileRunner: GitBlameFileRunner = async (): Promise<string> => {
      activeConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, activeConcurrency);
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeConcurrency--;
      return MULTI_LINE_PORCELAIN;
    };

    await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameFileRunner: mockFileRunner,
      concurrency: 3,
    });

    assert.ok(
      maxConcurrency <= 3,
      `max concurrency was ${maxConcurrency}, expected <= 3`,
    );
    assert.ok(maxConcurrency >= 1, 'should have at least 1 concurrent call');
  });

  it('preserves annotation order across multiple files', async () => {
    const annotations = [
      makeAnnotation('A', 'src/z.ts', 5),
      makeAnnotation('B', 'src/a.ts', 10),
      makeAnnotation('C', 'src/z.ts', 10),
      makeAnnotation('D', 'src/m.ts', 5),
    ];

    const mockFileRunner: GitBlameFileRunner = async (): Promise<string> => {
      return MULTI_LINE_PORCELAIN;
    };

    const result = await enrichWithProvenance(annotations, '/tmp/test', {
      gitBlameFileRunner: mockFileRunner,
    });

    assert.equal(result.length, 4);
    assert.equal(result[0]!.ref, 'A');
    assert.equal(result[1]!.ref, 'B');
    assert.equal(result[2]!.ref, 'C');
    assert.equal(result[3]!.ref, 'D');
  });

  it('handles empty annotations in batch mode', async () => {
    const result = await enrichWithProvenance([], '/tmp/test', {
      gitBlameFileRunner: async () => MULTI_LINE_PORCELAIN,
    });

    assert.deepEqual(result, []);
  });
});
