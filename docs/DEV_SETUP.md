# ローカル開発セットアップ（macOS / Apple Silicon）

本書は、CI と同じチェック（ShellCheck, Terraform fmt/validate）をローカルで再現し、環境差や部分最適を排除するための最短セットアップを示します（SSOT）。

## 対象
- macOS 13+（arm64）想定。Homebrew 利用。Docker は不要（任意）。

## 1) Homebrew の確認
```
brew --version || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

## 2) 必須ツールのインストール
- ShellCheck（Shell/Bash の静的検査）
```
brew install shellcheck
```
- Terraform（フォーマット/検証）
```
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```
- 任意（デプロイや補助で利用）
```
brew install awscli jq
```

### 必要バージョンの目安
- ShellCheck: 0.9.0 以上（Homebrew stable 推奨）
- Terraform: 1.5.x–1.7.x（本リポは 1.5+ を前提）
- AWS CLI: v2（任意; デプロイで利用）
- Python: 3.13（任意; Pillow Layer のローカル生成で利用）
- jq: 1.6（任意; スモーク時のJSON整形で利用）

### 一括セットアップ（任意）
```
brew update
brew tap hashicorp/tap
brew install shellcheck hashicorp/tap/terraform awscli jq || true
brew upgrade shellcheck hashicorp/tap/terraform awscli jq || true
```

## 2.5) PATH の設定確認（Homebrew / Apple Silicon）
```
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
echo $PATH | sed 's/:/\n/g' | nl | sed -n '1,50p'
```
先頭付近に `/opt/homebrew/bin` が含まれていることを確認してください。

## 3) バージョン確認
```
shellcheck --version
terraform -version
aws --version   # 任意
```

### zsh をお使いの方へ
- 本リポのツールは bash 前提です。zsh が既定の環境でも、実行時は `bash` を明示して実行してください。
```
bash scripts/tools/lint_shell.sh --strict
bash scripts/tools/fmt_terraform.sh --check
```

## 4) CI と同じチェックをローカルで実行
- Shell/Bash（警告もエラー扱い = CI と同条件）
```
bash scripts/tools/lint_shell.sh --strict
```
- Terraform（整形の確認と検証）
```
# 未整形なら diff を表示（CI の fmt -check に一致）
bash scripts/tools/fmt_terraform.sh --check

# init(-backend=false) → validate（CI と一致）
bash scripts/tools/fmt_terraform.sh --validate
```
- 整形の自動適用（必要時のみ）
```
bash scripts/tools/fmt_terraform.sh --write
```

### 一括検証（CI 相当）
```
bash scripts/tools/lint_shell.sh --strict \
  && bash scripts/tools/fmt_terraform.sh --check \
  && bash scripts/tools/fmt_terraform.sh --validate
```

## 5) よくあるつまずき（Troubleshooting）
- 「shellcheck not found」
  - 対処: `brew install shellcheck`。再実行で解消。
- 「mapfile: command not found」（macOS 標準 Bash 3.2）
  - 対処: 本リポのスクリプトは Bash 3.2 互換化済み。`bash scripts/...` で実行。
- Terraform validate で色が出ない（`-no-color`）
  - 仕様: CI ログの機械可読性/環境差の排除のため、Terraform は無色を既定にしています。Why は `docs/SPEC.md` の「CI ポリシー（出力/カラー方針）」参照。
- init/validate で認証が必要？
  - 本セットアップの validate は `-backend=false` のため AWS 認証不要。デプロイは `docs/GETTING_STARTED.md` を参照。

- Terraform が provider/plugin を取得できない
  - 対処: ネットワーク/プロキシ設定をご確認ください。必要に応じて `rm -rf infra/terraform/.terraform` の後に `bash scripts/tools/fmt_terraform.sh --validate` を再実行。
- fmt で差分が出続ける
  - 対処: `--write` で整形適用 → 直後に `--check` が成功することを確認してください。
- Homebrew のコマンドが見つからない（Apple Silicon）
  - 対処: 上記「PATH の設定確認」の手順で `/opt/homebrew/bin` を PATH に追加してください。

## 6) 参考（Why / 方針）
- ローカル/CI 共通スクリプト（SSOT）: `scripts/tools/`
  - `lint_shell.sh`（ShellCheck）、`fmt_terraform.sh`（fmt/validate）
- CI はこれらを呼ぶだけ（push 時のみ `terraform fmt` を自動適用 → bot コミット）。
- 出力/カラー方針（CI は無色、UI 側で色付け）は `docs/SPEC.md` に明記。
- 方針決定の記録: `docs/_local_/ADR-0001-ci-ssot.md`

## 6.5) GitHub Pages（Actions）初回有効化と権限（重要）
- 症状: `actions/configure-pages@v5` の `with: enablement: true` が 403（Resource not accessible by integration）で失敗する。
- 原因: 未有効のリポで「Pages サイトの新規作成」を GITHUB_TOKEN で行うと権限不足となるため（管理系API）。
- 対処（推奨・一度だけ）
  1) GitHub → Settings → Pages → Build and deployment → Source: 「GitHub Actions」を選択 → Save
  2) 以後は `configure-pages@v5 → upload-pages-artifact@v3 → deploy-pages@v4` でデプロイ可能
  3) 既に有効化済みなら、`with: enablement: true` は不要（削除推奨）
- 権限（最小）
  - ワークフロー/ジョブに `permissions: { contents: read, pages: write, id-token: write }`
  - pull_request（フォーク）では GITHUB_TOKEN は既定で read-only → デプロイは push: main 等で実行
- 参考
  - Using custom workflows with GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
  - REST: Create a GitHub Pages site: https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site

## 7) 次のステップ
- デプロイ/スモークは `docs/GETTING_STARTED.md` の手順へ。

## 8) アンインストール/クリーンアップ（任意）
- Homebrew パッケージ削除
```
brew uninstall shellcheck terraform awscli jq
```
- Terraform の作業ディレクトリ（ローカル検証の残骸）をクリーン
```
rm -rf infra/terraform/.terraform
```
