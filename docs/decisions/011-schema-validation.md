# ADR 011: JSON Schema によるレジストリ・設定ファイルのバリデーション

## Status

Proposed

## Context

現在のレジストリバリデーションには以下の課題がある:

1. **固定スキーマ**: 全 namespace のエントリが同一の `RegistryEntry` 型で管理されており、namespace 固有のフィールドや制約を表現できない
   - 例: JIRA namespace ではチケット番号（`ticket`）が必須であるべきだが、現状は任意フィールド
   - 例: ADR namespace では `supersededBy` のような固有フィールドを持ちたいが、型定義に存在しない
2. **プログラム的バリデーションの限界**: TypeScript 関数 `validateEntry()` でハードコードされた検証ロジックでは、namespace ごとのルール追加にコード変更が必要
3. **設定ファイル検証の不在**: `.shiorirc.json` にはバリデーションが存在せず、typo や構造ミスがサイレントに無視される
4. **エディタ支援の欠如**: スキーマが定義されていないため、`.shiorirc.json` やレジストリファイル編集時に補完や検証が効かない

ADR 010 でマルチレジストリ（namespace ごとのファイル分割）が導入され、namespace ごとにレジストリファイルを分離できるようになった。この基盤の上に、namespace ごとのスキーマ定義とバリデーションを構築する。

## Decision

### 1. namespace ごとのレジストリエントリスキーマ

namespace ごとに完全なカスタム JSON Schema を適用できるようにする。スキーマの配置場所はユーザー定義と自動生成で分ける。

#### ユーザー定義スキーマ（リポジトリローカル）

ユーザーが手書きするスキーマはプロジェクトリポジトリ内に配置し、`.shiorirc.json` の `entrySchema` で参照する:

```json
{
  "namespaces": {
    "JIRA": {
      "urlTemplate": "https://jira.example.com/browse/{id}",
      "registryFile": "shiori-registry-jira.json",
      "entrySchema": "schemas/JIRA.json"
    },
    "ADR": {
      "urlTemplate": "docs/decisions/{id}.md",
      "registryFile": "shiori-registry-adr.yaml",
      "entrySchema": "schemas/ADR.json"
    }
  }
}
```

`entrySchema` は `.shiorirc.json` からの相対パス。git-tracked なのでチームで共有・レビューできる。

#### shiori 管理スキーマ（`node_modules/.shiori/schemas/`）

shiori が管理するスキーマは `node_modules/.shiori/schemas/` に出力する。デフォルトスキーマもここに含まれる:

```
node_modules/.shiori/schemas/
├── _default.json   # デフォルトスキーマ（後述）
├── JIRA.json       # namespace 固有スキーマ（生成された場合）
└── ADR.json        # namespace 固有スキーマ（生成された場合）
```

`node_modules/` 配下のため gitignored であり、生成物として扱える。

#### スキーマ解決の優先順位

1. **`entrySchema` 指定**（ユーザー定義） → `.shiorirc.json` からの相対パスで解決
2. **`node_modules/.shiori/schemas/<NAMESPACE>.json`**（shiori 管理） → 規約ベースで自動検出。存在しなければ `_default.json` を使用

ユーザー定義が常に shiori 管理より優先される。

```ts
interface NamespaceConfig {
  urlTemplate: string;
  registryFile?: string;
  entrySchema?: string; // ユーザー定義 JSON Schema ファイルへの相対パス
}
```

#### カスタムスキーマの例

**JIRA エントリスキーマ** (`schemas/jira-entry.schema.json`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["reason", "target", "ticket"],
  "properties": {
    "reason": { "type": "string", "minLength": 1 },
    "target": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "string" }, "minItems": 1 }
      ]
    },
    "expires": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}(-\\d{2})?$"
    },
    "ticket": {
      "type": "string",
      "pattern": "^[A-Z]+-\\d+$",
      "description": "JIRA チケット番号 (例: PROJ-123)"
    },
    "owner": { "type": "string" },
    "priority": {
      "type": "string",
      "enum": ["critical", "high", "medium", "low"],
      "description": "JIRA 固有: 優先度"
    }
  },
  "additionalProperties": false
}
```

**ADR エントリスキーマ** (`schemas/adr-entry.schema.json`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["reason", "target"],
  "properties": {
    "reason": { "type": "string", "minLength": 1 },
    "target": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "string" }, "minItems": 1 }
      ]
    },
    "supersededBy": {
      "type": "string",
      "description": "ADR 固有: この決定を置き換えた ADR の ref"
    },
    "status": {
      "type": "string",
      "enum": ["accepted", "deprecated", "superseded"],
      "description": "ADR 固有: 決定の現在の状態"
    }
  },
  "additionalProperties": false
}
```

#### デフォルトスキーマ

`entrySchema` が未指定かつ `node_modules/.shiori/schemas/<NAMESPACE>.json` も存在しない場合に適用されるスキーマ。`node_modules/.shiori/schemas/_default.json` として出力される。現行の `validateEntry()` と等価な制約を JSON Schema で表現したもの:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["reason", "target"],
  "properties": {
    "reason": { "type": "string" },
    "target": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "string" } }
      ]
    },
    "expires": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}(-\\d{2})?$"
    },
    "ticket": { "type": "string" },
    "owner": { "type": "string" },
    "notes": { "type": "string" },
    "kind": { "type": "string" }
  },
  "additionalProperties": true
}
```

デフォルトスキーマは `additionalProperties: true` とし、既存レジストリとの後方互換性を保つ。カスタムスキーマでは `additionalProperties: false` を推奨するが、強制はしない。

### 2. .shiorirc.json の JSON Schema

`.shiorirc.json` 自体のバリデーション用スキーマを公開する:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "candidates": {
      "type": "object",
      "properties": {
        "lint-disable": { "type": "boolean" },
        "todo": { "type": "boolean" },
        "fixme": { "type": "boolean" },
        "hack": { "type": "boolean" },
        "xxx": { "type": "boolean" }
      },
      "additionalProperties": false
    },
    "namespaces": {
      "type": "object",
      "patternProperties": {
        "^[A-Z][A-Z0-9]*$": {
          "type": "object",
          "required": ["urlTemplate"],
          "properties": {
            "urlTemplate": { "type": "string" },
            "registryFile": { "type": "string" },
            "entrySchema": { "type": "string" }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

`.shiorirc.json` に `$schema` フィールドを記述することで、エディタの自動補完・検証が有効になる:

```json
{
  "$schema": "https://shiori.example.com/schemas/shiorirc.schema.json",
  "namespaces": { "..." : "..." }
}
```

スキーマファイルの配布先は実装フェーズで決定する（パッケージ内同梱、またはリモート URL）。

### 3. バリデーションのフロー

```
Registry File (JSON/YAML)
    ↓ parse
Record<string, unknown>
    ↓ for each [ref, entry]
parseRef(ref) → namespace
    ↓
スキーマ解決:
  1. entrySchema 指定あり → そのファイルで検証
  2. node_modules/.shiori/schemas/<NAMESPACE>.json あり → そのファイルで検証
     なければ node_modules/.shiori/schemas/_default.json で検証
    ↓
ValidationResult (errors: SchemaValidationError[])
```

namespace なしの ref（例: `SUP-1234`）は `_default.json` で検証する。

#### 混在エントリの扱い

namespace 別レジストリファイルに別の namespace のエントリが含まれる場合（例: `shiori-registry-jira.json` に `ADR:0007` が存在）、エントリ自体の ref から namespace を判定してスキーマを適用する。ファイルの所属 namespace ではなく、**ref の namespace がスキーマを決定する**。

### 4. 型システムへの影響と移行

カスタムスキーマの導入により、レジストリエントリが `RegistryEntry` の固定フィールドに収まらなくなる。

#### RegistryEntry 型の拡張

```ts
/** 全スキーマ共通のベースフィールド（デフォルトスキーマ相当） */
interface RegistryEntryBase {
  reason: string;
  target: string | string[];
  expires?: string;
  ticket?: string;
  owner?: string;
  notes?: string;
  kind?: string;
}

/** カスタムスキーマ対応のエントリ型 */
interface RegistryEntry extends RegistryEntryBase {
  /** カスタムスキーマで定義された追加フィールド */
  [key: string]: unknown;
}
```

shiori 内部のコマンド（`verify()`, `show()` 等）はこの型で動作する:
- `verify()`: `entry.expires` へのアクセスは `RegistryEntryBase` で型定義済み。カスタムスキーマが `expires` を含まない場合でも、JSON parse 結果は `undefined` になるため実行時エラーにはならない
- `show()`: `RegistryEntryBase` のフィールドは従来通り表示し、index signature 経由の追加フィールドは「カスタムフィールド」セクションで表示する

#### JSON Schema からの TypeScript 型生成

JSON Schema ファイルから namespace ごとの TypeScript 型定義を生成し、`node_modules/.shiori/types/` に出力する:

```
node_modules/.shiori/
├── schemas/
│   ├── _default.json
│   ├── JIRA.json
│   └── ADR.json
└── types/
    ├── _default.d.ts
    ├── JIRA.d.ts       # JiraRegistryEntry 型
    └── ADR.d.ts        # AdrRegistryEntry 型
```

**生成例** (`node_modules/.shiori/types/JIRA.d.ts`):

```ts
/** Generated from schemas/JIRA.json — do not edit */
export interface JiraRegistryEntry {
  reason: string;
  target: string | string[];
  expires?: string;
  ticket: string;
  owner?: string;
  priority?: "critical" | "high" | "medium" | "low";
}
```

**型付きアクセサ**:

shiori はジェネリックなアクセサを提供し、生成された型で型安全にエントリを参照できるようにする:

```ts
import type { JiraRegistryEntry } from 'node_modules/.shiori/types/JIRA';

// 型安全なアクセス
const entry = getTypedEntry<JiraRegistryEntry>(registry, 'JIRA:PROJ-123');
entry.ticket;    // string — 型エラーなし
entry.priority;  // "critical" | "high" | "medium" | "low" | undefined
entry.foo;       // コンパイルエラー
```

**生成タイミング**:

- `shiori init-schema` 実行時にスキーマと型定義を同時に生成する
- ユーザー定義スキーマ（`entrySchema`）が更新された場合も再生成する

**型生成ツールの選定**は実装フェーズで決定する（`json-schema-to-typescript` 等）。

### 5. エラーレポートの拡張

現行の `RegistryValidationError` を拡張し、スキーマ検証の詳細を含められるようにする:

```ts
interface SchemaValidationError {
  ref: string;
  message: string;
  /** JSON Schema validation 固有の情報 */
  schemaPath?: string;    // 違反したスキーマ内のパス
  instancePath?: string;  // 検証対象の JSON パス
  keyword?: string;       // 違反した制約の種類 (required, pattern, enum 等)
}
```

`verify` コマンドの出力にスキーマバリデーションエラーを新しい issue type として追加する:

```ts
type VerifyIssueType =
  | 'missing-in-registry'
  | 'unused-in-source'
  | 'expired'
  | 'syntax-error'
  | 'schema-violation';  // 新規追加
```

`schema-violation` のデフォルト severity は `warning` とする。既存の CI パイプラインが新しい issue type で意図せず失敗することを防ぐ。将来的に `--strict-schema` オプションで `error` に昇格可能にする。

### 6. スキーマ読み込みと検証の API

#### validateEntry() の新 signature

```ts
interface SchemaResolver {
  /** ref に対応するコンパイル済み JSON Schema バリデーション関数を返す */
  resolve(ref: string): ValidateFunction;
}

function validateEntry(
  ref: string,
  value: unknown,
  schemaResolver: SchemaResolver,
): { entry: RegistryEntry | undefined; errors: SchemaValidationError[] };
```

`SchemaResolver` はスキーマの読み込み・コンパイル・キャッシュを担当する。`loadMultiRegistry()` の前段階で構築し、引数として渡す:

```ts
// 使用例
const resolver = await buildSchemaResolver(config.namespaces, basePath);
const result = await loadMultiRegistry(registryPath, config.namespaces, basePath, resolver);
```

`buildSchemaResolver` の内部では Decision セクション 1 のスキーマ解決の優先順位に従い、`entrySchema` → `node_modules/.shiori/schemas/<NAMESPACE>.json` → `_default.json` の順で探索する。

#### スキーマ読み込み失敗時の挙動

スキーマファイルが存在しない、または不正な JSON Schema である場合:

1. **デフォルトスキーマにフォールバック**する
2. **warning を出力**する（`schema-load-error` として `SchemaValidationError` に追加）
3. バリデーション自体はスキップしない（デフォルトスキーマで検証を続行）

この挙動により、スキーマファイルの typo やパスミスがサイレントに無視されることはなく、かつ検証プロセス全体がエラー終了することもない。

### 7. スキーマキャッシュ

同一レジストリファイル内の複数エントリが同じスキーマを参照するため、スキーマの読み込み・コンパイルはキャッシュする。具体的なキャッシュ戦略は実装フェーズで決定するが、最低限ファイルパスベースのメモ化を行う。

### 8. エッジケースの扱い

| ケース | 扱い |
| --- | --- |
| namespace なしの ref（例: `SUP-1234`） | デフォルトスキーマで検証 |
| namespace パターン不一致のコロン付き ref（例: `abc:def`） | namespace なしと判定（ADR 008 準拠）、デフォルトスキーマで検証 |
| draft state（ref が空文字列） | スキーマ検証をスキップ（ref がないため namespace 判定不可） |
| entrySchema なしの namespace | デフォルトスキーマで検証。namespace 設定は urlTemplate/registryFile にのみ影響 |
| スキーマファイルが存在しない | デフォルトスキーマにフォールバック + warning |
| スキーマファイルが不正な JSON | デフォルトスキーマにフォールバック + warning |
| スキーマファイルが不正な JSON Schema | デフォルトスキーマにフォールバック + warning |

## Alternatives Considered

### A: RegistryEntry 型の拡張（固定フィールド追加）

namespace ごとに必要なフィールドを `RegistryEntry` 型に追加し、TypeScript 関数で検証する。

- 利点: 外部依存なし、TypeScript の型安全性が効く
- 欠点: namespace 追加のたびにコード変更が必要、ユーザーが自由にフィールドを定義できない

### B: カスタムバリデーション関数

namespace ごとに JavaScript/TypeScript のバリデーション関数を登録する。

- 利点: 柔軟性が高い、Turing 完全
- 欠点: セキュリティリスク（任意コード実行）、設定のポータビリティが低い、エディタ連携不可

### C: JSON Schema ファイルによる外部スキーマ定義（採用）

namespace ごとに JSON Schema ファイルを参照し、汎用的なスキーマバリデーションで検証する。

- 利点: 標準仕様ベース、エディタ連携可能、ユーザーが自由にスキーマを定義可能、コード変更不要
- 欠点: JSON Schema ライブラリの依存追加（実装時）、スキーマ記述の学習コスト

## Rationale

- **JSON Schema 標準の採用**: 独自バリデーション DSL を作るのではなく、広く使われている標準に乗ることでエディタ連携・ツールチェーン活用・学習コスト低減が見込める
- **完全カスタムスキーマ**: namespace は ID 体系が異なるシステムを表現するため、共通型の制約を強制するのは不自然。JIRA チケットと ADR では必要なメタデータが根本的に異なる
- **ユーザー定義はリポジトリローカル、shiori 管理は `node_modules/.shiori/`**: ユーザーが手書きするスキーマは git-tracked でチームレビュー可能。デフォルトスキーマ等 shiori が管理するものは `node_modules/` 配下に分離し、ソースツリーを汚さない。スキーマのインライン記述（`.shiorirc.json` 内に直接 JSON Schema を書く）は冗長になり設定ファイルの可読性を損なう
- **デフォルトスキーマの後方互換**: `additionalProperties: true` により、既存レジストリが壊れない。カスタムスキーマは新規 opt-in
- **ref ベースのスキーマ解決**: エントリが物理的にどのファイルに存在するかではなく、論理的な namespace（ref から判定）でスキーマを決める。ADR 010 のマルチレジストリと整合する
- **バリデーションライブラリは実装時に選定**: ADR では概念設計に集中し、ajv 等の具体的ライブラリは実装フェーズで選定する。v0.0.1 段階では依存追加の判断を急がない

## Consequences

### 型・インターフェースへの影響

- `NamespaceConfig` に `entrySchema?: string` フィールドが追加される
- `RegistryEntry` 型は `RegistryEntryBase` + index signature の形に拡張される（Decision セクション 4 参照）
- namespace ごとの TypeScript 型定義が `node_modules/.shiori/types/` に生成される
- `VerifyIssueType` に `'schema-violation'` が追加される（デフォルト severity: warning）
- `validateEntry()` の signature が変更される（`SchemaResolver` 引数の追加）

### 既存コマンドへの影響

| コマンド      | 影響                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| verify        | スキーマバリデーションを追加。`schema-violation` issue を報告                      |
| init-registry | namespace のスキーマに従ったエントリ雛形を生成可能に                               |
| scan          | なし（レジストリを読まない）                                                      |
| show          | カスタムフィールドも表示に含める                                                  |
| draft         | なし                                                                              |
| candidates    | なし                                                                              |

### ファイル構成の変化

```
project/
├── .shiorirc.json                          # $schema フィールド追加、entrySchema 参照
├── schemas/                                # 新規: ユーザー定義スキーマ (git-tracked)
│   ├── JIRA.json
│   └── ADR.json
├── node_modules/.shiori/                   # 新規: shiori 管理 (gitignored)
│   ├── schemas/                            # スキーマ
│   │   └── _default.json
│   └── types/                              # 生成された型定義
│       ├── JIRA.d.ts
│       └── ADR.d.ts
├── shiori-registry.json                    # 変更なし
├── shiori-registry-jira.json               # 変更なし
└── shiori-registry-adr.yaml                # 変更なし
```

### Migration

- 既存の `.shiorirc.json` と レジストリファイルは変更不要。`entrySchema` を設定しなければ従来のデフォルトスキーマで動作する
- カスタムスキーマを導入したい namespace から段階的に、リポジトリローカルにスキーマファイルを作成し `entrySchema` を追加する
- 現行の `validateEntry()` プログラム的バリデーションはデフォルトスキーマによる検証に段階的に置き換える
- **Breaking change 注意**: `VerifyIssueType` に `'schema-violation'` が追加されるため、verify の JSON 出力をパースしている外部ツールは `summary.byType` のキー増加に対応が必要。ただしデフォルト severity が `warning` のため、exit code への影響はない
- ユーザー定義のスキーマファイルはリポジトリローカルに配置し `entrySchema` で参照する。`shiori init-schema` コマンドで雛形を生成可能

### 未決定事項（実装フェーズで決定）

- JSON Schema バリデーションライブラリの選定（ajv, JSON Schema $Ref Parser 等）
- `.shiorirc.json` 用メタスキーマの配布方式（パッケージ内同梱 vs リモート URL）
- `shiori init-schema` コマンドの詳細設計
- JSON Schema のドラフトバージョン（Draft 2020-12 推奨だが、ライブラリの対応状況に依存）
- JSON Schema → TypeScript 型生成ツールの選定（`json-schema-to-typescript` 等）
- `$ref` によるスキーマ間の共通定義の共有方法
- `--strict-schema` オプションの詳細設計（`schema-violation` を error に昇格）
