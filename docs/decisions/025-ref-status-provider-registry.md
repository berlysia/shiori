---
status: Accepted
deps:
  - 18
  - 20
---

# ADR 025: Ref-Status Provider Selection and Extensibility

## Context

EP-0068 で `RefStatusProvider` インターフェースと GitHub Issues プロバイダを実装し、環境変数ベースの自動検出パターン（`GITHUB_TOKEN` → `GitHubIssuesRefStatusProvider`）が確立された。

この成功パターンを一般化し、外部プロバイダ開発者が shiori のリファレンスステータス解決に参加できるようにする需要がある。一方で v0.1.x の段階でプラグインエコシステム仕様を策定するのは時期尚早であり、段階的な拡張パスを設計する必要がある。

### 現状のアーキテクチャ

- `RefStatusProvider` インターフェース: `name` + `resolve(refs)` の 2 メンバー
- `selectRefStatusProvider()`: if-else チェーンで 2 プロバイダを選択
  1. `--ref-status-command` → `CommandRefStatusProvider`
  2. `GITHUB_TOKEN` → `GitHubIssuesRefStatusProvider`
  3. フォールバック: なし（ref ステータスチェックをスキップ）
- `resolveRefStatusMap()`: CLI コマンド共通のオーケストレーションヘルパー

### 設計上の制約

- ADR 018: shiori はデータ生成器。外部サービス連携はユーザーの責務
- ADR 020: 公開 API は最小限。追加は非破壊的変更として扱う
- 外部プロバイダ開発者が `RefStatusProvider` を実装するために、インターフェース定義へのアクセスが必要

## Decision

### Step 1（本 ADR のスコープ）

#### 1. 公開 API: RefStatusProvider インターフェースのみ

`package.json` の `exports` に `./core/ref-status-providers` エントリを追加し、`types.ts`（`RefStatusProvider` インターフェース定義）のみを公開する。

```json
"./core/ref-status-providers": {
  "types": "./dist/src/core/ref-status-providers/types.d.ts",
  "import": "./dist/src/core/ref-status-providers/types.js"
}
```

公開しないもの（内部実装として維持）:

- `CommandRefStatusProvider`, `GitHubIssuesRefStatusProvider` — 具体実装
- `selectRefStatusProvider`, `resolveRefStatusMap` — 内部オーケストレーション
- `parseGitHubRef` — GitHub 固有ユーティリティ

内部実装を非公開にすることで、signature 変更が breaking change にならず v0.x での進化速度を維持できる。

#### 2. Priority Chain の設計意図

プロバイダ選択の優先順位を以下のように定義する:

1. **Explicit**: ユーザー指定の `--ref-status-command`（常に最優先）
2. **Auto-detect**: 環境変数ベースの自動検出（`GITHUB_TOKEN` 等）
3. **None**: プロバイダなし（ref ステータスチェックをスキップ）

「Explicit > Implicit > None」の原則により、ユーザーの明示的な意図が自動検出を常にオーバーライドする。

#### 3. 外部プロバイダの接続方法（現行）

外部プロバイダは `--ref-status-command` を通じて接続する:

```bash
shiori verify --ref-status-command ./my-jira-checker
```

コマンドは stdin で ref リストを受け取り、stdout に JSONL で `RefStatusEntry` を返す。このプロトコルは `CommandRefStatusProvider` が処理する。

### Step 2 以降の検討事項（本 ADR では未確定）

以下は将来の拡張候補として記録するが、本 ADR では決定しない:

- **環境変数命名規約**: `SHIORI_REFSTATUS_<PROVIDER>_<KEY>` 形式が候補。実装時に実用性を検証してから確定する
- **npm installable providers**: `@berlysia/shiori-provider-*` パッケージによるプロバイダ配布。外部ユーザーが生まれてからエコシステム仕様を策定する方がリスクが低い
- **動的 Registry パターン**: 現在の if-else チェーンから、設定ファイルベースの動的プロバイダ登録への発展。プロバイダ数が増えた段階で検討する

## Alternatives Considered

### A. index.ts 全体を公開 API にする

`src/core/ref-status-providers/index.ts` の全 export を package.json exports に含める。

- 利点: 外部プロバイダ開発者が `CommandRefStatusProvider` を再利用可能
- 欠点: `GitHubIssuesRefStatusProvider`, `selectRefStatusProvider`, `parseGitHubRef` 等の内部実装まで semver 制約下に置かれ、リファクタリングの自由度が低下
- 判断: 不採用。ADR 020 の最小限原則に反する

### B. 動的プラグインローダーを Step 1 で実装

`require()` / `import()` による動的モジュール読み込みでプロバイダを自動検出する。

- 利点: zero-config でサードパーティプロバイダを接続可能
- 欠点: モジュール解決の複雑さ（ESM/CJS 互換性）、セキュリティ考慮、v0.1.x では過剰
- 判断: 不採用。`--ref-status-command` が同等の拡張性を提供している

### C. 公開 API を設けない

`RefStatusProvider` インターフェースを公開せず、外部プロバイダは型定義なしで `--ref-status-command` のみ使用する。

- 利点: API 互換性の責務がゼロ
- 欠点: TypeScript で外部プロバイダを実装する開発者が型安全性を得られない
- 判断: 不採用。インターフェース公開のコストは極小で、型安全性の恩恵が大きい

## Consequences

### 追加されるもの

- `package.json` の `exports`: `./core/ref-status-providers` エントリ（types.ts のみ）
- `select-provider.ts`: priority chain の設計意図と拡張ポイントのコメント

### 変更されるもの

- なし（ロジック変更なし）

### 他 ADR への影響

- **ADR 018**: 外部サービス連携の方針を維持。プロバイダインターフェースの公開は「構造化データ」アプローチの延長
- **ADR 020**: exports 追加は非破壊的変更。公開範囲はインターフェースのみに限定

### 将来の拡張パス

```
Step 1 (本 ADR)          Step 2 (将来)                Step 3 (将来)
─────────────────        ─────────────────            ─────────────────
Interface 公開           env-var 命名規約確定         動的 Registry
--ref-status-command     npm provider packages        設定ファイルベース
Priority chain 文書化    Jira/Linear PoC              auto-discovery
```
