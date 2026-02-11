# ADR 002: Annotation Model Generalization

## Status

Accepted

## Context

初期実装（ADR 001）では lint 抑制（waiver）専用のデータモデル `SuppressionRecord` を使用していた。しかし、lint 抑制以外にも「コード内の判断・例外・注記」を構造化コメントとして管理したいユースケースが見えてきた。例えば:

- 移行中のコードへのマーカー（`migrate`）
- リスク受容の記録（`risk`）
- 設計判断の注記（`note`）

これらはすべて「ソースコード内の構造化注釈を回収し、台帳で管理する」という同じパターンに従う。

## Decision

**lint 抑制専用モデルから構造化注釈の汎用モデルへ一般化する。**

具体的には:
- `SuppressionRecord` → `AnnotationRecord` に改名・拡張
- 注釈の種類を表す `verb` フィールドを導入（`waive`, `note`, `risk`, `migrate` 等）
- `linter` / `rule` → `tool` / `subject` に汎化（lint 以外でも意味が通るように）

## Rationale

### 一般化の動機

1. **共通パターンの認識**: ID 付き構造化コメントの回収・台帳突合・期限管理は、lint 抑制に限らない汎用的なパターン
2. **低コストな変更**: 挙動の変更は最小限で、主に型と命名の一般化が中心
3. **拡張性**: 新しい verb を追加するだけで新しいユースケースに対応できる

### 却下した代替案

- **別ツールとして実装**: verb ごとに別ツールを作る案。共通基盤の重複が大きく、統一的な台帳管理・レポートが困難になるため却下。
- **lint 抑制モデルのまま拡張**: `SuppressionRecord` に無理にフィールドを追加する案。命名と概念の不一致が拡大するため却下。

## Key Changes

### Data Model

```
SuppressionRecord → AnnotationRecord
  - id: string
  - verb: string ("waive" | "note" | "risk" | "migrate" | ...)
  - subject?: string (旧 rule: 対象ルール名や対象機能)
  - tool?: string (旧 linter: stylelint/eslint/unknown)
  - file, line, source, raw, meta, provider: 従来通り
```

### Source Code Markers

`waive(<ID>)` を維持しつつ、`<verb>(<ID>)` を基本構文として一般化:
- `waive(SUP-1234)` — lint 抑制
- `note(NOTE-1)` — 注記
- `risk(RISK-1)` — リスク受容
- `migrate(MIG-1)` — 移行マーカー

### Ledger

台帳も注釈一般に対応。エントリに `verb` フィールドを追加可能（省略時はソースから推定）。

## Compatibility

- CLI コマンド名（`scan`, `verify`, `init-ledger`）と基本動作は維持
- `--verbs` オプションで対象 verb を絞り込み可能（デフォルト: `waive,note,risk,migrate`）
- 内部モデルのみ一般化し、既存の lint 抑制ワークフローは変更なく動作する

## Consequences

- 既存のテスト・フィクスチャを新モデルに合わせて更新する必要がある
- Provider インターフェースが `AnnotationProvider` に統一される
- 将来の verb 追加はコード変更なし（CLI オプションで指定可能）
