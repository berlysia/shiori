import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion } from './semver.ts';

describe('parseVersion', () => {
  const accepted: [string, boolean][] = [
    ['0.3.1', false],
    ['0.4.0-rc.0', true],
    ['1.0.0-beta.2', true],
  ];
  for (const [text, prerelease] of accepted) {
    it(`accepts ${text}`, () => {
      const result = parseVersion(text);
      assert.deepEqual(result, { ok: true, version: text, prerelease });
    });
  }

  const rejected: [string, string][] = [
    ['v0.3.1', 'v prefix'],
    ['0.3', 'two parts'],
    ['01.2.3', 'leading zero'],
    ['0.3.1-', 'empty prerelease'],
    ['0.3.1 ', 'trailing space'],
    [' 0.3.1', 'leading space'],
    ['0.3.1\n', 'trailing newline'],
    ['0.3.1\n--foo', 'second line'],
    ['0.3.1+build', 'build metadata'],
    ['1.0.0-01', 'numeric identifier with a leading zero'],
    ['1.0.0-rc.01', 'numeric identifier with a leading zero after a dot'],
    ['', 'empty'],
    [`1.0.0-${'a'.repeat(251)}`, '257 characters'],
  ];
  for (const [text, name] of rejected) {
    it(`rejects ${name}`, () => {
      assert.equal(parseVersion(text).ok, false);
    });
  }

  it('accepts a 256 character version and rejects 257', () => {
    const at256 = `1.0.0-${'a'.repeat(250)}`;
    assert.equal(at256.length, 256);
    assert.equal(parseVersion(at256).ok, true);
    assert.equal(parseVersion(`${at256}a`).ok, false);
  });

  it('accepts alphanumeric identifiers that start with a zero', () => {
    assert.equal(parseVersion('1.0.0-0a').ok, true);
    assert.equal(parseVersion('1.0.0-rc.0').ok, true);
  });

  it('does not echo the input in the reason', () => {
    const result = parseVersion('0.3.1\u001b[31m');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason.includes('\u001b'), false);
  });
});
