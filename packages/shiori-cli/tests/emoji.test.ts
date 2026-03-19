import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  healthEmoji,
  trendArrow,
  trendEmoji,
  insightIcon,
  gateIcon,
} from '../src/core/emoji.ts';

describe('healthEmoji', () => {
  it('returns green circle for healthy', () => {
    assert.equal(healthEmoji('healthy'), '🟢');
  });

  it('returns yellow circle for warning', () => {
    assert.equal(healthEmoji('warning'), '🟡');
  });

  it('returns red circle for critical', () => {
    assert.equal(healthEmoji('critical'), '🔴');
  });
});

describe('trendArrow', () => {
  it('returns up arrow for improving', () => {
    assert.equal(trendArrow('improving'), '↑');
  });

  it('returns down arrow for declining', () => {
    assert.equal(trendArrow('declining'), '↓');
  });

  it('returns right arrow for stable', () => {
    assert.equal(trendArrow('stable'), '→');
  });
});

describe('trendEmoji', () => {
  it('returns chart increasing for improving', () => {
    assert.equal(trendEmoji('improving'), '📈');
  });

  it('returns chart decreasing for declining', () => {
    assert.equal(trendEmoji('declining'), '📉');
  });

  it('returns right arrow for stable', () => {
    assert.equal(trendEmoji('stable'), '➡️');
  });
});

describe('insightIcon', () => {
  it('returns cross mark for error', () => {
    assert.equal(insightIcon('error'), '❌');
  });

  it('returns warning sign for warning', () => {
    assert.equal(insightIcon('warning'), '⚠️');
  });

  it('returns info sign for info', () => {
    assert.equal(insightIcon('info'), 'ℹ️');
  });
});

describe('gateIcon', () => {
  it('returns check mark for passed', () => {
    assert.equal(gateIcon(true), '✅');
  });

  it('returns cross mark for failed', () => {
    assert.equal(gateIcon(false), '❌');
  });
});
