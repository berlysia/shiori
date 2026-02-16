---
status: Accepted
---

# ADR 005: Draft アノテーション

## Context

shiori でアノテーションを書く際、ref（チケット番号など）が未発行の段階でも注釈を残したい場面がある。現状では ref なしのアノテーションは「malformed」として扱われ、lint directive に `shiori:` を付けていない Path C と区別できなかった。

具体的には `ref: ''` のアノテーションが2種類混在していた:

| 分類      | 発生パス | `shiori:` マーカー | 意図              |
| --------- | -------- | ------------------ | ----------------- |
| Draft     | Path A/B | あり               | 意図的に ref 省略 |
| Malformed | Path C   | なし               | 追跡意図なし      |

## Decision

**`ShioriAnnotation` に `tagged: boolean` フィールドを追加し、`shiori:` マーカーの有無で draft と malformed を区別する。**

### tagged フィールド

```typescript
export interface ShioriAnnotation {
  ref: string;
  // ...
  /** Whether the annotation has an explicit `shiori:` marker in source */
  tagged: boolean;
  location: { file: string; line: number };
}
```

- Path A (lint directive + `shiori:`): `tagged: true`
- Path B (standalone `shiori:`): `tagged: true`
- Path C (lint directive without `shiori:`): `tagged: false`

### Draft の定義

`ref === '' && tagged === true` のアノテーションを draft とする。追加の構文は導入しない。

```ts
// shiori: reason="need to revisit this logic"  ← draft (ref省略 + shiori:あり)
// eslint-disable-next-line no-console           ← malformed (shiori:なし)
```

### verify での扱い

verify コマンドは draft を malformed として報告しない。malformed チェックの条件:

```typescript
// Before: ref === ''
// After:  ref === '' && !record.tagged
```

### 専用コマンド

`shiori draft` コマンドで draft アノテーション一覧を表示:

```bash
shiori draft --scan scan-result.json
```

## Rationale

- ref 省略だけで draft を表現でき、新しい構文の学習コストがない
- `tagged` フィールドは CommentProvider のパス分類を忠実に反映し、意味が明確
- verify で draft を無視することで、CI が不要な警告を出さない
- 専用コマンドで draft を一覧でき、後から ref を割り当てるワークフローを支援

## Consequences

- `ShioriAnnotation` に `tagged` フィールドが追加される（既存の scan 結果 JSON の形式が変わる）
- verify は draft を報告しなくなるため、ref 未設定のアノテーションを見落とさないよう `shiori draft` の利用が推奨される
- init-registry は既に `ref === ''` をスキップしているため変更不要
- ユーザー不在のため、破壊的変更の影響なし
