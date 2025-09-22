# バージョン運用ポリシーとアップグレード手順

このプロダクトのツール/ライブラリのバージョン方針と、アップグレード手順をまとめます。対象は「開発者が自身のAWSアカウントにデプロイして使う」ユースケースです。

## 方針（要点）
- 互換性: 後方互換の配慮は不要（開発中前提）。ただし、破壊的変更時は `docs/CHANGELOG.md` に記録することを推奨。
- 安定性: Lambdaランタイムは Python 3.13 を既定。SnapStart対応を最優先。
- アーキテクチャ: 既定は `arm64`（Graviton）。`x86_64` も選択可。レイヤー/ランタイムと揃えること。
- ピン留め: 重要コンポーネントは明示ピン留め。
  - Pillow: `lambda/requirements.txt` で厳密ピン（例: `Pillow==11.3.0`）。
  - Konva: CDNでバージョン指定（例: `10.0.0`）。
  - Terraform Provider: `~>` のレンジ運用（例: `aws ~> 6.0`）。
  - Terraform本体: `>= 1.5.0` を前提（1.6+推奨）。

## 現在の固定/推奨バージョン（最新化後）
- Lambda ランタイム: Python 3.13
- アーキテクチャ: arm64（Graviton）
- Pillow: 11.3.0（レイヤーに封入）
- Konva: 10.0.0（`web/index.html`のCDN）
- Terraform: 1.5+（1.6+推奨）
- Terraform AWS Provider: `~> 6.0`
- Terraform Archive Provider: `~> 2.4`
- AWS CLI: v2（最新推奨）

## アップグレードの基本手順（共通）
1) 変更対象を決める（例: Pillow/Konva/Provider/ランタイム など）。
2) 変更前に `scripts/tools/check_versions.sh` でローカルのツールバージョンを確認。
3) 対象のアップグレード手順（以下）に従い、ファイルとスクリプトを更新。
4) `terraform plan` で差分確認 → `terraform apply`。
5) 動作確認（`docs/DEPLOY.md` の検証コマンド）。
6) 破壊的変更なら `docs/CHANGELOG.md` を更新（任意運用）。

## Pillow（Lambdaレイヤー）のアップグレード
- 目的: セキュリティ更新/機能追加の取り込み。
- 作業:
  1) 目標バージョンを決定（例: `10.4.0`）。
  2) `scripts/deploy/build_layer.sh --version <新バージョン|latest>` を実行し、`infra/terraform/build/pillow-layer.zip` を再生成（Python 3.13 / cp313 / manylinux2014_* を前提）。
  3) `infra/terraform/dev.auto.tfvars` の `pillow_layer_zip_path` は `./build/pillow-layer.zip` を指定（既に指定済みなら不要）。
  4) `terraform apply`。
- 確認: APIにサンプルJSONをPOSTし、生成画像が得られること。
- 注意: ランタイム/アーキとwheelの互換（manylinux2014, aarch64/arm64, cp313）を満たすこと。

## Konva（WebUI）のアップグレード
- 作業:
  1) `web/index.html` のCDN行のバージョンを更新。
  2) WebUIで基本操作（各形状の作図/JSON出力）を確認。
  3) JSONスキーマの変化がないことを確認（必要なら `docs/SPEC.md` を更新）。

## Terraform Provider のアップグレード
- 作業:
  1) `infra/terraform/versions.tf` のProviderレンジを必要に応じて更新。
  2) `scripts/tools/upgrade_terraform_providers.sh` を実行（`terraform init -upgrade`）。
  3) `terraform plan` で差分確認 → `apply`。

## Lambda ランタイムのアップグレード（例: 3.13 以降）
- 前提: SnapStartが新ランタイムをサポートしていることを確認。
- 作業:
  1) `infra/terraform/main.tf` の `runtime` を対象バージョンへ更新。
  2) Pillowレイヤーを対象ABI（例: cp313）のwheelで再作成。
  3) `terraform apply`。

## スモークテスト
- `function_url` を取得し、最小JSONをPOSTして200応答・有効なpresigned URLが返ることを確認。
  - 最小例は `docs/DEPLOY.md` を参照。

## ロールバック（失敗時）
- Terraform: 直前のバージョンに戻して `apply`（Provider/コードのレンジ/ファイルを差し戻す）。
- Pillow: 直前の `infra/terraform/build/pillow-layer.zip` に戻す（バージョン管理やバックアップを推奨）。
- Konva: 直前のCDNバージョンに戻す。
