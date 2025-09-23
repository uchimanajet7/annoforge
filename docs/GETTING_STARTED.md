# はじめに（Getting Started）

最短 2–3 ステップで UI 試用と API デプロイを開始できます。詳細は `docs/DEPLOY.md` を参照してください。

## 前提（準備物）
- macOS / Linux 環境（WSL 含む）
- Terraform 1.5+ / AWS CLI v2 / Python 3.13 + pip
- AWS プロファイルまたは AssumeRole 可能な認証手段

動作確認（例）
```
terraform -version
aws --version
python3 --version
```

## 1) UI をすぐ試す
- オンライン: GitHub Pages で `web/` を公開（初回のみリポジトリ設定で有効化が必要）。公開 URL は README に追記されます。
- ローカル: `web/index.html` をブラウザで開く（機能は同等）。

操作の要点（抜粋）
- 画像を選択/ドラッグ&ドロップで読み込み
- ツール: 選択/矩形/直線/多角形/平行四辺形/円
- JSON は常時更新、コピー/ダウンロード/インポート可
- 「注釈付き画像を保存」で PNG 出力

### 1.1 GitHub Pages（Actions）初回有効化（必須: 一度だけ）
- 背景: GitHub Actions の `configure-pages@v5` は、既に Pages が有効なリポジトリ向けです。未有効の状態で「自動有効化」を GITHUB_TOKEN で行うと、権限仕様上 403（Resource not accessible by integration）になります。
- 手順（UI/設定）
  1) GitHub → 対象リポジトリ → Settings → Pages
  2) Build and deployment → Source: 「GitHub Actions」を選択 → Save
  3) 以後、`actions/configure-pages@v5 → actions/upload-pages-artifact@v3 → actions/deploy-pages@v4` の標準手順で自動公開されます
- Tips（ワークフローの微調整）
  - 既に有効化済みなら、`pages.yml` の `configure-pages` ステップで `with: enablement: true` は不要です（削除推奨）。
  - 最小権限の明記（推奨）:
    - `permissions: { contents: read, pages: write, id-token: write }` を job レベルにも付与
  - フォーク由来の pull_request では GITHUB_TOKEN が read-only となるため、Pages へのデプロイは push: main 等の信頼コンテキストで実施してください。
  - 参考: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## 2) API を最短デプロイ
- 対話（推奨）
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/deploy.sh
```
- 固定プロファイル
```
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh
```
- スモーク（POST→presignedUrl→HEAD 200）
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/smoke.sh
```

## 3) 次の一歩（任意）
- 出力値の確認: `bash scripts/deploy/with_aws.sh -- bash scripts/deploy/tf_outputs.sh`
- 破棄（課金抑制）: `bash scripts/deploy/with_aws.sh -- bash scripts/deploy/destroy.sh --yes`
- 詳細: `docs/DEPLOY.md`, アーキ/仕様: `docs/SPEC.md`, バージョン: `docs/VERSIONS.md`
