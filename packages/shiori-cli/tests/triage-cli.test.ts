import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { runCli, createFixtureDir, createTempBase } from "./helpers/cli-test-utils.ts";

describe("triage-cli: exit code behavior", () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase("shiori-triage-test-"));
  });

  after(async () => {
    await cleanup();
  });

  describe("exit code 0 when no errors", () => {
    it("exits 0 when all annotations are in registry", async () => {
      const dir = await createFixtureDir(baseDir, "no-errors", {
        sourceFiles: {
          "src/sample.ts":
            '// eslint-disable-next-line no-console -- shiori: TRG-001\nconsole.log("test");\n',
        },
        registryEntries: {
          "TRG-001": { reason: "test annotation", target: "all" },
        },
      });
      const { exitCode } = await runCli(["triage", "--cwd", dir, "--patterns", "src/**/*.ts"]);

      assert.equal(exitCode, 0);
    });
  });

  describe("exit code 1 when --fail-on issues produce errors", () => {
    it("exits 1 when annotations are missing from registry and --fail-on missing-in-registry", async () => {
      const dir = await createFixtureDir(baseDir, "fail-missing", {
        sourceFiles: {
          "src/sample.ts":
            '// eslint-disable-next-line no-console -- shiori: TRG-MISSING\nconsole.log("test");\n',
        },
        registryEntries: {},
      });
      const { exitCode, stderr } = await runCli([
        "triage",
        "--cwd",
        dir,
        "--patterns",
        "src/**/*.ts",
        "--fail-on",
        "missing-in-registry",
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes("Triage:"));
    });

    it("exits 1 when expired annotations exist and --fail-on expired", async () => {
      const dir = await createFixtureDir(baseDir, "fail-expired", {
        sourceFiles: {
          "src/sample.ts":
            '// eslint-disable-next-line no-console -- shiori: TRG-EXP\nconsole.log("test");\n',
        },
        registryEntries: {
          "TRG-EXP": {
            reason: "test annotation",
            target: "all",
            expires: "2020-01-01",
          },
        },
      });
      const { exitCode, stderr } = await runCli([
        "triage",
        "--cwd",
        dir,
        "--patterns",
        "src/**/*.ts",
        "--fail-on",
        "expired",
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes("critical:"));
    });
  });

  describe("exit code 0 when issues exist but not in --fail-on", () => {
    it("exits 0 when missing-in-registry issues exist but --fail-on is not set", async () => {
      const dir = await createFixtureDir(baseDir, "warn-only", {
        sourceFiles: {
          "src/sample.ts":
            '// eslint-disable-next-line no-console -- shiori: TRG-WARN\nconsole.log("test");\n',
        },
        registryEntries: {},
      });
      const { exitCode } = await runCli(["triage", "--cwd", dir, "--patterns", "src/**/*.ts"]);

      assert.equal(exitCode, 0);
    });

    it("exits 0 when issues exist but are only in --warn-on", async () => {
      const dir = await createFixtureDir(baseDir, "warn-on-only", {
        sourceFiles: {
          "src/sample.ts":
            '// eslint-disable-next-line no-console -- shiori: TRG-W\nconsole.log("test");\n',
        },
        registryEntries: {},
      });
      const { exitCode } = await runCli([
        "triage",
        "--cwd",
        dir,
        "--patterns",
        "src/**/*.ts",
        "--warn-on",
        "missing-in-registry",
      ]);

      assert.equal(exitCode, 0);
    });
  });

  describe("argument validation", () => {
    it("rejects invalid --fail-on value with exit code 1", async () => {
      const dir = await createFixtureDir(baseDir, "invalid-failon", {
        sourceFiles: {
          "src/sample.ts":
            '// eslint-disable-next-line no-console -- shiori: TRG-001\nconsole.log("test");\n',
        },
        registryEntries: {
          "TRG-001": { reason: "test annotation", target: "all" },
        },
      });
      const { exitCode, stderr } = await runCli([
        "triage",
        "--cwd",
        dir,
        "--patterns",
        "src/**/*.ts",
        "--fail-on",
        "bogus-type",
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes("Invalid --fail-on"));
    });

    it("rejects invalid --format value with exit code 1", async () => {
      const dir = await createFixtureDir(baseDir, "invalid-format", {
        sourceFiles: {
          "src/sample.ts":
            '// eslint-disable-next-line no-console -- shiori: TRG-001\nconsole.log("test");\n',
        },
        registryEntries: {
          "TRG-001": { reason: "test annotation", target: "all" },
        },
      });
      const { exitCode, stderr } = await runCli([
        "triage",
        "--cwd",
        dir,
        "--patterns",
        "src/**/*.ts",
        "--format",
        "xml",
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes("Invalid --format"));
    });
  });
});
