import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  ScanResult,
  Registry,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
  ReportResult,
} from "../src/core/types.ts";
import { report, calculateScore } from "../src/commands/report.ts";
import { VERIFY_ISSUE_TYPES } from "../src/core/types.ts";
import {
  formatReportOutput as formatReport,
  formatReportAsMarkdown,
  type ShieldsBadge,
} from "../src/formatters/report-formatter.ts";

function makeAnnotation(overrides: Partial<ShioriAnnotation> = {}): ShioriAnnotation {
  return {
    ref: "TEST-001",
    rule: "no-console",
    tagged: true,
    ignored: false,
    location: { file: "test.ts", line: 1 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    reason: "test reason",
    target: "test.ts",
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}

function makeScanResult(
  annotations: ShioriAnnotation[] = [],
  candidates: ShioriCandidate[] = [],
): ScanResult {
  return {
    annotations,
    candidates,
    filesScanned: 1,
  };
}

describe("report", () => {
  describe("health score", () => {
    it("returns score 100 for clean codebase", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
        registry: {
          "TEST-001": makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.health.score, 100);
      assert.equal(result.health.level, "healthy");
    });

    it("deducts points for expired annotations", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
        registry: {
          "TEST-001": makeRegistryEntry({ expires: "2020-01-01" }),
        },
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.health.score < 100);
      assert.equal(result.byType["expired"], 1);
    });

    it("deducts points for missing-in-registry", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "MISSING-001" })]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.health.score < 100);
      assert.equal(result.byType["missing-in-registry"], 1);
    });

    it("deducts points for untracked candidates", () => {
      const candidates: ShioriCandidate[] = [
        { pattern: "eslint", location: { file: "a.ts", line: 1 } },
        { pattern: "eslint", location: { file: "b.ts", line: 2 } },
      ];

      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })], candidates),
        registry: {
          "TEST-001": makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      // 2 candidates out of 3 total = ~67% untracked → score reduced
      assert.ok(result.health.score < 100);
    });

    it("returns critical for heavily degraded codebase", () => {
      const annotations = [
        makeAnnotation({ ref: "EXP-001" }),
        makeAnnotation({ ref: "EXP-002" }),
        makeAnnotation({ ref: "EXP-003" }),
        makeAnnotation({ ref: "EXP-004" }),
        makeAnnotation({ ref: "MISSING-001" }),
        makeAnnotation({ ref: "MISSING-002" }),
        makeAnnotation({ ref: "MISSING-003" }),
        makeAnnotation({
          ref: "BAD",
          tagged: true,
          syntaxErrors: ["invalid syntax"],
        }),
      ];
      const registry: Registry = {
        "EXP-001": makeRegistryEntry({ expires: "2020-01-01" }),
        "EXP-002": makeRegistryEntry({ expires: "2020-01-01" }),
        "EXP-003": makeRegistryEntry({ expires: "2020-01-01" }),
        "EXP-004": makeRegistryEntry({ expires: "2020-01-01" }),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.health.level, "critical");
      assert.ok(result.health.score < 50);
    });

    it("score never goes below 0", () => {
      // Create many issues to try to push score negative
      const annotations = Array.from({ length: 20 }, (_, i) =>
        makeAnnotation({ ref: `MISS-${i}`, rule: "no-any" }),
      );

      const result = report({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.health.score >= 0);
    });
  });

  describe("totals", () => {
    it("reports correct totals", () => {
      const annotations = [
        makeAnnotation({ ref: "TEST-001" }),
        makeAnnotation({ ref: "TEST-002" }),
      ];
      const candidates: ShioriCandidate[] = [
        { pattern: "eslint", location: { file: "a.ts", line: 1 } },
      ];
      const registry: Registry = {
        "TEST-001": makeRegistryEntry(),
        "TEST-002": makeRegistryEntry(),
        "TEST-003": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations, candidates),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.totals.annotations, 2);
      assert.equal(result.totals.candidates, 1);
      assert.equal(result.totals.registryEntries, 3);
    });
  });

  describe("insights", () => {
    it("generates expired insight", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
        registry: {
          "TEST-001": makeRegistryEntry({ expires: "2020-01-01" }),
        },
        failOn: [],
        warnOn: [],
      });

      const expired = result.insights.find((i) => i.label === "expired");
      assert.ok(expired);
      assert.equal(expired.level, "error");
    });

    it("generates unregistered insight", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "MISSING-001" })]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      const unregistered = result.insights.find((i) => i.label === "unregistered");
      assert.ok(unregistered);
      assert.equal(unregistered.level, "warning");
    });

    it("generates stale insight for unused registry entries", () => {
      const result = report({
        scanResult: makeScanResult([]),
        registry: {
          "STALE-001": makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      const stale = result.insights.find((i) => i.label === "stale");
      assert.ok(stale);
      assert.equal(stale.level, "warning");
    });

    it("generates candidates insight", () => {
      const candidates: ShioriCandidate[] = [
        { pattern: "eslint", location: { file: "a.ts", line: 1 } },
      ];

      const result = report({
        scanResult: makeScanResult([], candidates),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      const candidateInsight = result.insights.find((i) => i.label === "candidates");
      assert.ok(candidateInsight);
      assert.equal(candidateInsight.level, "info");
    });

    it("generates clean insight when no issues", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
        registry: {
          "TEST-001": makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      const clean = result.insights.find((i) => i.label === "clean");
      assert.ok(clean);
      assert.equal(clean.level, "info");
    });
  });

  describe("breakdowns", () => {
    it("aggregates by rule", () => {
      const annotations = [
        makeAnnotation({ ref: "TEST-001", rule: "no-console" }),
        makeAnnotation({ ref: "TEST-002", rule: "no-console" }),
        makeAnnotation({ ref: "TEST-003", rule: "no-debugger" }),
      ];
      const registry: Registry = {
        "TEST-001": makeRegistryEntry(),
        "TEST-002": makeRegistryEntry(),
        "TEST-003": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byRule.length, 2);
      // Sorted by count descending
      assert.equal(result.byRule[0]!.key, "no-console");
      assert.equal(result.byRule[0]!.count, 2);
      assert.equal(result.byRule[1]!.key, "no-debugger");
      assert.equal(result.byRule[1]!.count, 1);
    });

    it("aggregates by owner", () => {
      const registry: Registry = {
        "TEST-001": makeRegistryEntry({ owner: "team-a" }),
        "TEST-002": makeRegistryEntry({ owner: "team-a" }),
        "TEST-003": makeRegistryEntry({ owner: "team-b" }),
      };

      const result = report({
        scanResult: makeScanResult([
          makeAnnotation({ ref: "TEST-001" }),
          makeAnnotation({ ref: "TEST-002" }),
          makeAnnotation({ ref: "TEST-003" }),
        ]),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byOwner.length, 2);
      assert.equal(result.byOwner[0]!.key, "team-a");
      assert.equal(result.byOwner[0]!.count, 2);
    });

    it("aggregates by kind", () => {
      const registry: Registry = {
        "TEST-001": makeRegistryEntry({ kind: "suppression" }),
        "TEST-002": makeRegistryEntry({ kind: "suppression" }),
        "TEST-003": makeRegistryEntry({ kind: "decision" }),
      };

      const result = report({
        scanResult: makeScanResult([
          makeAnnotation({ ref: "TEST-001" }),
          makeAnnotation({ ref: "TEST-002" }),
          makeAnnotation({ ref: "TEST-003" }),
        ]),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byKind.length, 2);
      assert.equal(result.byKind[0]!.key, "suppression");
      assert.equal(result.byKind[0]!.count, 2);
    });

    it("excludes undefined rule/kind/owner", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001", rule: undefined })]),
        registry: {
          "TEST-001": makeRegistryEntry({
            kind: undefined,
            owner: undefined,
          }),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byRule.length, 0);
      assert.equal(result.byKind.length, 0);
      assert.equal(result.byOwner.length, 0);
    });
  });

  describe("verifyResult passthrough", () => {
    it("includes underlying verifyResult", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
        registry: {
          "TEST-001": makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.verifyResult);
      assert.ok(result.verifyResult.timestamp);
      assert.ok(result.verifyResult.summary);
    });
  });

  describe("now injection", () => {
    it("uses provided now date for expiry checks", () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
        registry: {
          "TEST-001": makeRegistryEntry({ expires: "2026-06-01" }),
        },
        failOn: [],
        warnOn: [],
        now: new Date("2026-07-01T00:00:00Z"),
      });

      assert.equal(result.byType["expired"], 1);

      const result2 = report({
        scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
        registry: {
          "TEST-001": makeRegistryEntry({ expires: "2026-06-01" }),
        },
        failOn: [],
        warnOn: [],
        now: new Date("2026-05-01T00:00:00Z"),
      });

      assert.equal(result2.byType["expired"], 0);
    });
  });

  describe("byFile aggregation", () => {
    it("aggregates annotations across multiple files", () => {
      const annotations = [
        makeAnnotation({
          ref: "TEST-001",
          location: { file: "src/a.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "TEST-002",
          location: { file: "src/a.ts", line: 5 },
        }),
        makeAnnotation({
          ref: "TEST-003",
          location: { file: "src/b.ts", line: 1 },
        }),
      ];
      const registry: Registry = {
        "TEST-001": makeRegistryEntry(),
        "TEST-002": makeRegistryEntry(),
        "TEST-003": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      assert.equal(result.byFile.length, 2);
      // Sorted by annotationCount descending
      assert.equal(result.byFile[0]!.path, "src/a.ts");
      assert.equal(result.byFile[0]!.annotationCount, 2);
      assert.equal(result.byFile[1]!.path, "src/b.ts");
      assert.equal(result.byFile[1]!.annotationCount, 1);
    });

    it("classifies expired ref annotations as expiredCount", () => {
      const annotations = [
        makeAnnotation({
          ref: "EXP-001",
          location: { file: "src/a.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "OK-001",
          location: { file: "src/a.ts", line: 5 },
        }),
      ];
      const registry: Registry = {
        "EXP-001": makeRegistryEntry({ expires: "2020-01-01" }),
        "OK-001": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      const fileA = result.byFile.find((f) => f.path === "src/a.ts");
      assert.ok(fileA);
      assert.equal(fileA.expiredCount, 1);
      assert.equal(fileA.healthyCount, 1);
    });

    it("classifies expiring-soon ref annotations as expiringCount", () => {
      // Use now injection: annotation expires in 5 days (within 14-day threshold)
      const annotations = [
        makeAnnotation({
          ref: "SOON-001",
          location: { file: "src/a.ts", line: 1 },
        }),
      ];
      const registry: Registry = {
        "SOON-001": makeRegistryEntry({ expires: "2026-07-05" }),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date("2026-07-01T00:00:00Z"),
      });

      assert.ok(result.byFile);
      const fileA = result.byFile.find((f) => f.path === "src/a.ts");
      assert.ok(fileA);
      assert.equal(fileA.expiringCount, 1);
      assert.equal(fileA.healthyCount, 0);
    });

    it("counts annotations without expiry as healthy", () => {
      const annotations = [
        makeAnnotation({
          ref: "NOEXP-001",
          location: { file: "src/a.ts", line: 1 },
        }),
      ];
      const registry: Registry = {
        "NOEXP-001": makeRegistryEntry({ expires: undefined }),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      assert.equal(result.byFile[0]!.healthyCount, 1);
      assert.equal(result.byFile[0]!.expiredCount, 0);
      assert.equal(result.byFile[0]!.expiringCount, 0);
    });

    it("attributes same ref across multiple files correctly", () => {
      const annotations = [
        makeAnnotation({
          ref: "EXP-001",
          location: { file: "src/a.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "EXP-001",
          location: { file: "src/b.ts", line: 1 },
        }),
      ];
      const registry: Registry = {
        "EXP-001": makeRegistryEntry({ expires: "2020-01-01" }),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      assert.equal(result.byFile.length, 2);
      // Both files should show the annotation as expired
      for (const file of result.byFile) {
        assert.equal(file.expiredCount, 1);
        assert.equal(file.healthyCount, 0);
      }
    });

    it("returns empty arrays when annotations is empty", () => {
      const result = report({
        scanResult: makeScanResult([]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      assert.ok(result.byDirectory);
      assert.equal(result.byFile.length, 0);
      assert.equal(result.byDirectory.length, 0);
    });

    it("excludes ignored annotations from aggregation", () => {
      const annotations = [
        makeAnnotation({
          ref: "TEST-001",
          location: { file: "src/a.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "IGN-001",
          ignored: true,
          location: { file: "src/a.ts", line: 5 },
        }),
      ];
      const registry: Registry = {
        "TEST-001": makeRegistryEntry(),
        "IGN-001": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      const fileA = result.byFile.find((f) => f.path === "src/a.ts");
      assert.ok(fileA);
      // Only 1 annotation counted (ignored one excluded)
      assert.equal(fileA.annotationCount, 1);
    });

    it("counts same ref multiple times in one file independently", () => {
      const annotations = [
        makeAnnotation({
          ref: "TEST-001",
          location: { file: "src/a.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "TEST-001",
          location: { file: "src/a.ts", line: 10 },
        }),
        makeAnnotation({
          ref: "TEST-001",
          location: { file: "src/a.ts", line: 20 },
        }),
      ];
      const registry: Registry = {
        "TEST-001": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      assert.equal(result.byFile[0]!.annotationCount, 3);
      assert.equal(result.byFile[0]!.healthyCount, 3);
    });

    it("counts empty ref annotations as healthy", () => {
      const annotations = [makeAnnotation({ ref: "", location: { file: "src/a.ts", line: 1 } })];
      // Empty ref won't match any registry entry — verify will flag as missing-in-registry
      // but it won't be expired or expiring, so it's "healthy" from expiry perspective
      const result = report({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byFile);
      assert.equal(result.byFile[0]!.healthyCount, 1);
      assert.equal(result.byFile[0]!.expiredCount, 0);
    });
  });

  describe("byDirectory aggregation", () => {
    it("groups files by dirname", () => {
      const annotations = [
        makeAnnotation({
          ref: "TEST-001",
          location: { file: "src/core/a.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "TEST-002",
          location: { file: "src/core/b.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "TEST-003",
          location: { file: "src/cli/c.ts", line: 1 },
        }),
      ];
      const registry: Registry = {
        "TEST-001": makeRegistryEntry(),
        "TEST-002": makeRegistryEntry(),
        "TEST-003": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byDirectory);
      assert.equal(result.byDirectory.length, 2);
      // src/core has 2 annotations (higher count → first)
      const coreDir = result.byDirectory.find((d) => d.directory === "src/core");
      assert.ok(coreDir);
      assert.equal(coreDir.annotationCount, 2);
      assert.equal(coreDir.fileCount, 2);

      const cliDir = result.byDirectory.find((d) => d.directory === "src/cli");
      assert.ok(cliDir);
      assert.equal(cliDir.annotationCount, 1);
      assert.equal(cliDir.fileCount, 1);
    });

    it('uses "." for root-level files', () => {
      const annotations = [
        makeAnnotation({
          ref: "TEST-001",
          location: { file: "test.ts", line: 1 },
        }),
      ];
      const registry: Registry = {
        "TEST-001": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byDirectory);
      assert.equal(result.byDirectory[0]!.directory, ".");
    });

    it("sums expired/expiring counts across files in directory", () => {
      const annotations = [
        makeAnnotation({
          ref: "EXP-001",
          location: { file: "src/core/a.ts", line: 1 },
        }),
        makeAnnotation({
          ref: "OK-001",
          location: { file: "src/core/b.ts", line: 1 },
        }),
      ];
      const registry: Registry = {
        "EXP-001": makeRegistryEntry({ expires: "2020-01-01" }),
        "OK-001": makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.byDirectory);
      const coreDir = result.byDirectory.find((d) => d.directory === "src/core");
      assert.ok(coreDir);
      assert.equal(coreDir.expiredCount, 1);
      assert.equal(coreDir.healthyCount, 1);
      assert.equal(coreDir.annotationCount, 2);
    });
  });
});

describe("formatReport", () => {
  function makeReportResult(): ReportResult {
    return report({
      scanResult: makeScanResult(
        [
          makeAnnotation({ ref: "TEST-001", rule: "no-console" }),
          makeAnnotation({ ref: "TEST-002", rule: "no-debugger" }),
        ],
        [{ pattern: "eslint", location: { file: "a.ts", line: 1 } }],
      ),
      registry: {
        "TEST-001": makeRegistryEntry({ owner: "team-a", kind: "suppression" }),
        "TEST-002": makeRegistryEntry({ owner: "team-b", kind: "decision" }),
      },
      failOn: [],
      warnOn: [],
    });
  }

  it("formats as JSON", () => {
    const result = makeReportResult();
    const output = formatReport(result, "json");
    const parsed = JSON.parse(output) as ReportResult;
    assert.equal(parsed.health.level, result.health.level);
    assert.equal(parsed.totals.annotations, 2);
  });

  it("formats as Markdown", () => {
    const result = makeReportResult();
    const output = formatReport(result, "markdown");
    assert.ok(output.includes("# Shiori Governance Report"));
    assert.ok(output.includes("Health:"));
    assert.ok(output.includes("Overview"));
    assert.ok(output.includes("Insights"));
  });

  it("formats as badge (shields.io endpoint JSON)", () => {
    const result = makeReportResult();
    const output = formatReport(result, "badge");
    const badge = JSON.parse(output) as ShieldsBadge;
    assert.equal(badge.schemaVersion, 1);
    assert.equal(badge.label, "governance");
    assert.match(badge.message, /^\d+\/100$/);
    assert.ok(["brightgreen", "yellow", "red"].includes(badge.color));
  });
});

describe("formatReportAsMarkdown", () => {
  it("includes all sections", () => {
    const result = report({
      scanResult: makeScanResult(
        [
          makeAnnotation({ ref: "TEST-001", rule: "no-console" }),
          makeAnnotation({ ref: "MISSING-001", rule: "no-any" }),
        ],
        [{ pattern: "eslint", location: { file: "a.ts", line: 1 } }],
      ),
      registry: {
        "TEST-001": makeRegistryEntry({
          owner: "team-a",
          kind: "suppression",
        }),
      },
      failOn: [],
      warnOn: [],
    });

    const md = formatReportAsMarkdown(result);

    assert.ok(md.includes("# Shiori Governance Report"));
    assert.ok(md.includes("## Health:"));
    assert.ok(md.includes("## Overview"));
    assert.ok(md.includes("## Insights"));
    assert.ok(md.includes("## Issues by Type"));
    assert.ok(md.includes("## Annotations by Rule"));
    assert.ok(md.includes("## Ownership"));
    assert.ok(md.includes("## Annotation Kinds"));
  });

  it("omits empty breakdown sections", () => {
    const result = report({
      scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001", rule: undefined })]),
      registry: {
        "TEST-001": makeRegistryEntry({ kind: undefined, owner: undefined }),
      },
      failOn: [],
      warnOn: [],
    });

    const md = formatReportAsMarkdown(result);

    assert.ok(!md.includes("## Annotations by Rule"));
    assert.ok(!md.includes("## Ownership"));
    assert.ok(!md.includes("## Annotation Kinds"));
  });

  it("shows correct health emoji", () => {
    // Healthy
    const healthy = report({
      scanResult: makeScanResult([makeAnnotation({ ref: "TEST-001" })]),
      registry: { "TEST-001": makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });
    assert.ok(formatReportAsMarkdown(healthy).includes("🟢"));

    // Critical
    const annotations = Array.from({ length: 10 }, (_, i) => makeAnnotation({ ref: `MISS-${i}` }));
    const critical = report({
      scanResult: makeScanResult(annotations),
      // All expired
      registry: Object.fromEntries(
        annotations.map((a) => [a.ref, makeRegistryEntry({ expires: "2020-01-01" })]),
      ),
      failOn: [],
      warnOn: [],
    });
    // Should be warning or critical due to expired
    const md = formatReportAsMarkdown(critical);
    assert.ok(md.includes("🟡") || md.includes("🔴"));
  });
});

describe("calculateScore", () => {
  /** Build a zero-initialized byType record */
  function zeroBytType(): Record<string, number> {
    const byType: Record<string, number> = {};
    for (const t of VERIFY_ISSUE_TYPES) {
      byType[t] = 0;
    }
    return byType;
  }

  it("returns 100 with no issues and no candidates", () => {
    const byType = zeroBytType();
    const score = calculateScore(
      [makeAnnotation({ ref: "A" })],
      [],
      byType as Record<(typeof VERIFY_ISSUE_TYPES)[number], number>,
    );
    assert.equal(score, 100);
  });

  it("deducts for ref-status-closed as major tier (5pt/issue)", () => {
    const byType = zeroBytType();
    byType["ref-status-closed"] = 2;
    const score = calculateScore(
      [makeAnnotation({ ref: "A" })],
      [],
      byType as Record<(typeof VERIFY_ISSUE_TYPES)[number], number>,
    );
    // 100 - min(2*5, 30) = 90
    assert.equal(score, 90);
  });

  it("ref-status-closed shares major tier cap with other major issues", () => {
    const byType = zeroBytType();
    byType["ref-status-closed"] = 3;
    byType["missing-in-registry"] = 4;
    // Total major issues: 7, raw deduction: 7*5=35, capped at 30
    const score = calculateScore(
      [makeAnnotation({ ref: "A" })],
      [],
      byType as Record<(typeof VERIFY_ISSUE_TYPES)[number], number>,
    );
    // 100 - 30 = 70
    assert.equal(score, 70);
  });

  it("caps critical tier at 40", () => {
    const byType = zeroBytType();
    byType["expired"] = 5;
    // Raw: 5*10=50, capped at 40
    const score = calculateScore(
      [makeAnnotation({ ref: "A" })],
      [],
      byType as Record<(typeof VERIFY_ISSUE_TYPES)[number], number>,
    );
    assert.equal(score, 60);
  });
});
