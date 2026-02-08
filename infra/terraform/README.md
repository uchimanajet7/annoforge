# Terraform デプロイ手順: Lambda + S3 + SnapStart + Function URL

このTerraformは、画像アノテーション用のLambda関数・Pillowレイヤー・公開Function URL・IAM・出力用S3バケットを作成します。最短の利用は認証ラッパー `scripts/deploy/with_aws.sh` 経由で auth→setup→… の流れでエントリーポイントを実行する方法を推奨します。詳細は `docs/DEPLOY.md` を参照してください。

本書のコマンド例は、原則としてリポジトリルートでの実行を前提とします。`README.md` があるディレクトリです。

## 前提
- Terraform v1.5+ / AWS Provider v6.x
- ランタイム: Python 3.13。SnapStart対応
- コード: `lambda/handler.py`。Pillow はレイヤー
- 既定タイムアウト: 30秒。`lambda_timeout_seconds` 変数で調整できます

## 1) PillowレイヤーZIPの用意: Docker不要を優先
- 既定アーキテクチャは arm64。Graviton です。manylinux2014_aarch64 の wheel で作成:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip
pip install \
  --platform manylinux2014_aarch64 \
  --implementation cp \
  --python-version 3.13 \
  --abi cp313 \
  --only-binary=:all: \
  -t python \
  Pillow==12.1.0
mkdir -p infra/terraform/build
zip -r infra/terraform/build/pillow-layer.zip python
```

- フォールバック: Docker を使い、AL2023 / Python 3.13 / arm64 で作成:

```bash
docker run --rm -v "$PWD":/var/task public.ecr.aws/lambda/python:3.13-arm64 bash -lc '
  set -euo pipefail
  python -m pip install --upgrade pip
  pip install Pillow==12.1.0 -t python
  mkdir -p infra/terraform/build
  zip -r infra/terraform/build/pillow-layer.zip python
'
```

## 2) tfvars を準備
例: `infra/terraform/dev.auto.tfvars`。スクリプト利用時は `scripts/deploy/make_tfvars.sh` がこのファイルを自動生成します

```hcl
aws_region                    = "<AWS_REGION>"
architecture                  = "arm64"        # 既定はarm64。x86_64も可。レイヤと揃える
function_name                 = "annoforge-api"
output_bucket                 = "<OUTPUT_BUCKET>"     # Terraformがこのバケットを作成。SSE-S3, PublicAccessBlock, force_destroy
output_prefix                 = "<OUTPUT_PREFIX>"
result_format                 = "png"
presign_ttl_default_seconds   = 3600
presign_ttl_max_seconds       = 86400
ttl_safety_margin_seconds     = 300
lambda_timeout_seconds        = 30            # 既定30s。必要に応じて調整
image_url_allow_regex         = ""
max_image_bytes               = 10485760
cors_allow_origins            = ["*"]
# 既存レイヤーを使う場合は existing_layer_arn を設定し、下のzipパスは空のままでも可
existing_layer_arn            = ""
pillow_layer_zip_path         = "./build/pillow-layer.zip"  # レイヤzipパス。scripts/deploy/build_layer.sh の出力先
```

## 3) 適用

```bash
cd infra/terraform
terraform init
terraform plan -var-file=dev.auto.tfvars
terraform apply -var-file=dev.auto.tfvars
```

ラッパー併用:
```
bash scripts/deploy/with_aws.sh -- bash -lc 'cd infra/terraform && terraform init && terraform plan -var-file=dev.auto.tfvars'
```

出力に Function URL が表示されます。

## 4) 動作確認

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
$(terraform output -raw function_url)/annotate | jq .
```

## 補足
- SnapStartは公開版に適用されます。本Terraformは `publish=true` + エイリアス `prod` を作成し、Function URLはエイリアスに紐付けます。
- CORSはFunction URL側に統一するため、関数内CORSは既定で無効化し、`internal_cors_enabled=false` とします。必要に応じてtrueに変更可能です。
- S3バケットは Terraform が作成し、既定SSEは SSE-S3/AES256 です。Public Access Block も有効化します。destroy時は `force_destroy=true` で完全削除します。
- presigned URLのTTLは、`min(要求TTL, 7日, 認証情報の残存-安全マージン)` でクランプされます。

## 命名規約: 既定・固定リソース
- 既定のベース名: `function_name = "annoforge-api"`。variables.tf に定義しています
- 本Terraformが作成する固定リソースはアプリ名を含めます:
  - Lambda関数: `annoforge-api`
  - IAMロール: `annoforge-api-exec`
  - IAMポリシー: `annoforge-api-s3-put-get`
  - Lambdaレイヤー: `annoforge-api-pillow`
  - CloudWatch LogGroup: `/aws/lambda/annoforge-api`
  - Lambdaエイリアス: `prod`
  - Function URL: 関数名 + エイリアスに連動
- `function_name` を変えると当該リソースは再作成となり、Function URL も新規発行されます。
