import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extendExpires } from '../src/core/date-utils.ts';

describe('extendExpires', () => {
  describe('YYYY-MM format', () => {
    it('extends by 1 month', () => {
      assert.equal(extendExpires('2026-01', 1), '2026-02');
    });

    it('extends by 3 months', () => {
      assert.equal(extendExpires('2026-01', 3), '2026-04');
    });

    it('extends by 12 months (year rollover)', () => {
      assert.equal(extendExpires('2026-01', 12), '2027-01');
    });

    it('rolls over from December to January', () => {
      assert.equal(extendExpires('2026-12', 1), '2027-01');
    });

    it('rolls over from November + 3', () => {
      assert.equal(extendExpires('2026-11', 3), '2027-02');
    });

    it('preserves YYYY-MM format', () => {
      const result = extendExpires('2026-06', 3);
      assert.equal(result.length, 7);
      assert.match(result, /^\d{4}-\d{2}$/);
    });
  });

  describe('YYYY-MM-DD format', () => {
    it('extends by 3 months (normal)', () => {
      assert.equal(extendExpires('2026-01-15', 3), '2026-04-15');
    });

    it('clamps day to last day of target month (Jan 31 + 1 → Feb 28)', () => {
      assert.equal(extendExpires('2026-01-31', 1), '2026-02-28');
    });

    it('clamps day for leap year (Jan 31 + 1 → Feb 29 in 2024)', () => {
      assert.equal(extendExpires('2024-01-31', 1), '2024-02-29');
    });

    it('extends Feb 28 by 1 month to March 28', () => {
      assert.equal(extendExpires('2026-02-28', 1), '2026-03-28');
    });

    it('rolls over year boundary with day', () => {
      assert.equal(extendExpires('2026-12-15', 1), '2027-01-15');
    });

    it('preserves YYYY-MM-DD format', () => {
      const result = extendExpires('2026-06-15', 3);
      assert.equal(result.length, 10);
      assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    });

    it('clamps March 31 + 1 to April 30', () => {
      assert.equal(extendExpires('2026-03-31', 1), '2026-04-30');
    });
  });

  describe('error cases', () => {
    it('throws for zero months', () => {
      assert.throws(() => extendExpires('2026-01', 0), /must be positive/);
    });

    it('throws for negative months', () => {
      assert.throws(() => extendExpires('2026-01', -1), /must be positive/);
    });

    it('throws for invalid format', () => {
      assert.throws(() => extendExpires('2026', 1), /Invalid expires format/);
    });

    it('throws for invalid YYYY-MM', () => {
      assert.throws(() => extendExpires('abcd-ef', 1), /Invalid YYYY-MM date/);
    });

    it('throws for invalid YYYY-MM-DD', () => {
      assert.throws(
        () => extendExpires('abcd-ef-gh', 1),
        /Invalid YYYY-MM-DD date/,
      );
    });

    it('throws for month out of range (YYYY-MM)', () => {
      assert.throws(() => extendExpires('2026-13', 1), /Invalid YYYY-MM date/);
    });
  });
});
