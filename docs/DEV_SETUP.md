# ローカル開発セットアップ

本書は、CI と同じチェックである ShellCheck と Terraform の fmt/validate をローカルで再現し、環境差や部分最適を排除するための最短セットアップを示します。

本書のコマンド例は、原則としてリポジトリルートでの実行を前提とします。

## 対象
- 本書は macOS + Homebrew を前提としたローカル開発セットアップです。Docker は必須ではありません。

## 1) Homebrew の確認
```
brew --version
```

## 2) 必須ツールのインストール
- ShellCheck。Shell/Bash の静的検査です。
```
brew install shellcheck
```
- Terraform。フォーマットと検証で使います。
```
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```
- 任意です。以降の確認例に含むため、必要ならインストールしてください。
```
brew install awscli jq
```

### 必要バージョンの目安
- ShellCheck: 0.9.0 以上。Homebrew stable を推奨します。
- Terraform: 1.5.x–1.7.x。本リポは 1.5+ を前提とします。
- AWS CLI: v2。任意です。デプロイで使います。
- Python: 3.13。Pillow Layer のローカル生成で使います。該当作業を行わない場合は任意です。
- jq: 1.6。任意です。スモーク時の JSON 整形で使います。

### 任意: 一括セットアップ
```
brew update
brew tap hashicorp/tap
brew install shellcheck hashicorp/tap/terraform awscli jq || true
brew upgrade shellcheck hashicorp/tap/terraform awscli jq || true
```

## 2.5) Homebrew の設定。公式手順です。
Homebrew のインストールとシェル設定は公式手順を参照してください。
- https://brew.sh/

確認:
- `brew --version` が実行できること。できない場合は上記の公式手順に従ってシェル設定を完了してください。

## 3) バージョン確認
```
shellcheck --version
terraform -version
aws --version   # 任意
```
```
bash scripts/tools/check_updates.sh   # 任意: 最新差分を確認
```

### zsh をお使いの方へ
- 本リポのツールは bash 前提です。zsh が既定の環境でも、実行時は `bash` を明示して実行してください。
```
bash scripts/tools/lint_shell.sh --strict
bash scripts/tools/fmt_terraform.sh --check
```

## 3.5) WebMCPのローカル静的サーバー

未公開のローカル版をWebMCP対応ブラウザーで使うときだけ使用します。通常の人向けローカル利用では、従来どおり `web/index.html` を直接開けます。

```
bash scripts/tools/web/start-local-web.sh
```

- URL: `http://127.0.0.1:8000/`
- 待受け: `127.0.0.1` のみ
- 終了: 起動したターミナルで `Ctrl+C`。起動スクリプトがSWSへシグナルを転送し、終了を待ちます。
- ポート: 既定は8000。変更する場合だけ `SWS_PORT=8001 bash scripts/tools/web/start-local-web.sh` とします。
- 配信範囲: `web/` の静的ファイルだけです。ディレクトリ一覧、シンボリックリンク追跡、アップロード・書込みAPIはありません。
- 実装: 起動時に GitHub Releases API で最新安定版を確認します。初回、または承認した更新時に対象OS/CPUの公式配布物を取得し、Release assetのSHA-256 digestと版番号の検証成功後だけ `tools/web/static-web-server` へ配置します。
- 作業領域: 取得・展開・キャッシュはリポジトリ内の無視対象 `tools/web/` だけを使います。OS一時領域は使いません。
- 更新: 配置済み版と最新安定版が異なる対話起動では、置換確認の既定値はYesです。非対話起動では明示指定なしに置換しません。
- ポート競合: LISTENプロセスを表示し、停止確認の既定値はNoです。承認時はSIGTERM後に最大5秒待ち、残存時だけSIGKILLを別確認します。
- 用途: WebMCPページを通常のHTTPオリジンで扱うための開発補助です。MCPサーバーや製品バックエンドではありません。

補助指定は通常利用では不要です。自動実行や版を明示する場合だけ使用します。

- `SWS_VERSION=<version|vversion|latest>`: 指定版を確認なしで取得または再利用します。配置済みの指定版はネットワーク確認なしで再利用できます。
- `SWS_AUTO_UPDATE=1` または `SWS_ASSUME_YES=1`: 非対話環境を含め、更新確認を省略します。
- `SWS_ASSUME_NO=1`: 更新候補があっても配置済み版を利用します。
- `SWS_FORCE_KILL=1`: SIGTERMで終了しないプロセスに対するSIGKILL確認を省略します。ポート競合時の最初の停止確認は省略しません。

通常経路:

1. `http://127.0.0.1:8000/` を対応内蔵ブラウザーで開く。
2. `get_annotations` で初期revisionを取得する。
3. `open_image_from_data_url` または `open_image_from_url` で画像を開く。
4. `get_image_preview`、`replace_annotations`、`get_annotations` で対象、反映内容、見た目を確認する。プレビューは元画像の縦横比を保ち、指定最大辺以内で、表示のパン・ズーム・選択表示に依存しないことを確認する。
5. 同じ位置に重なる形状を2件以上用意し、一覧から1件だけを選択してパレットまたはカラーピッカーを操作する。`get_annotations` で対象1件の `color` だけが変わりrevisionが1増えること、一覧・キャンバス・プレビューが同じ色になることを確認する。同じ色の再選択ではrevisionが増えないことも確認する。
6. 選択操作だけでは次回作図色が変わらず、選択中に実際に選んだ色は、選択解除後に新規作成する形状へ引き継がれることを確認する。
7. 最終 `get_annotations` の完全なJSON、revision、アノテーション数を保持し、最終応答にJSONコードブロックとして表示できることを確認する。ファイル成果物も必要な試験だけ `start_annotations_json_download` を実行する。
8. `export_annotated_image` で完成PNGを生成する。対象クライアントで `data_url` が実画像として会話へ表示されることを同じ実行面で確認済みの場合だけ、その経路を完全経路に使用できる。現在確認済みのCodexデスクトップ経路では `delivery: "download"` を使用し、返されたファイル名、MIME type、バイト数、revision、アノテーション数、幅、高さを記録する。
9. `delivery: "download"` の場合、`outcome: "download_requested"`、`requestDispatched: true`、`completionVerified: false` は要求送信までの証拠として扱う。ブラウザーのダウンロード一覧で完了を確認し、必要な利用者承認を経たクライアントの通常のファイル機能で、その呼び出しが作成した実ファイルだけを読み取る。PNGシグネチャ、非ゼロのファイル長、幅、高さを検証し、スクリーンショットやキャンバス表示を代替成果物にしない。
10. 同じ最終応答に、手順7の完全なJSONと、手順9で検証した実PNGを表示または添付する。ツール呼び出し結果、ブラウザー上の画像、ダウンロード一覧、ファイルパス、要約文だけでは合格にしない。実PNGが応答内で利用者に見えない場合は未完了であり、「添付済み」と報告しない。
11. `data_url` のクライアント対応を別途調べる場合は、実画像として表示されたかを受入条件にする。長いJSON文字列が切り詰められた場合、WebMCPによるPNG生成失敗とは分類せず、当該クライアントの提示経路未対応として記録する。出力上限の増加、同じData URLの再試行、仕様化されていない画像コンテンツ形式の追加では回避しない。
12. Site toolsを先に試したうえで、必要なツールが利用できない、処理がエラーになる、または結果後の保存実ファイル・会話提示を確認できない場合は、利用者の依頼とクライアントの通常権限に従って既存UIやファイル機能へ切り替える。同じ失敗操作を無条件に反復せず、切替後も保存実ファイルの検証と会話への実画像表示まで同じ受入条件を適用する。ツール結果を操作許可として扱わず、AnnoForgeが自動フォールバックするものとも、切替後の操作をWebMCPとも扱わない。
13. 終了後、起動したターミナルで `Ctrl+C` を押す。

## 4) CI と同じチェックをローカルで実行
- Shell/Bash。警告もエラー扱いです。CI と同条件です。
```
bash scripts/tools/lint_shell.sh --strict
```
- Terraform。整形の確認と検証です。
```
# 未整形なら diff を表示します。CI の fmt -check と一致します。
bash scripts/tools/fmt_terraform.sh --check

# init は -backend=false で実行し、その後 validate を実行します。CI と一致します。
bash scripts/tools/fmt_terraform.sh --validate
```
- 整形の自動適用。必要時のみ実行します。
```
bash scripts/tools/fmt_terraform.sh --write
```

### 一括検証。CI 相当です。
```
bash scripts/tools/lint_shell.sh --strict \
  && bash scripts/tools/fmt_terraform.sh --check \
  && bash scripts/tools/fmt_terraform.sh --validate
```

## 5) よくあるつまずき
- 「shellcheck not found」
  - 対処: `brew install shellcheck`。再実行で解消。
- 「mapfile: command not found」。macOS 標準 Bash 3.2 の場合です。
  - 対処: 本リポのスクリプトは Bash 3.2 互換化済み。`bash scripts/...` で実行。
- Terraform validate で色が出ない。`-no-color` のためです。
  - 仕様: CI ログの機械可読性/環境差の排除のため、Terraform validate は無色です。`-no-color` を既定にしています。
- init/validate で認証が必要？
- 本セットアップの validate は `-backend=false` のため AWS 認証は行わない。デプロイは `docs/GETTING_STARTED.md` を参照。

- Terraform が provider/plugin を取得できない
  - 対処: ネットワーク/プロキシ設定をご確認ください。必要に応じて `rm -rf infra/terraform/.terraform` の後に `bash scripts/tools/fmt_terraform.sh --validate` を再実行。
- fmt で差分が出続ける
  - 対処: `--write` で整形適用 → 直後に `--check` が成功することを確認してください。
- Homebrew のコマンドが見つからない
  - 対処: Homebrew の公式手順 https://brew.sh/ に従ってセットアップを完了してください。

## 6) 参考。理由と方針
- ローカル/CI 共通スクリプト: `scripts/tools/`
  - `lint_shell.sh` は ShellCheck、`fmt_terraform.sh` は Terraform の整形と検証です。
- CI はこれらを呼ぶだけです。push のときだけ `terraform fmt` を自動適用し、bot がコミットします。
- Terraform は GitHub Actions では `hashicorp/setup-terraform@v4` を使用して固定版を導入します。
- 出力とカラー方針は `docs/SPEC.md` に明記しています。CI は無色で、UI 側で色付けします。
- 方針: CI 相当チェックは `docs/SPEC.md` の CI ポリシーに従います。
- GitHub Actions の action 更新確認は `.github/dependabot.yml` の weekly 設定で行います。

## 6.5) GitHub Pages。初回有効化と権限。重要
- 本リポジトリの GitHub Pages は GitHub 公式の custom workflow で公開します。
- 初回のみ、GitHub で以下を設定してください。
  1) GitHub → Settings → Pages → Build and deployment → Source: 「GitHub Actions」を選択
  2) Save
- 権限: `pages.yml` は `permissions: { contents: read, pages: write, id-token: write }` を使用します。
- 実装方針:
  - GitHub 公式の custom workflow を使用します。
  - `actions/configure-pages@v5`、`actions/upload-pages-artifact@v4`、`actions/deploy-pages@v4` で公開します。
  - publish 用の追加 secret は不要です。
- pull_request では公開しません。`push: main` または `workflow_dispatch` で反映します。

## 6.6) Dependabot。GitHub Actions 更新監視
- `.github/dependabot.yml` で `package-ecosystem: "github-actions"` を weekly 実行します。
- 対象は `.github/workflows/` 配下の action 参照です。
- 新しい action version が公開されると、Dependabot が更新 pull request を作成します。

## 7) 次のステップ
- デプロイ/スモークは `docs/GETTING_STARTED.md` の手順へ。

## 8) 任意: アンインストール/クリーンアップ
- Homebrew パッケージ削除
```
brew uninstall shellcheck terraform awscli jq
```
- Terraform の作業ディレクトリをクリーンします。
```
rm -rf infra/terraform/.terraform
```
