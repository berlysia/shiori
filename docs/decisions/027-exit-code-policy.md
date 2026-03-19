---
status: Accepted
deps: []
---

# ADR 027: CLI Exit Code Policy Matrix

## Context

shiori CLI は 23+ コマンドを持ち、各コマンドが独立に `process.exitCode = 1` を設定している。exit code の意味は暗黙的でドキュメント化されておらず、CI 統合時にどのコマンドがどの条件で非ゼロ終了するかの全体像が把握しにくい。

EP-0115 はこの問題を解決するため、exit code の体系的な定義と自己検証メカニズムを求めている。

### 現状

- 全コマンドが `process.exitCode = 1` のみを使用（`process.exit()` は不使用）
- exit code は `0`（成功）と `1`（失敗）の 2 値のみ
- `candidates` と `update` コマンドは exit code 未設定
- 各コマンドの失敗条件は暗黙的（コード内にインラインで記述）
- exit code の意味がドキュメント化されていない

## Decision

### Exit Code 定数

`core/exit-codes.ts` に名前付き定数を定義する:

```typescript
export const ExitCode = {
  SUCCESS: 0,
  GOVERNANCE_VIOLATION: 1,
  USAGE_ERROR: 2,
  ENVIRONMENT_ERROR: 3,
} as const;
```

| Code | Name | Meaning |
|------|------|---------|
| 0 | SUCCESS | 正常終了 |
| 1 | GOVERNANCE_VIOLATION | ガバナンス問題の検出（verify errors, health threshold, doctor failures） |
| 2 | USAGE_ERROR | CLI 引数の誤り（無効なフォーマット、不正なオプション） |
| 3 | ENVIRONMENT_ERROR | 環境の問題（ファイル未発見、パス境界違反） |

### Phase 1: 定数定義とポリシーメタデータ（本 ADR のスコープ）

1. `core/exit-codes.ts` に `ExitCode` 定数と `ExitCodePolicy` 型を定義
2. 各コマンドの exit code ポリシーをメタデータとして宣言
3. `doctor` コマンドに exit code ポリシー検証チェックを追加

Phase 1 では定数の定義とポリシー宣言のみを行い、既存の `process.exitCode = 1` を段階的に定数に置き換える作業は Phase 2 とする。

### Phase 2: 段階的適用

Phase 2 は2段階で進める:

**Phase 2a: governance trigger の定数化（値の変更なし）**

governance カテゴリのコマンドにおいて、ガバナンス違反検出時の `process.exitCode = 1` を `process.exitCode = ExitCode.GOVERNANCE_VIOLATION`（値は同じ `1`）に置き換える。passthrough カテゴリのコマンドから誤って設定されていた `process.exitCode = 1` を除去する。この段階では exit code の実際の値は変わらないため、破壊的変更は発生しない。

対象:
- governance コマンド（verify, check, triage, health, report, doctor, delta, summary）の governance trigger → `ExitCode.GOVERNANCE_VIOLATION`
- passthrough コマンド（watch, journal, guide）の不正な `process.exitCode = 1` → 除去

**Phase 2b: usage/environment の exit code 分離（破壊的変更）**

usage カテゴリのコマンドの `process.exitCode = 1` を `ExitCode.USAGE_ERROR`（値 `2`）に、環境エラーを `ExitCode.ENVIRONMENT_ERROR`（値 `3`）に置き換える。これは exit code の値が変わる破壊的変更のため、メジャーバージョンアップまたは明示的なオプトインメカニズムが必要。共有ユーティリティ（`cli-validation.ts`, `cli-output.ts`, `cli-context.ts`）内の `process.exitCode = 1` も呼び出し元のカテゴリに応じた定数に置き換える。

### コマンド別ポリシー

| Command | Exit 1 Trigger | Category |
|---------|---------------|----------|
| verify | `summary.errors > 0` | governance |
| check | `summary.errors > 0` | governance |
| triage | `summary.errors > 0` | governance |
| health | `summary.errors > 0` OR health level threshold | governance |
| report | `summary.errors > 0` | governance |
| doctor | `summary.fail > 0` | governance |
| scan | validation failures | usage |
| init | validation failures | usage |
| update | (none — always 0) | passthrough |
| candidates | (none — always 0) | passthrough |
| resolve | validation failures, missing provider | usage |
| adopt | file write failures, no candidates | usage |
| show | ref not found | usage |
| why | ref not found | usage |
| jump | ref not found | usage |
| annotate | validation failures | usage |
| draft | validation failures | usage |
| migrate | validation failures | usage |
| watch | (none — long-running) | passthrough |
| delta | `summary.errors > 0` | governance |
| weekly-report | output failures | usage |
| journal | (none — query only) | passthrough |
| docs | (none — display only) | passthrough |
| summary | `summary.errors > 0` OR health level threshold | governance |
| aggregate | validation failures, missing input files | usage |
| guide | (none — interactive navigator) | passthrough |

## Consequences

### Positive

- CI 統合者が各コマンドの exit code 動作を事前に把握可能
- `doctor --check-exit-policies` による自己検証で exit code 設定漏れを検出
- 段階的な exit code 細分化（code 2, 3）への移行パスが明確

### Negative

- 既存の `process.exitCode = 1` を変更する際に破壊的変更のリスク（Phase 2b で対応）
- メタデータの維持コスト（新コマンド追加時にポリシー定義が必要）

### Neutral

- Phase 1 は定数定義のみのため、既存動作への影響なし
