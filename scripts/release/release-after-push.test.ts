import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enterAfterPush } from './release-after-push.ts';
import { parseVersion, type ValidVersion } from './lib/semver.ts';
import type { Deps } from './lib/types.ts';

const parsed = parseVersion('0.3.1');
const version: ValidVersion = parsed.ok ? parsed.version : ('' as ValidVersion);

function depsWithOutput() {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    output: {
      emit: (line: string) => out.push(line),
      emitError: (line: string) => err.push(line),
      emitChunk: () => undefined,
    },
  } as unknown as Deps;
  return { deps, out, err };
}

describe('enterAfterPush (provisional stop)', () => {
  it('row 2: exit 1 and the manual steps before approval', async () => {
    const { deps, err } = depsWithOutput();
    assert.equal(
      await enterAfterPush(deps, { kind: 'after-push', version }),
      1,
    );
    const text = err.join('\n');
    assert.match(text, /\(row 2\)/);
    assert.match(text, /see: docs\/releasing\.md "Checks before approval"/);
  });
  it('row 3: exit 0 and the post-release checks', async () => {
    const { deps, out, err } = depsWithOutput();
    assert.equal(
      await enterAfterPush(deps, { kind: 'check-only', version }),
      0,
    );
    assert.match(
      out.join('\n'),
      /see: docs\/releasing\.md "Post-release checks"/,
    );
    assert.deepEqual(err, []);
  });
});
