# はじめに

UI の試用は GitHub Pages またはローカルで行えます。API デプロイは最短でそれぞれ 1 手順ずつで開始できます。詳細は `docs/DEPLOY.md` を参照してください。

本書のコマンド例は、原則としてリポジトリルートでの実行を前提とします。

## 前提。準備物
- 対象は macOS / Linux のみ。
- Terraform 1.5+ / AWS CLI v2 / Python 3.13 + pip。Python はレイヤー作成に使用します。
- curl / jq / zip。デプロイスクリプトやスモークで使用。
- AWS プロファイル（推奨）または AssumeRole + MFA の認証手段。

動作確認。例
```
terraform -version
aws --version
python3 --version
jq --version
curl --version | head -n1
zip -v | head -n1
```

## 1) UI をすぐ試す
- オンライン: GitHub Pages
  - フォーク/別ownerのリポジトリでは公開URLが変わります。
  - 自分の公開URL: `https://<owner>.github.io/<repo>/`。プロジェクトページです。Settings → Pages に表示されるURLを使用してください。詳細は下記「公開URLの確認方法」も参照してください。
  - 初回のみ、リポジトリ設定で Pages を有効化する必要があります。手順は下記 1.1 を参照してください。
  - 作者運用のデモサイト: https://uchimanajet7.github.io/annoforge/
- ローカル: `web/index.html` をブラウザで開きます。機能は同等です。Konva.js は `https://unpkg.com` から取得するためネットワーク接続が必要です。

操作の要点。抜粋
- 画像を選択/ドラッグ&ドロップで読み込み
- ツール: 選択/矩形/直線/多角形/平行四辺形/円
- JSON は常時更新、コピー/ダウンロード/インポート可
- 「注釈付き画像を保存」で PNG 出力

### 1.1 GitHub Pages と GitHub Actions。初回有効化。必須です。一度だけ
- 背景: GitHub Pages は初回のみ、リポジトリ設定で Source を「GitHub Actions」に指定する必要があります。本リポの workflow は自動有効化は行いません。
- 手順。UI/設定
  1) GitHub → 対象リポジトリ → Settings → Pages
  2) Build and deployment → Source: 「GitHub Actions」を選択 → Save
  3) 以後、`actions/configure-pages@v5 → actions/upload-pages-artifact@v3 → actions/deploy-pages@v4` の標準手順で自動公開されます
- Tips。ワークフローの微調整
  - 最小権限の明記: `permissions: { contents: read, pages: write, id-token: write }`。本リポは設定済みです。
  - フォーク由来の pull_request では GITHUB_TOKEN が read-only となるため、Pages へのデプロイは push: main 等の信頼コンテキストで実施してください。
  - 参考: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

#### 公開URLの確認方法。他の手段
- リポジトリ Settings → Pages に表示される URL
- Actions → Pages ワークフロー → Deploy ステップの出力。`page_url`
- リポジトリの Environments → `github-pages` → View deployment
- 既定パターン: `https://<owner>.github.io/<repo>/`。プロジェクトページです。

## 2) API を最短デプロイ
- 対話。推奨です。
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/deploy.sh
```
- 固定プロファイル
```
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh
```
- スモーク。POST→presignedUrl→GET 200 で確認します。
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/smoke.sh
```

## 3) 任意: 次の一歩
- 出力値の確認: `bash scripts/deploy/with_aws.sh -- bash scripts/deploy/tf_outputs.sh`
- 破棄: 課金抑制のために実行します。`bash scripts/deploy/with_aws.sh -- bash scripts/deploy/destroy.sh --yes`
- 詳細: `docs/DEPLOY.md`, アーキ/仕様: `docs/SPEC.md`, バージョン: `docs/VERSIONS.md`
