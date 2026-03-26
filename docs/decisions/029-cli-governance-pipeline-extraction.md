---
status: Superseded
source_role: architect
deps: []
superseded_by: '031-governance-pipelinets-core-commands'
---

# ADR-029: CLI Governance Pipeline Extraction

## Status

Superseded by [ADR-031](031-governance-pipelinets-core-commands.md) — governance-pipeline.ts は core/ ではなく commands/ 層に配置。

## Context

pitch-cli.ts, health-cli.ts の scan → registry → report オーケストレーションが約 30 行の重複コードとして存在する。EP-0187（onboard 自己完結化）の実装で 3 箇所目の重複が発生する。各コマンドの CLI ラッパーが createBaseContext → withRegistry → resolveScanPatterns → scan → report の同一パイプラインを個別にインラインで実行しており、パラメータ解決ロジックの不整合リスクがある。

## Decision

共通オーケストレーションを core/governance-pipeline.ts に抽出し、GovernancePipelineOptions → GovernancePipelineResult の単一関数として提供する。pitch-cli, health-cli, onboard-cli（新規）はこのパイプラインを呼び出す。各コマンド固有の後続処理（trend 計算、triage、fix 等）は CLI ラッパー側に残す。scan → report の核となるパイプラインのみを共有する。

## Consequences

pitch-cli / health-cli のリファクタリングが必要だが、変更は機械的な抽出であり、既存テストで検証可能。パイプライン関数への scan / report の結合が生じるが、これは既に事実上の結合であり、明示化するメリットの方が大きい。onboard 自己完結化（EP-0187）の実装コストが大幅に削減される。
