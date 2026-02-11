# ADR 008: Namespace Resolution

## Status

Proposed

## Context

ADR 003 で `ref` の値に `namespace:id` 形式（例: `JIRA:PROJ-123`, `ADR:0007`）を使用できることを定義し、パーサは ref を文字列としてそのまま保持する方針とした。namespace 解決（URL 変換等）は「横断機能フェーズで対応」と明記されており、正式な解析・外部システムへの解決機構はまだ存在しない。

エディタ拡張で `shiori:<ID>` からオーバーレイ・インレイ表示を実現するための基盤として、ref 文字列の namespace 解析と URL 解決の仕組みが必要になった。

## Decision

### `parseRef()` 関数

`src/core/namespace.ts` に `parseRef(ref: string)` を追加する。

**解析ルール**:

1. コロン（`:`）の有無で分割する。**コロン必須**で namespace 判定
2. コロン前が `[A-Z][A-Z0-9]*` に一致 → namespace として抽出
3. コロンなし or パターン不一致 → `namespace: undefined`

```ts
type ParsedRef = {
  namespace: string | undefined;
  id: string;
  raw: string;
};
```

**解析例**:

| Input           | namespace | id         |
| --------------- | --------- | ---------- |
| `JIRA:PROJ-123` | `JIRA`    | `PROJ-123` |
| `ADR:0007`      | `ADR`     | `0007`     |
| `SUP-1234`      | undefined | `SUP-1234` |
| `abc:def`       | undefined | `abc:def`  |
| `A:B`           | `A`       | `B`        |
| (empty)         | undefined | (empty)    |

`abc:def` は小文字始まりのためパターン不一致。ref 全体がそのまま `id` になる。

### `.shiorirc.json` への `namespaces` セクション追加

既存の `ShioriConfig` 型を拡張し、namespace ごとの設定を記述できるようにする:

```json
{
  "candidates": { "...": "..." },
  "namespaces": {
    "JIRA": {
      "urlTemplate": "https://jira.example.com/browse/{id}"
    },
    "ADR": {
      "urlTemplate": "docs/decisions/{id}.md"
    }
  }
}
```

```ts
interface NamespaceConfig {
  urlTemplate: string; // {id} プレースホルダーで URL/パス生成
}

// ShioriConfig に追加
interface ShioriConfig {
  candidates?: Partial<CandidatePatternConfig>;
  namespaces?: Record<string, NamespaceConfig>;
}
```

- `urlTemplate` は `{id}` プレースホルダーを `id` 部分に置換して URL を生成する
- `defaultNamespace` は導入しない。explicit namespace only でシンプルに保つ

### `resolveRefUrl()` 関数

`src/core/namespace.ts` に配置する pure function:

```ts
function resolveRefUrl(
  ref: string,
  namespaces: Record<string, NamespaceConfig> | undefined,
): string | undefined;
```

1. `parseRef(ref)` で namespace を抽出
2. namespace が undefined または設定に存在しない → `undefined` を返す
3. 設定の `urlTemplate` 内の `{id}` を `id` に置換して返す

**URL 解決例**:

| ref             | urlTemplate                            | result                                     |
| --------------- | -------------------------------------- | ------------------------------------------ |
| `JIRA:PROJ-123` | `https://jira.example.com/browse/{id}` | `https://jira.example.com/browse/PROJ-123` |
| `ADR:0007`      | `docs/decisions/{id}.md`               | `docs/decisions/0007.md`                   |
| `SUP-1234`      | (namespace なし)                       | undefined                                  |
| `GH:42`         | (設定に `GH` なし)                     | undefined                                  |

## Rationale

- **既存の `.shiorirc.json` を拡張**: 新しい設定ファイルを導入せず、既存の仕組みに乗る
- **コロン必須**: `SUP-1234` のようなハイフン含みの ID と曖昧にならない。大文字パターンにより `http:` のような URL スキームとの誤判定も回避
- **`defaultNamespace` を導入しない**: namespace なしの ref はそのまま扱う。暗黙的な解決は予期しない動作の原因になる
- **pure function 設計**: `parseRef` と `resolveRefUrl` はどちらも同期的な pure function。エディタ拡張やテストから直接利用しやすい

## Consequences

- `ShioriConfig` / `ResolvedConfig` 型に `namespaces` フィールドが追加される
- `src/core/namespace.ts` が新モジュールとして追加される
- 既存コマンド（scan, verify, init-registry）への影響はない（namespace 解決は新機能として追加されるのみ）
- ADR 009 (`shiori show`) と ADR 010（マルチレジストリ）が namespace 設定を参照する
