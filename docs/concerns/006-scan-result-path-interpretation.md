---
status: Proposed
discovered_at: 2026-02-27
discovered_by: reviewer
---

# Concern 006: paths.scanResult の絶対パス解釈がコマンド間で不一致

## Summary

`config.paths.scanResult` が絶対パスの場合、コマンドによって解釈が異なる:

- `scan-cli.ts`, `init-cli.ts`, `scan-result-loader.ts`: `join(cwd, configPath)` → 絶対パスが cwd に結合され誤ったパスになる
- `check-cli.ts` (--save-scan): `resolve(cwd, configPath)` → 絶対パスはそのまま使われる

`path.join('/work', '/absolute/path')` → `/work//absolute/path` (Posix) のようにプラットフォーム依存の予期しない動作を起こす。`path.resolve('/work', '/absolute/path')` → `/absolute/path` が正しい統一方針。

## Affected files

- `src/core/scan-result-loader.ts` L50: `join(cwd, configPath)` → `resolve(cwd, configPath)` に変更すべき
- `src/commands/scan-cli.ts` L84, L121: `join(cwd, config.paths.scanResult)` → `resolve(cwd, ...)` に変更すべき
- `src/commands/init-cli.ts` L70: `join(cwd, config.paths.scanResult)` → `resolve(cwd, ...)` に変更すべき
- `src/commands/check-cli.ts` L141: 既に `resolve` を使用（正しい）

## Recommended approach

1. 全箇所を `resolve(cwd, configPath)` に統一する
2. 絶対パスが `--cwd` 外を指す場合は `assertWithinCwd` で検出される（書き込みパスの場合）
3. 読み込みパスの場合は境界チェック不要だが、`resolve` での統一は必要

## Priority

Medium — デフォルト値 `.config/shiori/scan-result.json` は相対パスなので通常動作に問題はないが、ユーザーが config で絶対パスを設定した場合に不整合が顕在化する。
