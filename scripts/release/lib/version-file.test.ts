import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVersion } from './semver.ts';
import { syncVersionConstant } from './version-file.ts';

function valid(text: string) {
  const parsed = parseVersion(text);
  assert.ok(parsed.ok);
  return parsed.version;
}

const CURRENT = readFileSync(
  new URL('../../../packages/shiori-cli/src/core/version.ts', import.meta.url),
  'utf8',
);

describe('syncVersionConstant', () => {
  it('rewrites only the constant line of the real version.ts', () => {
    const result = syncVersionConstant(CURRENT, valid('0.3.1'));
    assert.ok(result.ok);
    const before = CURRENT.split('\n');
    const after = result.source.split('\n');
    assert.equal(after.length, before.length);
    const changed = before.flatMap((line, index) =>
      line === after[index] ? [] : [index],
    );
    assert.equal(changed.length, 1);
    assert.equal(after[changed[0] ?? 0], "export const VERSION = '0.3.1';");
    assert.match(CURRENT, /^export const VERSION = '[^']+';$/m);
  });

  it('writes a prerelease version', () => {
    const result = syncVersionConstant(
      "export const VERSION = '0.3.0';\n",
      valid('0.4.0-rc.0'),
    );
    assert.deepEqual(result, {
      ok: true,
      source: "export const VERSION = '0.4.0-rc.0';\n",
    });
  });

  it('fails when there is no constant line', () => {
    assert.equal(
      syncVersionConstant('export const OTHER = 1;\n', valid('0.3.1')).ok,
      false,
    );
  });

  it('fails when there are two constant lines', () => {
    const source =
      "export const VERSION = '0.3.0';\nexport const VERSION = '0.3.0';\n";
    assert.equal(syncVersionConstant(source, valid('0.3.1')).ok, false);
  });

  it('does not match a commented or indented line', () => {
    const source =
      " export const VERSION = '0.3.0';\n// export const VERSION = '0.3.0';\n";
    assert.equal(syncVersionConstant(source, valid('0.3.1')).ok, false);
  });
});
