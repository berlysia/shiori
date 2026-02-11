# ADR 004: kind フィールドをレジストリ専用に移行

## Status

Accepted

## Context

ADR 003 で導入した `shiori: key=value` 構文では、`kind` フィールド（waive, design, compat, risk, migrate 等）をソースコメントとレジストリ JSON の両方に記述できた。しかし運用上、以下の問題が明らかになった:

1. **冗長性**: 同一 ref に対して kind は一意に決まる。ソースとレジストリの両方に持つ必要がない
2. **不整合リスク**: ソースコメントとレジストリで異なる kind を指定した場合のマージ戦略が不明確（`inferKindFromAnnotations` で `'mixed'` を返すなど、アドホックな対応が必要だった）
3. **ソースコメントの肥大化**: `ref` と `expires` だけで十分な場合が大半。`kind` は分類メタデータであり、ソースに埋め込む必要性が低い

## Decision

**`kind` フィールドをソースコメント（`ShioriAnnotation`）から削除し、レジストリ（`RegistryEntry`）での一元管理に移行する。**

### ソースコメント構文

`kind` は記述しない:

```ts
// eslint-disable-next-line no-console -- shiori: ref=SUP-1234 expires=2026-06
// shiori: ref=ADR:0007
```

> パーサの汎用 key=value 解析により、ソースに `kind=waive` が残っていても構文エラーにはならない（後方互換）。ただし `ShioriAnnotation` には含まれず、無視される。

### レジストリでの管理

```json
{
  "SUP-1234": {
    "reason": "...",
    "kind": "waive",
    ...
  }
}
```

CLI やエディタ拡張で ref からレジストリを引けば、分類情報は十分把握できる。

### 内部モデル変更

```
ShioriAnnotation
  kind?: string    → （削除）

RegistryEntry
  kind: string | undefined  → （保持）
```

### ソート順変更

scan 結果のソート順が `ref → kind → file → line` から `ref → file → line` に変更される。

## Rationale

- ソースコメントは「何を追跡するか（ref）」と「いつまでか（expires）」に集中すべき
- 分類（kind）は組織的な管理情報であり、レジストリの責務
- `init-registry` の `inferKindFromAnnotations` のような推定ロジックが不要になり、コードが簡素化される
- ユーザー不在のため、破壊的変更の影響なし

## Consequences

- ソースコメントがシンプルになる（`ref` + `expires` + `reason` のみ）
- `kind` の分類はレジストリで一元管理され、不整合が発生しない
- 既存ソースコメントの `kind=` 記述は構文エラーにならず、段階的に除去できる
- scan 結果の出力順が変わる（kind によるソートがなくなる）
