# ADR 003: shiori Intent Layer への移行

## Status

Accepted

## Context

ADR 002 で `<verb>(<id>)` 形式の軽量マーカー構文を確立した。これにより lint 抑制以外のユースケース（note, risk, migrate）にも対応できるようになったが、以下の限界が見えてきた:

1. **メタデータの制約**: 現構文では `verb` と `id` しか表現できず、`expires` は正規表現による補助パースに頼っている
2. **名前空間の欠如**: ID がフラットで、参照先（JIRA, ADR, ドキュメント等）の種別を構造的に区別できない
3. **ESLint directive との統合**: `eslint-disable-next-line rule -- verb(ID)` の description 領域を使っているが、shiori アノテーションとしての明示的な境界がない
4. **横断的な分析の困難**: kind 別集計、参照解決、期限監査などの横断機能を実装するには、より構造化されたモデルが必要

## Decision

**`<verb>(<id>)` 構文を廃止し、`shiori:` プレフィックスを持つ key=value 構文へ置き換える。**

> ユーザーがまだ存在しないため、後方互換は不要。旧構文は完全に削除し、新構文のみをサポートする。

### 新構文

```
shiori: ref=<id> [kind=<taxonomy>] [expires=<date>] [reason=<text>]
```

ESLint directive 内では `--` セパレータの後に配置:

```ts
// eslint-disable-next-line no-explicit-any -- shiori: ref=JIRA:PROJ-123 kind=compat expires=2026-03
```

スタンドアロン（lint directive 外）:

```ts
// shiori: ref=ADR:0007 kind=design
```

`shiori:` プレフィックスを持つすべてのコメントを検出対象とする。

### フィールド必須性

| フィールド | 必須性 | 備考 |
|-----------|--------|------|
| `ref` | **必須** | なければ malformed 扱い |
| `kind` | 任意 | 省略時は分類なし |
| `expires` | 任意 | YYYY-MM-DD or YYYY-MM |
| `reason` | 任意 | 自由記述 |

### namespace

`ref` の値に `namespace:id` 形式（例: `JIRA:PROJ-123`, `ADR:0007`）を使用できる。

- パーサは `ref` の値を文字列としてそのまま保持する（namespace の分割・バリデーションはしない）
- 将来的に namespace 側に形式要求がある場合、それを適用可能にする設計余地を残す
- namespace 解決（URL 変換等）は横断機能フェーズで対応

### 新内部モデル

```ts
type ShioriAnnotation = {
  tag?: string          // TODO, FIXME 等（将来拡張）
  kind?: string         // compat, waive, debt, risk, design...
  ref: string           // JIRA:PROJ-123, ADR:0007（必須）
  reason?: string       // 自由記述
  expires?: string      // YYYY-MM-DD or YYYY-MM
  rule?: string         // ESLint/stylelint ルール名（directive から自動取得）
  location: {
    file: string
    line: number
  }
}
```

## Rationale

### key=value 構文を選択した理由

1. **拡張性**: 新しいキーを追加するだけでメタデータを拡張できる（構文変更不要）
2. **明示性**: `shiori:` プレフィックスにより、他のコメントとの境界が明確
3. **パース容易性**: 行ベーステキスト走査（ADR 001 の設計原則）と親和性が高い
4. **名前空間対応**: `ref=JIRA:PROJ-123` のように namespace:id 形式で参照先を構造化

### `<verb>` → `kind` への正規化

- `verb` はアクション（動詞）を暗示するが、実際には分類（taxonomy）として使われている
- `kind` の方が「このアノテーションの種別は何か」を素直に表現する
- 既存の verb（waive, note, risk, migrate）はそのまま kind の値として使える

### 検出スコープ: `shiori:` プレフィックスへの全反応

CommentProvider を拡張し、`shiori:` プレフィックスを持つすべてのコメントを検出する:

- `// shiori: ref=...` — スタンドアロン
- `/* shiori: ref=... */` — ブロックコメント内
- `-- shiori: ref=...` — lint directive の description 領域内

lint directive 内で検出した場合は、directive のルール名を `rule` フィールドに自動紐付けする。

### 却下した代替案

- **JSON 形式のコメント**: `// shiori: {"ref": "..."}` — 冗長で可読性が低い
- **YAML 形式**: 複数行が必要になりがちで、行ベース走査と相性が悪い
- **専用タグ形式**: `@shiori(...)` — JSDoc 系との混同リスク、既存 directive との統合が困難
- **後方互換レイヤ**: ユーザー不在のため不要。旧構文を維持する複雑さを回避。

## Key Changes

### 構文変更（破壊的）

| 要素 | 旧（ADR 002） | 新（本 ADR） |
|------|---------------|-------------|
| 基本形 | `verb(ID)` | `shiori: ref=ID kind=verb` |
| ESLint 内 | `-- verb(ID)` | `-- shiori: ref=ID kind=verb` |
| expires | `expires=2026-01-01`（正規表現で補助パース） | `expires=2026-01-01`（key=value 統一） |
| 名前空間 | なし | `ref=JIRA:PROJ-123` |
| スタンドアロン | なし | `// shiori: ref=ADR:0007 kind=design` |

### 内部モデル変更

```
AnnotationRecord        → ShioriAnnotation
  verb: string          → kind?: string
  id: string            → ref: string（必須）
  tool?: string         → （削除。rule に統合）
  subject?: string      → rule?: string
  meta: Record          → 個別フィールドに展開 (reason, expires)
  source, raw, provider → （削除。簡素化）
```

## Migration Strategy

### Phase 1: 内部モデル置き換え

`AnnotationRecord` を `ShioriAnnotation` に完全置き換え。旧モデルは削除。関連する型定義・インターフェースをすべて更新。

### Phase 2: 新構文パーサ

CommentProvider を書き換え:
- `shiori:` プレフィックスの key=value 構文を解析
- lint directive 内（`-- shiori:`）とスタンドアロン（`// shiori:`）の両方を検出
- directive のルール名を `rule` に自動紐付け
- 旧構文（`<verb>(<id>)`）のパーサは完全削除

### Phase 3: コマンド・テスト更新

- scan, verify, init-registry コマンドを新モデルに対応
- テストフィクスチャを新構文に全面書き換え
- CLI オプション調整（`--verbs` → 必要に応じて `--kind` 等）

### Phase 4: 横断機能（将来）

- kind 別・rule 別・file 別の集計
- 名前空間解決器（`JIRA:*` → URL, `ADR:*` → ファイルパス）
- 期限監査（expired → warning/error）

## Consequences

- 破壊的変更だが、ユーザー不在のため影響なし
- 新構文の導入により表現力が大幅に向上する
- 内部モデルの簡素化（source, raw, provider 等の削除）により保守性が向上
- `shiori:` プレフィックスによる全コメント検出で、lint directive 外の設計意図もキャプチャ可能に
- Provider インターフェースの変更が必要（`AnnotationRecord[]` → `ShioriAnnotation[]`）
