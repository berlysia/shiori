# ADR 019: Node.js バージョン要件の見直し

## Status

Accepted

## Context

現在の `engines` フィールドは `"node": ">=22.6.0"` を要求している。Node 22.6.0 は `--experimental-strip-types` が導入されたバージョンであり、テストの実行に必要:

```json
"test": "node --experimental-strip-types --test tests/**/*.test.ts"
```

しかし、ビルド済みの CLI（`dist/src/cli.js`）は純粋な JavaScript であり、ES2022 をターゲットとしている。理論上、ES2022 をサポートする Node.js バージョンであれば動作する。

### Node.js LTS スケジュール（2026年2月時点）

| バージョン | LTS 開始 | EOL     | ステータス                 |
| ---------- | -------- | ------- | -------------------------- |
| Node 18    | 2022-10  | 2025-04 | EOL                        |
| Node 20    | 2023-10  | 2026-04 | Active LTS（EOL まもなく） |
| Node 22    | 2024-10  | 2027-04 | Active LTS                 |
| Node 24    | 2025-10  | 2028-04 | Current                    |

Node 20 は2026年4月にEOL予定だが、まだ多くのプロジェクトで使用されている。`>=22.6.0` の要件は Node 20 ユーザーを完全に排除する。

### 実際のランタイム依存

ビルド済み JS が使用する Node.js API:

- `node:fs/promises`（Node 14+）
- `node:path`（全バージョン）
- `node:process`（全バージョン）
- `node:test`（テストのみ、Node 18+）
- ES2022 構文: top-level await, `Array.at()`, `Object.hasOwn()`

ES2022 の完全サポートは Node 18+ で利用可能。

## Decision

### ランタイム要件とテスト要件を分離する

#### ランタイム（npm パッケージ利用者）

```json
"engines": {
  "node": ">=18.0.0"
}
```

- ビルド済み JS の実行に必要な最小バージョン
- Node 18 は EOL 済みだが、Node 20 を使用するプロジェクトを排除しないことが目的
- ES2022 サポートが基準

#### テスト実行（開発者）

```json
// package.json の scripts
"test": "node --experimental-strip-types --test tests/**/*.test.ts"
```

- テスト実行には引き続き Node 22.6.0+ が必要（`--experimental-strip-types`）
- `CONTRIBUTING.md` またはREADMEの Development セクションに明記
- CI では Node 22 を使用

#### TypeScript コンパイル

- `tsconfig.json` の `target: "ES2022"` は変更しない
- ビルド出力が Node 18+ で動作することを保証

### CI マトリクス

```yaml
strategy:
  matrix:
    node-version: [18, 20, 22]
jobs:
  # Node 18/20: ビルド + 実行テストのみ
  # Node 22: フルテストスイート
```

Node 18/20 では `pnpm build && node dist/src/cli.js --help` 等の基本動作テストを実行し、ユニットテストは Node 22 でのみ実行する。

## Alternatives Considered

### A. Node 20+ に設定

- 利点: Active LTS のみをサポート。EOL ランタイムを排除
- 欠点: Node 20 は2026年4月にEOLのため、すぐに Node 22+ に上げる必要が出る
- 判断: 中途半端。Node 18 まで下げるか、22 のまま維持するかの二択が明確

### B. 現状維持（>=22.6.0）

- 利点: テスト実行とランタイムが同一要件。説明がシンプル
- 欠点: Node 20 LTS ユーザーが使えない。v0.0.1 の時点で採用障壁を上げるのは不利
- 判断: 技術的な制約ではなく開発便宜による要件を利用者に押し付けるべきではない

### C. テストを tsc + node でコンパイルして実行

テストファイルも TypeScript コンパイル後に実行する構成にすれば、`--experimental-strip-types` が不要になり、テスト実行要件も下げられる。

- 利点: テスト・ランタイム両方の要件を統一できる
- 欠点: テスト実行のためにビルドステップが必要になり、開発体験が低下
- 判断: 開発体験を優先し、テストは引き続き `--experimental-strip-types` で実行。ランタイム要件のみ下げる

### D. Node 16+ に設定

- 利点: 最大限の互換性
- 欠点: ES2022 の一部機能（`Array.at()` 等）が不完全。古い Node のバグに対処が必要
- 判断: 過剰な後方互換。Node 18 が実用的な下限

## Consequences

### 変更されるもの

- `package.json` の `engines.node`: `">=22.6.0"` → `">=18.0.0"`
- README の Requirements セクション: ランタイム要件と開発要件を分離して記載

### 追加されるもの

- CI マトリクスに Node 18/20 でのスモークテスト
- README に開発者向け Node 22+ 要件の記載

### リスク

- **テストされていない環境でのバグ**: Node 18/20 固有の挙動差異。CI マトリクスで緩和
- **依存パッケージの互換性**: `fast-glob`, `gunshi`, `yaml` が Node 18 をサポートしているか確認が必要（現時点では全てサポート済み）

### 他 ADR への影響

- なし（ランタイム要件の変更は他の設計判断に影響しない）
