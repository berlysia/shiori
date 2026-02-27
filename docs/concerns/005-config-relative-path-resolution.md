---
status: Done
discovered_at: 2026-02-27
discovered_by: reviewer
---

# Concern 005: --config 相対パスが --cwd 基準で解決されない

## Summary

`--config` フラグに相対パスを指定した場合、`--cwd` を基準に解決されず `process.cwd()` 基準になる。パス解決・境界ガード統一方針に反しており、`--cwd /other/dir --config ../shared-config` のような組み合わせで意図しないディレクトリを参照する。

## Affected files

- `src/commands/check-cli.ts` — `loadConfigAndRegistry({ configDir: ctx.values.config })` を直接渡し
- `src/commands/verify-cli.ts` — 同上
- `src/commands/scan-cli.ts` — `loadConfig(cwd, ctx.values.config)` を直接渡し
- `src/commands/init-cli.ts` — 同上
- `src/commands/watch-cli.ts` — 同上
- `src/commands/update-cli.ts` — 同上
- `src/commands/candidates-cli.ts` — 同上
- `src/commands/draft-cli.ts` — 同上
- `src/core/config.ts` — `loadConfig()` の `configDir` 引数の解決ロジック

## Recommended approach

1. `loadConfig(cwd, configDir)` 内で `configDir` が相対パスの場合 `resolve(cwd, configDir)` で解決する
2. または各 CLI ラッパーで `ctx.values.config` を `resolve(cwd, ctx.values.config)` に変換してから渡す
3. `tests/path-resolution-cli.test.ts` に `--config` 相対パス解決テストを追加

## Priority

Medium — `--cwd` と `--config` を同時指定するケースは限定的だが、統一方針違反として修正が望ましい。
