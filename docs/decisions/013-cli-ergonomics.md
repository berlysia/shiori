---
status: Accepted
---

# ADR 013: CLI Ergonomics Improvement

## Context

shiori CLI は現在、ほぼ全コマンドに `-s scan-result.json` を毎回指定する必要があり、`verify`/`show` は `-r registry.json` も必須。パイプ連携も未対応で、反復的なワークフローが煩雑。

典型的な操作:

```bash
# 現状: 毎回パス指定が必要
shiori scan --output scan-result.json
shiori verify -s scan-result.json -r registry.json --fail-on expired
shiori show --ref DEV-001 -s scan-result.json -r registry.json
```

## Decision

### 1. 設定ファイルの移行

`.shiorirc.json` を廃止し、`.config/shiori/config.json` に一本化する。後方互換性は維持しない。

```
<project>/
├── .config/shiori/
│   ├── config.json           # 設定ファイル（tracked）
│   ├── registry.json         # レジストリ（tracked）
│   └── scan-result.json      # スキャン結果（gitignored、ephemeral）
```

### 2. 設定ファイルスキーマの拡張

```typescript
interface ShioriConfig {
  candidates?: Partial<CandidatePatternConfig>;
  refPatterns?: RefPatternConfig[];
  // 新規
  scan?: {
    patterns?: string[]; // デフォルト glob patterns
    ignore?: string[]; // デフォルト ignore patterns
  };
  paths?: {
    scanResult?: string; // scan結果のパス（デフォルト: .config/shiori/scan-result.json）
    registry?: string; // registryのパス
  };
}
```

### 3. 設定ファイル探索

- `--config <dir>` 指定時: `<dir>/config.json`
- `--config` 未指定時: `<cwd>/.config/shiori/config.json`

### 4. scan コマンドの TTY 自動切替

- `--output` 明示時: 指定先に保存（最優先、現行動作）
- `--output` 未指定かつ TTY: `config.paths.scanResult`（デフォルト: `.config/shiori/scan-result.json`）に保存、サマリーを stderr に表示
- `--output` 未指定かつ非 TTY（パイプ/リダイレクト）: stdout に JSON 出力（現行動作維持）
- 保存先ディレクトリが存在しない場合、`mkdir(recursive: true)` で自動作成

### 5. consumer コマンドの scan 結果解決順序

1. `--scan <path>` 明示引数（最優先）
2. `--scan -` → stdin 強制読み取り
3. `--scan` 未指定かつ stdin が非 TTY → stdin 読み取り（パイプ検出）
4. `config.paths.scanResult`（設定ファイルのパス）
5. `.config/shiori/scan-result.json`（ハードコードデフォルト）
6. 全て失敗 → エラー（試行したパスを一覧表示）

### 6. registry 解決順序

1. `--registry <path>` 明示引数（最優先）
2. `config.paths.registry`
3. `.config/shiori/registry.json`（cwd）
4. 全て失敗 → エラー（試行したパスを一覧表示）

ファイル存在チェック（`access()`）で最初に見つかったパスを使用。

### 7. `check` ワンショットコマンド

`scan` → `verify` をインメモリで連続実行するワンショットコマンド:

```bash
shiori check                              # scan → verify をワンショット実行
shiori check --fail-on expired            # オプション指定も可能
shiori check --save-scan                  # scan結果もファイル保存
```

config を読み込み、`scan()` → `verify()` の pure 関数を直接呼び出す。中間ファイル不要。

## Alternatives Considered

### A: `.shiorirc.json` との後方互換維持（fallback 探索）

- 利点: 既存ユーザーに影響なし
- 欠点: 2 つの設定ファイル形式が共存し混乱。early stage なので移行コスト低い
- 却下理由: ユーザーの判断により後方互換性を切り捨て

### B: XDG Base Directory Specification 準拠（`~/.config/shiori/`）

- 利点: 標準に準拠
- 欠点: shiori はプロジェクトローカルツールであり、グローバル設定は不適切
- 却下理由: プロジェクトルートに `.config/shiori/` を置く方がワークフローに合致

### C: stdin 対応なし（ファイルパスのデフォルトのみ）

- 利点: 実装がシンプル
- 欠点: パイプ連携という Unix 的ワークフローを失う
- 却下理由: `scan | verify` はコマンドライン完成度として重要

## Rationale

- **早期段階での設定形式統一**: 0.0.1 で外部ユーザー未到達。今なら後方互換コスト0
- **規約ベースの省略**: ファイルパスの規約化で典型操作を引数0で実行可能にする
- **TTY 検出による適応**: ターミナル直接実行とパイプ/スクリプト実行で最適な動作を自動選択
- **段階的な便利さ**: デフォルトパス < パイプ < ワンショットの3段階で、ユーザーのワークフローに合わせた選択肢を提供

## Consequences

### 廃止されるもの

- `.shiorirc.json` ファイル形式
- `loadConfig(cwd)` の `.shiorirc.json` 探索
- `--scan`, `--registry` の `required: true`

### 追加されるもの

- `.config/shiori/config.json` 設定ファイル形式
- `ShioriConfig.scan`, `ShioriConfig.paths` フィールド
- `loadScanResult()` 関数（stdin + ファイル解決）
- `resolveRegistryPath()` 関数
- `check` コマンド
- `.gitignore` に `.config/shiori/scan-result.json` 追加

### Migration

- `.shiorirc.json` → `.config/shiori/config.json` に移動（フィールド構造は互換）
- CI スクリプトの `--scan`, `--registry` 明示指定は引き続き動作（変更不要）
- `--config` の挙動変更: ディレクトリ指定→ディレクトリ指定のまま（ファイル名が変わるのみ）
