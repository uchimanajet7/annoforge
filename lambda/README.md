# Lambda 実装概要: Python 3.13 + SnapStart

## はじめに（推奨導線）
- 本リポジトリの公式デプロイ導線は **Terraform + デプロイスクリプト** です。新規cloneの方は `docs/DEPLOY.md` を参照してください。
- 本ファイルは Lambda 実装/設定の把握のための **低レベル参考** です。コンソールでの手動作成・手動変更は IaC と乖離して drift が発生しやすいため、原則として推奨しません。

本書のコマンド例は、原則としてリポジトリルート、つまり `README.md` があるディレクトリでの実行を前提とします。

この関数は画像にアノテーションを描画し、S3に保存してpresigned URLを返します。

## 構成
- ランタイム: Python 3.13
- SnapStart: 有効
- 公開: Lambda Function URL（AuthType: NONE）
- 依存: Pillow（Lambda Layerとして配布）

## 環境変数
- `OUTPUT_BUCKET`: 出力先S3バケット名。必須。
- `OUTPUT_PREFIX`: 出力プレフィックス。任意。例: `results/`。
- `PRESIGN_TTL_DEFAULT_SECONDS`: presigned URL の既定 TTL（秒）。任意。既定は 3600。
- `PRESIGN_TTL_MAX_SECONDS`: presigned URL の最大 TTL（秒）。任意。既定は 86400。最大は 604800（7日）。
- `TTL_SAFETY_MARGIN_SECONDS`: 認証情報の残存時間から差し引く安全マージン（秒）。任意。既定は 300。
- `RESULT_FORMAT`: 出力画像形式。任意。値は `png` または `jpeg`。既定は `png`。
- `CORS_ALLOW_ORIGINS`: 関数内CORSを有効にした場合の許可オリジン。任意。未設定時は `*`。値は `*` またはカンマ区切り。
- `INTERNAL_CORS_ENABLED`: 関数内で CORS ヘッダを返すか。任意。既定は false。
- `IMAGE_URL_ALLOW_REGEX`: 入力画像URLの許可正規表現。任意。未設定時は `https://` のみ許可。
- `MAX_IMAGE_BYTES`: 入力画像の最大バイト数。任意。既定は 10485760（10MiB）。

## 備考
- 実効TTLは `min(要求TTL, 7日, 認証情報の残存-安全マージン)` でクランプされます。
- SnapStart では一意値（uuid/token）はハンドラ内で生成しています。
- `polygon/parallelogram` は線分連結で輪郭を描画し、幅の互換性問題を回避しています。
- S3バケット側で既定SSE（SSE-S3/AES256）を有効化しているため、Put時の暗号化指定は行いません。presigned URL によるGETはそのまま利用できます。
