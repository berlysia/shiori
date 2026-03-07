---
status: Draft
deps:
  - 3
  - 7
  - 12
  - 18
---

# ADR 023: Annotation Chronicle — Provenance × RefStatus × Registry 時系列統合

## Context

### 動機

shiori はアノテーションの「現在の状態」（存在・検証結果・健全性スコア）を報告できるが、「いつ・誰が・なぜ導入し、その後どうなったか」という時系列的な文脈を提供していない。

EP-0046 (Provenance View) と RefStatus 基盤が揃った今、これらを統合して各アノテーションのライフサイクルを時系列で可視化する「Annotation Chronicle」機能を導入する。

### 利用可能なデータソース

1. **Provenance (EP-0046)**: git blame による導入日時・著者・コミット情報
2. **Registry**: 有効期限 (`expires`)、所有者 (`owner`)、種別 (`kind`)
3. **RefStatus (ADR 018)**: 外部コマンドによるチケット状態 (open/closed/unknown)
4. **Annotation source**: 有効期限 (`expires`) フィールド

### 制約

- RefStatus プロトコル (ADR 018) は「現在の状態」のみを返す。過去の状態遷移履歴は取得できない
- Registry に `created_at` / `updated_at` フィールドは存在しない
- 完全な時系列ライフサイクル再構成には限界がある

## Decision

### データモデル: ChronicleEntry + ChronicleEvent の二層構造

```typescript
type ChronicleEventType =
  | 'introduced'
  | 'expires'
  | 'expired'
  | 'status-closed';

interface ChronicleEvent {
  type: ChronicleEventType;
  date: string; // ISO 8601 (YYYY-MM-DD)
  label: string; // 人間可読な説明
}

interface ChronicleEntry {
  ref: string;
  locations: Array<{ file: string; line: number }>;
  events: ChronicleEvent[]; // 日付順ソート
  currentStatus?: RefStatusValue; // 外部ステータス
  owner?: string; // レジストリ所有者
  kind?: string; // レジストリ種別
}
```

### 純粋関数設計

`src/core/chronicle.ts` に `buildChronicle()` を配置。I/O なしの純粋関数として設計し、全ての入力をパラメータで受け取る。

### 4段階の縮退動作

| Level       | 利用可能データ                    | 出力                               |
| ----------- | --------------------------------- | ---------------------------------- |
| 1 (Full)    | Provenance + Registry + RefStatus | 完全なタイムライン                 |
| 2           | Provenance + Registry             | タイムライン（外部ステータスなし） |
| 3           | Registry のみ                     | expires/expired イベントのみ       |
| 4 (Minimal) | Annotations のみ                  | 位置インベントリ（イベントなし）   |

### CLI 統合

- `shiori report -f html --timeline`: タイムラインセクションを HTML レポートに追加
- `--timeline` は `--provenance` を暗黙的に含む
- `--ref-status-command` と組み合わせて外部ステータスも統合可能

### HTML レンダリング

既存の HTML formatter (`report-html-formatter.ts`) に `renderChronicleSection()` を追加。ref ごとのカードにタイムラインを表示。イベントタイプ別の色分け（introduced: 緑、expires: 青、expired: 赤、status-closed: オレンジ）。

## Consequences

### 利点

- 既存の Provenance + RefStatus 基盤を自然に統合
- Pure function パターン遵守で高いテスタビリティ
- HTML formatter の既存拡張パターン (delta overlay, provenance section) に準拠
- 段階的縮退で ref-status-command なしでも価値を提供

### 欠点・制約

- RefStatus に履歴がないため「ステータス変遷」は表現できない（現在のスナップショットのみ）
- Registry に作成日時がないため、レジストリ登録日のイベントは生成できない
- `--timeline` フラグ時に provenance enrichment が必須（git リポジトリ外では degraded）

### 将来の拡張

- RefStatus プロトコルに履歴対応を追加（別 EP として分離）
- Registry に `created_at` / `updated_at` フィールドを追加
- JSON 出力フォーマットでの Chronicle データ提供
