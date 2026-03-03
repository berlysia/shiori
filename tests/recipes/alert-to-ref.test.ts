import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VERIFY_ISSUE_TYPES } from '../../src/core/types.ts';

/**
 * Extract ref from a SARIF alert message using the same pattern as alert-to-ref.sh.
 *
 * The shell script uses: grep -oP '(?:ID|Ref) "\K[^"]+' | head -1
 * This TypeScript equivalent allows unit testing without requiring bash.
 */
function extractRefFromMessage(message: string): string | null {
  const match = message.match(/(?:ID|Ref) "([^"]+)"/);
  return match ? (match[1] ?? null) : null;
}

/**
 * Message templates matching verify.ts (src/commands/verify.ts).
 * Each entry represents the actual message format produced by the verify function.
 */
const MESSAGE_TEMPLATES: Record<
  string,
  { template: (ref: string) => string; hasRef: boolean }
> = {
  // ID "<ref>" pattern
  'missing-in-registry': {
    template: (ref) => `ID "${ref}" found in source but not in registry`,
    hasRef: true,
  },
  'unused-in-source': {
    template: (ref) => `ID "${ref}" exists in registry but not found in source`,
    hasRef: true,
  },
  expired: {
    template: (ref) => `ID "${ref}" expired on 2026-01-15`,
    hasRef: true,
  },

  // Ref "<ref>" pattern
  'ref-format': {
    // verify.ts L121: 'Invalid ref format "${ref}"' — lowercase "ref" does not match (?:ID|Ref)
    // Extraction falls back to failure for this issue type.
    template: (ref) =>
      `Invalid ref format "${ref}": expected uppercase prefix with alphanumeric segments (e.g. SUP-1234, ADR:0007)`,
    hasRef: false,
  },
  'unrouted-ref': {
    template: (ref) => `Ref "${ref}" does not match any configured refPatterns`,
    hasRef: true,
  },
  'ref-collision': {
    template: (ref) =>
      `Ref "${ref}" defined in both registry.json and jira-registry.json (pattern file takes precedence)`,
    hasRef: true,
  },
  'registry-routing-mismatch': {
    template: (ref) =>
      `Ref "${ref}" is in default registry but pattern "JIRA-{id}" routes to jira-registry.json`,
    hasRef: true,
  },

  // syntax-error: ref may be empty — uses "Syntax error:" prefix (no quoted ref)
  'syntax-error': {
    template: (_ref) => `Syntax error: ref= is not a valid key`,
    hasRef: false,
  },

  // expiring-soon: ID "<ref>" pattern
  'expiring-soon': {
    template: (ref) => `ID "${ref}" expires on 2026-03-01 (within 14 days)`,
    hasRef: true,
  },
};

describe('alert-to-ref ref extraction', () => {
  describe('extracts ref from all verify message templates', () => {
    const testRef = 'SUP-1234';

    for (const [issueType, { template, hasRef }] of Object.entries(
      MESSAGE_TEMPLATES,
    )) {
      if (hasRef) {
        it(`extracts ref from ${issueType} message`, () => {
          const message = template(testRef);
          const extracted = extractRefFromMessage(message);
          assert.equal(
            extracted,
            testRef,
            `Failed to extract ref from ${issueType}: "${message}"`,
          );
        });
      } else {
        it(`returns null for ${issueType} message (no extractable ref)`, () => {
          const message = template(testRef);
          const extracted = extractRefFromMessage(message);
          assert.equal(
            extracted,
            null,
            `Unexpected ref extracted from ${issueType}: "${message}"`,
          );
        });
      }
    }
  });

  describe('covers all VerifyIssueType values', () => {
    it('MESSAGE_TEMPLATES has an entry for every VerifyIssueType', () => {
      const templateTypes = new Set(Object.keys(MESSAGE_TEMPLATES));
      for (const issueType of VERIFY_ISSUE_TYPES) {
        assert.ok(
          templateTypes.has(issueType),
          `Missing MESSAGE_TEMPLATES entry for VerifyIssueType: ${issueType}`,
        );
      }
    });

    it('MESSAGE_TEMPLATES has no extra entries beyond VerifyIssueType', () => {
      const issueTypes = new Set<string>(VERIFY_ISSUE_TYPES);
      for (const key of Object.keys(MESSAGE_TEMPLATES)) {
        assert.ok(
          issueTypes.has(key),
          `Extra MESSAGE_TEMPLATES entry not in VerifyIssueType: ${key}`,
        );
      }
    });
  });

  describe('handles various ref formats', () => {
    const refFormats = [
      'SUP-1234',
      'ADR:0007',
      'JIRA-PROJ-123',
      'DEV-001',
      'LEGACY-WORKAROUND',
      'A-1',
    ];

    for (const ref of refFormats) {
      it(`extracts "${ref}" from ID pattern`, () => {
        const message = `ID "${ref}" found in source but not in registry`;
        assert.equal(extractRefFromMessage(message), ref);
      });

      it(`extracts "${ref}" from Ref pattern`, () => {
        const message = `Ref "${ref}" does not match any configured refPatterns`;
        assert.equal(extractRefFromMessage(message), ref);
      });
    }
  });

  describe('edge cases', () => {
    it('returns null for empty message', () => {
      assert.equal(extractRefFromMessage(''), null);
    });

    it('returns null for message without ID or Ref pattern', () => {
      assert.equal(
        extractRefFromMessage('Syntax error: ref= is not a valid key'),
        null,
      );
    });

    it('returns first ref when message contains multiple', () => {
      const message = 'ID "FIRST-001" found and Ref "SECOND-002" also present';
      assert.equal(extractRefFromMessage(message), 'FIRST-001');
    });

    it('handles ref with special characters (colon)', () => {
      const message = 'ID "ADR:0007" found in source but not in registry';
      assert.equal(extractRefFromMessage(message), 'ADR:0007');
    });

    it('does not match lowercase "id" or "ref"', () => {
      assert.equal(
        extractRefFromMessage('id "lower-001" should not match'),
        null,
      );
      assert.equal(
        extractRefFromMessage('ref "lower-002" should not match'),
        null,
      );
    });

    it('ref-format message has lowercase "ref" — no extraction', () => {
      // verify.ts L121: 'Invalid ref format "${ref}"' — lowercase "ref" won't match (?:ID|Ref)
      const message =
        'Invalid ref format "bad-ref": expected uppercase prefix with alphanumeric segments';
      assert.equal(extractRefFromMessage(message), null);
    });
  });
});
