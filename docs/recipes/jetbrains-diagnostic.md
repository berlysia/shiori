# JetBrains IDE: External Tool による diagnostic 統合

`shiori verify --format diagnostic` の GCC 互換出力を JetBrains IDE（IntelliJ IDEA, WebStorm, PhpStorm 等）の External Tool + Output Filter で統合し、実行結果からファイルへ直接ジャンプできるようにするレシピ。

## 概要

このレシピは以下を実現します：

1. **External Tool** で `shiori verify --format diagnostic` を IDE から実行
2. **Output Filter** で diagnostic 出力をパースし、Run ウィンドウ内のリンクからファイルジャンプ
3. **キーボードショートカット** で任意のタイミングで実行

新規コードは不要。既存の `--format diagnostic` 出力をそのまま利用します。

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトにインストール済み
- レジストリファイルが存在する（`shiori init` 済み）
- IntelliJ IDEA / WebStorm / PhpStorm / その他 JetBrains IDE

## diagnostic 出力フォーマット

`shiori verify --format diagnostic` は GCC 互換の 1 行 1 issue フォーマットを出力します：

```
file:line:column: severity: message [type]
```

出力例：

```
src/foo.ts:42:1: error: Annotation expired on 2025-01-15 [expired]
src/bar.ts:10:1: warning: Not found in registry [missing-in-registry]
```

## External Tool 設定

### 手順

1. **Settings** → **Tools** → **External Tools** を開く
2. **+** ボタンで新規ツールを追加
3. 以下の設定を入力：

| 項目                  | 値                                  |
| --------------------- | ----------------------------------- |
| **Name**              | `shiori verify`                     |
| **Group**             | `shiori`                            |
| **Program**           | `npx`                               |
| **Arguments**         | `shiori verify --format diagnostic` |
| **Working directory** | `$ProjectFileDir$`                  |

pnpm を使用している場合：

| 項目          | 値                                  |
| ------------- | ----------------------------------- |
| **Program**   | `pnpm`                              |
| **Arguments** | `shiori verify --format diagnostic` |

### Output Filter 設定

同じダイアログの **Output Filters** ボタンをクリックし、以下を追加します：

| 項目                   | 値                                   |
| ---------------------- | ------------------------------------ | -------------- |
| **Name**               | `shiori diagnostic`                  |
| **Regular expression** | `$FILE_PATH$:$LINE$:$COLUMN$: (error | warning): .\*` |

この設定により、Run ウィンドウに表示される各 diagnostic 行がクリック可能なリンクになり、該当ファイルの行にジャンプできます。

### shiori check ツールの追加

`verify` に加えて `check`（scan + verify の統合コマンド）を External Tool として追加する場合：

| 項目                  | 値                                 |
| --------------------- | ---------------------------------- |
| **Name**              | `shiori check`                     |
| **Group**             | `shiori`                           |
| **Program**           | `npx`                              |
| **Arguments**         | `shiori check --format diagnostic` |
| **Working directory** | `$ProjectFileDir$`                 |

Output Filter は `shiori verify` と同じ設定を使います。

## 使い方

### メニューから実行

**Tools** → **shiori** → **shiori verify** を選択します。

Run ウィンドウに diagnostic 出力が表示され、各行をクリックするとファイルの該当行にジャンプします。

### キーボードショートカットの割り当て

1. **Settings** → **Keymap** を開く
2. 検索ボックスに `shiori verify` と入力
3. **External Tools** → **shiori** → **shiori verify** を右クリック
4. **Add Keyboard Shortcut** を選択
5. 任意のキーコンビネーションを設定（例: `Ctrl+Shift+V`）

### 右クリックメニュー

External Tool はファイルやディレクトリの右クリックメニューからも実行できます。

## XML 設定ファイル（手動インポート）

External Tool の設定は XML ファイルとしてエクスポート/インポートが可能です。以下の内容を `<IDE設定ディレクトリ>/tools/shiori.xml` に配置します：

```xml
<toolSet name="shiori">
  <tool
    name="shiori verify"
    showInMainMenu="true"
    showInEditor="true"
    showInProject="true"
    showInSearchPopup="true"
    disabled="false"
    useConsole="true"
    showConsoleOnStdOut="true"
    showConsoleOnStdErr="true"
    synchronizeAfterRun="false">
    <exec>
      <option name="COMMAND" value="npx" />
      <option name="PARAMETERS" value="shiori verify --format diagnostic" />
      <option name="WORKING_DIRECTORY" value="$ProjectFileDir$" />
    </exec>
    <filter>
      <option
        name="NAME"
        value="shiori diagnostic" />
      <option
        name="DESCRIPTION"
        value="" />
      <option
        name="REGEXP"
        value="$FILE_PATH$:$LINE$:$COLUMN$: (error|warning): .*" />
    </filter>
  </tool>
  <tool
    name="shiori check"
    showInMainMenu="true"
    showInEditor="true"
    showInProject="true"
    showInSearchPopup="true"
    disabled="false"
    useConsole="true"
    showConsoleOnStdOut="true"
    showConsoleOnStdErr="true"
    synchronizeAfterRun="false">
    <exec>
      <option name="COMMAND" value="npx" />
      <option name="PARAMETERS" value="shiori check --format diagnostic" />
      <option name="WORKING_DIRECTORY" value="$ProjectFileDir$" />
    </exec>
    <filter>
      <option
        name="NAME"
        value="shiori diagnostic" />
      <option
        name="DESCRIPTION"
        value="" />
      <option
        name="REGEXP"
        value="$FILE_PATH$:$LINE$:$COLUMN$: (error|warning): .*" />
    </filter>
  </tool>
</toolSet>
```

IDE 設定ディレクトリの場所：

| OS      | パス                                                            |
| ------- | --------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/JetBrains/<IDE><version>/tools/` |
| Linux   | `~/.config/JetBrains/<IDE><version>/tools/`                     |
| Windows | `%APPDATA%\JetBrains\<IDE><version>\tools\`                     |

## File Watcher 統合（オプション）

ファイル保存時に自動で `shiori verify` を実行したい場合、File Watcher を使います。

1. **Settings** → **Tools** → **File Watchers** を開く
2. **+** → **Custom** を選択
3. 以下の設定を入力：

| 項目                        | 値                                  |
| --------------------------- | ----------------------------------- |
| **Name**                    | `shiori verify on save`             |
| **File type**               | `Any`                               |
| **Scope**                   | `Project Files`                     |
| **Program**                 | `npx`                               |
| **Arguments**               | `shiori verify --format diagnostic` |
| **Working directory**       | `$ProjectFileDir$`                  |
| **Output paths to refresh** | （空）                              |
| **Auto-save edited files**  | Off（無限ループ防止）               |

**注意**: File Watcher はファイル保存のたびに実行されるため、大規模プロジェクトではパフォーマンスに影響する場合があります。`shiori watch --format diagnostic` の利用も検討してください。

## トラブルシューティング

### "npx: command not found" エラー

JetBrains IDE が Node.js のパスを認識していない場合があります。

**対処法**:

1. **Settings** → **Languages & Frameworks** → **Node.js** で Node.js インタープリタのパスを確認
2. External Tool の **Program** にフルパスを指定（例: `/usr/local/bin/npx`）

### Output Filter でリンクが生成されない

正規表現が正しく設定されているか確認します。JetBrains の Output Filter では `$FILE_PATH$`, `$LINE$`, `$COLUMN$` がマクロとして解釈されます。

手動で出力を確認する場合：

```bash
npx shiori verify --format diagnostic
```

出力がない場合は verify issues が 0 件です（正常）。

### `<unknown>:0:1` のエントリ

ファイルパスや行番号が特定できないアノテーション（レジストリにのみ存在する等）は `<unknown>:0:1` として出力されます。これは仕様です。JetBrains IDE はこの行のリンクを生成できませんが、メッセージ内容は表示されます。

## 関連

- [VS Code Tasks レシピ](./vscode-annotate-task.md) — VS Code での同等の統合
- [Neovim diagnostic レシピ](./neovim-diagnostic.md) — Neovim での同等の統合
- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md) — 構造化出力の設計方針
