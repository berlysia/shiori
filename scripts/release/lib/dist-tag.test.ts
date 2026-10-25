import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { distTagFor } from './dist-tag.ts';

describe('distTagFor', () => {
  it('maps a stable version to latest and a prerelease to next', () => {
    assert.equal(distTagFor('0.3.1'), 'latest');
    assert.equal(distTagFor('0.4.0-rc.0'), 'next');
    assert.equal(distTagFor('1.0.0-beta.2'), 'next');
  });
});
