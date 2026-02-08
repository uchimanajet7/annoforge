# AnnoForge 仕様: WebUI / Lambda API / Terraform / ツール

- プロジェクト名: AnnoForge
- バージョン: 1.0
- 状態: 本仕様に基づき実装完了。
- 背景: 既存は矩形のみ。競合ツール相当の柔軟な指定を WebUI から可能にする。対象は直線・多角形・平行四辺形。
- 非互換: 下位/後方互換は保証しません。

## 1. 目的とスコープ: 第1部 WebUI
- 目的: 画像上に矩形・直線・多角形・平行四辺形・円のアノテーションを直感的に作成・編集し、他ツールが消費可能なJSON文字列として出力する。
- スコープ: WebUI の単一ページにおける描画・編集・一覧・JSON出力・コピー機能。画像のアップロード/表示は現状踏襲。
- 非スコープ: ユーザ管理、プロジェクト保存の永続化。サーバ連携は第2部の Lambda API で別途定義。

## 2. 採用技術と理由
- Konva.js を CDN で導入。
  - 理由: レイヤ/ヒットグラフ/トランスフォーマ等の実績あるパターンがあり、大量アノテーション/拡張性/保守性に優れる。
  - 代替: Fabric.js は即席UIに強いが、長期運用とスケール面で Konva を優先。

## 3. UI/UX 仕様
### 3.1 主要コンポーネント
- 画像表示レイヤ: 背景のアップロード画像
- アノテーションレイヤ: Konva の Shape/Line/Rect/Group などの形状
- コントロール: ツール選択のアイコンは選択/矩形/直線/多角形/平行四辺形/円。表示操作は＋/−/リセット。色選択はパレットとカラーピッカー。画像選択、全てクリア、注釈付き画像の保存、JSONコピーのアイコン、JSONインポートのモーダル。
- アノテ一覧: 形状ごとの概要（色・種類・座標）と削除ボタン
- JSON表示: 全アノテーションのJSONを常時更新表示。セクション見出しは中央、操作アイコンは右寄せ。コピー/ダウンロード/インポートを集約。

### 3.1.1 画像の読み込み
- ファイル選択: ヘッダのファイル入力から画像を選択
- ドラッグ＆ドロップ: キャンバスのステージ上に画像ファイルをドロップで読み込みます。既存画像は置換します。ドロップ中は枠をハイライト表示します。
- 初期表示: 読み込み後はステージ内に収まる比率で表示し、画像中心がステージ中心となる位置に配置する。拡大は行わない。

### 3.2 ツール/操作
- 選択ツール: 形状選択と移動。矩形と円は Konva Transformer で拡大縮小と回転に対応。直線・多角形・平行四辺形は頂点アンカーで形状を編集し、回転用のTransformerは使わない。
- 矩形: ドラッグで作成。編集はTransformerのハンドルで可能。
- 直線: クリックしてドラッグで終点を決め、離して確定。作成後は端点ドラッグ可。ヒット判定は `hitStrokeWidth` を使用。
- 端点スナップ: 直線作図時のみ、既存頂点の近傍で端点を自動スナップし、マーカーを表示する。
- 多角形: 連続クリックで頂点追加、ダブルクリック/Enterで確定。確定後は各頂点（アンカー）をドラッグで編集。
- 平行四辺形: 3点指定。P1,P2 で基底ベクトル、P3 でオフセット。4点目は自動補完します。P4 = P3 + (P2 - P1)。描画・保存時の頂点順は [P1, P2, P4, P3] とします。辺の並びが a, b, -a, -b となり、対向辺が平行です。確定後は頂点編集可能です。
- 円: 中心をクリックで開始し、ドラッグで半径を可視化してマウスアップで確定。確定後はドラッグで移動し、Transformerで等倍スケーリングします。transformend で scale を半径に正規化します。
- キャンセル: ツール切替で作図中の下書きを破棄する。
- ズーム/パン: ＋/−ボタンと選択ツールの背景ドラッグで操作します。タッチはピンチ対応です。

### 3.2.1 ツールUI: アイコン化
- ドロップダウンではなく、各ツールをアイコンボタンで表示。
- 選択中のボタンは視覚的にアクティブ表示します。枠と背景で示します。

### 3.2.2 色選択
- パレットは既定10色、カラーピッカーで任意色を選択できます。
- 選択した色は新規図形に適用する。既存図形の色変更は実装していない。

### 3.3 当たり判定/編集性
- 直線: `hitStrokeWidth = max(8, thickness)` で掴みやすさ確保。
- 頂点アンカー: 半径6pxの可視ハンドル。ドラッグで点移動。多角形のみ、ダブルクリックで点削除。
- Transformer: 矩形と円の単一選択時に表示。

### 3.4 視覚仕様
- 色: パレット＋任意色。strokeのみ、fillなし。
- 太さ: 既定5px。JSON の `thickness` に反映。
- HiDPI: KonvaのpixelRatioデフォルト活用。

### 3.5 一覧・操作
- 一覧項目: 種別名、色スウォッチ、矩形/直線/円は主要座標/寸法、ポリゴン/平行四辺形は頂点数、削除ボタン。
- クリック: 対応形状の線幅を一時的に太くして800ミリ秒間強調表示する。
- 全てクリア: 形状をすべて削除。
- クリップボード: 全アノテーションJSONのコピー。

## 4. データモデル/JSON仕様
- 座標は元画像座標系の原寸で保持/出力します。表示時はスケールで写像します。
- 既存のフォーマットを拡張し、`draw` 配列に形状を収める。
- 回転角はJSONに含めない。

### 4.1 共通フィールド
- `shape`: `"rectangle" | "line" | "polygon" | "parallelogram" | "circle"`
- `color`: 6桁HEX。先頭の `#` は任意。
- `thickness`: number。単位は px。

### 4.2 形状別フィールド
- rectangle: `x, y, width, height`
- line: `x1, y1, x2, y2`
- polygon: `points`。数列は `[x1, y1, x2, y2, ...]`。
- parallelogram: `points`。4点分の数列で、連続頂点順。
- circle: `x, y, radius`。中心座標と半径。

### 4.3 例
```json
{
  "draw": [
    { "shape": "rectangle", "x": 120, "y": 80, "width": 200, "height": 120, "color": "FF0000", "thickness": 5 },
    { "shape": "line", "x1": 50, "y1": 60, "x2": 300, "y2": 200, "color": "00FF00", "thickness": 5 },
    { "shape": "polygon", "points": [100,100, 160,120, 140,180], "color": "0000FF", "thickness": 5 },
    { "shape": "parallelogram", "points": [200,200, 320,200, 380,260, 260,260], "color": "FF00FF", "thickness": 5 },
    { "shape": "circle", "x": 240, "y": 150, "radius": 60, "color": "0080FF", "thickness": 5 }
  ]
}
```

### 4.4 JSONインポート: モーダル
- 入力: トップレベル `draw` 配列は必須。`color` の先頭 `#` は任意。
- 導線: 「JSON形式」セクション右アクションの「インポート」からモーダル起動。
- 操作:
  - 貼り付け: モーダル内の「貼り付け」アイコンでクリップボードから取得。非対応時は手動貼り付け。
  - ファイル: `.json` ファイル選択で読み込み
- ドロップ: モーダルのドロップゾーンへ .json をドロップします。ステージコンテナへの .json ドロップはモーダルへ誘導します。
- 検証: 件数サマリ等を表示し、問題なければ「インポート」ボタンが有効化
- 挙動: 置換。既存アノテを全てクリアしてJSONを描画。結果は成功/スキップ件数を通知。

## 5. 内部状態/設計方針
- ステージ/レイヤ:
  - `Stage`: キャンバス全体
  - `Layer: image`: 背景画像
  - `Layer: annotations`: 形状群
  - 必要に応じて `Layer: guides`: ドラフト線と頂点アンカー
- スケール管理:
  - 表示倍率 `canvasScale` を保持。ステージは表示用スケール、JSONは原寸座標を保持。
- 形状管理:
  - 内部配列 `shapes[]` にアプリ独自モデルを保持します。項目は id, type, style, geometry。Konvaノードとは疎結合。
  - 直線は x1,y1,x2,y2 を保持する。多角形/平行四辺形は points 配列で保持し、平行四辺形は作図時のみ3点から4点へ補完する。
- 編集:
  - 矩形と円はTransformerで編集。直線・多角形・平行四辺形は頂点アンカーで編集。
  - 当たり判定はKonvaのヒットグラフを使用、直線は `hitStrokeWidth` を設定。

## 6. 操作詳細フロー
- 直線:
  1) クリックで始点確定 2) ドラッグで移動プレビュー 3) マウスアップで終点確定 4) id採番→配列追加→一覧/JSON更新
- 多角形:
  1) クリックで頂点追加 2) ツール切替でキャンセル、Enter/ダブルクリックで確定 3) 確定後アンカー表示し編集可
- 平行四辺形:
  1) P1 2) P2 3) P3 4) P4を自動算出。P4 = P3 + (P2 - P1) 5) 頂点順 [P1, P2, P4, P3] で確定 6) 編集は四頂点のアンカー
- 円:
  1) クリックで中心確定 2) ドラッグで半径プレビュー 3) マウスアップで確定 4) 以後はドラッグ移動、Transformerで等倍スケール。transformend で radius に反映し scale を1に戻す。

- ズーム/パン:
  1) ＋/−ボタン: ビューポート中心基準で拡大/縮小
  2) 選択ツールで背景ドラッグ: パン。図形上は従来どおり選択/移動。
  3) ピンチ: 2本指の距離比でスケール変更、中心移動量も反映
- 削除: 一覧の削除ボタンで削除する。
- ハイライト: 一覧クリックで線幅を一時的に太くして800ミリ秒間強調表示する。

## 7. バリデーション/ガード
- 直線: 長さ < 5px は破棄する。
- 矩形: 幅 < 5px または 高さ < 5px は破棄する。
- 円: 半径 < 3px は破棄する。
- 多角形は頂点数 >= 3 で確定。
- 平行四辺形は自動補完後に4頂点で確定。

## 8. アクセシビリティ/国際化
- キーボード操作: Enter対応。
- 文言: 日本語。

## 9. 性能/品質
- ヒット幅やガイドは軽量描画に留める。
- HiDPI表示における線の視認性を確保。

### 9.1 外部CDN接続の高速化（リソースヒント）
- KonvaのCDN配信元 `https://unpkg.com` への初回接続時間を短縮するため、`<head>` 冒頭付近に以下のリソースヒントを追加する。
  - `<link rel="preconnect" href="https://unpkg.com">`
  - `<link rel="dns-prefetch" href="https://unpkg.com">`
- `preconnect` と `dns-prefetch` は Safari 系ブラウザの既知バグにより同一要素へ併記しない（必ず別タグに分ける）。
- CORS を伴わない `script` 取得のため `crossorigin` 属性は付与しない。

## 10. 受け入れ基準
- 画像上で矩形/直線/多角形/平行四辺形/円が作成できる。
- 形状の基本編集ができる。矩形と円は移動と拡大縮小と回転に対応し、直線・多角形・平行四辺形は移動と頂点編集に対応する。
- 一覧に各図形が反映され、削除ができる。
- JSONが常時更新され、クリップボードコピーできる。
- 直線の掴みやすさが担保されている（`hitStrokeWidth`）。

## 11. 既存からの変更点
- Canvas素描ロジックをKonva.jsベースに置換。
- JSONスキーマの拡張（`line`/`polygon`/`parallelogram`）。
- UIにツール選択セクションを追加。

---

## 第2部: Lambda API 仕様（画像アノテーション生成）

- バージョン: 1.0
- 状態: 実装済み（本API仕様に基づき実装完了）
- 目的: Web APIにより指定画像へアノテーションを描画し、生成画像をS3に保存してpresigned URLを返す。
- ランタイム: AWS Lambda（Python 3.13, SnapStart対応）
- 構成: Lambda Function URL（公開）、S3（出力）

### 1. エンドポイント
- ベース: Lambda Function URL
- パス: `/annotate`
- メソッド: `POST`。`OPTIONS` はプリフライトで、Function URL の CORS 設定で処理する。

### 2. リクエスト
- ヘッダ:
  - `Content-Type: application/json`
  - `Origin: <caller-origin>`（CORS判定に使用、任意）
- ボディ（例）:
```
{
  "imageUrl": "https://... または S3 presigned URL",
  "config": {                 // UIのJSONをそのまま貼る場合は、drawをこの中へ
    "draw": [
      { "shape": "line", "x1": 128, "y1": 95, "x2": 2, "y2": 338, "color": "FF0000", "thickness": 5 },
      { "shape": "rectangle", "x": 1139, "y": 334, "width": 461, "height": 260, "color": "0000FF", "thickness": 5 }
    ]
  },
  "ttlSeconds": 3600,         // 任意: presignedUrlの希望TTL（秒）
  "resultFormat": "png"       // 任意: "png" | "jpeg"。既定は環境変数 RESULT_FORMAT。
}
```

- 互換入力（WebUIのコピーJSONをそのまま使用する場合）:
- `config.draw` とトップレベル `draw` の両方を受け付ける。
- 例: `{ "imageUrl": "...", "config": { "draw": [ ... ] }, "ttlSeconds": 3600 }`

#### 2.1 サポート形状（初期・WebUI準拠）
- 共通: `color` は `RRGGBB`、先頭の `#` は任意。`thickness` は正の整数（px）。
- `line`: `x1,y1,x2,y2,color,thickness`
- `rectangle`: `x,y,width,height,color,thickness`（枠線のみ、塗り無し）
- `circle`: `x,y,radius,color,thickness`（中心座標）
- `polygon`: `points:[x1,y1,x2,y2,...],color,thickness`（3点以上）。
- `parallelogram`:
  - 方式A（推奨）: `points:[p1x,p1y,p2x,p2y,p4x,p4y,p3x,p3y]`（UI保存順 [P1,P2,P4,P3]）
  - 方式B（互換）: `points:[p1x,p1y,p2x,p2y,p3x,p3y]`（3点指定時、`P4 = P3 + (P2 - P1)` をサーバで自動補完）
  - どちらも `color,thickness` を付与。

### 3. レスポンス
- 成功（200）:
```
{
  "presignedUrl": "https://...",
  "metadata": {
    "fileSize": 61744,
    "expiresAt": 1735689600000,
    "contentType": "image/png"
  }
}
```

### 4. エラー
- 400: `invalid_request`。必須項目欠落または型不正。
- 404: `not_found`。リクエストパスが見つかりません。
- 413: `payload_too_large`。画像またはリクエストサイズが上限を超過しています。
- 415: `unsupported_media_type`。画像をデコードできません。
- 422: `validation_error`。形状またはパラメータ検証に失敗しました。
- 500: `internal_error`
- 形式（例）:
```
{
  "error": "validation_error",
  "message": "unsupported shape: ellipse"
}
```

### 5. TTLポリシー
- 実効TTL = `min(要求TTL, 7日(604800s), 署名資格情報の残存有効時間 - 安全マージン)`。
- `ttlSeconds` が未指定の場合は `PRESIGN_TTL_DEFAULT_SECONDS` を用いる。
- サーバは `PRESIGN_TTL_MAX_SECONDS` により上限クランプする（推奨: 86400=24h）。
- 資格情報の残存有効時間が取得できる場合は動的クランプし、できない場合は上記上限で代替。
- `expiresAt` は適用後TTLに基づく計算値。資格情報の実失効が先行する場合は早期無効化されうる。

### 6. S3オブジェクト
- バケット: 環境変数 `OUTPUT_BUCKET`。必須。
- プレフィックス: 環境変数 `OUTPUT_PREFIX`。任意。例: `results/`。
- キー形式（推測困難・一意）:
  - `"{prefix}{yyyy}/{mm}/{dd}/{uuid}_{token}.{ext}"`
  - `uuid = uuid4()`、`token = secrets.token_urlsafe(16)` をハンドラ内で生成（SnapStart一意性順守）。
- 暗号化: バケット既定のSSE-S3（AES256）。アプリ側のヘッダ指定は行わない。
- Content-Type: `image/png` または `image/jpeg`。
- ライフサイクル: Terraform管理のS3バケットに対して、作成から10日経過したオブジェクトを自動削除するライフサイクルルールを適用する。APIで生成された成果物はこの期間内に取得する運用を前提とする（TTL超過後の再取得は再生成で対応）。

### 7. セキュリティ/CORS/SSRF対策
- CORS:
  - 関数内CORSは `INTERNAL_CORS_ENABLED=true` のときのみ有効。既定は無効。
  - 有効時の許可オリジンは `CORS_ALLOW_ORIGINS`。カンマ区切りで、`*` も可。
  - プリフライトは Function URL の CORS 設定で処理する。内部CORSが無効な場合、関数はCORSヘッダを返さない。
  - 実リクエストでは、許可オリジンに一致する場合のみ `Access-Control-Allow-Origin` を返す。
- SSRF防止:
  - 画像取得許可を `IMAGE_URL_ALLOW_REGEX` で制限可能。未設定時は `https://` のみ許可。
  - 画像サイズ上限 `MAX_IMAGE_BYTES`。既定は 10 MiB。実読込で強制。
  - 接続と読み取りのタイムアウトを設定。

### 8. SnapStart方針（Python）
- モジュールスコープで重いimport・boto3クライアントの生成を実施。
- 一意値生成（uuid/token）はハンドラ内で実施（スナップショット共有の重複防止）。
- 署名前に資格情報の残存有効時間を評価しTTLをクランプ。

### 9. 形状描画仕様（サーバ）
- ライブラリ: Pillow（Lambda Layerで配布）。
- 色: `#RRGGBB`へ変換。
- 基本方針: すべて「枠線のみ」。塗りは行わない。
- `line`: `ImageDraw.line((x1,y1,x2,y2), fill, width=thickness)`
- `rectangle`: `ImageDraw.rectangle((x,y,x+width,y+height), outline=fill, width=thickness)`
- `circle`: `bbox=(cx-r,cy-r,cx+r,cy+r)` とし、`ImageDraw.ellipse(bbox, outline=fill, width=thickness)`
- `polygon`: `points` の隣接点を `line` で結び、最後に始点へ戻るクローズドパスで輪郭を描画する。`ImageDraw.polygon` は環境差で `width` 未対応のため、明示的に線分描画とする。
- `parallelogram`: `points` を4頂点（方式Bはサーバで4点化）として `polygon` と同様のクローズドパス描画。
- バリデーション: 厚み>0、寸法>0、`polygon`3点以上、`parallelogram`は最終的に4点。極端な値は422で拒否する場合あり。

### 10. 環境変数（外部注入）
- 必須: `OUTPUT_BUCKET`
- 任意: `OUTPUT_PREFIX`, `PRESIGN_TTL_DEFAULT_SECONDS`(既定3600), `PRESIGN_TTL_MAX_SECONDS`(既定86400, <=604800), `TTL_SAFETY_MARGIN_SECONDS`(既定300), `RESULT_FORMAT`("png"|"jpeg"), `CORS_ALLOW_ORIGINS`, `IMAGE_URL_ALLOW_REGEX`, `MAX_IMAGE_BYTES`(既定10485760), `INTERNAL_CORS_ENABLED`(既定false)

### 11. 非機能/上限
- 画像サイズ上限: `MAX_IMAGE_BYTES` に従う。
- 処理時間: Lambdaタイムアウト内（既定 30s, 変数 `lambda_timeout_seconds` で調整）。
- メモリ: 画像サイズに応じて 512MB〜1024MB を推奨。

- `line`/`rectangle`/`circle`/`polygon`/`parallelogram` に従い描画された結果がS3に保存され、presigned URLが返る。
- `expiresAt` は適用後TTLに基づく計算値。
- 入力不正時に適切なエラー（400/413/415/422）が返る。
- CORSプリフライトが成功し、許可オリジンでの呼び出しが可能。

### 12. 用語・表現方針（CLI/WEB）
- CLI: 確認は2行型（案内行＋「〜しますか？ [y/N]」）で統一。情報メッセージは `ui::info`/`ui::warn` の通常文言を用い、`[HINT]` のような接頭辞は使用しない。
- Web: 画面内のガイダンスはユーザ向けの「ヒント」表現を据え置き、`statusBar` に短時間表示する。CLIの用語方針と混同しないよう役割を分離する。

---


### CI ポリシー（整形と静的検査）
- 目的: 人手のローカル整形を省き、main/PR を常時グリーンに保つ。
- 発火条件: push / pull_request / workflow_dispatch。
  - push: `infra/terraform` で `terraform fmt -recursive` を自動適用し、差分があれば bot 署名で自動コミット（当該ジョブのみ `permissions.contents: write`）。
  - PR: 自動整形は行わず、`terraform fmt -check -recursive -diff` の結果だけを出力。
- 失敗基準:
  - ShellCheck: scripts/**/*.sh は警告・エラーとも許容しない（ゼロ警告）。
  - Terraform: `fmt -check` 不整合、`validate` エラーで失敗。
- セキュリティ/最小権限:
  - 自動コミット権限は Terraform ジョブに限定。Pages/他ジョブへは付与しない。
  - CI のジョブでは AWS 認証を行わず、OIDC も使用しない。
  - fork からの PR では `contents: write` は無効化されるため自動コミットは発生しない（チェックのみ）。

#### 共有スクリプトの採用
- CI とローカルの挙動を一致させるため、以下を scripts/tools/ に配置し、CI はこれらを呼び出すのみとする。
  - `lint_shell.sh` … ShellCheck 実行（`--strict` でエラー化）
  - `fmt_terraform.sh` … `--check|--write|--validate` を受け付ける統合スクリプト（作業ディレクトリは `infra/terraform`）
- 理由: 重複排除・再現性・ベンダーロック最小化。Pages のみ GitHub 固有のため例外。

#### 出力/カラー方針（Why）
- 目的: CIログの機械可読性（検索性・注釈化・差分の明瞭化）と環境差の排除。
- ルール:
  - Terraform は CI では常に無色出力（`-no-color`）。TTY 判定に左右されず、同一表現で比較できる。
  - 人向けの可読性はシェルUI（`ui::info/ui::ok/ui::err`）側で担保する。
- 代替/拡張:
  - 共通変数 `NO_COLOR=1` や `TF_CLI_ARGS="-no-color"` も利用可能。

---

## 第3部: インフラ/IaC 仕様（Terraform）

### 1. 採用理由と方針
- 採用: Terraform（AWS Provider v6系）
  - 理由: 複数環境・差分可視化（plan/apply）・ガバナンス。Function URL・SnapStart・レイヤー・IAMを一元管理。
- 構築対象: Lambda関数（Python3.13, SnapStart）、エイリアス（`prod`）、Function URL（公開/CORS）、IAMロール、Pillowレイヤー、CloudWatch Logs。

### 2. SnapStartと互換性
- SnapStartは「公開バージョン」にのみ適用。Terraformは `publish = true` とし `aws_lambda_alias` に紐付ける。
- SnapStartの制限: プロビジョンドコンカレンシー、/tmp>512MB、EFS、コンテナイメージ等とは非互換。Layersは使用可能。
- アーキテクチャ: `arm64`/`x86_64` 両対応。既定は `arm64` を推奨（コスト/性能）。

### 3. アーティファクト出力ポリシー
- 方針: Terraform モジュール直下の `build/` に生成物を一元化する。
  - 関数ZIP: `${path.module}/build/lambda.zip`（`archive_file` データソースが生成）。
  - レイヤZIP: `./build/pillow-layer.zip`（Terraform実行時の作業ディレクトリ＝`infra/terraform` 基準）。
- 理由（根拠）
  - 一貫性/整合: 関数・レイヤの出力場所を揃え、参照先/清掃手順を単純化。
  - 実行の堅牢性: `../../` など上位相対を避け、`terraform {cwd}=infra/terraform` 前提で最短・誤りにくい相対パスとする。
  - 再生成性: `scripts/deploy/build_layer.sh` で常に再生成でき、`rm -rf infra/terraform/build/` で安全に掃除可能。
- 変数と指定
  - `variable "pillow_layer_zip_path"` は `existing_layer_arn` 未指定時に使用。
  - 既定例（tfvars）: `pillow_layer_zip_path = "./build/pillow-layer.zip"`
  - 既存レイヤを使う場合は `existing_layer_arn` を優先し、`pillow_layer_zip_path` は空でもよい。
- クリーニング
- 生成物は `infra/terraform/build/` 配下に集約。削除する場合は、同ディレクトリを削除する。

---

## 付録: デプロイスクリプトのログ/出力規約（CLI）

目的: すべてのシェルスクリプトの出力仕様を統一し、可読性/再現性/保守性を高める。

1) 出力チャネルの使い分け
- 人間向けメッセージ（見出し/案内/確認/完了/警告/エラー/実行表示）は、TTYがあれば /dev/tty、無ければ stderr に出力する（非TTYでも失敗しないこと）。
- 機械可読出力（後段処理がパースする値）は stdout に出力する（例: `setup.sh` の `__OUT_*`）。

1.1) 出力デバイスの選択順（TTY優先・非TTY安全フォールバック）
- UI関数（`ui::hdr/info/ok/warn/err/run`）は、以下の順序で出力先を決定する。
  1. `/dev/tty` が読み取り可能なら `/dev/tty`（ローカル対話性最優先）
  2. `-t 2` が真なら `/dev/stderr`
  3. `-t 1` が真なら `/dev/stdout`
  4. 上記いずれでもなければ `/dev/stderr`
- 目的: ローカルの対話性を維持しつつ、CI 等の非TTY環境でも `/dev/tty` を参照せず確実に出力する。

2) UI関数の使用（`scripts/lib/ui.sh`）
- 見出し: `ui::hdr <tag> <msg>`
- 情報: `ui::info <tag> <msg>`
- 警告: `ui::warn <tag> <msg>`
- エラー: `ui::err <tag> <msg>`（必要に応じて非ゼロ終了）
- 完了: `ui::ok <tag> <msg>`
- 実行表示: `ui::run <tag> <text>`（run行）
- デバッグ: `ui::debug[_fp]`（`DEPLOY_DEBUG=1` のときのみ表示）

3) run行の書式（コピー性最優先・統一フォーマット）
- 3行ブロックで出力する。
  1) `[tag] run: <実行コマンド:>`
  2) 実際に実行されるコマンドを1行（そのままコピーで実行可）
  3) URLがある場合のみ、URLを1行（無ければ出さない）
  - 例（HTTP）:
    - GET
      `[smoke] run: GET:` の次行に `curl -sS -L -X GET "<URL>"` を出力し、その次の行に `<URL>` を出力
    - POST
      `[smoke] run: POST:` の次行に `curl ... | jq .` を出力し、その次の行に `<URL>` を出力
    - GET
      `[smoke] run: GET:` の次行に `curl -sS -L -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time "<秒>" "<URL>"` を出力し、その次の行に `<URL>` を出力
  - 例（コマンド）:
    - `[deploy] run: tf_apply.sh:` の次行に `bash scripts/deploy/tf_apply.sh --yes`
    - `[tf] run: terraform apply:` の次行に `terraform apply -input=false -auto-approve`

4) 開始/終了タイムスタンプ
- deploy 系スクリプトは `scripts/deploy/*.sh` を対象とし、開始時と終了時に時刻を出力する（deploy.sh準拠）。
  - 精度: ミリ秒（`ui::ts` を使用）。
  - 開始: `ui::info <tag> "----- start: $(ui::ts) -----"`
  - 終了: `ui::info <tag> "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "<diff_ms>")) -----"`
  - 経過時間: `ui::epoch_ms` でmsエポックを取り、差分を `ui::fmt_elapsed_ms` で短く整形（<60s: S.MMMs / <1h: M:SS.MMM / ≥1h: H:MM:SS.MMM）。
- 実装: `scripts/lib/ui.sh` の `ui::ts`/`ui::epoch_ms` は `gdate`/GNU `date` 優先、次に `date '+%N'` のナノ秒を利用（可能ならミリ秒化）、最後に秒精度へフォールバック。

5) ヘルプ/usage/引数エラー
- `-h|--help` で `usage()` を表示する。引数不正時は `ui::err` を用いて終了する。
- usage本文はstdoutで問題ない。その他の案内はUI関数でstderrへ。

6) 確認プロンプト（Yes/No）
- 規約（2行型/既定N）に従い `ui::ask_yesno` を使用する。
	  - 案内行: 「<操作>の前に確認します」
	  - 本プロンプト: 「<操作>しますか？ [y/N]」

7) タグ付与の原則
- 代表例: `deploy`（エントリ）、`setup`、`layer`、`tf`（init/plan/apply）、`smoke`、`with_aws`、`tools`。
- スクリプト内で一貫した `<tag>` を用いる（grep容易性/ログ分析のため）。

8) 色/TTY
- 色はTTYで有効。`NO_COLOR=1` で無効、`CLICOLOR_FORCE=1`/`DEPLOY_COLOR=1` で強制有効。
- run行は人間が読む前提のためUI関数に従う。機械可読用途では使用しない。
- 非TTY（例: CI）でも UI はフォールバック先（stderr など）へ出力し、失敗してはならない。

9) 機械可読出力の最小化
- `__OUT_*` や `terraform` の純出力以外は、機械が読む必要のある情報を stdout に出さない（人間向けはstderrに集約）。

10) 一貫性の担保
- echo直書きは避け、上記UI関数を使用する（例外: usageヒアドキュメント、機械可読出力）。
- 書式が長くなる場合でも、方針（URL改行/コマンド1行）を守る。

### 3. CORSの扱い
- Function URL 側でCORSを設定する（推奨）。
- 関数内CORSは既定で無効（`INTERNAL_CORS_ENABLED=false`）。必要時のみ有効化。
- Function URL の `cors.allow_methods` は `POST` のみとする。

### 4. 構成方法（Terraform→Lambda環境変数）
- 出力先S3（バケット/プレフィックス）や各種動作パラメータは、Terraformの変数でデプロイ時に指定し、Lambdaの環境変数へ反映する（API実行時に変更はしない）。
- 主要な環境変数:
  - `OUTPUT_BUCKET`: 出力先S3バケット。必須。
  - `OUTPUT_PREFIX`: 出力プレフィックス。任意。
  - `RESULT_FORMAT`: `png`|`jpeg`
  - `PRESIGN_TTL_DEFAULT_SECONDS`, `PRESIGN_TTL_MAX_SECONDS`, `TTL_SAFETY_MARGIN_SECONDS`
  - `IMAGE_URL_ALLOW_REGEX`, `MAX_IMAGE_BYTES`
  - `INTERNAL_CORS_ENABLED`: 関数内で CORS ヘッダを返すか。任意。既定は false。

### 5. 主要変数（Terraform）
- `aws_region`, `function_name`, `alias_name`
- `output_bucket`, `output_prefix`, `result_format`
- `presign_ttl_default_seconds`, `presign_ttl_max_seconds`, `ttl_safety_margin_seconds`
- `image_url_allow_regex`, `max_image_bytes`, `cors_allow_origins`
- `existing_layer_arn` または `pillow_layer_zip_path`
- `lambda_timeout_seconds`, `lambda_memory_mb`, `lambda_tmp_mb(<=512MB)`
- `log_retention_days`

### 6. レイヤー（Pillow）採用理由とビルド
- Pillowはネイティブ依存を含むため、レイヤー化で以下の利点:
  - 関数zipの肥大化を抑制、デプロイ差分が軽量。
  - 複数関数での再利用。
  - SnapStartとの互換性に問題なし（制限事項に非該当）。
- 代替案: 関数zip同梱も可（小規模なら選択可）。ただし再デプロイのたびにフル配布となる。

#### 6.1 推奨ビルド手順（arm64既定）
前提: 以下のコマンド例はリポジトリルートで実行します。
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

### 7. 命名規約。既定・固定リソース
- ベース名（既定）: `function_name = "annoforge-api"`（infra/terraform/variables.tf）
- 派生リソース（アプリ名を含める）:
  - Lambda関数: `annoforge-api`
  - IAMロール: `annoforge-api-exec`
  - IAMポリシー: `annoforge-api-s3-put-get`
  - Lambdaレイヤー: `annoforge-api-pillow`
  - CloudWatch LogGroup: `/aws/lambda/annoforge-api`
  - Lambdaエイリアス: `prod`（環境名として簡潔に維持）
  - Function URL: 上記 関数名 + エイリアスに連動
- 非対象（ユーザー指定に依存）: `output_bucket`, `output_prefix` などの可変名は命名規約の適用外。
- 注意（再作成）: `function_name` を変更すると Lambda 関数や関連名は ForceNew（再作成）となり、Function URL も新規発行されます。

#### 6.2 フォールバック（Docker, AL2023/Py3.13/arm64）
```bash
docker run --rm -v "$PWD":/var/task public.ecr.aws/lambda/python:3.13-arm64 bash -lc '
  set -euo pipefail
  python -m pip install --upgrade pip
  pip install Pillow==12.1.0 -t python
  mkdir -p infra/terraform/build
  zip -r infra/terraform/build/pillow-layer.zip python
'
```

※ x86_64 を用いる場合は `manylinux2014_x86_64`／`public.ecr.aws/lambda/python:3.13` を選択し、Terraformの `architecture` を `x86_64` に揃える。

### 7. 出力
- `function_url`, `function_arn`, `alias_arn`, `layer_arn`

### 8. 運用メモ
- 署名URLTTLは、要求TTLとS3上限7日、および実行ロール資格情報の残存により動的クランプ。
- 画像URL許可は正規表現で制御（SSRF防止）。
- S3は既定SSE（SSE-S3/AES256）を有効化。presigned URL のGETはそのまま利用可能（S3がサーバ側で復号）。

## 9. 付録: デプロイスクリプトUI（運用仕様）
- auth/profile 共通の認証確認の表示項目は「Account / Arn / Region」。profile の場合はプロファイル名も表示する。Region の解決順は `AWS_REGION` → `AWS_DEFAULT_REGION` → `aws configure get region`。profile では `--profile` 指定があれば優先。
- setup の入力は「前段で既定値を明示」し、プロンプト自体には既定値を表示せず、Enterで既定値を採用する。対象: リージョン、アーキテクチャ、Pillowバージョン。
- Pillow の既定は latest（オンライン解決）。解決不能時は 12.1.0 にフォールバック。
- 認証（auth）は、Terraform(AWS Provider v6) の互換性のため原則として環境変数ベースの一時クレデンシャルを用いる。既に認証済みなら auth はスキップし、未認証の場合にのみ AssumeRole+MFA で一時クレデンシャルを発行する。
- ラッパー方式（推奨）: 認証は `with_aws.sh` 経由でプロセス内に注入し、そのまま後続コマンドを実行する。ディスク非保存・対話/手動の体験一致。
- apply は plan 完了後に TTY安全の確認を行い、既定は N とし、y の場合のみ `--yes` 付与で自動適用する。`--yes` または setup の自動承認がある場合は確認を省略して自動適用し、Terraform 標準の確認プロンプトには依存しない。
 
### 9.1 確認プロンプト規約。Yes/No。統一ルール
- 用途: 破壊的/影響大な操作（例: plan適用、ファイル上書き、削除等）の前には必ず表示する。
- 2行型で統一: 
	  - 案内行: 「<操作>の前に確認します」
	  - 本プロンプト: 「<操作>しますか？ [y/N]:」
- 既定: N（EnterでN）。受理: y/Y/yes/Yes を肯定、それ以外は否定。
- 実装API: `ui::ask_yesno` を用いる（Silent版は確認用途に使わない）。
- 軽微操作の最終確認（例: プロファイル選択確定）も同形式に揃える。
- 非Yes/No入力（文字列/数値など）は、前段で既定値を明示したうえで `ui::ask_silent` を用い、Enterで既定を採用させる。
- デバッグ出力: `DEPLOY_DEBUG=1` で追加ログ（runコマンド/フラグ/作業ディレクトリなど）を stderr に出力。

---

## 第4部: デプロイ認証ラッパー仕様（with_aws.sh）

- 対象ファイル: `scripts/deploy/with_aws.sh`
- 目的: デプロイや運用コマンド実行時に、安全な認証（短期クレデンシャル）を、対話/非対話の両方で簡便に提供する。
- 方針: AWS CLI v2 のプロファイル（SSO/Identity Center 含む）を第一候補とし、必要に応じてAssumeRole+MFAの手動フローを維持。

#### 設計判断の背景（要約）
- `mode=profile` を既定に採用し、`export-credentials` によるブリッジでレガシーツールにも対応。
- `mode=auth` はプロファイルを置けない・使えない制約下での例外運用（短期/臨時）に限定。

注意（禁止事項）:
- AssumeRole の直接実行（独自スクリプトや eval 等）は行わないこと。必ず `scripts/deploy/with_aws.sh` から実行する。

### 1. 既定動作（変更点）
- 既定モード: `profile`（現行の `auth` から切替）。
- 呼び出し例（既定で `profile` 対話選択へ遷移）:
```bash
bash scripts/deploy/with_aws.sh -- aws s3 ls
```

### 2. モード別仕様
#### 2.1 mode=profile（推奨・既定）
- 役割: 指定または選択した AWS プロファイルから、CLIが解決した短期クレデンシャルを環境変数に注入してコマンドを `exec` 実行。
- `--profile` 明示時: 非対話。現行どおり `aws configure export-credentials --profile <NAME> --format env` の出力を安全に適用して実行。
- `--profile` 省略時: 対話選択フローに入る。
  - `aws configure list-profiles` の一覧を番号付きで表示。
  - 入力は「番号」または「プロファイル名」を許可。
  - `?` で一覧の再表示、`q` で中止。
  - 選択後は「確認プロンプト（y/N）」で最終確認。
  - 選択がSSOプロファイルで未ログインの場合、エラーを明示し `aws sso login --profile <NAME>` を案内（自動ログインは行わない）。
- フォールバック: `export-credentials` の出力が非セッションの場合は、環境変数の注入は行わず `AWS_PROFILE=<NAME>` を設定して実行する（credential_process/SSO の自動更新を活かすため）。

#### 2.2 mode=auth（例外・現状維持）
- 役割: 指定した情報（ロールARN/MFA/ベースプロファイル等）から短期クレデンシャルを取得し、環境変数へ適用。
- 対話: ロールARN、MFAデバイスARN、MFAコード、ベースプロファイル（任意）を未指定時に対話で取得。
- AssumeRole を実施して新規の一時クレデンシャルを適用した場合は、`AWS_PROFILE` を明示的に `unset` して環境変数の一時クレデンシャルで固定。
- すでに認証済みの環境なら、新規AssumeRoleはスキップ（現行踏襲）。

`auth` は「例外運用」の位置付けであり、日常運用は `profile` を用いる。

ユーザー入力（未指定時に対話）:
- 必須: `--role-arn`, `--mfa-arn`, `MFAコード(6桁)`。
- 任意: `--base-profile`（空可）, `--duration`（秒, 既定3600）。

### 3. UI/対話仕様（mode=profile, 未指定時）
- 一覧表示（例）:
```
利用可能なAWSプロファイル:
 1) default
 2) <WORK_PROFILE_1>
 3) <WORK_PROFILE_2>
 4) <WORK_PROFILE_3>
 5) <WORK_PROFILE_4>
[1-5 または プロファイル名, ?=再表示, q=中止]:
```
- 入力検証: 範囲外の番号/存在しない名前は再入力を促す。
- 確認: `選択: <name> で実行しますか？ [y/N]`
- 中止: `q` 入力で中断（戻り値 130）。

### 4. 互換性・移行
- 既定モード変更の影響: これまで `with_aws.sh -- <cmd>` で `auth` を前提にしていた利用は、今後 `--mode auth` を明示する。
- 非対話運用は、引き続き `--mode profile --profile <NAME>` の明示で安定動作。

### 5. 例（使用イメージ）
- 既定（profile）・プロファイル未指定（対話選択）:
```bash
bash scripts/deploy/with_aws.sh -- aws s3 ls
```
- 非対話（profile固定）:
```bash
bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- aws sts get-caller-identity
```
- 例外（auth 継続利用）:
```bash
bash scripts/deploy/with_aws.sh --mode auth --base-profile default -- aws s3 ls
```

### 6. エラー/リカバリ
- AWS CLI 不在: 明示エラー（現行踏襲）。
- `export-credentials` 失敗: プロファイル名/SSOログイン状態/CLI v2 を案内。SSOの場合は `aws sso login --profile <NAME>` をガイド。
- 入力中止: `q` で 130 終了。

### 7. 非目標（今回の変更で扱わない範囲）
- 自動 `aws sso login` 実行（セキュリティ/同意の観点で行わない）。
- `auth` モードの入力UI改善（今回は現状維持）。

### 8. 受け入れ基準
- `--profile` 未指定かつ `mode=profile` で、一覧→選択→確認→実行の対話が行える。
- 無効入力は再入力を促し、`q` で中断できる。
- SSO未ログイン時は適切にエラーメッセージと再ログイン手順を案内する。
- 既定モードが `profile` となり、`--mode auth` 明示で従来の `auth` フローが使える。

### 9. 実装方針。参考
- `scripts/deploy/with_aws.sh` の `mode=profile` 分岐で、`--profile` 未指定時のエラー終了を対話フローに変更。
- `aws configure list-profiles` の結果を配列化してメニュー表示、入力値を正規化/検証。
- 確定後、`aws configure export-credentials --format env --profile <name>` の結果を既存の `apply_exports` に渡して `exec` 実行。
- 失敗時は原因を出し分け（未ログイン/存在しないプロファイル/CLI v2未満等）。


## Terraform Provider 情報出力スクリプト（show_terraform_providers.sh）

### 1. 目的
- Terraform ワークスペース（`infra/terraform` 固定）の現在ロックされているプロバイダー情報を、チーム全体で共有しやすい形で出力する。
- `terraform init` 済みかどうかを即時判定し、未初期化時には実行者へ初期化を促す。
- バージョンレンジ（`versions.tf`）と実際のロック値（`.terraform.lock.hcl`）の乖離を素早く検知できる状態を維持する。

### 2. 対象スクリプトと配置
- パス: `scripts/tools/show_terraform_providers.sh`
- `scripts/tools/upgrade_terraform_providers.sh` と同じく `scripts/lib/ui.sh` を利用したログ体裁を採用。
- ワークスペースは `infra/terraform` ディレクトリに固定し、移動後にコマンドを実行する。

### 3. 入出力仕様
- 引数: なし（`-h|--help` のみサポート）。
- 標準出力:
  1. `terraform version` の結果（CLI・初期化済みプロバイダー版の概要）。
  2. `terraform providers` の結果（モジュール別の要求プロバイダーと採用バージョン）。
  3. `.terraform.lock.hcl` の内容から、`provider` / `version` / `constraints` を含む行のみをファイル順に出力する。空行は保持せず、プロバイダーブロックの区切りとして1行だけ空行を挿入する。
- 標準エラー: ログメッセージ（`ui::info`/`ui::ok`/`ui::warn`/`ui::err`）。
- 退出コード: 正常終了で `0`。`.terraform.lock.hcl` が無い等の未初期化時は `1` を返し、初期化手順（`terraform init` または `scripts/tools/upgrade_terraform_providers.sh`）を案内。

### 4. 振る舞い
1. タイムスタンプ付きの開始/終了ログを出力（`upgrade_terraform_providers.sh` と同様のトラップ構造）。
2. `-h|--help` の場合は使用方法を表示して終了。
3. `infra/terraform` に移動し、`terraform` コマンドの存在を確認。無ければ明示エラー。
4. `.terraform.lock.hcl` が存在しない場合は `ui::err` で未初期化を通知し、終了コード1で停止。
5. `terraform version` と `terraform providers` を順に実行し、実行コマンドを `ui::run` で事前表示。
6. `.terraform.lock.hcl` を Bash のテキスト処理で先頭から走査し、`provider` / `version` / `constraints` を含む行のみを抽出して順に出力する。
7. 出力後に「versions.tf の制約と乖離が無いかを確認し、必要なら `upgrade_terraform_providers.sh` を実行する」旨を `ui::ok` で案内。

### 5. エラーとリカバリ
- `terraform` 未インストール: `ui::err` で不足を通知し、CLI のインストールを促す。
- `.terraform.lock.hcl` 未存在: `ui::err` で未初期化を案内し、`terraform init` 実行を促す。
- パース失敗（想定外フォーマット）: `ui::warn` で注意喚起し、ロックファイルを直接参照するよう案内しつつ終了コードは 0（情報出力が一部欠落するだけの場合）とする。

### 6. 受け入れ基準
- 初期化済み環境で実行すると、`terraform version` / `terraform providers` / ロックファイル行抜き出しの3部構成が表示される。
- 未初期化環境で実行すると、`.terraform.lock.hcl` が無い旨のエラーと初期化手順が表示され、終了コード1となる。
- 表示内で取り扱う情報は `infra/terraform` の内容に限定され、他ディレクトリを変更しない。
- ログ出力のスタイルが既存ツール (`upgrade_terraform_providers.sh`) と同一のトーン・フォーマットとなる。
