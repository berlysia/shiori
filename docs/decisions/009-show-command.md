# ADR 009: `shiori show` Command

## Status

Accepted

## Context

ref から情報を引く手段が存在しない。`shiori verify` はレジストリとソースの整合性を検証するが、特定の ref について「レジストリエントリ」「ソース上の出現箇所」「外部リンク URL」をまとめて表示する機能はない。

エディタ拡張で `shiori:<ID>` からインレイ・オーバーレイ表示を実現するためにも、プログラマティックに ref 情報を取得できる API が基盤として必要になる。

## Decision

### `shiori show <ref>` コマンド

既存のコマンド分割パターン（dual-file: pure logic + CLI wrapper）に従い追加する。

- `src/commands/show.ts` — pure logic
- `src/commands/show-cli.ts` — CLI wrapper（gunshi）

### pure logic: `show()` 関数

```ts
interface ShowInput {
  ref: string;
  registry: Registry;
  annotations: ShioriAnnotation[];
  namespaces: Record<string, NamespaceConfig> | undefined;
}

interface ShowResult {
  ref: string;
  registryEntry: RegistryEntry | undefined;
  sourceLocations: Array<{ file: string; line: number }>;
  url: string | undefined;
}

function show(input: ShowInput): ShowResult;
```

- `registryEntry`: レジストリに ref が存在すればそのエントリ
- `sourceLocations`: アノテーション配列から ref が一致するものの location を収集
- `url`: ADR 008 の `resolveRefUrl()` で解決した URL（設定がなければ undefined）

IO 分離により、テストやエディタ拡張から registry/annotations/config を直接渡して利用できる。

### CLI 出力

- 出力フォーマット: JSON（stdout）
- exit code: `0` = found（registryEntry または sourceLocations が存在）、`1` = not found

```bash
$ shiori show JIRA:PROJ-123
{
  "ref": "JIRA:PROJ-123",
  "registryEntry": {
    "reason": "Legacy API compatibility",
    "target": "src/api/legacy.ts",
    "expires": "2026-06",
    "ticket": null,
    "owner": "team-platform",
    "notes": null,
    "kind": "compat"
  },
  "sourceLocations": [
    { "file": "src/api/legacy.ts", "line": 42 },
    { "file": "src/api/legacy.ts", "line": 87 }
  ],
  "url": "https://jira.example.com/browse/PROJ-123"
}
```

### package exports 拡張

エディタ拡張やプログラマティック利用のため、package exports を追加する:

```json
{
  "exports": {
    "./core/namespace": "./dist/core/namespace.js",
    "./commands/show": "./dist/commands/show.js"
  }
}
```

## Future Work: Editor Extension

- `shiori:<ID>` からインレイ・オーバーレイ表示を実現
- `parseRef()` + `resolveRefUrl()`（ADR 008）が同期的な building block として機能する
- キャッシュ戦略（registry/annotations の再読み込み頻度）はエディタ拡張側の責務
- Language Server Protocol (LSP) での Hover/CodeLens 提供も将来的な選択肢

## Rationale

- **dual-file パターン踏襲**: 既存の scan, verify, init-registry と同じ設計方針
- **JSON 出力**: プログラマティック利用に適しており、エディタ拡張との連携が容易
- **IO 分離**: pure function `show()` は registry/annotations を引数として受け取り、ファイル読み込みは CLI wrapper の責務。テスタビリティとライブラリ利用を両立
- **exit code 設計**: シェルスクリプトや CI での利用を想定。`1` = not found は `grep` 等の慣例に従う

## Consequences

- 新コマンド `shiori show` が追加される（2 ファイル: show.ts + show-cli.ts）
- `package.json` の exports フィールドが拡張される
- ADR 008 の `parseRef()` / `resolveRefUrl()` に依存する
- ADR 010（マルチレジストリ）導入時は、CLI wrapper 側で複数レジストリをマージしてから `show()` に渡す形になる
