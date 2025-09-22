# はじめに（Getting Started）

最短 2–3 ステップで UI 試用と API デプロイを開始できます。詳細は `docs/DEPLOY.md` を参照してください。

## 前提（準備物）
- macOS / Linux 環境（WSL 含む）
- Terraform 1.5+ / AWS CLI v2 / Python 3.13 + pip
- AWS プロファイルまたは AssumeRole 可能な認証手段

動作確認（例）
```
terraform -version
aws --version
python3 --version
```

## 1) UI をすぐ試す
- オンライン: GitHub Pages で `web/` を公開（PRP-003 で設定）。公開 URL は README に追記されます。
- ローカル: `web/index.html` をブラウザで開く（機能は同等）。

操作の要点（抜粋）
- 画像を選択/ドラッグ&ドロップで読み込み
- ツール: 選択/矩形/直線/多角形/平行四辺形/円
- JSON は常時更新、コピー/ダウンロード/インポート可
- 「注釈付き画像を保存」で PNG 出力

## 2) API を最短デプロイ
- 対話（推奨）
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/deploy.sh
```
- 固定プロファイル
```
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh
```
- スモーク（POST→presignedUrl→HEAD 200）
```
bash scripts/deploy/with_aws.sh -- bash scripts/deploy/smoke.sh
```

## 3) 次の一歩（任意）
- 出力値の確認: `bash scripts/deploy/with_aws.sh -- bash scripts/deploy/tf_outputs.sh`
- 破棄（課金抑制）: `bash scripts/deploy/with_aws.sh -- bash scripts/deploy/destroy.sh --yes`
- 詳細: `docs/DEPLOY.md`, アーキ/仕様: `docs/SPEC.md`, バージョン: `docs/VERSIONS.md`
