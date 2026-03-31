import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  Registry,
  VerifyIssueType,
} from '../src/core/types.ts';
import { VERIFY_ISSUE_TYPES } from '../src/core/types.ts';
import {
  check,
  checkThresholds,
  computeDualAxisScores,
} from '../src/commands/check.ts';

const makeScanResult = (
  annotations: ScanResult['annotations'],
): ScanResult => ({
  annotations,
  candidates: [],
  filesScanned: 1,
});

describe('check', () => {
  it('returns verify result from scan result and registry', () => {
    const scanResult = makeScanResult([
      {
        ref: 'TEST-001',
        tagged: true,
        ignored: false,
        location: { file: 'test.ts', line: 1 },
      },
    ]);
    const registry: Registry = {
      'TEST-001': {
        reason: 'test',
        target: 'test.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };

    const result = check({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
    });

    assert.equal(result.scanResult, scanResult);
    assert.equal(result.verifyResult.summary.total, 0);
    assert.equal(result.verifyResult.scannedRecords, 1);
    assert.equal(result.verifyResult.registryEntries, 1);
  });

  it('passes duplicates through to verify for ref-collision', () => {
    const scanResult = makeScanResult([
      {
        ref: 'DUP-001',
        tagged: true,
        ignored: false,
        location: { file: 'test.ts', line: 1 },
      },
    ]);
    const registry: Registry = {
      'DUP-001': {
        reason: 'test',
        target: 'test.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };

    const result = check({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      duplicates: [
        {
          ref: 'DUP-001',
          defaultFile: 'registry.json',
          patternFile: 'team-a.json',
        },
      ],
    });

    const collisions = result.verifyResult.issues.filter(
      (i) => i.type === 'ref-collision',
    );
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0]!.ref, 'DUP-001');
    assert.equal(result.verifyResult.summary.byType['ref-collision'], 1);
  });

  it('passes expiringThresholdDays through to verify', () => {
    const scanResult = makeScanResult([
      {
        ref: 'SOON-001',
        tagged: true,
        ignored: false,
        location: { file: 'test.ts', line: 1 },
      },
    ]);
    const registry: Registry = {
      'SOON-001': {
        reason: 'test',
        target: 'test.ts',
        expires: '2026-02-14',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };

    const result = check({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      now: new Date('2026-02-11T00:00:00Z'),
      expiringThresholdDays: 7,
    });

    const expiringSoon = result.verifyResult.issues.filter(
      (i) => i.type === 'expiring-soon',
    );
    assert.equal(expiringSoon.length, 1);
    assert.equal(expiringSoon[0]!.ref, 'SOON-001');
  });

  it('detects missing-in-registry as error when failOn is set', () => {
    const scanResult = makeScanResult([
      {
        ref: 'UNKNOWN-001',
        tagged: true,
        ignored: false,
        location: { file: 'test.ts', line: 1 },
      },
    ]);

    const result = check({
      scanResult,
      registry: {},
      failOn: ['missing-in-registry'],
      warnOn: [],
    });

    assert.equal(result.verifyResult.summary.errors, 1);
    assert.equal(result.verifyResult.issues[0]!.type, 'missing-in-registry');
    assert.equal(result.verifyResult.issues[0]!.severity, 'error');
  });
});

describe('checkThresholds', () => {
  it('passes when no thresholds are set', () => {
    const result = checkThresholds({ coverage: 50, hygiene: 50 });
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
  });

  it('passes when both axes meet thresholds', () => {
    const result = checkThresholds({
      coverage: 80,
      hygiene: 70,
      coverageThreshold: 80,
      hygieneThreshold: 70,
    });
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
  });

  it('fails when coverage is below threshold', () => {
    const result = checkThresholds({
      coverage: 60,
      hygiene: 90,
      coverageThreshold: 80,
    });
    assert.equal(result.passed, false);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]!.axis, 'coverage');
    assert.equal(result.violations[0]!.actual, 60);
    assert.equal(result.violations[0]!.threshold, 80);
  });

  it('fails when hygiene is below threshold', () => {
    const result = checkThresholds({
      coverage: 90,
      hygiene: 50,
      hygieneThreshold: 70,
    });
    assert.equal(result.passed, false);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]!.axis, 'hygiene');
    assert.equal(result.violations[0]!.actual, 50);
    assert.equal(result.violations[0]!.threshold, 70);
  });

  it('reports both violations when both axes fail', () => {
    const result = checkThresholds({
      coverage: 40,
      hygiene: 30,
      coverageThreshold: 80,
      hygieneThreshold: 70,
    });
    assert.equal(result.passed, false);
    assert.equal(result.violations.length, 2);
    assert.equal(result.violations[0]!.axis, 'coverage');
    assert.equal(result.violations[1]!.axis, 'hygiene');
  });

  it('ignores threshold for axis not specified', () => {
    const result = checkThresholds({
      coverage: 20,
      hygiene: 90,
      hygieneThreshold: 70,
    });
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
  });
});

describe('computeDualAxisScores', () => {
  it('computes coverage and hygiene from scan result and byType', () => {
    const scanResult: ScanResult = {
      annotations: [
        {
          ref: 'A-001',
          tagged: true,
          ignored: false,
          location: { file: 'a.ts', line: 1 },
        },
      ],
      candidates: [
        {
          pattern: 'eslint',
          directive: 'eslint-disable-next-line',
          location: { file: 'b.ts', line: 2 },
        },
      ],
      filesScanned: 2,
    };

    // No issues → hygiene = 100, coverage = 1/(1+1) = 50
    const byType = Object.fromEntries(
      VERIFY_ISSUE_TYPES.map((t) => [t, 0]),
    ) as Record<VerifyIssueType, number>;

    const scores = computeDualAxisScores(scanResult, byType);
    assert.equal(scores.coverage, 50);
    assert.equal(scores.hygiene, 100);
  });
});
