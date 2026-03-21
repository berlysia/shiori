import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GhCliRefStatusProvider,
  isGhCliAvailable,
} from '../src/core/ref-status-providers/gh-cli-provider.ts';
import { selectRefStatusProvider } from '../src/core/ref-status-providers/select-provider.ts';

// ── GhCliRefStatusProvider basic tests ─────────────────────

describe('GhCliRefStatusProvider', () => {
  it('has name "gh-cli"', () => {
    const provider = new GhCliRefStatusProvider({
      repository: 'owner/repo',
    });
    assert.equal(provider.name, 'gh-cli');
  });

  it('returns empty array for empty refs', async () => {
    const provider = new GhCliRefStatusProvider({
      repository: 'owner/repo',
    });
    const results = await provider.resolve([]);
    assert.deepEqual(results, []);
  });

  it('returns empty array when no refs match GitHub patterns', async () => {
    const provider = new GhCliRefStatusProvider({
      repository: 'owner/repo',
    });
    // SUP-1234 and ADR:0007 are not GitHub ref patterns
    const results = await provider.resolve(['SUP-1234', 'ADR:0007']);
    assert.deepEqual(results, []);
  });
});

// ── isGhCliAvailable ───────────────────────────────────────

describe('isGhCliAvailable', () => {
  it('returns a boolean indicating gh CLI availability', async () => {
    // This test exercises the real `gh` binary.
    // In environments without gh installed, it should return false.
    const result = await isGhCliAvailable();
    assert.equal(typeof result, 'boolean');
  });
});

// ── selectRefStatusProvider priority chain ──────────────────

describe('selectRefStatusProvider (EP-0111 gh CLI integration)', () => {
  it('prefers refStatusCommand over gh CLI and githubToken', async () => {
    const provider = await selectRefStatusProvider({
      refStatusCommand: 'my-checker --json',
      githubToken: 'some-token',
      skipGhCli: false,
    });
    assert.notEqual(provider, undefined);
    assert.equal(provider!.name, 'command');
  });

  it('skips gh CLI when skipGhCli is true and falls through to githubToken', async () => {
    const provider = await selectRefStatusProvider({
      githubToken: 'some-token',
      githubRepository: 'owner/repo',
      skipGhCli: true,
    });
    assert.notEqual(provider, undefined);
    assert.equal(provider!.name, 'github-issues');
  });

  it('returns undefined when skipGhCli is true and no token is available', async () => {
    const provider = await selectRefStatusProvider({
      skipGhCli: true,
    });
    assert.equal(provider, undefined);
  });

  it('returns undefined when only githubRepository is set (no token, skipGhCli)', async () => {
    const provider = await selectRefStatusProvider({
      githubRepository: 'owner/repo',
      skipGhCli: true,
    });
    assert.equal(provider, undefined);
  });
});
