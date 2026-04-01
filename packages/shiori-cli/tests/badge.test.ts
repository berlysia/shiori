import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMaturityBadge,
  formatBadgeAsJson,
  formatBadgeAsMarkdown,
  buildBadgeUrl,
  formatBadgeOutput,
  MATURITY_STAGE_COLORS,
  BADGE_FORMATS,
  BADGE_STYLES,
  type MaturityBadge,
  type BadgeStyle,
} from '../src/commands/badge.ts';
import type { HealthResult, HealthMaturityStage } from '../src/core/types.ts';

/** Minimal HealthResult stub for badge tests */
function makeHealthResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    health: {
      level: 'healthy',
      score: 85,
      summary: 'OK',
      coverage: 90,
      hygiene: 80,
    },
    issues: { total: 0, errors: 0, warnings: 0 },
    expiring: { expired: 0, expiringSoon: 0 },
    insights: [],
    maturityStage: 'Maintained',
    ...overrides,
  };
}

describe('buildMaturityBadge', () => {
  it('builds badge from HealthResult with maturityStage', () => {
    const result = makeHealthResult({ maturityStage: 'Autonomous' });
    const badge = buildMaturityBadge(result);

    assert.equal(badge.schemaVersion, 1);
    assert.equal(badge.label, 'governance');
    assert.equal(badge.message, 'Autonomous');
    assert.equal(badge.color, 'brightgreen');
  });

  it('falls back to Foundation when maturityStage is missing', () => {
    const result = makeHealthResult({ maturityStage: undefined });
    const badge = buildMaturityBadge(result);

    assert.equal(badge.message, 'Foundation');
    assert.equal(badge.color, 'red');
  });

  it('maps all maturity stages to correct colors', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];
    const expectedColors = ['red', 'orange', 'blue', 'brightgreen'];

    for (let i = 0; i < stages.length; i++) {
      const result = makeHealthResult({ maturityStage: stages[i] });
      const badge = buildMaturityBadge(result);
      assert.equal(
        badge.color,
        expectedColors[i],
        `${stages[i]} should map to ${expectedColors[i]}`,
      );
    }
  });
});

describe('MATURITY_STAGE_COLORS', () => {
  it('covers all four stages', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];
    for (const stage of stages) {
      assert.ok(stage in MATURITY_STAGE_COLORS, `Missing color for ${stage}`);
    }
  });
});

describe('formatBadgeAsJson', () => {
  it('produces valid shields.io endpoint JSON', () => {
    const badge: MaturityBadge = {
      schemaVersion: 1,
      label: 'governance',
      message: 'Maintained',
      color: 'blue',
    };
    const output = formatBadgeAsJson(badge);
    const parsed = JSON.parse(output) as MaturityBadge;

    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.label, 'governance');
    assert.equal(parsed.message, 'Maintained');
    assert.equal(parsed.color, 'blue');
  });

  it('produces pretty-printed JSON', () => {
    const badge: MaturityBadge = {
      schemaVersion: 1,
      label: 'governance',
      message: 'Tracking',
      color: 'orange',
    };
    const output = formatBadgeAsJson(badge);
    assert.ok(output.includes('\n'));
    assert.equal(JSON.stringify(JSON.parse(output), null, 2), output);
  });
});

describe('buildBadgeUrl', () => {
  it('builds shields.io static badge URL', () => {
    const badge: MaturityBadge = {
      schemaVersion: 1,
      label: 'governance',
      message: 'Autonomous',
      color: 'brightgreen',
    };
    const url = buildBadgeUrl(badge);
    assert.equal(
      url,
      'https://img.shields.io/badge/governance-Autonomous-brightgreen',
    );
  });

  it('appends style query parameter when provided', () => {
    const badge: MaturityBadge = {
      schemaVersion: 1,
      label: 'governance',
      message: 'Foundation',
      color: 'red',
    };
    const url = buildBadgeUrl(badge, 'for-the-badge');
    assert.equal(
      url,
      'https://img.shields.io/badge/governance-Foundation-red?style=for-the-badge',
    );
  });

  it('omits style parameter when not provided', () => {
    const badge: MaturityBadge = {
      schemaVersion: 1,
      label: 'governance',
      message: 'Tracking',
      color: 'orange',
    };
    const url = buildBadgeUrl(badge);
    assert.ok(!url.includes('?style='));
  });
});

describe('formatBadgeAsMarkdown', () => {
  it('produces Markdown image syntax', () => {
    const badge: MaturityBadge = {
      schemaVersion: 1,
      label: 'governance',
      message: 'Maintained',
      color: 'blue',
    };
    const md = formatBadgeAsMarkdown(badge);
    assert.ok(md.startsWith('![governance: Maintained]'));
    assert.ok(md.includes('https://img.shields.io/badge/'));
  });

  it('includes style in URL when provided', () => {
    const badge: MaturityBadge = {
      schemaVersion: 1,
      label: 'governance',
      message: 'Autonomous',
      color: 'brightgreen',
    };
    const md = formatBadgeAsMarkdown(badge, 'flat-square');
    assert.ok(md.includes('?style=flat-square'));
  });
});

describe('formatBadgeOutput', () => {
  it('dispatches json format', () => {
    const result = makeHealthResult({ maturityStage: 'Maintained' });
    const output = formatBadgeOutput(result, { format: 'json' });
    const parsed = JSON.parse(output) as MaturityBadge;
    assert.equal(parsed.message, 'Maintained');
    assert.equal(parsed.color, 'blue');
  });

  it('dispatches markdown format', () => {
    const result = makeHealthResult({ maturityStage: 'Autonomous' });
    const output = formatBadgeOutput(result, { format: 'markdown' });
    assert.ok(output.startsWith('![governance: Autonomous]'));
  });

  it('dispatches url format', () => {
    const result = makeHealthResult({ maturityStage: 'Foundation' });
    const output = formatBadgeOutput(result, { format: 'url' });
    assert.ok(output.startsWith('https://img.shields.io/badge/'));
    assert.ok(output.includes('Foundation'));
    assert.ok(output.includes('red'));
  });

  it('passes style through to markdown/url', () => {
    const result = makeHealthResult({ maturityStage: 'Tracking' });
    const md = formatBadgeOutput(result, {
      format: 'markdown',
      style: 'for-the-badge',
    });
    assert.ok(md.includes('?style=for-the-badge'));

    const url = formatBadgeOutput(result, {
      format: 'url',
      style: 'flat-square',
    });
    assert.ok(url.includes('?style=flat-square'));
  });
});

describe('constants', () => {
  it('BADGE_FORMATS includes json, markdown, url', () => {
    assert.deepEqual([...BADGE_FORMATS], ['json', 'markdown', 'url']);
  });

  it('BADGE_STYLES includes all shields.io styles', () => {
    const expected: BadgeStyle[] = [
      'flat',
      'flat-square',
      'plastic',
      'for-the-badge',
      'social',
    ];
    assert.deepEqual([...BADGE_STYLES], expected);
  });
});
