# はじめに

UI の試用は GitHub Pages またはローカルで行えます。API デプロイは最短でそれぞれ 1 手順ずつで開始できます。詳細は `docs/DEPLOY.md` を参照してください。

本書のコマンド例は、原則としてリポジトリルートでの実行を前提とします。

## 前提。準備物
- 対象は macOS / Linux のみ。
- Terraform 1.5+ / AWS CLI v2 / Python 3.13 + pip。Python はレイヤー作成に使用します。
- curl / jq / zip。デプロイスクリプト、スモーク、ローカルWebMCP用SWSの取得検証で使用。
- tar / lsof。ローカルWebMCP用SWSの展開とポート競合確認で使用。
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
- 「注釈付き画像を保存」で、表示のパンやズームに左右されない元画像寸法・画像範囲の PNG を出力

### ローカル版をWebMCP対応エージェントと使う

次の1コマンドで AnnoForge のローカル静的サーバーを起動します。

```bash
bash scripts/tools/web/start-local-web.sh
```

起動時に GitHub Releases の最新安定版を確認します。初回は対象OS/CPUの Static Web Server を取得し、Release assetのSHA-256 digestと版番号を検証してリポジトリ内の無視対象 `tools/web/` へ保存します。配置済み版より新しい安定版がある場合は更新を確認し、拒否した場合は配置済み版で起動します。起動後、エージェントが `http://127.0.0.1:8000/` を内蔵ブラウザーで開きます。

- エージェントは `get_annotations` で初期 revision を取得し、`open_image_from_data_url` または `open_image_from_url` で画像を開きます。
- `get_image_preview` で、元画像の縦横比を保ち、表示状態や選択表示を含めない対象画像を確認します。`replace_annotations` で注釈を反映し、JSONとプレビューを再確認します。
- `export_annotated_image` の `data_url` で、元画像と同じ寸法・範囲の完成PNGを会話側へ返します。人向けファイル保存が必要な場合だけダウンロード経路を使います。
- 対応クライアントが会話添付の画像バイト列をツールへ渡せる場合、人がブラウザーのファイル選択を行う必要はありません。WebMCP自体は添付バイト列やローカルファイルパスへのアクセスを保証しないため、利用できない場合はCORS対応のHTTPS URLを入力にします。
- サーバーは `127.0.0.1` だけで待ち受け、`web/` だけを配信し、起動したターミナルの `Ctrl+C` で終了します。
- ポート変更が必要な場合だけ `SWS_PORT=8001 bash scripts/tools/web/start-local-web.sh` とします。
- 指定ポートが使用中の場合は対象プロセスを表示し、停止するか確認します。承認なしに既存プロセスを停止しません。
- このサーバーはローカル確認用であり、MCPサーバー、製品バックエンド、公開サーバーではありません。
- WebMCPを使わない通常のローカル利用では、前述のとおり `web/index.html` を直接開けます。
- WebMCPのツール契約と通常経路は `docs/WEBMCP.md` を参照してください。

### 1.1 GitHub Pages と GitHub Actions。初回有効化。必須です。一度だけ
- 背景: GitHub Pages は初回のみ、リポジトリ設定で Source を「GitHub Actions」に指定する必要があります。本リポの workflow は自動有効化は行いません。
- 手順。UI/設定
  1) GitHub → 対象リポジトリ → Settings → Pages
  2) Build and deployment → Source: 「GitHub Actions」を選択 → Save
  3) 以後、`actions/configure-pages@v5 → actions/upload-pages-artifact@v4 → actions/deploy-pages@v4` の標準手順で自動公開されます
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
