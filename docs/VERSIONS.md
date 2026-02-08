# バージョン運用ポリシーとアップグレード手順

このプロダクトのツール/ライブラリのバージョン方針と、アップグレード手順をまとめます。対象は「開発者が自身のAWSアカウントにデプロイして使う」ユースケースです。

本書のコマンド例は、原則としてリポジトリルート、つまり `README.md` があるディレクトリでの実行を前提とします。

## 方針の要点
- 互換性: 後方互換は保証しません。
- 安定性: Lambdaランタイムは Python 3.13 を既定。SnapStart対応を最優先。
- アーキテクチャ: 既定は `arm64`。Gravitonです。`x86_64` も選択可。レイヤー/ランタイムと揃えること。
- ピン留め: 重要コンポーネントは明示ピン留め。
  - Pillow: `lambda/requirements.txt` で厳密ピンします。`Pillow==12.1.0` のように指定します。
  - Konva: CDNでバージョン指定します。`10.2.0` のように指定します。
  - Terraform Provider: `~>` のレンジで運用します。`aws ~> 6.0` のように指定します。
  - Terraform本体: `>= 1.5.0` を前提とします。1.6+ を推奨します。

## 現在の固定/推奨バージョン（最新化後）
- Lambda ランタイム: Python 3.13
- アーキテクチャ: arm64。Gravitonです。
- Pillow: 12.1.0。レイヤーに封入しています。
- Konva: 10.2.0。`web/index.html` のCDN設定です。
- Terraform: 1.5+。1.6+ を推奨します。
- Terraform AWS Provider: `~> 6.0`
- Terraform Archive Provider: `~> 2.4`
- AWS CLI: v2。最新を推奨します。

## 共通のアップグレード基本手順
1) 変更対象を決める。たとえば Pillow/Konva/Provider/ランタイム など。
2) 変更前に `scripts/tools/check_versions.sh` でローカルのツールバージョンを確認。
3) 対象のアップグレード手順に従い、ファイルとスクリプトを更新します。
4) `terraform plan` で差分確認 → `terraform apply`。
5) 動作確認します。`docs/DEPLOY.md` の検証コマンドを実行します。

## バージョン監視と更新フロー

### 監視スクリプト
- 最新差分の取得:  
  ```bash
  bash scripts/tools/check_updates.sh
  ```
- JSON形式での取得:  
  ```bash
  bash scripts/tools/check_updates.sh --json
  ```
- 主な出力セクション:
  - `[needs-update]`: 最新との差分あり。`action` と `doc` に従って更新。
  - `[up-to-date]`: 現行が最新版。
  - `[missing]`: 現行値が取得できません。ファイル未生成などが原因です。
  - `[unknown]`: 最新版の取得に失敗しました。ネットワーク等が原因です。
  - `[info-only]`: 自動取得対象外。リンク先を手動確認。

### 対象と参照リンク
- スクリプトは `scripts/tools/check_updates.sh` 冒頭の `targets` 定義に基づいて監視対象を判定。最新版の取得には PyPI / HashiCorp Releases / AWS CLI Command Reference (`https://awscli.amazonaws.com/v2/documentation/api/latest/index.html`) / python.org / unpkg（CDN: package.json）/ jsDelivr Data API / curl.se / jqlang.github.io/jq 公式サイトなどの公開情報を利用している。
- 各ターゲットは以下のドキュメント節に対応する。
  - Pillow → `#pillow`
  - Konva → `#konva`
  - Terraform CLI → `#terraform-cli`
  - Terraform AWS Provider → `#terraform-aws-provider`
  - Terraform Archive Provider → `#terraform-archive-provider`
  - AWS Lambda Python runtime → `#aws-lambda-python-runtime`
  - 開発環境ツール: aws-cli/python3/pip/zip/curl/jq → `#開発環境ツール`

## Pillow
- 目的: セキュリティ更新/機能追加の取り込み。
- アップグレード手順:
  1) 目標バージョンを決定します。`12.1.0` のように指定します。PyPIリリースノートを参照してください。
  2) `scripts/deploy/build_layer.sh --version <新バージョン|latest>` を実行し、`infra/terraform/build/pillow-layer.zip` を再生成します。前提は Python 3.13 / cp313 / manylinux2014_* です。
  3) `infra/terraform/dev.auto.tfvars` の `pillow_layer_zip_path` が `./build/pillow-layer.zip` になっていることを確認。
     - `infra/terraform/dev.auto.tfvars` が未作成の場合は、`scripts/deploy/make_tfvars.sh` で生成するか、`docs/DEPLOY.md` の tfvars 例を参考に手動作成してください。
  4) `terraform apply` を実行。
- 検証: APIにサンプルJSONをPOSTし、生成画像が期待通りであること。
- 注意: ランタイム/アーキとwheelの互換は manylinux2014, aarch64/arm64, cp313 を満たすこと。

## Konva
- CDNスクリプトのバージョンを `web/index.html` で指定。
- バージョン更新手順:
  1) `web/index.html` の CDN 行（`https://unpkg.com/konva@<version>`）を最新値に更新。
  2) WebUIで各図形の作図・編集・JSON出力をスモークテスト。
  3) JSON形式の仕様が変化していないか確認し、変更があれば `docs/SPEC.md` を更新。

## Terraform CLI
- 取得方法: `terraform version` でローカルのインストール版を確認。必要に応じてアップデートする。
- 更新時は `terraform -version` の結果を記録し、`terraform plan` が成功することを確認。
- HashiCorp Release Notes を参照し、破壊的変更が無いか事前確認する。

## Terraform AWS Provider
- Terraform のロックファイル（`infra/terraform/.terraform.lock.hcl`）にピン留め。
- 更新手順:
  1) `infra/terraform/versions.tf` のレンジを必要に応じて調整。
  2) `scripts/tools/upgrade_terraform_providers.sh` を実行してロック更新。
  3) `terraform plan` で差分確認後、`terraform apply`。
- AWS Provider のリリースノートを確認し、対象リソースの挙動変更が無いか精査する。

## Terraform Archive Provider
- AWS Provider と同様にロックファイルで管理。
- 更新時は AWS Provider と同じ手順で `terraform init -upgrade` を実行し、`terraform plan` で確認。
- Archive Provider の機能追加・非推奨が影響しないかをリリースノートで確認。

## AWS Lambda Python runtime
- `infra/terraform/main.tf` の `runtime` で指定 (`python3.13`)。
- 新ランタイムが公開された場合:
  1) AWS Docs / What's New で SnapStart 対応状況とサポート期限を確認。
  2) `runtime` フィールドを新バージョンへ更新。
  3) Pillow レイヤーを同じ ABI（例: cp314）で再構築。
  4) `terraform apply` 後に Lambda Function URL でスモークテスト。

## 開発環境ツール
- `scripts/tools/check_updates.sh` は以下のローカルコマンドのバージョンも収集し、最新リリースとの差分を提示する。
  - `aws`（AWS CLI v2）
  - `python3`
  - `pip`
  - `zip`
  - `curl`
  - `jq`
- 更新方針:
  - プライマリ OS が macOS の場合は Homebrew、Linux の場合はパッケージマネージャや公式インストーラを利用。
  - 各コマンドのリリースページ（スクリプト出力の `ref`）から変更点を確認し、必要に応じて更新。
  - 更新後は `scripts/tools/check_updates.sh` を再実行し、最新版になったことを確認。

## スモークテスト
- `function_url` を取得し、最小JSONをPOSTして200応答・有効なpresigned URLが返ることを確認。
  - 最小例は `docs/DEPLOY.md` を参照。

## ロールバック（失敗時）
- Terraform: 直前のバージョンに戻して `apply`（Provider/コードのレンジ/ファイルを差し戻す）。
- Pillow: 直前の `infra/terraform/build/pillow-layer.zip` に戻す（バージョン管理やバックアップを推奨）。
- Konva: 直前のCDNバージョンに戻す。
