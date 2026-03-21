import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGitHubRef,
  GitHubIssuesRefStatusProvider,
} from '../src/core/ref-status-providers/github-issues-provider.ts';
import { CommandRefStatusProvider } from '../src/core/ref-status-providers/command-provider.ts';
import { selectRefStatusProvider } from '../src/core/ref-status-providers/select-provider.ts';
import type {
  RefStatusEntry,
  RefStatusRunner,
} from '../src/core/ref-status.ts';

// ── parseGitHubRef ──────────────────────────────────────────

describe('parseGitHubRef', () => {
  it('parses GH-123 with default repository', () => {
    const result = parseGitHubRef('GH-123', 'octocat/hello-world');
    assert.deepEqual(result, {
      owner: 'octocat',
      repo: 'hello-world',
      issueNumber: 123,
    });
  });

  it('parses GH-1 (single digit)', () => {
    const result = parseGitHubRef('GH-1', 'owner/repo');
    assert.deepEqual(result, {
      owner: 'owner',
      repo: 'repo',
      issueNumber: 1,
    });
  });

  it('returns undefined for GH-123 without default repository', () => {
    assert.equal(parseGitHubRef('GH-123'), undefined);
  });

  it('returns undefined for GH-123 with invalid default repository format', () => {
    assert.equal(parseGitHubRef('GH-123', 'invalid'), undefined);
    assert.equal(parseGitHubRef('GH-123', 'a/b/c'), undefined);
    assert.equal(parseGitHubRef('GH-123', '/repo'), undefined);
    assert.equal(parseGitHubRef('GH-123', 'owner/'), undefined);
  });

  it('parses OWNER/REPO#123 (explicit repository)', () => {
    const result = parseGitHubRef('octocat/hello-world#42');
    assert.deepEqual(result, {
      owner: 'octocat',
      repo: 'hello-world',
      issueNumber: 42,
    });
  });

  it('parses repository names with dots and hyphens', () => {
    const result = parseGitHubRef('my-org/my.repo#100');
    assert.deepEqual(result, {
      owner: 'my-org',
      repo: 'my.repo',
      issueNumber: 100,
    });
  });

  it('returns undefined for non-GitHub refs', () => {
    assert.equal(parseGitHubRef('SUP-1234'), undefined);
    assert.equal(parseGitHubRef('ADR:0007'), undefined);
    assert.equal(parseGitHubRef('DEV-001'), undefined);
    assert.equal(parseGitHubRef(''), undefined);
  });

  it('returns undefined for bare #123 (not supported)', () => {
    assert.equal(parseGitHubRef('#123'), undefined);
  });

  it('returns undefined for GH- without number', () => {
    assert.equal(parseGitHubRef('GH-'), undefined);
  });

  it('returns undefined for GH-abc (non-numeric)', () => {
    assert.equal(parseGitHubRef('GH-abc'), undefined);
  });
});

// ── CommandRefStatusProvider ────────────────────────────────

describe('CommandRefStatusProvider', () => {
  it('delegates to the provided runner', async () => {
    const mockRunner: RefStatusRunner = async (
      command: string,
      refs: string[],
    ): Promise<RefStatusEntry[]> => {
      assert.equal(command, 'my-checker');
      assert.deepEqual(refs, ['SUP-1', 'SUP-2']);
      return [
        { ref: 'SUP-1', status: 'open' },
        { ref: 'SUP-2', status: 'closed' },
      ];
    };

    const provider = new CommandRefStatusProvider('my-checker', mockRunner);
    assert.equal(provider.name, 'command');

    const results = await provider.resolve(['SUP-1', 'SUP-2']);
    assert.deepEqual(results, [
      { ref: 'SUP-1', status: 'open' },
      { ref: 'SUP-2', status: 'closed' },
    ]);
  });

  it('returns empty array for empty refs', async () => {
    const mockRunner: RefStatusRunner = async (): Promise<RefStatusEntry[]> => {
      throw new Error('should not be called');
    };

    const provider = new CommandRefStatusProvider('cmd', mockRunner);
    const results = await provider.resolve([]);
    assert.deepEqual(results, []);
  });
});

// ── GitHubIssuesRefStatusProvider ───────────────────────────

describe('GitHubIssuesRefStatusProvider', () => {
  it('has name "github-issues"', () => {
    const provider = new GitHubIssuesRefStatusProvider({
      token: 'fake-token',
      repository: 'owner/repo',
    });
    assert.equal(provider.name, 'github-issues');
  });

  it('returns empty array for empty refs', async () => {
    const provider = new GitHubIssuesRefStatusProvider({
      token: 'fake-token',
      repository: 'owner/repo',
    });
    const results = await provider.resolve([]);
    assert.deepEqual(results, []);
  });

  it('returns empty array when no refs match GitHub patterns', async () => {
    const provider = new GitHubIssuesRefStatusProvider({
      token: 'fake-token',
      repository: 'owner/repo',
    });
    // SUP-1234 and ADR:0007 are not GitHub ref patterns
    const results = await provider.resolve(['SUP-1234', 'ADR:0007']);
    assert.deepEqual(results, []);
  });
});

// ── selectRefStatusProvider ─────────────────────────────────

describe('selectRefStatusProvider', () => {
  it('returns CommandRefStatusProvider when refStatusCommand is specified', async () => {
    const provider = await selectRefStatusProvider({
      refStatusCommand: 'my-checker --json',
      githubToken: 'some-token',
      skipGhCli: true,
    });
    assert.notEqual(provider, undefined);
    assert.equal(provider!.name, 'command');
  });

  it('returns GitHubIssuesRefStatusProvider when only githubToken is available', async () => {
    const provider = await selectRefStatusProvider({
      githubToken: 'some-token',
      githubRepository: 'owner/repo',
      skipGhCli: true,
    });
    assert.notEqual(provider, undefined);
    assert.equal(provider!.name, 'github-issues');
  });

  it('prefers refStatusCommand over githubToken (user explicit > auto-detect)', async () => {
    const provider = await selectRefStatusProvider({
      refStatusCommand: 'my-checker',
      githubToken: 'some-token',
      githubRepository: 'owner/repo',
      skipGhCli: true,
    });
    assert.notEqual(provider, undefined);
    assert.equal(provider!.name, 'command');
  });

  it('returns undefined when neither command nor token is available', async () => {
    const provider = await selectRefStatusProvider({ skipGhCli: true });
    assert.equal(provider, undefined);
  });

  it('returns undefined when only githubRepository is set (no token)', async () => {
    const provider = await selectRefStatusProvider({
      githubRepository: 'owner/repo',
      skipGhCli: true,
    });
    assert.equal(provider, undefined);
  });
});
