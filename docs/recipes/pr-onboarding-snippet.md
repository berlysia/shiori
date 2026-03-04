# PR Comment Onboarding Snippet

PRコメントの末尾に追加するオンボーディングセクションのテンプレート。
shiori を知らない開発者が PR レビュー中にツールの概要を理解し、導入まで完結できる。

## 使い方

GitHub Actions ワークフローで `shiori delta --format markdown` の出力ファイルに
このスニペットを `cat >> ` で append してから PR コメントに投稿する。

````yaml
- name: Append onboarding section
  run: |
    cat >> .tmp/shiori-delta.md << 'ONBOARDING'

    ---

    <details>
    <summary>💡 shiori について</summary>

    **shiori** はソースコード中の lint disable コメントや技術的判断を追跡・管理するガバナンスツールです。

    このコメントは `shiori delta` によって自動投稿されています。

    ### クイックスタート

    ```bash
    # インストール
    pnpm add -D shiori

    # プロジェクト初期化（レジストリ + CI テンプレート生成）
    pnpm shiori init

    # lint disable の候補を検出して追跡開始
    pnpm shiori candidates
    pnpm shiori adopt

    # レジストリとの整合性を検証
    pnpm shiori check
    ```

    📖 詳細: `pnpm shiori docs` または [README](https://github.com/user/shiori#readme)

    </details>
    ONBOARDING
````

## カスタマイズ

### リポジトリURLを変更する

`[README](https://github.com/user/shiori#readme)` をプロジェクトの実際のURLに置き換えてください。

### スニペットを無効化する

ワークフローからこのステップを削除するか、条件付きで実行してください：

```yaml
- name: Append onboarding section
  if: ${{ env.SHIORI_ONBOARDING != 'false' }}
  run: |
    cat >> .tmp/shiori-delta.md << 'ONBOARDING'
    ...
    ONBOARDING
```

## 関連

- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md)
- [Delta PR Description レシピ](./github-actions-delta-pr-description.md)
