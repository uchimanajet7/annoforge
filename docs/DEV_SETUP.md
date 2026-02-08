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
- Python: 3.13。任意です。Pillow Layer のローカル生成で使います。
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
- 出力とカラー方針は `docs/SPEC.md` に明記しています。CI は無色で、UI 側で色付けします。
- 方針: CI 相当チェックは `docs/SPEC.md` の CI ポリシーに従います。

## 6.5) GitHub Pages と GitHub Actions。初回有効化と権限。重要
- 症状: GitHub Pages のデプロイが失敗する／公開されない。例: 403 Resource not accessible by integration。
- 原因: 初回の Pages 設定の Source は GitHub Actions です。未設定、または実行コンテキストの権限が不足している。
- 対処: 推奨です。一度だけ対応してください。
  1) GitHub → Settings → Pages → Build and deployment → Source: 「GitHub Actions」を選択 → Save
  2) 以後は `configure-pages@v5 → upload-pages-artifact@v3 → deploy-pages@v4` でデプロイ可能
- 権限: 最小
  - ワークフロー/ジョブに `permissions: { contents: read, pages: write, id-token: write }`
  - pull_request はフォークでは GITHUB_TOKEN が既定で read-only のため、デプロイは push: main 等で実行します。
- 参考
  - Using custom workflows with GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
  - REST: Create a GitHub Pages site: https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site

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
