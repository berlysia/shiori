---
status: Accepted
deps: []
---

# ADR 028: コマンド出力スキーマバージョニング

## Context

shiori CLI は 7 つの JSON 出力パスを持つが、出力構造に一貫性がなく、機械消費（CI パイプライン、外部ツール連携）における互換性管理が困難である。

### 現状

| Formatter          | Command                              | Envelope?             | CLI version? | Schema version?   |
| ------------------ | ------------------------------------ | --------------------- | ------------ | ----------------- |
| fix-formatter      | `fix --format json` (plan)           | No                    | No           | No                |
| fix-formatter      | `fix --apply --format json` (result) | No                    | No           | No                |
| resolve-formatter  | `resolve --closed --format json`     | Yes (`meta` + `data`) | Yes          | No                |
| report-formatter   | `report --format json`               | No                    | No           | No                |
| summary            | `summary --format json`              | No                    | No           | No                |
| sarif              | `verify --format sarif`              | Yes (SARIF spec)      | Yes          | Yes (SARIF 2.1.0) |
| annotate-formatter | `annotate --format json`             | No                    | No           | No                |

問題点:

1. **構造の不一致**: `resolve --closed --format json` のみが `meta` + `data` envelope を使用し、他は raw データオブジェクトを直接出力
2. **スキーマバージョンの不在**: 出力構造が変更された場合に消費者が互換性を判定する手段がない
3. **CLI バージョンとスキーマバージョンの区別なし**: resolve-formatter の `meta.version` は CLI バージョンだが、消費者にとって重要なのは出力スキーマの互換性

## Decision

### 1. `meta` + `data` envelope パターンの標準化

機械消費向け JSON 出力に共通の envelope 構造を適用する:

```typescript
interface CommandOutput<T> {
  meta: OutputMeta;
  data: T;
}

interface OutputMeta {
  /** CLI version (for debugging, not for compatibility checks) */
  version: string;
  /** Schema version (integer, starts at 1). Consumers use this for compatibility. */
  schemaVersion: number;
  /** Command that produced this output */
  command: string;
  /** ISO 8601 timestamp (optional, for audit trails) */
  timestamp?: string;
}
```

`meta` の最小必須フィールドは `version`、`schemaVersion`、`command` の 3 つ。`timestamp` は optional（audit が必要なコマンドのみ）。

### 2. スキーマバージョンの意味

`schemaVersion` は整数値（1, 2, 3, ...）で、出力構造の互換性レベルを表す。CLI バージョンとは独立に管理される。

- 同一 `schemaVersion` 内では出力構造の後方互換性を保証する
- `schemaVersion` の初期値は `1`

### 3. Breaking / Non-Breaking Change の定義

**Breaking Change（schemaVersion bump 必須）**:

- 既存フィールドの削除
- 既存フィールドの型変更（例: `number` → `string`）
- 必須フィールドの追加（消費者が想定しないフィールドが必須になる）
- フィールドの意味変更（例: `count` が「全件数」→「エラー数」に変わる）

**Non-Breaking Change（bump 不要）**:

- Optional フィールドの追加（TypeScript の `?` 修飾子に対応）
- フィールドの順序変更（JSON は順序非依存）
- `meta` envelope 内の optional フィールド追加

### 4. 消費者の互換性チェック推奨パターン

消費者は `meta.schemaVersion` のみで互換性を判定する。`meta.version`（CLI バージョン）はデバッグ用であり、互換性判定に使用しない。

```typescript
// 推奨: 消費者の互換性チェック
const SUPPORTED_SCHEMA_VERSION = 1;

function parseFixOutput(raw: unknown): FixOutputV1 {
  const output = JSON.parse(raw as string);
  if (output.meta?.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version ${output.meta.schemaVersion}. ` +
        `This tool supports schema version ${SUPPORTED_SCHEMA_VERSION}. ` +
        `Update this tool or pin the shiori CLI version.`,
    );
  }
  return output.data;
}
```

### 5. Scope

本 ADR は CLI コマンドの JSON 出力（`--format json`）のみを対象とする。

**対象外**:

- Registry / Config ファイルのスキーマバリデーション（ADR-011 の責務）
- SARIF 出力（OASIS 標準スキーマに準拠、独自バージョニング不要）

### 6. 段階的適用計画

優先度基準: CI 自動化での機械消費頻度。

| Phase   | Commands                                              | 根拠                                                                                                    |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Phase 1 | `fix --format json`, `resolve --closed --format json` | fix は EP-0124 で CI パイプライン連携が確立済み。resolve は既に envelope あり、`schemaVersion` 追加のみ |
| Phase 2 | `verify --format json`, `report --format json`        | CI ダッシュボード連携で機械消費される                                                                   |
| Phase 3 | `summary --format json`, `annotate --format json`     | 人間向け使用が主、機械消費は低頻度                                                                      |

各 Phase で:

1. 対象コマンドの既存 JSON 出力を `meta` + `data` envelope で wrap
2. `meta.schemaVersion` を `1` で初期化
3. 既存の raw 出力は `data` フィールド内に配置（構造の変更なし）
4. テスト追加（envelope 構造、schemaVersion の存在確認）

## Consequences

### Positive

- 機械消費者が出力構造の互換性を事前に判定可能
- Breaking change 発生時にバージョン番号で明示的に通知
- `resolve --format json` で確立された envelope パターンの全コマンド統一

### Negative

- 全コマンドへの段階適用にコストがかかる（6 コマンド × envelope wrap + テスト）
- 既存の raw JSON 出力を消費するツールが `data` フィールドへのアクセスに移行する必要あり（breaking change）
- `meta` envelope による出力サイズの微増（数十バイト程度、実質的影響なし）

### Neutral

- Phase 1 の `fix` は EP-0124 で CI 連携が確立されたばかりのため、早期に envelope 化することで消費者の移行コストを最小化できる
