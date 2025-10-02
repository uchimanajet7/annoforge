# デプロイ手順（auth → setup → deploy フロー）

この手順は、用途別に分割したスクリプト群と、順に呼び出すエントリーポイント（deploy.sh）で、認証からスモークテストまで一気通貫で実行します。途中で失敗しても、該当フェーズだけ再実行できます。

## 0. 前提（ツールとインストール案内）
- AWSアカウントと必要権限（IAM: Lambda/S3/Logs）
- 必要ツールと推奨バージョン:
  - Terraform 1.5+（1.6+推奨）
    - 公式: https://developer.hashicorp.com/terraform/install
  - AWS CLI v2
    - 公式: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
  - Python 3.x + pip（レイヤー作成に使用）
    - 公式: https://www.python.org/downloads/
  - jq（検証レスポンス整形に使用）
    - 公式: https://jqlang.github.io/jq/
  - curl, zip

最小インストール例（macOS/Homebrew）:
```
brew install terraform awscli jq python
```

最小インストール例（Debian/Ubuntu, Terraformは公式APT）:
```
sudo apt-get update && sudo apt-get install -y curl unzip jq python3 python3-venv
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform awscli
```

バージョン確認（任意）:
```
bash scripts/tools/check_versions.sh
```

AWS認証:
- 認証は認証ラッパー `with_aws.sh` に一元化します。deploy.sh は認証を行いません（プロセス環境に注入された一時クレデンシャル前提）。

## 1. 出力S3バケット（Terraformで自動作成）
- バケットはTerraformが作成します（既定SSE: SSE-S3/AES256、Public Access Block有効、destroyで完全削除）。
- 事前に「グローバル一意のバケット名」を決めておいてください（エントリーポイント実行時に入力/指定します）。

## 2. 一括実行（推奨: エントリーポイント）
auth（認証）→ setup（全入力の一括収集）→ build_layer → tfvars → init → plan → apply → smoke を順に実施します。

apply ポリシー（最新・最善・最高）:
- plan 完了後、`--yes` も `setup` の自動承認も無い場合は、/dev/tty に TTY安全な確認を表示し、既定Nで適用可否を問います。
- y を入力した場合のみ無人適用（`--yes` 付与, Terraformの標準確認は出ません）。
- N/Enter の場合は apply をスキップし、その時点で deploy.sh は正常終了します（以後の smoke は実行されません）。

### 2.1 ラッパー経由での実行（推奨: B案, eval不要・ディスク非保存）
対話/手動いずれも、先頭に認証ラッパーを付けるだけで同一体験に揃えられます。既定モードは `profile` です。

- 推奨: プロファイル選択（既定=profile, `--profile` 未指定は対話選択）
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/deploy.sh
```

- 非対話: プロファイル固定（CLI v2 でプロファイルが整備済みの場合）
```
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh
```

- 互換: 手動AssumeRole+MFA を使う場合（`mode=auth` 明示）
```
bash scripts/deploy/with_aws.sh \
  --mode auth \
  --base-profile <BASE_PROFILE> \
  --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE_NAME> \
  --mfa-arn  arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> \
  --duration 3600 \
  -- bash scripts/deploy/deploy.sh
```

ラッパーは一時クレデンシャルを“プロセス内のみ”に注入し、そのまま後続コマンドを実行します。eval不要・ディスクに保存しません。

（注）deploy.sh をラッパー無しで直接実行することは推奨しません（前提エラーで停止します）。必ず with_aws.sh 経由で実行してください。apply の制御は以下の優先順です。
1) `deploy.sh --yes`（全自動承認）
2) setup の「Terraform apply 自動承認」= yes（自動承認）
3) 上記が無い場合は plan 後に TTY安全な確認（既定N）。y なら自動適用、N/Enter なら apply をスキップ（正常終了）
SSOプロファイルを選んだ場合に未ログインなら、案内に従い以下を実行のうえ再試行してください。
```
aws sso login --profile <WORK_PROFILE>
```

補足（profile のフォールバック）:
- 選択/指定したプロファイルが非セッション（`AWS_SESSION_TOKEN` を含まない）場合、ラッパーは環境変数の注入を行わず `AWS_PROFILE=<WORK_PROFILE>` を設定して実行します。これにより、`credential_process`/SSO の自動更新を活かした実行が可能です。

禁止事項:
- AssumeRole の直接実装/直接実行（eval など）は行わないでください。例外運用が必要な場合でも、必ず `with_aws.sh --mode auth -- … -- <command>` の形式で実行します。

## 3. フェーズ単体での実行（途中再開など）
途中で失敗した場合は、該当フェーズだけ再実行できます。各スクリプトは「引数 > 環境変数（DEPLOY_*）> 対話」の優先で動作します。

- 前提確認のみ（推奨: ラッパー経由, 既定=profile 対話選択）:
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/setup.sh
```
- 前提確認のみ（非対話: プロファイル固定）:
```
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/setup.sh
```
- 前提確認のみ（互換: 手動AssumeRole+MFA）:
```
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/setup.sh --base-profile <your-base-profile>
```
- レイヤー作成（最新安定版）:
```
bash scripts/deploy/build_layer.sh --arch arm64 --version latest
```
- tfvars生成（上書き確認あり）:
```
bash scripts/deploy/make_tfvars.sh --region us-west-2 --bucket your-unique-bucket-name --prefix results --arch arm64 --yes
```
- Terraform:
```
bash scripts/deploy/tf_init.sh
bash scripts/deploy/tf_plan.sh
bash scripts/deploy/tf_apply.sh --yes
```
- スモークテストのみ:
```
bash scripts/deploy/smoke.sh
# すべての図形を描画して確認する場合
bash scripts/deploy/smoke.sh --all-shapes
```

### 3.1 等価手動フロー（ラッパー経由, 推奨: B案）
すべて同じ認証コンテキストで動かすため、各ステップをラッパーで包みます（eval不要・ディスク非保存）。既定は `profile` 対話選択です。

```
# 対話選択
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/build_layer.sh --arch arm64 --version latest
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/make_tfvars.sh --region us-west-2 --bucket your-unique-bucket-name --prefix results --arch arm64 --yes
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/tf_init.sh
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/tf_plan.sh
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/tf_apply.sh --yes
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/smoke.sh
# 全図形の描画確認（任意）
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/smoke.sh --all-shapes

# 非対話（プロファイル固定）
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/build_layer.sh --arch arm64 --version latest
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/make_tfvars.sh --region us-west-2 --bucket your-unique-bucket-name --prefix results --arch arm64 --yes
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/tf_init.sh
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/tf_plan.sh
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/tf_apply.sh --yes
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/smoke.sh
# 全図形の描画確認（任意）
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/smoke.sh --all-shapes

# 互換（auth 明示）
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/build_layer.sh --arch arm64 --version latest
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/make_tfvars.sh --region us-west-2 --bucket your-unique-bucket-name --prefix results --arch arm64 --yes
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/tf_init.sh
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/tf_plan.sh
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/tf_apply.sh --yes
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/smoke.sh
# 全図形の描画確認（任意）
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash scripts/deploy/smoke.sh --all-shapes
```

セッション型（任意）:
```
bash scripts/deploy/with_aws.sh --mode auth --role-arn arn:aws:iam::<ACCOUNT_ID>:role/<ROLE> --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> -- bash
# 子シェル内で:
bash scripts/deploy/tf_plan.sh
bash scripts/deploy/tf_apply.sh --yes
exit
```

## 4. 手動手順（参考: 低レベル操作）
4-1) レイヤー作成（Docker不要, arm64）
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
  Pillow==11.3.0
zip -r infra/terraform/build/pillow-layer.zip python
```

4-2) tfvars作成（例: infra/terraform/dev.auto.tfvars）
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

## 5. 片付け（削除）
```
bash scripts/deploy/destroy.sh
```
- Terraform管理のS3バケットも含め、全リソースを削除します（`force_destroy=true`）。
- 実行前に2行型の確認が入ります（既定: N）。`--yes` 指定時のみ無人で実行します。
  - 案内行: 「destroy の前に確認します（既定: N）」
  - 本プロンプト: 「destroy を実行しますか？ [y/N]」
- バケット内のオブジェクトも削除されます。再生成可能な成果物のみを保存する前提です。

（参考）VCS除外ポリシー（概要）:
- `infra/terraform/.terraform/`, `infra/terraform/*.tfstate*`, `infra/terraform/tfplan`, `infra/terraform/build/` は `.gitignore` により追跡外です（誤コミット防止）。
- `infra/terraform/build/` 以下の生成物は VCS では追跡しません（`scripts/deploy/build_layer.sh` で再生成可能）。
- 既存で追跡されている場合は、インデックスから除外します（履歴の除去は別途検討）。

## 6. トラブルシュート
### 6.0 認証とTerraform(AWS Provider v6)の相性
- 本エントリーポイントは、Terraformの互換性のため「環境変数ベースの一時クレデンシャル（AWS_SESSION_TOKENあり）」を原則要求します。
- 既にAWS認証済でも、セッションでない場合は auth を実行して STS 一時クレデンシャルを発行します（対話/引数）。
- `--base-profile/--role-arn/--mfa-arn` を指定すると無人化できます。
- これにより “assume role with MFA enabled, but AssumeRoleTokenProvider session option not set.” を未然に回避します。

（B案）ラッパー経由の場合は、上記要件をラッパー側で満たすため、個別スクリプトやTerraformのエラーを大幅に低減できます。

### 6.1 `pip install` でwheelが見つからない/ネット不調:
  - `build_layer.sh --version latest` はPyPI参照に失敗すると既定版にフォールバックします。
  - ネットワーク制限がある場合は後で再実行してください。
- `terraform apply` でS3権限エラー:
  - バケット名/リージョン/権限（PutObject）を確認
- CORSでブロックされる:
  - Terraformの `cors_allow_origins`（Function URL 側）を適切なオリジンに調整

## 7. 参考
 - 仕様: `docs/SPEC.md`
 - Terraform詳細: `infra/terraform/README.md`

## 8. 補足（SSEとpresigned URL）
- 本プロジェクトのS3は既定SSE（SSE-S3/AES256）を有効化します。
- 暗号化オブジェクトでも、presigned URL のGET/HEADで問題なくダウンロードできます（S3がサーバ側で復号）。
- 必要権限は「署名者の `s3:GetObject`」。クライアントは認証不要です。
 - 参考: Presigned URLの仕組み（AWS公式）
    - https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
## 9. 表示・色について
- 人間向けの見出し/入力/確認/完了/エラーは stderr に出力します。機械可読出力（__OUT_*）とコマンド結果は stdout に出力します。
- 色は TTY で有効、`NO_COLOR=1` で無効、`CLICOLOR=0/1` と `CLICOLOR_FORCE=1`、`DEPLOY_COLOR=0/1` に対応します。
- Terraform の `plan` 出力も TTY では色付き表示になります（`NO_COLOR=1` で無効化）。
- run 行のコマンドは無色のまま出力するため、コピー&ペーストでそのまま再実行できます。

## 10. 命名規約（既定・固定リソース）
- 既定ベース名: `function_name = "annoforge-api"`
- 本ツールが作成する固定リソースはアプリ名を含みます。
  - Lambda関数: `annoforge-api`
  - IAMロール: `annoforge-api-exec`
  - IAMポリシー: `annoforge-api-s3-put-get`
  - Lambdaレイヤー: `annoforge-api-pillow`
  - CloudWatch LogGroup: `/aws/lambda/annoforge-api`
  - Lambdaエイリアス: `prod`
  - Function URL: 関数名 + エイリアスに連動
- 備考: ユーザーが入力する値（例: `output_bucket`, `output_prefix`）はこの命名規約の対象外です。
- 詳細: `docs/SPEC.md` の「命名規約（既定・固定リソース）」も参照してください。

## 11. 確認プロンプト規約（Yes/No）
- 2行型で統一します。
  - 案内行: 「<行為>の前に確認します（既定: N）」
  - 本プロンプト: 「<行為>しますか？ [y/N]:」
- `y`/`Y`/`yes`/`Yes` を肯定、それ以外は否定（EnterはN）。
- 実装は `ui::ask_yesno` を使用します（Silent版は確認用途に使いません）。
- 詳細仕様は `docs/SPEC.md` の「確認プロンプト規約（Yes/No, 統一ルール）」を参照してください。

## 12. スモークテスト既定とタイムアウト調整
- 既定画像: 安定CDNの小さめ画像を使用（`https://placehold.co/256x256.png`）。必要に応じ `--image-url` で上書き可能です。
- curlタイムアウト: 以下の環境変数で調整できます。
  - `SMOKE_TIMEOUT_FUNC`（POST全体の最大秒, 既定25）
  - `SMOKE_TIMEOUT_HEAD`（HEAD確認の最大秒, 既定10）
 - readiness待ち: `SMOKE_READY_WAIT_SECONDS`（既定90）。Function URL 伝播/コールドを吸収するため、`GET /annotate` に対する応答（200/400/404/415/422のいずれか）を最長N秒待ってからPOSTを実行します。`0` で無効。待機中は15秒ごとに進捗（経過/残り/直近の応答コード）を表示します。
 - 図形セット: 既定は最小（line/rectangle）。`--all-shapes` 指定時は全図形（line/rectangle/circle/polygon/parallelogram）を描画して確認します。
 - ログ表示の粒度: run行は統一フォーマット（1行目: `[tag] run: <実行コマンド:>`、2行目: 実コマンド1行、3行目: URLがある場合のみ）。readinessのGET/POST/HEAD も同様に表記します（成功時は追加出力なし、失敗時のみエラー表示）。
 - 備考: `function_url` が Terraform outputs に存在しない場合、スクリプトはエラーで終了し、`terraform apply` 手順を案内します。
- 例:
```
SMOKE_TIMEOUT_FUNC=40 SMOKE_TIMEOUT_HEAD=15 \
  bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- \
  bash scripts/deploy/smoke.sh --image-url https://example.com/your.png
```
- 便利ヘルパー（outputsの表示）:
```
bash scripts/deploy/tf_outputs.sh
# 呼び出し例は 'bash scripts/deploy/smoke.sh' 実行時に「コピー用」でコマンド本体も単独行で表示されます（そのまま貼り付け可）。
```
 - 備考: outputs が未定義/空の場合はエラーで終了し、`terraform apply` 手順を案内します。
- 認証確認（auth/profile 共通）の表示項目は「Profile（profile時のみ）/ Account / Arn / Region」です（Regionの解決順: `AWS_REGION` → `AWS_DEFAULT_REGION` → `aws configure get region`。profile時は `--profile` 指定があれば優先）。

- 運用タスク一覧/進捗: `docs/AUDIT_TASKS.md` を参照してください（不要/未使用/不整合の改善タスクと進捗を管理）。

### 9.1 デバッグ出力
- 追加のデバッグ行は `DEPLOY_DEBUG=1` で有効化できます（stderr）。
- 例: plan→apply の流れや apply の実行コマンドを明示
- スクリプトごとにフィンガープリント（fp=<hash12>/mtime/file）を表示し、実行中のスクリプト状態を識別可能
```
DEPLOY_DEBUG=1 bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh
```
- setup の入力は、前段で既定値を明示し、プロンプト自体には既定値を表示しません（Enterで既定値を採用）。対象: リージョン、アーキテクチャ、Pillowバージョン。
- Pillow の既定は latest（オンラインで解決）。ネットワークやPyPI障害で解決できない場合は 11.3.0 を自動採用します（フォールバック）。

---

## 10. 付録: 認証方針変更の経緯（記録）
- 変更日: 2025-09-18（このドキュメント更新日）
- 変更内容: 認証ラッパー `with_aws.sh` の既定モードを `auth` から `profile` へ変更。`--profile` 未指定時はプロファイル選択UIを提供。
- 背景/理由:
  - AWSの最新推奨（人的アクセスは SSO/Identity Center + 短期認証）に整合するため。
  - プロファイル経由は自動リフレッシュ/権限管理が容易で、運用・セキュリティ上のフットガンを削減。
  - レガシー/例外用途には `export-credentials` による環境変数ブリッジを使用可能。
- 代替案の比較:
  - 手動AssumeRole（auth）常用: MFA/トークン管理の負担が高く、長期的に非効率。
  - プロファイル統一: 標準化と自動更新が得られ、CI/CD・人手の双方で一貫性が高い。
- 互換方針:
  - `--mode auth` は例外運用として残置（プロファイルを置けない/使えない制約下、緊急時の“その場”対応）。
  - ドキュメントの導線は「profile（推奨）→ auth（例外）」の順で統一。
- 影響範囲:
  - 既存で `with_aws.sh -- <cmd>` を `auth` 前提で使っていた場合は、`--mode auth` の明示で移行可能。
  - README のクイックスタートを profile 前提に差し替え済み。
