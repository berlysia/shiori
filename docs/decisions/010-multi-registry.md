# ADR 010: Multi-Registry Loading

## Status

Proposed

## Context

現在 shiori は単一のレジストリファイル（`shiori-registry.json` or `.yaml`）で全アノテーションを管理している。プロジェクトが成長し namespace が増えると、単一ファイルでの管理には以下の課題が出てくる:

1. **見通しの悪化**: 異なる namespace のエントリが混在し、特定 namespace の一覧性が低下する
2. **責任分離の困難**: チームや namespace ごとにオーナーシップを分けたい場合に、ファイル単位での CODEOWNERS 設定ができない
3. **マージコンフリクト**: 大規模プロジェクトでは単一 JSON/YAML ファイルへの同時編集によるコンフリクトが頻発する

## Decision

### namespace 設定に `registryFile` フィールドを追加

ADR 008 で導入する `.shiorirc.json` の `namespaces` セクションに、namespace ごとのレジストリファイルパスを指定できるようにする:

```json
{
  "namespaces": {
    "JIRA": {
      "urlTemplate": "https://jira.example.com/browse/{id}",
      "registryFile": "shiori-registry-jira.json"
    },
    "ADR": {
      "urlTemplate": "docs/decisions/{id}.md",
      "registryFile": "shiori-registry-adr.yaml"
    }
  }
}
```

```ts
interface NamespaceConfig {
  urlTemplate: string;
  registryFile?: string; // JSON/YAML 両対応、拡張子で自動判定
}
```

`registryFile` は省略可能。指定がなければデフォルトレジストリに含まれる。

### Registry loading 順序

1. デフォルトレジストリファイルを読み込む
2. namespace 設定に `registryFile` があるものを順に読み込む
3. 全エントリをマージする

**キー重複時のルール**: namespace 別ファイルを優先する（専用ファイル = 権威ソース）。重複がある場合は warning を出力する。

### init-registry のルーティング

`init-registry` コマンドで新規エントリを追加する際:

1. `parseRef(ref)` で namespace を抽出（ADR 008）
2. namespace に対応する `registryFile` 設定があればそのファイルに書き込む
3. 設定がなければデフォルトレジストリに書き込む

### レジストリキー形式

変更なし。キーはフル ref 文字列（例: `JIRA:PROJ-123`）をそのまま使用する。namespace でキーを分割する必要はない。

## Alternatives Considered

### A: 規約ベース分割

`shiori-registry-{namespace}.json` のように命名規約でファイルを自動検出する。

- 利点: 設定不要
- 欠点: ファイル名の柔軟性がない、YAML/JSON 混在時のルールが曖昧、ディレクトリ構成をカスタマイズできない

### B: 単一ファイル内セクション分割

```json
{
  "JIRA": { "PROJ-123": { "...": "..." } },
  "ADR": { "0007": { "...": "..." } }
}
```

- 利点: ファイルが一つで済む
- 欠点: 既存レジストリ形式との breaking change、キーが `ref` ではなく `id` 部分のみになり他コマンドとの整合性が崩れる

### C: 設定ファイルでパス指定（採用）

`.shiorirc.json` の namespace 設定に `registryFile` を追加する。

- 利点: 既存形式と完全互換、パスの自由度が高い、opt-in で段階的に分離可能
- 欠点: 設定の記述が必要

## Rationale

- **Option C を採用**: 既存レジストリ形式を変更せず、opt-in で namespace ごとにファイルを分離できる。breaking change なし
- **namespace 別ファイル優先**: 専用ファイルに書かれたエントリは、そのファイルが正式な情報源。デフォルトレジストリに残っている古いエントリより新しい
- **JSON/YAML 両対応**: 既存の registry loading（ADR で拡張子による自動判定を実装済み）をそのまま活用

## Consequences

### 既存コマンドへの影響

| コマンド      | 影響                                                      |
| ------------- | --------------------------------------------------------- |
| verify        | config 経由で全レジストリを自動発見・マージ。透過的に対応 |
| init-registry | `parseRef` → namespace 判定 → 対応ファイルにルーティング  |
| scan          | なし（レジストリを読まない）                              |
| draft         | なし（レジストリを読まない）                              |
| candidates    | なし（レジストリを読まない）                              |
| show          | CLI wrapper 側でマージ済みレジストリを `show()` に渡す    |

### Migration

- 既存の単一レジストリファイルは変更不要。`registryFile` を設定しなければ従来通り動作する
- 分離したい namespace が出てきた時点で、opt-in で `registryFile` を追加し、該当エントリを移動する
- ADR 008 の `NamespaceConfig` 型に `registryFile` フィールドが追加される
