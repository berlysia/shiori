---
status: Accepted
deps:
  - 13
---

# ADR 014: init and update Commands

## Context

ADR 013 で CLI エルゴノミクスを改善したが、`init-registry` コマンドの立ち位置が曖昧になった:

1. **初回セットアップ**: `init-registry` は registry 雛形を作るが、config.json 作成や .gitignore 追記はカバーしない。プロジェクト初期化としては不完全
2. **`--merge` の日常利用**: 新 ref を既存 registry に追記する操作は「init」という名前にそぐわない。「update」や「sync」に近い
3. **`-registry` suffix**: shiori の文脈で registry 以外を init/update する対象がない。suffix は冗長

## Decision

### `init-registry` を廃止し、`init` と `update` に分解する

#### `init` コマンド

プロジェクトに shiori を導入する1回限りのセットアップ:

1. `.config/shiori/config.json` を作成（既に存在すればスキップ）
2. ソースをスキャンして annotation を検出
3. `.config/shiori/registry.json` を生成（scan 結果から雛形作成）
4. `.gitignore` に `.config/shiori/scan-result.json` を追記（既に含まれていればスキップ）
5. セットアップ結果のサマリーを表示

```bash
shiori init
shiori init --registry custom-registry.yaml   # 出力先を指定
shiori init --patterns "src/**/*.ts"           # scan パターンを指定
```

#### `update` コマンド

既存 registry に新しい ref をマージする日常操作:

1. scan 結果をロード（auto-detect）
2. 既存 registry をロード（auto-detect）
3. scan にあるが registry にない ref のエントリを追加（既存エントリは保持）
4. pattern routing がある場合は適切なファイルに振り分け
5. 更新結果のサマリーを表示

```bash
shiori scan && shiori update              # デフォルトパス
shiori scan | shiori update               # パイプ
shiori update -r custom-registry.json     # registry を指定
```

### pure ロジックの再利用

`init-registry.ts` の `initRegistry()` と `routeRegistryByPattern()` はそのまま再利用する。これらは registry 生成のコアロジックであり、`init` と `update` の両方から呼ばれる。ファイル名を `registry-generator.ts` にリネームして役割を明確化する。

## Alternatives Considered

### A: `init-registry` を残して `update-registry` を追加

- 欠点: `init-registry` と `init` の責務が曖昧。`-registry` suffix が冗長

### B: `update` ではなく `sync`

- 欠点: `sync` は双方向同期を連想させる。実際は一方向（scan → registry）の追記操作

## Consequences

### 廃止されるもの

- `init-registry` コマンド（CLI ラッパーのみ。pure ロジックは存続）

### 追加されるもの

- `init` コマンド
- `update` コマンド
- `registry-generator.ts`（`init-registry.ts` からリネーム）

### Migration

- `shiori init-registry -o registry.json` → `shiori init`
- `shiori init-registry --merge existing.json -o registry.json` → `shiori update`
- CI スクリプトで `init-registry` を使用している場合は `update` に置換
