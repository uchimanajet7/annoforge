# Lambda デプロイ手順（Python 3.13 + SnapStart）

この関数は画像にアノテーションを描画し、S3に保存してpresigned URLを返します。

## 構成
- ランタイム: Python 3.13
- SnapStart: 有効
- 公開: Lambda Function URL（AuthType: NONE）
- 依存: Pillow（Lambda Layerとして配布）

## 環境変数
- `OUTPUT_BUCKET`（必須）: 出力先S3バケット名
- `OUTPUT_PREFIX`（任意）: 出力プレフィックス（例 `results/`）
- `PRESIGN_TTL_DEFAULT_SECONDS`（任意, 既定3600）
- `PRESIGN_TTL_MAX_SECONDS`（任意, 既定86400, かつ≤604800）
- `TTL_SAFETY_MARGIN_SECONDS`（任意, 既定300）
- `RESULT_FORMAT`（任意, `png`|`jpeg`, 既定`png`）
- `CORS_ALLOW_ORIGINS`（任意, `*` またはカンマ区切り）
- `IMAGE_URL_ALLOW_REGEX`（任意, 未設定時は `https://` のみ許可）
- `MAX_IMAGE_BYTES`（任意, 既定10485760=10MiB）

## デプロイ手順（概要）
1) Pillow Layer の作成（x86_64例）

   コマンド（Amazon Linux 2023互換環境で実行）:
   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r lambda/requirements.txt -t python
   zip -r pillow-layer.zip python
   ```
   - コンソールで「レイヤーの作成」→ zipをアップロード
   - ランタイム「python3.13」を選択

2) Lambda関数の作成
   - ランタイム: Python 3.13
   - ハンドラ: `handler.handler`
   - 上記レイヤーをアタッチ
   - 実行ロール: S3 Put/Get 権限を付与（`s3:PutObject` と `s3:GetObject`。`s3:PutObjectAcl` は不要）

3) SnapStart 有効化
   - コンソール: SnapStart → 有効 → 発行後のバージョンに適用

4) Function URL の作成
   - 認証: NONE
   - CORS: 必要に応じて有効化（またはコード内ヘッダで対応）

5) 環境変数の設定
   - `OUTPUT_BUCKET` 等を設定

6) テスト（例）
   - Function URL: `https://xxxxx.lambda-url..../annotate`
   - POST JSON:
   ```bash
   curl -sS -X POST \
     -H 'Content-Type: application/json' \
     -d '{
       "imageUrl": "https://.../your-image.png",
       "draw": [
         {"shape":"line","x1":10,"y1":10,"x2":200,"y2":120,"color":"FF0000","thickness":5},
         {"shape":"rectangle","x":50,"y":50,"width":150,"height":90,"color":"0000FF","thickness":3}
       ],
       "ttlSeconds": 3600,
       "resultFormat": "png"
     }' \
     https://xxxxx.lambda-url..../annotate | jq .
   ```

## 備考
- 実効TTLは `min(要求TTL, 7日, 認証情報の残存-安全マージン)` でクランプされます。
- SnapStart では一意値（uuid/token）はハンドラ内で生成しています。
- `polygon/parallelogram` は線分連結で輪郭を描画し、幅の互換性問題を回避しています。
- S3バケット側で既定SSE（SSE-S3/AES256）を有効化しているため、Put時の暗号化指定は不要です。presigned URL によるGETもそのまま利用できます。
