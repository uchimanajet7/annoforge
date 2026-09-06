# ローカル開発セットアップ

本書は、CI と同じ ShellCheck、Terraform の fmt/validate、WebMCP受信処理のJavaScript検査・テストをローカルで実行するためのセットアップを示します。

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
- Node.js: 22.2以上。WebMCPのファイル受信モジュールとそのテストを使う場合だけ必要です。標準モジュールだけを使うため、`npm install` は不要です。CIではNode.js 24を使用します。通常のWeb UIには不要です。

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
node --version  # WebMCPの受信処理・テストを行う場合
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
7. 最終 `get_annotations` の完全なJSON、revision、注釈数を保持する。[受信モジュールの実行例](WEBMCP.md#411-クライアント側の受信と会話への添付) に従い、対応クライアントのNode.js実行環境で公開Site toolsと許可された保存先を渡して、PNG・JSONを取得する。
8. `prepare_annotation_export`、`read_annotation_export`、`release_annotation_export` だけでファイル受信が完結し、自動ダウンロード、画面の保存ボタン、クリップボードを使わないことを確認する。受信モジュールが保存後のバイト数・SHA-256、PNG構造・寸法、JSON構文・注釈数を検証し、両方の絶対パスを返すことを確認する。
9. 実PNGを画像表示機能でデコードし、元画像寸法の注釈付き画像で選択枠などを含まないことを確認する。最終回答に実PNGのMarkdown画像とJSONファイルへのリンクを含め、JSON本文を依頼された場合は完全な内容も表示する。ツール内表示、ファイルパスの文字列、成功の要約だけで合格にしない。
10. 準備後に注釈を編集すると古いexportIdの読取りが拒否され、最新revisionで再準備したPNGとJSONには編集が反映されることを確認する。選択・ズームだけでは無効にならないこと、新しい準備・解放・再読込み後には古いIDを使えないことも確認する。
11. 直接受信できないクライアントでダウンロードを試す場合は、クライアントが提供する許可・待受けを開始してから要求し、保存された実ファイルを検証する。`completionVerified: false` は保存完了の証拠にしない。保存ボタンも同じ要求処理なので、押し直すだけをフォールバックとは扱わない。
12. 終了後、起動したターミナルで `Ctrl+C` を押す。

## 4) CI と同じチェックをローカルで実行

- WebMCPの受信処理。追加パッケージなしで構文検査とNode.js標準テストを実行します。

```bash
node --check web/app.js
node --check scripts/tools/web/receive-annotation-export.mjs
node --test tests/webmcp-export.test.mjs
```

テストは小さいPNG・JSON、分割取得が必要な13 MiBのPNG、破損・版不一致・不正入力・上書き防止・後処理を検証します。テスト用ファイルは実行環境の一時領域に一意なディレクトリを作り、終了後にそのテストが作成したディレクトリだけを削除します。一時領域を明示する場合は、`ANNOFORGE_TEST_TMP_DIR` に許可されたディレクトリの絶対パスを指定します。モックを使う受信単体テストであり、実ブラウザーのWebMCP接続と最終回答への画像表示は3.5の経路で別途確認します。

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
  && bash scripts/tools/fmt_terraform.sh --validate \
  && node --check web/app.js \
  && node --check scripts/tools/web/receive-annotation-export.mjs \
  && node --test tests/webmcp-export.test.mjs
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
- WebMCP受信処理のCIジョブは、Node.js 24で構文検査と単体テストを行います。権限は `contents: read`、パッケージのインストール・キャッシュは不要です。
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
