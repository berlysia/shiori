# ADR 012: Pattern-Based Ref Resolution

## Status

Accepted (Supersedes ADR 008)

## Context

ADR 008 では ref 文字列に `NAMESPACE:id` 構文を導入し、コロンで namespace を分離して URL 解決やレジストリ振り分けを行う設計とした。しかし運用を想定すると、以下の問題がある:

1. **namespace は不要な中間概念**: `PROJ-123` という ref は、それが JIRA 由来であることを明示しなくても十分にユニークである。`JIRA:PROJ-123` と書く必要はない
2. **ref は外部 ID の忠実な再現である必要がない**: プロジェクト内で `JIRA-123` というエイリアスを使い、外部の `PROJ-123` にマップしてもよい。マッピングは設定の責務であり、ref の構文に埋め込むべきではない
3. **セパレータ議論が本質ではない**: `:` か `-` かという問いの根本は、namespace という概念自体の必要性にある。namespace をなくせばセパレータの問題も消える

## Decision

### namespace 概念の廃止

`parseRef()` 関数と `ParsedRef` 型を廃止する。ref は単なる文字列として扱い、構文的な分解は行わない。

### `.shiorirc.json` の `namespaces` を `refPatterns` に置換

ref 文字列に対するパターンマッチで URL 解決・レジストリ振り分け・スキーマ適用を行う:

```json
{
  "refPatterns": [
    {
      "match": "JIRA-{id}",
      "urlTemplate": "https://jira.example.com/browse/PROJ-{id}",
      "registryFile": "shiori-registry-jira.json",
      "entrySchema": "schemas/jira.json"
    },
    {
      "match": "ADR-{id}",
      "urlTemplate": "docs/decisions/{id}.md",
      "registryFile": "shiori-registry-adr.yaml"
    }
  ]
}
```

```ts
interface RefPatternConfig {
  /** パターン文字列。`{id}` プレースホルダーで任意部分をキャプチャ */
  match: string;
  /** URL テンプレート。`{id}` をキャプチャ値で置換 */
  urlTemplate?: string;
  /** このパターンに一致する ref のレジストリファイル (ADR 010) */
  registryFile?: string;
  /** このパターンに一致する ref のエントリスキーマ (ADR 011) */
  entrySchema?: string;
}
```

- `refPatterns` は **配列**（順序付き）。先頭から評価し、最初にマッチしたパターンを使用する
- `{id}` は ref 内の可変部分をキャプチャするプレースホルダー。`urlTemplate` 内の `{id}` にキャプチャ値を展開する
- パターンにマッチしない ref は URL 解決なし・デフォルトレジストリ・デフォルトスキーマで扱う

### パターンマッチの仕様

`{id}` を含むパターン文字列を正規表現に変換する:

| パターン    | 生成される正規表現 | マッチ例     | `{id}`   |
| ----------- | ------------------ | ------------ | -------- |
| `JIRA-{id}` | `^JIRA-(.+)$`      | `JIRA-123`   | `123`    |
| `ADR-{id}`  | `^ADR-(.+)$`       | `ADR-0007`   | `0007`   |
| `{id}`      | `^(.+)$`           | 何でもマッチ | ref 全体 |

`{id}` を含まないリテラルパターンも許可する（完全一致）:

| パターン            | マッチ例                 |
| ------------------- | ------------------------ |
| `LEGACY-WORKAROUND` | `LEGACY-WORKAROUND` のみ |

### `resolveRefUrl()` の置換

```ts
function resolveRefUrl(
  ref: string,
  patterns: RefPatternConfig[] | undefined,
): string | undefined;
```

1. `patterns` を先頭から順に評価
2. `match` パターンに一致する最初のエントリを見つける
3. `urlTemplate` の `{id}` をキャプチャ値で置換して返す
4. マッチなし or `urlTemplate` なし → `undefined`

### ソースコードの記述

namespace 構文が不要になるため、ref はプロジェクトが自由に決めた形式で書く:

```typescript
// Before (ADR 008)
// eslint-disable-next-line no-console -- shiori: JIRA:PROJ-123
// shiori: ADR:0007

// After (ADR 012)
// eslint-disable-next-line no-console -- shiori: JIRA-123
// shiori: ADR-0007
```

既存の `JIRA:PROJ-123` 形式の ref も（パターンを `JIRA:{id}` と書けば）引き続き動作する。ref の形式を強制しないため、移行は段階的に行える。

## Alternatives Considered

### A: namespace を残しつつパターンベースを追加（両立）

- 利点: 後方互換
- 欠点: 2 つの解決メカニズムが共存し、混乱の元。namespace が不要であるという本質的な問題が解決しない

### B: prefix ベースのレコード（順序なし）

```json
{
  "refPatterns": {
    "JIRA-": { "urlTemplate": "..." },
    "ADR-": { "urlTemplate": "..." }
  }
}
```

- 利点: 設定が簡潔
- 欠点: prefix の長さで優先順位が曖昧になる。`{id}` キャプチャの柔軟性がない

### C: 配列 + `{id}` プレースホルダー（採用）

- 利点: 順序で優先順位が明確、`{id}` キャプチャで ref と外部 ID の変換が自由
- 欠点: 配列のため設定がやや冗長

## Rationale

- **ref はプロジェクトローカルなエイリアス**: 外部システムの ID 体系を ref の構文に押し込む必要がない。`JIRA-123` → `PROJ-123` のような変換は設定側の責務
- **パターンマッチは構文解析より柔軟**: namespace 分離はコロンに依存した固定構文だが、パターンマッチなら任意の形式に対応できる
- **概念の削減**: namespace / `parseRef()` / コロンセパレータという 3 つの概念が消え、「パターンに一致すれば設定を適用」という単一のルールに統一される
- **配列の順序付き評価**: 「先頭から最初のマッチ」はルーティングの標準的なセマンティクス。曖昧さが生じない

## Consequences

### 廃止されるもの

- `ParsedRef` 型
- `parseRef()` 関数
- `NAMESPACE_PATTERN` 定数
- `.shiorirc.json` の `namespaces` セクション

### 追加されるもの

- `RefPatternConfig` 型
- `matchRefPattern()` 関数（パターンマッチ + `{id}` キャプチャ）
- `.shiorirc.json` の `refPatterns` セクション

### 他 ADR への影響

| ADR                         | 影響                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **009 (show)**              | `ShowInput.namespaces` → `ShowInput.refPatterns` に変更。`resolveRefUrl()` の引数がパターン配列に変わる                            |
| **010 (multi-registry)**    | `NamespaceConfig.registryFile` → `RefPatternConfig.registryFile` に移行。ルーティングが namespace ベースからパターンベースに変わる |
| **011 (schema validation)** | `NamespaceConfig.entrySchema` → `RefPatternConfig.entrySchema` に移行。スキーマ解決が namespace ベースからパターンベースに変わる   |

### Migration

- `.shiorirc.json` の `namespaces` を `refPatterns` に書き換える
- 既存の `JIRA:PROJ-123` 形式の ref は `match: "JIRA:{id}"` パターンで互換維持可能。新規プロジェクトではコロンなしの形式を推奨
- `parseRef()` を呼び出しているコードを `matchRefPattern()` に置き換える
- レジストリキーの変更は任意。既存キーはそのまま動作する（パターンを合わせればよい）
