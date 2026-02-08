# デプロイ手順: 認証 → setup → deploy

この手順は、用途別に分割したスクリプト群と、順に呼び出すエントリーポイントの `deploy.sh` で、認証からスモークテストまで一気通貫で実行します。途中で失敗しても、該当フェーズだけ再実行できます。

本書のコマンド例は、原則として `README.md` があるリポジトリルートでの実行を前提とします。

## 0. 前提: ツールとインストール案内
- AWSアカウントと必要権限。IAMは Lambda/S3/Logs
- 必要ツールと推奨バージョン:
  - Terraform 1.5+
    - 公式: https://developer.hashicorp.com/terraform/install
  - AWS CLI v2
    - 公式: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- Python 3.13 + pip。レイヤー作成に使用します。
    - 公式: https://www.python.org/downloads/
  - jq。検証レスポンス整形に使用します。
    - 公式: https://jqlang.github.io/jq/
  - curl, zip

最小インストール例: macOS/Homebrew
```
brew install terraform awscli jq python
```

最小インストール例: Linux。Debian/Ubuntu を想定しています。Terraform は公式APTを使用します。
```
sudo apt-get update && sudo apt-get install -y curl unzip zip jq python3 python3-venv
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform

# AWS CLI v2。公式インストーラを使用します。arm64 の場合は URL を awscli-exe-linux-aarch64.zip に切り替えてください。
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

バージョン確認: 任意
```
bash scripts/tools/check_versions.sh
```

最新差分確認:
```
bash scripts/tools/check_updates.sh
```

AWS認証:
- AWS認証は `with_aws.sh` に一元化します。`deploy.sh` は認証を行いません。`with_aws.sh` 経由で `AWS_PROFILE` または一時クレデンシャルが設定された状態で実行してください。

## 1. 出力S3バケット: Terraformで自動作成
- バケットはTerraformが作成します。既定SSEは SSE-S3/AES256 です。Public Access Blockは有効です。destroyで完全削除します。
- 事前にグローバル一意のバケット名を決めておいてください。エントリーポイント実行時に入力または指定します。

## 2. 一括実行: 推奨はエントリーポイント
認証→ setup→ build_layer→ tfvars→ init→ plan→ apply→ smoke を順に実施します。

apply ポリシー
- plan 完了後、`--yes` も `setup` の自動承認も無い場合は、/dev/tty に TTY安全な確認を表示し、既定Nで適用可否を問います。
- y を入力した場合のみ無人適用します。`--yes` を付与し、Terraformの標準確認は出ません。
- N/Enter の場合は apply をスキップし、その時点で deploy.sh は正常終了します。以後の smoke は実行されません。

### 2.1 ラッパー経由での実行: 推奨。ディスク非保存。
対話/手動いずれも、先頭に認証ラッパーを付けるだけで同一体験に揃えられます。既定モードは `profile` です。

- 推奨: プロファイル選択。既定は profile です。`--profile` 未指定は対話選択です。
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/deploy.sh
```

- 非対話: プロファイル固定。CLI v2 でプロファイルが整備済みの場合です。
```
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh
```

- 例外: 手動AssumeRole+MFA を使う場合です。`mode=auth` を明示します。
```
bash scripts/deploy/with_aws.sh \
  --mode auth \
  --base-profile <BASE_PROFILE> \
  --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE_NAME> \
  --mfa-arn  arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> \
  --duration 3600 \
  -- bash scripts/deploy/deploy.sh
```

ラッパーは一時クレデンシャルを“プロセス内のみ”に注入し、そのまま後続コマンドを実行します。ディスクに保存しません。

deploy.sh は認証を行いません。原則として with_aws.sh 経由で実行してください。既定は profile です。AWS_PROFILE または一時クレデンシャルが設定済みの場合は、直接実行しても構いません。apply の制御は以下の優先順です。
1) `deploy.sh --yes` で自動承認。
2) setup の「Terraform apply 自動承認」= yes なら自動承認。
3) それ以外は plan 後に確認します。既定は N です。y なら自動適用、N/Enter なら apply をスキップして正常終了します。
SSOプロファイルを選んだ場合に未ログインなら、案内に従い以下を実行のうえ再試行してください。
```
aws sso login --profile <WORK_PROFILE>
```

profile のフォールバック
- 選択または指定したプロファイルが非セッションの場合、ラッパーは環境変数の注入を行わず `AWS_PROFILE=<WORK_PROFILE>` を設定して実行します。`credential_process` または SSO の自動更新を利用できます。

禁止事項:
- AssumeRole の直接実装または直接実行は行わないでください。例外運用が必要な場合でも、`with_aws.sh --mode auth -- … -- <command>` の形式で実行します。

## 3. フェーズ単体での実行: 途中再開など
途中で失敗した場合は、該当フェーズだけ再実行できます。入力の扱いはスクリプトごとに異なります。例:
- `setup.sh`: 引数で指定された項目はその値を採用し、未指定項目のみ対話で補完します。
- `make_tfvars.sh`: 「引数 > 環境変数 `DEPLOY_*` > 既定/自動解決」の順で値を解決します。

- 前提確認のみ。推奨はラッパー経由です。既定は profile の対話選択です。
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/setup.sh
```
- 前提確認のみ: 非対話。プロファイル固定。
```
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/setup.sh
```
- 前提確認のみ: 例外。手動AssumeRole+MFA。
```
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/setup.sh --base-profile <your-base-profile>
```
- レイヤー作成: 最新安定版
```
bash scripts/deploy/build_layer.sh --arch arm64 --version latest
```
- tfvars生成: 上書き確認あり
```
bash scripts/deploy/make_tfvars.sh --region us-west-2 --bucket your-unique-bucket-name --prefix results --arch arm64 --yes
```
- Terraform:
```
bash scripts/deploy/tf_init.sh
bash scripts/deploy/tf_plan.sh
bash scripts/deploy/tf_apply.sh --yes
```
- スモークテストのみ
```
bash scripts/deploy/smoke.sh
# すべての図形を描画して確認する場合
bash scripts/deploy/smoke.sh --all-shapes
```

## 4. 手動手順。低レベル操作の参考
4-1) レイヤー作成（arm64）
```
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

4-2) tfvars作成。例: infra/terraform/dev.auto.tfvars
```
aws_region                  = "<AWS_REGION>"
architecture                = "arm64"
function_name               = "annoforge-api"
alias_name                  = "prod"
output_bucket               = "<OUTPUT_BUCKET>"   # Terraformがこのバケットを作成
output_prefix               = "<OUTPUT_PREFIX>"
result_format               = "png"
presign_ttl_default_seconds = 3600
presign_ttl_max_seconds     = 86400
ttl_safety_margin_seconds   = 300
image_url_allow_regex       = ""
max_image_bytes             = 10485760
cors_allow_origins          = ["*"]
existing_layer_arn          = ""
pillow_layer_zip_path       = "./build/pillow-layer.zip"
internal_cors_enabled       = false
```

4-3) Terraform適用
```
cd infra/terraform
terraform init
terraform plan -var-file=dev.auto.tfvars
terraform apply -var-file=dev.auto.tfvars
```

## 5. 片付け。削除
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/destroy.sh
```
- Terraform管理のS3バケットも含め、`force_destroy=true` で全リソースを削除します。
- 実行前に2行型の確認が入ります。既定は N です。 `--yes` 指定時のみ無人で実行します。
  - 案内行: 「destroy の前に確認します」
  - 本プロンプト: 「destroy を実行しますか？ [y/N]」
- バケット内のオブジェクトも削除されます。再生成可能な成果物のみを保存する前提です。

## 6. トラブルシュート
### 6.0 認証とTerraform(AWS Provider v6)の相性
- 本エントリーポイントは認証を行いません。with_aws.sh 経由で認証済み環境で実行してください。
- `--base-profile/--role-arn/--mfa-arn` を指定すると対話入力を減らせます。多要素認証コードの入力は必要です。
- これにより “assume role with MFA enabled, but AssumeRoleTokenProvider session option not set.” を未然に回避します。

ラッパー経由の場合は、上記要件をラッパー側で満たすため、個別スクリプトやTerraformのエラーを大幅に低減できます。

### 6.1 `pip install` でwheelが見つからない/ネット不調:
  - `build_layer.sh --version latest` はPyPI参照に失敗すると既定版にフォールバックします。
  - ネットワーク制限がある場合は後で再実行してください。
- `terraform apply` でS3権限エラー:
  - バケット名/リージョン/PutObject 権限を確認
- CORSでブロックされる:
  - Terraformの `cors_allow_origins` を適切なオリジンに調整。Function URL 側です。

## 7. 参考
 - 仕様: `docs/SPEC.md`
 - Terraform詳細: `infra/terraform/README.md`

## 8. SSE と presigned URL
- 本プロジェクトのS3は既定SSEであるSSE-S3/AES256を有効化します。
- 暗号化オブジェクトでも、presigned URL のGETで問題なくダウンロードできます。S3がサーバ側で復号します。
- 必要権限は「署名者の `s3:GetObject`」。クライアントは認証しない。
 - 参考: Presigned URLの仕組み。AWS公式
    - https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
## 9. 表示・色について
- 人間向けの見出し/入力/確認/完了/エラーは、TTYがあれば /dev/tty、無ければ stderr へ出力します。機械可読出力の `__OUT_*` とコマンド結果は stdout に出力します。
- 色は TTY で有効、`NO_COLOR=1` で無効、`CLICOLOR=0/1` と `CLICOLOR_FORCE=1`、`DEPLOY_COLOR=1` に対応します。
- Terraform の `plan` 出力も TTY では色付き表示になります。`NO_COLOR=1` で無効化します。
- run 行のコマンドは無色のまま出力するため、コピー&ペーストでそのまま再実行できます。

## 10. 命名規約。既定・固定リソース
- 既定ベース名: `function_name = "annoforge-api"`
- 本ツールが作成する固定リソースはアプリ名を含みます。
  - Lambda関数: `annoforge-api`
  - IAMロール: `annoforge-api-exec`
  - IAMポリシー: `annoforge-api-s3-put-get`
  - Lambdaレイヤー: `annoforge-api-pillow`
  - CloudWatch LogGroup: `/aws/lambda/annoforge-api`
  - Lambdaエイリアス: `prod`
  - Function URL: 関数名 + エイリアスに連動
- ユーザーが入力する `output_bucket` や `output_prefix` などの値はこの命名規約の対象外です。
- 詳細: `docs/SPEC.md` の「命名規約。既定・固定リソース」も参照してください。

## 11. 確認プロンプト規約。Yes/No
- 2行型で統一します。
  - 案内行: 「<操作>の前に確認します」
  - 本プロンプト: 「<操作>しますか？ [y/N]:」
- `y`/`Y`/`yes`/`Yes` を肯定、それ以外は否定です。Enter は N です。
- 実装は `ui::ask_yesno` を使用します。Silent版は確認用途に使いません。
- 詳細仕様は `docs/SPEC.md` の「確認プロンプト規約。Yes/No。統一ルール」を参照してください。

## 12. スモークテスト既定とタイムアウト調整。readiness は GET、検証は POST→GET
- 既定画像は `https://placehold.co/256x256.png` を使用します。必要に応じ `--image-url` で上書きできます。
- curlタイムアウト: 以下の環境変数で調整できます。
  - `SMOKE_TIMEOUT_FUNC`: POST全体の最大秒。既定は 25 です。
  - `SMOKE_TIMEOUT_HEAD`: GET確認の最大秒。既定は 10 です。
 - readiness待ち: `SMOKE_READY_WAIT_SECONDS` で待機秒数を指定します。既定は 90 です。Function URL の伝播とコールドスタートを吸収するため、最長 `SMOKE_READY_WAIT_SECONDS` 秒、`GET /annotate` の応答コードが 200/400/404/415/422 のいずれかになるまで待ってから POST を実行します。`0` で無効です。待機中は 15 秒ごとに経過/残り/直近の応答コードを表示します。
 - 図形セット: 既定は最小です。line と rectangle を描画します。`--all-shapes` 指定時は line/rectangle/circle/polygon/parallelogram を描画して確認します。
 - ログ表示の粒度: run行は統一フォーマットです。1行目は `[tag] run: GET:` のように種別ラベルを表示します。2行目は実コマンド1行、3行目は URL がある場合のみ表示します。readiness の GET/POST も同様に表記します。
- 例:
```
SMOKE_TIMEOUT_FUNC=40 SMOKE_TIMEOUT_HEAD=15 \
  bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- \
  bash scripts/deploy/smoke.sh --image-url https://example.com/your.png
```
- 便利ヘルパー: outputs の表示
```
bash scripts/deploy/tf_outputs.sh
```
- outputs が未定義/空の場合はエラーで終了し、`terraform apply` 手順を案内します。
- 認証確認の表示項目は「Account / Arn / Region」です。profile 時はプロファイル名を併せて表示します。Region の解決順は `AWS_REGION` → `AWS_DEFAULT_REGION` → `aws configure get region` です。profile時は `--profile` 指定があれば優先します。

### 12.1 デバッグ出力
- 追加のデバッグ行は `DEPLOY_DEBUG=1` で有効化できます。出力先は stderr です。
- 例: plan→apply の流れや apply の実行コマンドを明示
- スクリプトごとにフィンガープリントを表示し、実行中のスクリプト状態を識別可能です。形式は fp=<hash12>/mtime/file です。
```
DEPLOY_DEBUG=1 bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh
```
- setup の入力は、前段で既定値を明示し、プロンプト自体には既定値を表示しません。Enterで既定値を採用します。対象: リージョン、アーキテクチャ、Pillowバージョン。
- Pillow の既定は latest で、オンラインで解決します。ネットワークやPyPI障害で解決できない場合は 12.1.0 を自動採用します。

---
