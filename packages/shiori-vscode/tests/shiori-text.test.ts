import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractShioriText, isDateExpired } from '../src/shiori-text.ts';

describe('extractShioriText', () => {
  it('extracts ref from standard annotation with space', () => {
    const result = extractShioriText(
      '// eslint-disable-next-line no-console -- shiori: SUP-1234',
    );
    assert.ok(result);
    assert.equal(result.fieldsText, 'SUP-1234');
  });

  it('extracts ref with key=value pairs', () => {
    const result = extractShioriText(
      "// shiori: SUP-1234 expires=2026-06 reason='tracked'",
    );
    assert.ok(result);
    assert.equal(
      result.fieldsText,
      "SUP-1234 expires=2026-06 reason='tracked'",
    );
  });

  it('extracts compact form (no space after colon)', () => {
    const result = extractShioriText('// shiori:SUP-1234');
    assert.ok(result);
    assert.equal(result.fieldsText, 'SUP-1234');
  });

  it('extracts ADR-style ref', () => {
    const result = extractShioriText('// shiori: ADR:0007');
    assert.ok(result);
    assert.equal(result.fieldsText, 'ADR:0007');
  });

  it('returns undefined for shiori:ignore', () => {
    const result = extractShioriText(
      '// eslint-disable-next-line no-console -- shiori:ignore',
    );
    assert.equal(result, undefined);
  });

  it('returns undefined for shiori:ignore with surrounding text', () => {
    const result = extractShioriText(
      '// stylelint-disable-next-line -- shiori:ignore some-rule',
    );
    assert.equal(result, undefined);
  });

  it('returns undefined for lines without shiori marker', () => {
    const result = extractShioriText('// eslint-disable-next-line no-console');
    assert.equal(result, undefined);
  });

  it('returns undefined for empty line', () => {
    const result = extractShioriText('');
    assert.equal(result, undefined);
  });

  it('provides correct shioriOffset', () => {
    const line = '// eslint-disable-next-line no-console -- shiori: SUP-1234';
    const result = extractShioriText(line);
    assert.ok(result);
    // shioriOffset should point to the start of "shiori:" match within the line
    assert.ok(result.shioriOffset >= 0);
    assert.ok(line.slice(result.shioriOffset).startsWith('shiori:'));
  });

  it('handles standalone shiori comment', () => {
    const result = extractShioriText('// shiori: DEV-001');
    assert.ok(result);
    assert.equal(result.fieldsText, 'DEV-001');
  });
});

describe('isDateExpired', () => {
  it('returns false for a far future YYYY-MM-DD date', () => {
    assert.equal(isDateExpired('2099-12-31'), false);
  });

  it('returns true for a past YYYY-MM-DD date', () => {
    assert.equal(isDateExpired('2020-01-01'), true);
  });

  it('returns false for a far future YYYY-MM date', () => {
    assert.equal(isDateExpired('2099-12'), false);
  });

  it('returns true for a past YYYY-MM date', () => {
    assert.equal(isDateExpired('2020-01'), true);
  });

  it('YYYY-MM: same month is not expired (month is still active)', () => {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    assert.equal(isDateExpired(currentYearMonth), false);
  });

  it('YYYY-MM-DD: today is not expired (day is still active)', () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(isDateExpired(todayStr), false);
  });

  it('YYYY-MM-DD: yesterday is expired', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const str = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    assert.equal(isDateExpired(str), true);
  });
});
