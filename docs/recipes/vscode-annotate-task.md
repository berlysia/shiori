# VS Code Tasks: annotate コマンドのエディタキーバインド統合

エディタ内から `shiori annotate` をキーボードショートカットで呼び出し、LSP 不要で「エディタ内ガバナンス」体験の 80% を実現するレシピ。

## 概要

このレシピは以下を実現します：

1. **VS Code Tasks** で `shiori annotate --target ${file}:${lineNumber}` を定義
2. **キーバインド** でカーソル行に対して即座にアノテーション挿入
3. **Problem Matcher** で `shiori verify --format diagnostic` の結果を Problems パネルに表示
4. **JSON 出力** で annotate 結果をプログラマティックに処理

LSP 拡張なしで、VS Code の標準機能だけでガバナンスワークフローを完結させます。

## ユーザー体験の変化

| Before                                      | After                                                |
| ------------------------------------------- | ---------------------------------------------------- |
| ターミナルでファイルパスと行番号を手入力    | カーソル行で `Ctrl+Shift+A` → ref 入力だけで完了     |
| annotate 後にターミナルで verify を手動実行 | Tasks + Problem Matcher で Problems パネルに自動表示 |
| 違反箇所の特定に CLI 出力を目視で追う       | Problems パネルからワンクリックでジャンプ            |

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み
- レジストリファイルが存在する（`shiori init` 済み）
- VS Code 1.50 以上

## Tasks 定義

`.vscode/tasks.json` に以下のタスクを追加します：

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "shiori: Annotate current line (dry-run)",
      "type": "shell",
      "command": "pnpm shiori annotate --target ${file}:${lineNumber} --ref ${input:ref} --format json",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Annotate current line (apply)",
      "type": "shell",
      "command": "pnpm shiori annotate --target ${file}:${lineNumber} --ref ${input:ref} --apply",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Annotate with reason + expires (apply)",
      "type": "shell",
      "command": "pnpm shiori annotate --target ${file}:${lineNumber} --ref ${input:ref} --reason ${input:reason} --expires ${input:expires} --apply",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Verify (diagnostic)",
      "type": "shell",
      "command": "pnpm shiori verify --format diagnostic",
      "problemMatcher": {
        "owner": "shiori",
        "fileLocation": ["relative", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
          "file": 1,
          "line": 2,
          "column": 3,
          "severity": 4,
          "message": 5,
          "code": 6
        }
      },
      "presentation": {
        "reveal": "silent",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Check (diagnostic)",
      "type": "shell",
      "command": "pnpm shiori check --format diagnostic",
      "problemMatcher": {
        "owner": "shiori",
        "fileLocation": ["relative", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
          "file": 1,
          "line": 2,
          "column": 3,
          "severity": 4,
          "message": 5,
          "code": 6
        }
      },
      "presentation": {
        "reveal": "silent",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Live Dashboard",
      "type": "shell",
      "command": "pnpm shiori watch --dashboard --open",
      "isBackground": true,
      "problemMatcher": []
    }
  ],
  "inputs": [
    {
      "id": "ref",
      "type": "promptString",
      "description": "Tracking reference (e.g. SUP-1234, ADR:0007)",
      "default": ""
    },
    {
      "id": "reason",
      "type": "promptString",
      "description": "Reason for the annotation",
      "default": ""
    },
    {
      "id": "expires",
      "type": "promptString",
      "description": "Expiration date (YYYY-MM-DD or YYYY-MM)",
      "default": ""
    }
  ]
}
```

## キーバインド設定

`keybindings.json`（`Ctrl+Shift+P` → `Preferences: Open Keyboard Shortcuts (JSON)`）に追加：

```json
[
  {
    "key": "ctrl+shift+a",
    "command": "workbench.action.tasks.runTask",
    "args": "shiori: Annotate current line (dry-run)"
  },
  {
    "key": "ctrl+shift+alt+a",
    "command": "workbench.action.tasks.runTask",
    "args": "shiori: Annotate current line (apply)"
  },
  {
    "key": "ctrl+shift+d",
    "command": "workbench.action.tasks.runTask",
    "args": "shiori: Verify (diagnostic)"
  }
]
```

> **macOS**: `ctrl` を `cmd` に読み替えてください。

### キーバインドの意図

| キー               | タスク              | 説明                                      |
| ------------------ | ------------------- | ----------------------------------------- |
| `Ctrl+Shift+A`     | Annotate (dry-run)  | まず JSON プレビューで確認                |
| `Ctrl+Shift+Alt+A` | Annotate (apply)    | 確認後に実際に書き込み                    |
| `Ctrl+Shift+D`     | Verify (diagnostic) | Problems パネルにガバナンス違反を一覧表示 |

## Problem Matcher の仕組み

`shiori verify --format diagnostic` は GCC 互換フォーマットで出力します：

```
src/foo.ts:42:1: error: Annotation expired on 2025-01-15 [expired]
src/bar.ts:10:1: warning: Not found in registry [missing-in-registry]
```

VS Code の `$gcc` Problem Matcher と互換性があるため、Problems パネルに自動的に表示されます。上記の tasks.json ではカスタム正規表現を使用して `[type]` 部分もコードとして取り込みます。

### カスタム Problem Matcher の正規表現

```
^(.+):(\d+):(\d+):\s+(error|warning):\s+(.+)\s+\[(.+)\]$
```

| グループ | フィールド | 例                                 |
| -------- | ---------- | ---------------------------------- |
| 1        | file       | `src/foo.ts`                       |
| 2        | line       | `42`                               |
| 3        | column     | `1`                                |
| 4        | severity   | `error`                            |
| 5        | message    | `Annotation expired on 2025-01-15` |
| 6        | code       | `expired`                          |

## 応用パターン

### annotate → verify のチェインタスク

annotate 実行後に自動で verify を走らせ、Problems パネルを更新します：

```json
{
  "label": "shiori: Annotate + Verify",
  "dependsOrder": "sequence",
  "dependsOn": [
    "shiori: Annotate current line (apply)",
    "shiori: Verify (diagnostic)"
  ]
}
```

キーバインドに割り当てれば、1キーで「アノテーション追加 + 違反確認」が完結します。

### JSON 出力のパイプライン

`--format json` の出力は以下のスキーマです：

```json
{
  "file": "src/app.ts",
  "line": 10,
  "ref": "SUP-1234",
  "action": "insert",
  "lineInserted": true,
  "annotationLine": "// eslint-disable-next-line no-console -- shiori: SUP-1234",
  "registryEntry": {
    "reason": "workaround for issue",
    "expires": "2026-06"
  },
  "warnings": []
}
```

CI パイプラインやカスタムスクリプトから利用する場合に便利です。

### ファイル保存時に自動 verify

VS Code の `runOn` 機能を使って、保存のたびに verify を実行できます。ただし保存のたびにフルスキャンが走るため、大規模プロジェクトでは遅延が生じます。リアルタイムフィードバックが必要な場合は、次の「watch --format diagnostic」を推奨します。

```json
{
  "label": "shiori: Verify on save",
  "type": "shell",
  "command": "pnpm shiori verify --format diagnostic",
  "runOptions": {
    "runOn": "folderOpen"
  },
  "problemMatcher": {
    "owner": "shiori",
    "fileLocation": ["relative", "${workspaceFolder}"],
    "pattern": {
      "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
      "file": 1,
      "line": 2,
      "column": 3,
      "severity": 4,
      "message": 5,
      "code": 6
    }
  },
  "presentation": {
    "reveal": "never"
  }
}
```

### watch --format diagnostic によるリアルタイムフィードバック

`shiori watch --format diagnostic` はファイル変更を検知するたびにスキャン・verify を再実行し、GCC 互換形式で diagnostic 行を stdout に出力します。VS Code のバックグラウンドタスクと組み合わせることで、保存するだけで Problems パネルにガバナンス違反がリアルタイム表示されます。

```json
{
  "label": "shiori: Watch Diagnostic (real-time)",
  "type": "shell",
  "command": "pnpm shiori watch --format diagnostic",
  "isBackground": true,
  "problemMatcher": {
    "owner": "shiori-watch",
    "fileLocation": ["relative", "${workspaceFolder}"],
    "background": {
      "activeOnStart": true,
      "beginsPattern": "^\\[.*\\] refreshed \\(",
      "endsPattern": "^\\[.*\\] refreshed \\("
    },
    "pattern": {
      "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
      "file": 1,
      "line": 2,
      "column": 3,
      "severity": 4,
      "message": 5,
      "code": 6
    }
  },
  "presentation": {
    "reveal": "never",
    "panel": "shared"
  }
}
```

**動作フロー**:

1. タスク起動 → `watch` がファイル監視を開始
2. ファイル保存 → デバウンス（250ms）後にスキャン＋verify 再実行
3. stderr に `[timestamp] refreshed (filename)` を出力（`beginsPattern` がマッチ）
4. stdout に diagnostic 行を出力（`pattern` がマッチ → Problems パネルに反映）
5. 次のリフレッシュで前回の problems がクリアされ、最新の結果に更新

**`runOn` との違い**:

| 項目               | `runOn: folderOpen` | `watch --format diagnostic`        |
| ------------------ | ------------------- | ---------------------------------- |
| トリガー           | 保存イベント        | ファイルシステム変更               |
| 実行方式           | 毎回プロセス起動    | 常駐プロセス                       |
| デバウンス         | なし                | 250ms（設定可能）                  |
| 大規模プロジェクト | 遅延あり            | 差分検知で高速                     |
| dashboard との併用 | 可能                | 排他（`--dashboard` とは同時不可） |

## ガバナンス成熟度モデルでの位置づけ

| Level | 名称            | 仕組み                                  | レシピ                                                   |
| ----- | --------------- | --------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible       | lint disable で違反が隠れている         | ---                                                      |
| 1     | Visible         | PR コメントで差分を通知                 | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced        | PR ステータスチェックでマージをブロック | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured        | ガバナンススコアのバッジ表示            | [Governance Badge](./governance-badge.md)                |
| 4     | Inline          | エディタ内にインライン diagnostics      | [Code Scanning](./code-scanning.md)                      |
| **5** | **Interactive** | **エディタ内からアノテーション操作**    | **このレシピ**                                           |

## トラブルシューティング

### Problems パネルに何も表示されない

- `shiori verify --format diagnostic` をターミナルで直接実行し、出力があることを確認してください
- issues が 0 件の場合は出力が空になります（正常動作）
- Problem Matcher の `fileLocation` が `["relative", "${workspaceFolder}"]` になっているか確認してください

### annotate が `Error: Invalid --target format` で失敗する

- ファイルが保存済みであることを確認してください（未保存ファイルでは `${file}` が空になる場合があります）
- ファイルパスにスペースが含まれる場合は、`"command"` の `${file}` を `"\"${file}\""` に変更してください

### `ref` の入力プロンプトが表示されない

- `tasks.json` の `inputs` セクションに `ref` の定義があることを確認してください
- VS Code を再起動して設定を反映してください

### macOS で `Ctrl+Shift+A` が効かない

macOS では `Cmd+Shift+A` に変更するか、`keybindings.json` で以下のように設定してください：

```json
{
  "key": "cmd+shift+a",
  "command": "workbench.action.tasks.runTask",
  "args": "shiori: Annotate current line (dry-run)"
}
```

---

## 関連

- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [Code Scanning レシピ](./code-scanning.md) --- SARIF × GitHub Code Scanning 統合
- [Local Dashboard レシピ](./local-dashboard.md) --- リアルタイムダッシュボード
- [Checks Gate レシピ](./github-checks-gate.md) --- PR ステータスチェック
