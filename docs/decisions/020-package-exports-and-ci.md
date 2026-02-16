---
status: Accepted
deps:
  - 9
  - 18
  - 19
---

# ADR 020: パッケージ exports 整備と CI パイプライン

## Context

パブリッシュに向けて、パッケージングの品質保証に以下の課題がある。

### 1. exports フィールドの不備

現在の exports:

```json
{
  ".": { "import": "./dist/src/core/types.js" },
  "./core/ref-pattern": { "import": "./dist/src/core/ref-pattern.js" },
  "./commands/show": { "import": "./dist/src/commands/show.js" }
}
```

問題点:

- **型定義の export が未指定**: `"types"` 条件がないため、TypeScript プロジェクトでの型解決が `moduleResolution: "bundler"` 等の設定次第で不安定
- **公開 API の範囲が未検討**: どのモジュールをパブリック API として公開するかの方針が不明確

### 2. CI パイプラインの不在

README に GitHub Actions ワークフローの例はあるが、shiori 自身のリポジトリには CI が設定されていない。パブリッシュ後のリグレッション検知手段がない。

### 3. パブリッシュの再現性

`npm publish` / `pnpm publish` のプロセスが未標準化。バージョンバンプ、CHANGELOG 生成、タグ作成が手動。

## Decision

### 1. exports の整備

#### 型定義の追加

```json
{
  ".": {
    "types": "./dist/src/core/types.d.ts",
    "import": "./dist/src/core/types.js"
  },
  "./core/ref-pattern": {
    "types": "./dist/src/core/ref-pattern.d.ts",
    "import": "./dist/src/core/ref-pattern.js"
  },
  "./commands/show": {
    "types": "./dist/src/commands/show.d.ts",
    "import": "./dist/src/commands/show.js"
  }
}
```

`"types"` を各エントリの先頭に配置する（TypeScript の exports 解決は上から順に評価される）。

#### 公開 API の方針

v0.0.1 の公開 API は最小限に保つ:

| エントリ             | 目的                                        | 対象ユーザー         |
| -------------------- | ------------------------------------------- | -------------------- |
| `.`                  | 型定義（`ShioriAnnotation`, `Registry` 等） | プラグイン開発者     |
| `./core/ref-pattern` | ref パターンマッチユーティリティ            | カスタムツール開発者 |
| `./commands/show`    | プログラマティックな ref 検索               | エディタ拡張開発者   |

今後の需要に応じて exports を追加する。追加は非破壊的変更（minor バージョン）として扱う。

### 2. CI パイプライン

#### ワークフロー構成

```
.github/workflows/
├── ci.yml          # PR/push 時の品質チェック
└── release.yml     # タグ push 時の npm パブリッシュ
```

#### ci.yml

```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm build
      # ビルド成果物の動作確認
      - run: node dist/src/cli.js --help
```

ADR 019 が採用された場合は Node 18/20 のスモークテストジョブを追加する。

#### release.yml

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
      - run: pnpm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`--provenance` フラグで npm provenance を有効化し、パッケージの出所を検証可能にする。

### 3. パブリッシュ手順の標準化

#### 手動フロー（v0.x の間）

```bash
# 1. バージョンバンプ
pnpm version patch  # or minor, major

# 2. 品質チェック
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build

# 3. タグ push → release.yml が自動パブリッシュ
git push && git push --tags
```

#### 将来の自動化（v1.0 以降で検討）

- changesets または release-it による自動バージョンバンプ
- CHANGELOG.md 自動生成
- GitHub Releases 自動作成

v0.x の間は手動フローで十分。自動化は利用者が増えてリリース頻度が上がった時点で導入する。

## Alternatives Considered

### A. exports を一切公開しない（CLI-only パッケージ）

- 利点: API 互換性の責務がない。`exports: { ".": null }` で内部モジュールへのアクセスを完全に遮断
- 欠点: エディタ拡張やカスタムツールからの利用が不可能。エコシステム発展の阻害
- 判断: 最小限の公開 API を提供する方が、ツールとしての汎用性が高い

### B. 全モジュールを exports に公開

- 利点: 最大限の柔軟性。ユーザーが任意のモジュールを import 可能
- 欠点: 全モジュールが API 互換性の対象になる。内部リファクタリングが breaking change に
- 判断: v0.0.1 では不採用。必要に応じて exports を追加する方針

### C. CI を GitHub Actions 以外で構成（CircleCI, GitLab CI 等）

- 利点: プラットフォーム非依存
- 欠点: リポジトリが GitHub にあるため GitHub Actions が最も統合が深い。SARIF アップロード等の連携も GitHub 前提
- 判断: GitHub Actions を使用

### D. changesets を初期から導入

- 利点: バージョニング・CHANGELOG が自動化。monorepo にも対応
- 欠点: v0.0.1 の単一パッケージに対して過剰。ワークフローが複雑化
- 判断: v1.0 以降で検討

## Consequences

### 変更されるもの

- `package.json` の `exports`: 各エントリに `"types"` 条件を追加

### 追加されるもの

- `.github/workflows/ci.yml`: PR/push 時の品質チェック
- `.github/workflows/release.yml`: タグ push 時の npm パブリッシュ
- パブリッシュ手順のドキュメント（README または CONTRIBUTING.md）

### 他 ADR への影響

- **ADR 018**: CI ワークフローに SARIF アップロードを将来追加可能
- **ADR 019**: CI マトリクスに Node 18/20 のスモークテストを追加する場合は ci.yml を拡張
