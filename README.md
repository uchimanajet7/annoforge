# AnnoForge

画像アノテーション WebUI + Lambda API

公開サイト: GitHub Pages。初回のみ有効化が必要です。
- 自分の公開URL: `https://<owner>.github.io/<repo>/`
  - GitHub → Settings → Pages に表示されるURLを使用してください。フォーク/別ownerのリポジトリでは公開URLが変わります。
  - 初回のみ Pages を有効化する必要があります。手順は `docs/GETTING_STARTED.md` の 1.1 を参照してください。
- 作者運用のデモサイト: https://uchimanajet7.github.io/annoforge/
  - UIの動作比較用です。

本リポジトリのコマンド例は、原則としてリポジトリルートでの実行を前提とします。この README があるディレクトリです。

AnnoForge は、WebUIで定義した線・矩形・多角形・平行四辺形・円のアノテーションを、Python 3.13 と SnapStart を使う AWS Lambda 上の API で画像に描画し、S3へ保存してpresigned URLを返すツールです。

## UI クイックスタート
- 画像の読み込み: 「画像を選択」またはキャンバスへドラッグ&ドロップ。既存画像は置換されます。
- ツール: 選択/矩形/直線/多角形/平行四辺形/円。
  - 直線は `hitStrokeWidth` 拡大で掴みやすく調整済み。
  - 多角形はクリックで頂点追加、ダブルクリック/Enter で確定。
  - 平行四辺形は P1→P2→P3 を指定します。P4 は自動補完され、保存順は [P1,P2,P4,P3] です。
  - 円は中心クリック→ドラッグで半径→離して確定。変形は等倍。
- 表示操作: 右下の＋/−/リセット、選択ツール中は背景ドラッグでパン。タッチはピンチズーム。
- 色: パレットまたはカラーピッカー。新規作図へ適用します。既定太さは元画像座標で 5px です。
- JSON/入出力: 常時更新。コピー/ダウンロード/インポートに対応します。貼付/ファイル/ドロップで取り込めます。
- 保存: 「注釈付き画像を保存」で、表示のパンやズームに左右されない元画像寸法・画像範囲のPNGを出力します。

## WebMCP / Site tools

WebMCP 対応環境では、人とエージェントが同じ AnnoForge ページと作業状態を共有できます。エージェントは画像を開き、見た目と JSON を確認し、アノテーションを反映し、完成 PNG を会話側へ返せます。人は同じキャンバス上で途中確認、編集、保存を行えます。

- `open_image_from_url`: CORSで取得可能なHTTPS画像、または同一オリジンのloopback画像を開きます。
- `open_image_from_data_url`: 会話側から渡されたPNG/JPEG/WebPのData URLを開きます。
- `get_annotations`: 現在の作業版、全アノテーション、元画像の寸法を読み取ります。
- `get_image_preview`: 元画像の縦横比を保ち、表示状態や選択表示を含めない注釈付き縮小PNGを返します。元画像より拡大しません。
- `replace_annotations`: 読み取った作業版が最新の場合だけ、検証済みの `draw` で全アノテーションを不可分に置換します。
- `start_annotations_json_download`: 既存のアノテーションJSON保存を開始します。
- `export_annotated_image`: 元画像と同じ寸法・範囲の完成PNGをエージェントへ返すか、人向けダウンロードを開始します。
- 対応環境: Site tools が利用できる最新の ChatGPT デスクトップアプリ内蔵ブラウザー。対応モデル、ワークスペース、ロールアウトの最新条件は [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp) を確認してください。
- 非対応環境: Site tools は登録されず、既存の画面操作と JSON 入出力はそのまま利用できます。
- ローカルのWebMCP利用: リポジトリルートで `bash scripts/tools/web/start-local-web.sh` を実行し、`http://127.0.0.1:8000/` を対応内蔵ブラウザーで開きます。起動時に Static Web Server の最新安定版を確認し、更新がある場合は置換するか確認します。画像はWebMCPのData URLまたはURL入力で渡すため、サーバー起動時の画像指定や人によるブラウザーのファイル選択は必須ではありません。
- 通常の人向けローカル利用: 従来どおり `web/index.html` を直接開けます。WebMCPのためにこの経路を変更していません。
- 詳細仕様: `docs/WEBMCP.md`

## API クイックスタート
- 対話。推奨です。既定は profile で、プロファイル選択UIがあります。
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

関連ドキュメント
- デプロイ手順・トラブルシュート: `docs/DEPLOY.md`
- 仕様: 構成/ラッパー仕様/API は `docs/SPEC.md`
- バージョン運用: `docs/VERSIONS.md`
- はじめに: UI と Pages の初回有効化を含みます。`docs/GETTING_STARTED.md`

## 認証方針と背景
- 既定は `profile` です。AWS CLI v2 プロファイル/SSO/role_arn+source_profile を使います。自動更新・一時認証に整合します。
- 例外として `auth` を残置します。AssumeRole+MFA の手動フローです。プロファイルを置けない/使えない、緊急の“その場運用”などでのみ使用します。

ツール導入: 参考
- Terraform: https://developer.hashicorp.com/terraform/install
- AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

構成仕様・API仕様は `docs/SPEC.md` にまとまっています。

## Developer Setup (macOS)
- 開発者向けのローカルセットアップとCI相当チェック手順: `docs/DEV_SETUP.md`
- 例: Shell/Bash 検査と Terraform 整形チェック
```
bash scripts/tools/lint_shell.sh --strict
bash scripts/tools/fmt_terraform.sh --check
```

## Community & Support
- はじめに: `docs/GETTING_STARTED.md`

## Notes
<p><a href="https://uchimanajet7.hatenablog.com/entry/2025/10/14/180000">AnnoForge 開発メモ - WebUIで注釈設定 → AWS Lambdaで画像に注釈を追加してみた</a></p>
