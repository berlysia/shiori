import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/core/version.ts';

// Read with fs, not a JSON import: tsc would emit a copy of package.json into dist/.
function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

describe('VERSION', () => {
  it('matches the package.json version', () => {
    const packageJson = readJson('../package.json');
    assert.equal(VERSION, packageJson['version']);
  });
});
