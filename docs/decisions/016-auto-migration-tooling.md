---
status: Proposed
deps:
  - 6
  - 14
  - 15
---

# ADR 016: 既存コードベースへの自動マイグレーション

## Context

shiori の最大の採用障壁は初期導入コストにある。

競合ツールとの比較:

| ツール                   | 導入時のソースコード変更               | 初期コスト |
| ------------------------ | -------------------------------------- | ---------- |
| ESLint Bulk Suppressions | 不要（`--suppress-all` で自動生成）    | ゼロ       |
| eslint-seatbelt          | 不要（TSV にカウントを記録）           | ゼロ       |
| DebtBomb                 | 必要（`@debtbomb()` コメントを手書き） | 高い       |
| **shiori**               | 必要（`shiori:` コメントを手書き）     | 高い       |

shiori は `shiori:` コメントをソースコードに記述する必要があるが、既存コードベースに数百の lint disable comment がある場合、手作業での導入は非現実的。現在の `candidates` コマンドは未追跡の disable comment を検出できるが、`shiori:` コメントの自動挿入は行わない。

## Decision

### `shiori migrate` コマンドの追加

既存の lint disable comment に `shiori:` アノテーションを自動付与するマイグレーションコマンドを提供する。

#### 基本動作

```bash
# プレビュー（デフォルト: 書き換えない）
shiori migrate

# 実行（ソースファイルを書き換え + registry を更新）
shiori migrate --write
```

#### 処理フロー

1. `candidates` のロジックを使って未追跡の lint disable comment を検出
2. 各候補に対して自動 ref を生成（連番: `MIG-001`, `MIG-002`, ...）
3. ソースファイル上の disable comment に ` -- shiori: MIG-001` を挿入
4. registry に対応するエントリを追加（`reason: "auto-migrated"`, `kind: "migration"`）

#### ref 生成戦略

```typescript
// デフォルト: 連番プレフィックス
shiori migrate                    // → MIG-001, MIG-002, ...
shiori migrate --prefix DEBT      // → DEBT-001, DEBT-002, ...
shiori migrate --prefix JIRA:PROJ // → JIRA:PROJ-001, JIRA:PROJ-002, ...
```

- `--prefix` でプレフィックスをカスタマイズ可能
- 既存 registry の ref と衝突しない番号から開始
- 同一ルールで複数箇所ある場合もそれぞれ個別の ref を付与（ルールではなくアノテーション単位の追跡がshioriの設計思想）

#### 挿入フォーマット

```typescript
// Before:
// eslint-disable-next-line no-console

// After:
// eslint-disable-next-line no-console -- shiori: MIG-001

// Before (separator あり):
// eslint-disable-next-line no-console -- existing reason

// After (shiori: を追記):
// eslint-disable-next-line no-console -- existing reason shiori: MIG-001
```

#### 安全装置

- **デフォルトは dry-run**: `--write` なしでは変更をプレビューのみ表示
- **バックアップ不要**: git のワーキングツリーで実行する前提。`--write` 実行前に `git status` が clean でない場合は警告を出す
- **既存 shiori: アノテーションはスキップ**: 既に `shiori:` が付いている disable comment は変更しない
- **行長制限の考慮**: コメント追記後の行長が極端に長くなる場合は警告を出す（ただし自動改行はしない）

### 段階的な導入シナリオ

```bash
# Step 1: 現状を把握
shiori candidates

# Step 2: 自動マイグレーションをプレビュー
shiori migrate

# Step 3: 実行
shiori migrate --write

# Step 4: 自動生成された ref を確認、必要に応じて意味のある ref に書き換え
#         (例: MIG-042 → PERF-001)
shiori check

# Step 5: 以降は通常の shiori ワークフロー
```

## Alternatives Considered

### A. codemod ツールとしての提供（jscodeshift 等）

- 利点: AST ベースで正確な書き換え
- 欠点: 言語ごとの codemod が必要。shiori の言語非依存方針（ADR 001）に反する
- 判断: 行ベースのテキスト書き換えで十分。disable comment の構造は行単位

### B. 外部スクリプトとして提供（shiori 本体に含めない）

- 利点: 本体を軽量に保てる
- 欠点: ユーザーがスクリプトを見つけにくい。registry 更新ロジックとの整合性を保つのが困難
- 判断: `candidates` のロジックと `update` のロジックを組み合わせるため、本体に含めるのが自然

### C. ref 自動生成をせず、ファイル名+行番号を ref にする

- 利点: 外部システムとの連携不要
- 欠点: リファクタリングで行番号が変わると ref が無効化。ファイル名変更も同様
- 判断: 連番 ref の方が安定。マイグレーション後にユーザーが意味のある ref に書き換える運用を想定

## Consequences

### 追加されるもの

- `migrate` コマンド（`src/commands/migrate.ts`, `src/commands/migrate-cli.ts`）
- ソースファイル書き換えロジック（`insertShioriAnnotation()`）

### 変更されるもの

- CLI ルーター（`src/cli.ts`）に `migrate` サブコマンドを追加
- README に migrate ワークフローを追加

### 他 ADR への影響

- **ADR 006**: candidates ロジックを migrate が再利用
- **ADR 014**: migrate は init の延長として位置づけ（初回導入時に使用）
- **ADR 015**: ref バリデーション（B）は migrate が生成する ref にも適用される
