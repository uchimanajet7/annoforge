# AnnoForge

画像アノテーション WebUI + Lambda API

公開サイト（GitHub Pages）
- https://uchimanajet7.github.io/annoforge/

AnnoForge は、WebUIで定義したアノテーション（線・矩形・多角形・平行四辺形・円）を、AWS Lambda（Python 3.13 + SnapStart）上のAPIで画像に描画し、S3へ保存してpresigned URLを返すツールです。

## UI クイックスタート
- 画像の読み込み: 「画像を選択」またはキャンバスへドラッグ&ドロップ（既存画像は置換）。
- ツール: 選択/矩形/直線/多角形/平行四辺形/円。
  - 直線は `hitStrokeWidth` 拡大で掴みやすく調整済み。
  - 多角形はクリックで頂点追加、ダブルクリック/Enter で確定。
  - 平行四辺形は P1→P2→P3 を指定（P4 自動補完、保存順 [P1,P2,P4,P3]）。
  - 円は中心クリック→ドラッグで半径→離して確定。変形は等倍。
- 表示操作: 右下の＋/−/リセット、選択ツール中は背景ドラッグでパン。タッチはピンチズーム。
- 色: パレットまたはカラーピッカー（新規作図へ適用、既定太さ5px）。
- JSON/入出力: 常時更新。コピー/ダウンロード/インポート（貼付/ファイル/ドロップ）。
- 保存: 「注釈付き画像を保存」でPNG出力。

## API クイックスタート
- 対話（推奨: 既定=profile, プロファイル選択UI）
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

関連ドキュメント（詳細）
- デプロイ手順・トラブルシュート: `docs/DEPLOY.md`
- 仕様（構成/ラッパー仕様/API）: `docs/SPEC.md`
- バージョン運用: `docs/VERSIONS.md`

## 認証方針と背景（要約）
- 既定は `profile`（AWS CLI v2 プロファイル/SSO/role_arn+source_profile）。自動更新・一時認証の最新推奨に整合。
- 例外として `auth`（AssumeRole+MFAの手動フロー）を残置。プロファイルを置けない/使えない、緊急の“その場運用”などでのみ使用。
- 方針変更の経緯・詳細は `docs/DEPLOY.md`「付録: 認証方針変更の経緯」を参照。

ツール導入（参考）
- Terraform: https://developer.hashicorp.com/terraform/install
- AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

構成仕様・API仕様は `docs/SPEC.md` にまとまっています。

## Developer Setup (macOS)
- 開発者向けのローカルセットアップとCI相当チェック手順: `docs/DEV_SETUP.md`
- 例（Shell/Bash検査, Terraform整形チェック）
```
bash scripts/tools/lint_shell.sh --strict
bash scripts/tools/fmt_terraform.sh --check
```

## Community & Support
- はじめに（最短導線）: `docs/GETTING_STARTED.md`

## References
- デプロイ手順・トラブルシュート: `docs/DEPLOY.md`
- 仕様（構成/ラッパー仕様/API）: `docs/SPEC.md`
- バージョン運用・採用バージョン: `docs/VERSIONS.md`
