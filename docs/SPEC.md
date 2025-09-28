# AnnoForge: 画像アノテーションツール 機能拡張仕様（Konva.js採用）

- プロジェクト名: AnnoForge
- バージョン: 1.0
- 状態: 承認済み / 実装済み（本仕様に基づき実装完了）
- 背景: 既存は矩形のみ。競合同等の柔軟な指定（直線・多角形・平行四辺形）をWebUIから可能にする。
- 非互換: 下位/後方互換は考慮不要（要件より）。

## 1. 目的とスコープ
- 目的: 画像上に矩形・直線・多角形・平行四辺形・円のアノテーションを直感的に作成・編集し、他ツールが消費可能なJSON文字列として出力する。
- スコープ: WebUI（単一ページ）における描画・編集・一覧・JSON出力・コピー機能。画像のアップロード/表示は現状踏襲。
- 非スコープ: サーバ連携、ユーザ管理、プロジェクト保存、SVG/PNG出力（将来拡張候補）。

## 2. 採用技術と理由
- Konva.js（CDN導入）
  - 理由: レイヤ/ヒットグラフ/トランスフォーマ等の実績あるパターンがあり、大量アノテーション/拡張性/保守性に優れる。
  - 代替: Fabric.js（即席UIに強い）があるが、長期運用とスケール面でKonvaを優先。

## 3. UI/UX 仕様
### 3.1 主要コンポーネント
- 画像表示レイヤ: 背景（アップロード画像）
- アノテーションレイヤ: 形状（Konva Shape/Line/Rect/Groupなど）
- コントロール: ツール選択（アイコン: 選択/矩形/直線/多角形/平行四辺形/円）、表示操作（矢印/＋/−/リセット）、色選択（パレット＋カラーピッカー）、画像選択、全消去、注釈付き画像の保存、JSONコピー（アイコン）、JSONインポート（モーダル）
- アノテ一覧: 形状ごとの概要（色・種類・座標）と削除ボタン
- JSON表示: 全アノテーションのJSONを常時更新表示（セクション見出しは中央、操作アイコンは右寄せ。コピー/ダウンロード/インポートを集約）

### 3.1.1 画像の読み込み
- ファイル選択: ヘッダのファイル入力から画像を選択
- ドラッグ＆ドロップ: キャンバス（ステージ）上に画像ファイルをドロップで読み込み（既存画像は置換）。ドロップ中は枠をハイライト表示。
- 初期表示: 読み込み後は倍率1・センタリング（画像中心がステージ中心）で開始

### 3.2 ツール/操作
- 選択ツール: 形状選択、移動、Konva Transformerで拡大縮小/回転（矩形/円/直線は回転可、ポリゴン/平行四辺形は回転可）。
- 矩形: ドラッグで作成。編集はTransformerのハンドルで可能。
- 直線: クリックで始点、次のクリックで終点。作成後は端点ドラッグ可。ヒット判定は `hitStrokeWidth` を使用。
- 端点スナップ: 既存頂点の近傍（画面上おおよそ12px）で端点を自動スナップ（プレビュー表示あり）。
- 多角形: 連続クリックで頂点追加、ダブルクリック/Enterで確定。確定後は各頂点（アンカー）をドラッグで編集。
- 平行四辺形: 3点指定（P1, P2で基底ベクトル、P3でオフセット）。4点目は自動補完（P4 = P3 + (P2 - P1)）。描画・保存時の頂点順は [P1, P2, P4, P3] とする（辺の並びが a, b, -a, -b となり、対向辺が平行）。確定後は頂点編集可能。
- 円: 中心をクリックで開始、ドラッグで半径を可視化、マウスアップで確定。確定後はドラッグで移動、Transformerで等倍スケーリング（transformendで scale を半径に正規化）。
- キャンセル: ESCで作図キャンセル（未確定の頂点を破棄）。
- スナップ（初期OFF）: 角度（45°）/グリッド（8px）にスナップ可（将来設定）。
- ズーム/パン: ＋/−ボタンと選択ツールの背景ドラッグで操作（タッチはピンチ対応）。

### 3.2.1 ツールUI（アイコン化）
- ドロップダウンではなく、各ツールをアイコンボタンで表示。
- 選択中のボタンは視覚的にアクティブ表示（枠/背景）。

### 3.2.2 色選択
- パレット（既定10色）＋カラーピッカー（任意色）を提供。
- 選択した色は以後の新規図形に適用（既存図形の色変更は初期リリース対象外）。

### 3.3 当たり判定/編集性
- 直線: `hitStrokeWidth = max(8, thickness)` で掴みやすさ確保。
- 頂点アンカー: 半径6pxの可視ハンドル。ドラッグで点移動。ダブルクリックで点削除（多角形のみ）。
- Transformer: 単一選択時に表示。複数選択は将来検討。

### 3.4 視覚仕様
- 色: パレット＋任意色。strokeのみ、fillなし。
- 太さ: 既定5px（JSONの`thickness`に反映）。
- 破線: `lineType`（1=実線, 2=破線）。UIは初期リリースで固定1（将来切替）。
- HiDPI: KonvaのpixelRatioデフォルト活用。

### 3.5 一覧・操作
- 一覧項目: 種別名、色スウォッチ、主要座標/寸法の表示、削除ボタン。
- クリック: 対応形状をハイライト（1秒間の強調枠）。
- 全消去: 形状をすべて削除。
- クリップボード: 全アノテーションJSONのコピー。

## 4. データモデル/JSON仕様
- 座標は「元画像座標系（原寸）」で保持/出力。表示時はスケールで写像。
- 既存のフォーマットを拡張し、`draw` 配列に形状を収める。

### 4.1 共通フィールド
- `shape`: `"rectangle" | "line" | "polygon" | "parallelogram" | "circle"`
- `color`: 6桁HEX（先頭`#`なし）
- `thickness`: number（px）

### 4.2 形状別フィールド
- rectangle: `x, y, width, height`
- line: `x1, y1, x2, y2`
- polygon: `points`（数列: `[x1, y1, x2, y2, ...]`）
- parallelogram: `points`（4点分の数列, 連続頂点順）
- circle: `x, y, radius`（中心座標と半径）

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

## 14. JSONインポート（モーダル）
- 入力: 上記スキーマと同一（`draw`配列）。`color`は先頭に`#`があってもなくても許容。
- 導線: 「JSON形式」セクション右アクションの「インポート」からモーダル起動。
- 操作:
  - 貼り付け: モーダル内の「貼り付け」アイコンでクリップボードから取得（非対応時は手動貼り付け）
  - ファイル: `.json` ファイル選択で読み込み
  - ドロップ: モーダルのドロップゾーンへ .json をドロップ（キャンバス上の .json ドロップもモーダルへルーティング）
- 検証: 件数サマリ等を表示し、問題なければ「インポート」ボタンが有効化
- 挙動: 置換（既存アノテ全消去→JSONを描画）。結果は成功/スキップ件数を通知。

## 5. 内部状態/設計方針
- ステージ/レイヤ:
  - `Stage`（キャンバス全体）
  - `Layer: image`（背景画像）
  - `Layer: annotations`（形状群）
  - 必要に応じて `Layer: guides`（ドラフト線/頂点アンカー）
- スケール管理:
  - 表示倍率 `canvasScale` を保持。ステージは表示用スケール、JSONは原寸座標を保持。
- 形状管理:
  - 内部配列 `shapes[]` にアプリ独自モデルを保持（id, type, style, geometry）。Konvaノードとは疎結合。
  - 直線/多角形は頂点配列で表現。平行四辺形は4頂点（作図時のみ3点→4点補完）。
- 編集:
  - 矩形/直線はTransformer + 端点アンカー。多角形/平行四辺形は頂点アンカーで編集。
  - 当たり判定はKonvaのヒットグラフを使用、直線は `hitStrokeWidth` を設定。

## 6. 操作詳細フロー
- 直線:
  1) クリックで始点確定 2) 移動プレビュー 3) クリックで終点確定 4) id採番→配列追加→一覧/JSON更新
- 多角形:
  1) クリックで頂点追加（1点目にマーカー） 2) ESCでキャンセル、Enter/ダブルクリックで確定 3) 確定後アンカー表示し編集可
- 平行四辺形:
  1) P1 2) P2 3) P3 4) P4を自動算出（P4 = P3 + (P2 - P1)） 5) 頂点順 [P1, P2, P4, P3] で確定 6) 編集は四頂点のアンカー
- 円:
  1) クリックで中心確定 2) ドラッグで半径プレビュー 3) マウスアップで確定 4) 以後はドラッグ移動、Transformerで等倍スケール（transformendで radius に反映し scale を1に戻す）

- ズーム/パン:
  1) ＋/−ボタン: ビューポート中心基準で拡大/縮小
  2) 選択ツールで背景ドラッグ: パン（図形上は従来どおり選択/移動）
  3) ピンチ: 2本指の距離比でスケール変更、中心移動量も反映
- 削除: 一覧または選択中に削除（初期は一覧のみ）
- ハイライト: 一覧クリックで1秒間の強調表示

## 7. バリデーション/ガード
- 面積/長さが閾値未満（< 5px）の図形は自動破棄。
- 多角形は頂点数 >= 3 で確定。
- 平行四辺形は自動補完後に4頂点で確定。

## 8. アクセシビリティ/国際化
- キーボード操作: Enter/ESC対応、将来Tab移動検討。
- 文言: 日本語（将来i18n対応余地あり）。

## 9. 性能/品質
- ヒット幅やガイドは軽量描画に留める。
- 大量図形時はレイヤキャッシュ/リスニング最適化（将来拡張）。
- HiDPI表示における線の視認性を確保。

## 10. 受け入れ基準
- 画像上で矩形/直線/多角形/平行四辺形/円が作成できる。
- 形状の基本編集（移動、サイズ変更or頂点移動、回転）ができる。
- 一覧に各図形が反映され、削除ができる。
- JSONが常時更新され、クリップボードコピーできる。
- 直線の掴みやすさが担保されている（`hitStrokeWidth`）。

## 11. 既存からの変更点
- Canvas素描ロジックをKonva.jsベースに置換。
- JSONスキーマの拡張（`line`/`polygon`/`parallelogram`）。
- UIにツール選択セクションを追加。

## 12. 実装計画（ハイレベル）
1) Konva導入（CDN）とレイヤ構成追加（画像/アノテ/ガイド）
2) 既存の矩形描画をKonva Rectに移行
3) 直線ツール実装（クリック2回で作成、端点アンカー編集）
4) 多角形ツール実装（頂点追加/確定、アンカー編集）
5) 平行四辺形ツール実装（3点→4点自動補完、アンカー編集）
6) 一覧/ハイライト/削除の更新（id紐付け）
7) JSONエクスポート更新（拡張スキーマ）
8) スタイル/アクセシビリティ微調整と動作検証

## 13. オープン事項（初期は未対応でも可）
- 複数選択/整列/整列ガイド/スナップON/OFF UI
- 破線・色・太さのUI設定
- Undo/Redo

---

本仕様に問題がなければ「承認」とご返信ください。承認後、最小単位から順に実装を開始します。

---

## 第2部: Lambda API 仕様（画像アノテーション生成）

- バージョン: 1.0
- 状態: 承認済み / 実装済み（本API仕様に基づき実装完了）
- 目的: Web APIにより指定画像へアノテーションを描画し、生成画像をS3に保存してpresigned URLを返す。
- ランタイム: AWS Lambda（Python 3.13, SnapStart対応）
- 構成: Lambda Function URL（公開）、S3（出力）

### 1. エンドポイント
- ベース: Lambda Function URL
- パス: `/annotate`
- メソッド: `POST`（本体JSON）／`OPTIONS`（CORSプリフライト）

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
  "resultFormat": "png"       // 任意: "png" | "jpeg"（既定: 環境変数 RESULT_FORMAT）
}
```

- 互換入力（WebUIのコピーJSONをそのまま使用する場合）:
  - `config.draw` の代わりに、トップレベル `draw` も受け付ける。
  - 例: `{ "imageUrl": "...", "draw": [ ... ], "ttlSeconds": 3600 }`

#### 2.1 サポート形状（初期・WebUI準拠）
- 共通: `color` は `RRGGBB`（先頭`#`なし）、`thickness` は正の整数（px）。
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
- 400: `invalid_request`（必須項目欠落・型不正）
- 401: `unauthorized`（認可失敗時）
- 413: `payload_too_large`（画像/リクエストサイズ超過）
- 415: `unsupported_media_type`（画像デコード不可）
- 422: `validation_error`（形状/パラメータ検証失敗）
- 429: `rate_limited`（将来）
- 500: `internal_error`
- 形式（例）:
```
{
  "error": "validation_error",
  "message": "unsupported shape: ellipse"
}
```

### 5. TTLポリシー（最新・最善・最高の対応）
- 実効TTL = `min(要求TTL, 7日(604800s), 署名資格情報の残存有効時間 - 安全マージン)`。
- `ttlSeconds` が未指定の場合は `PRESIGN_TTL_DEFAULT_SECONDS` を用いる。
- サーバは `PRESIGN_TTL_MAX_SECONDS` により上限クランプする（推奨: 86400=24h）。
- 資格情報の残存有効時間が取得できる場合は動的クランプし、できない場合は上記上限で代替。
- `expiresAt` は適用後TTLに基づく計算値（資格情報の実失効が先行する場合は早期無効化されうる旨を既知とする）。

### 6. S3オブジェクト
- バケット: 環境変数 `OUTPUT_BUCKET`（必須）。
- プレフィックス: 環境変数 `OUTPUT_PREFIX`（任意、例 `results/`）。
- キー形式（推測困難・一意）:
  - `"{prefix}{yyyy}/{mm}/{dd}/{uuid}_{token}.{ext}"`
  - `uuid = uuid4()`、`token = secrets.token_urlsafe(16)` をハンドラ内で生成（SnapStart一意性順守）。
- 暗号化: バケット既定のSSE-S3（AES256）。アプリ側のヘッダ指定は不要。
- Content-Type: `image/png` または `image/jpeg`。

### 7. セキュリティ/CORS/SSRF対策
- CORS:
  - 環境変数 `CORS_ALLOW_ORIGINS`（カンマ区切り, `*`可）。
  - `OPTIONS /annotate` に対し `Access-Control-Allow-Methods: POST, OPTIONS` 等を返す。
  - 実リクエストでは許可オリジンのみ `Access-Control-Allow-Origin` をエコー。
- SSRF防止:
  - 画像取得許可を `IMAGE_URL_ALLOW_REGEX` で制限可能（未設定時は `https://` のみ許可）。
  - 画像サイズ上限 `MAX_IMAGE_BYTES`（既定: 10 MiB）。Content-Lengthと実読込で強制。
  - タイムアウト（接続/読み取り）を設定。

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
- `polygon`: `points` の隣接点を `line` で結び、最後に始点へ戻るクローズドパスで輪郭を描画（`ImageDraw.polygon` は環境差で `width` 未対応のため明示的に線分描画）。
- `parallelogram`: `points` を4頂点（方式Bはサーバで4点化）として `polygon` と同様のクローズドパス描画。
- バリデーション: 厚み>0、寸法>0、`polygon`3点以上、`parallelogram`は最終的に4点。極端な値は422で拒否する場合あり。

### 10. 環境変数（外部注入）
- 必須: `OUTPUT_BUCKET`
- 任意: `OUTPUT_PREFIX`, `PRESIGN_TTL_DEFAULT_SECONDS`(既定3600), `PRESIGN_TTL_MAX_SECONDS`(既定86400, <=604800), `RESULT_FORMAT`("png"|"jpeg"), `CORS_ALLOW_ORIGINS`, `IMAGE_URL_ALLOW_REGEX`, `MAX_IMAGE_BYTES`(既定10485760)

### 11. 非機能/上限
- 画像サイズ上限: `MAX_IMAGE_BYTES` に従う。
- 処理時間: Lambdaタイムアウト内（既定 30s, 変数 `lambda_timeout_seconds` で調整）。
- メモリ: 画像サイズに応じて 512MB〜1024MB を推奨。

- `line`/`rectangle`/`circle`/`polygon`/`parallelogram` に従い描画された結果がS3に保存され、presigned URLが返る。
- `expiresAt` が実適用TTLに一致。
- 入力不正時に適切なエラー（400/422/415）が返る。
- CORSプリフライトが成功し、許可オリジンでの呼び出しが可能。

### 12. 用語・表現方針（CLI/WEB）
- CLI: 確認は2行型（案内行＋「〜しますか？ [y/N]」）で統一。情報メッセージは `ui::info`/`ui::warn` の通常文言を用い、`[HINT]` のような接頭辞は使用しない。
- Web: 画面内のガイダンスはユーザ向けの「ヒント」表現を据え置き、`statusBar` に短時間表示する。CLIの用語方針と混同しないよう役割を分離する。

---

本仕様（第2部: Lambda API）が問題なければ「承認」とご返信ください。承認後、リポジトリ再編（`web/`, `lambda/`）とサーバ実装に着手します。


### CI ポリシー（整形と静的検査）
- 目的: 人手のローカル整形を不要にし、main/PR を常時グリーンに保つ。
- 発火条件: push / pull_request / workflow_dispatch。
  - push: `infra/terraform` で `terraform fmt -recursive` を自動適用し、差分があれば bot 署名で自動コミット（当該ジョブのみ `permissions.contents: write`）。
  - PR: 自動整形は行わず、`terraform fmt -check -recursive -diff` の結果だけを出力。
- 失敗基準:
  - ShellCheck: scripts/**/*.sh は警告・エラーとも許容しない（ゼロ警告）。
  - Terraform: `fmt -check` 不整合、`validate` エラーで失敗。
- セキュリティ/最小権限:
  - 自動コミット権限は Terraform ジョブに限定。Pages/他ジョブへは付与しない。
  - fork からの PR では `contents: write` は無効化されるため自動コミットは発生しない（チェックのみ）。

#### 共有スクリプト（SSOT）の採用
- CI とローカルの挙動を一致させるため、以下を scripts/tools/ に配置し、CI はこれらを呼び出すのみとする（方針合意、実装はPRP‑004で行う）。
  - `lint_shell.sh` … ShellCheck 実行（`--strict` でエラー化）
  - `fmt_terraform.sh` … `--check|--write|--validate` を受け付ける統合スクリプト（作業ディレクトリは `infra/terraform`）
- 理由: DRY/SSOT・再現性・ベンダーロック最小化。Pages のみ GitHub 固有のため例外。

#### 出力/カラー方針（Why）
- 目的: CIログの機械可読性（検索性・注釈化・差分の明瞭化）と環境差の排除。
- ルール:
  - Terraform は CI では常に無色出力（`-no-color`）。TTY 判定に左右されず、同一表現で比較できる。
  - 人向けの可読性はシェルUI（`ui::info/ui::ok/ui::err`）側で担保する。
- 代替/拡張:
  - 共通変数 `NO_COLOR=1` や `TF_CLI_ARGS="-no-color"` も利用可能。
  - 将来、ローカルのみカラーを許す場合は scripts/tools へ色制御フラグ（`--color auto|always|never`）を追加する。

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

### 3. アーティファクト出力ポリシー（最新・最善・最高）
- 方針: Terraform モジュール直下の `build/` に生成物を一元化する。
  - 関数ZIP: `${path.module}/build/lambda.zip`（`archive_file` データソースが生成）。
  - レイヤZIP: `./build/pillow-layer.zip`（Terraform実行時の作業ディレクトリ＝`infra/terraform` 基準）。
- 理由（根拠）
  - 一貫性/整合: 関数・レイヤの出力場所を揃え、参照先/清掃手順を単純化。
  - 追跡外ポリシー: ルート `.gitignore` で `infra/terraform/build/` を丸ごと除外済み（誤コミット防止）。
  - 実行の堅牢性: `../../` など上位相対を避け、`terraform {cwd}=infra/terraform` 前提で最短・誤りにくい相対パスとする。
  - 再生成性: `scripts/deploy/build_layer.sh` で常に再生成でき、`rm -rf infra/terraform/build/` で安全に掃除可能。
- 変数と指定
  - `variable "pillow_layer_zip_path"` は `existing_layer_arn` 未指定時に使用。
  - 既定例（tfvars）: `pillow_layer_zip_path = "./build/pillow-layer.zip"`
  - 既存レイヤを使う場合は `existing_layer_arn` を優先し、`pillow_layer_zip_path` は空でもよい。
- クリーニング
  - ローカル生成物は `infra/terraform/build/` 配下に集約。不要時は同ディレクトリを削除すればよい。

---

## 付録: デプロイスクリプトのログ/出力規約（CLI）

目的: すべてのシェルスクリプトの出力仕様を統一し、可読性/再現性/保守性を高める。

1) 出力チャネルの使い分け
- 人間向けメッセージ（見出し/案内/確認/完了/警告/エラー/実行表示）は stderr に出力する（非TTYでも失敗しないこと）。
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
    - HEAD
      `[smoke] run: HEAD:` の次行に `curl -sS -L -I "<URL>"` を出力し、その次の行に `<URL>` を出力
  - 例（コマンド）:
    - `[deploy] run: tf_apply.sh:` の次行に `bash scripts/deploy/tf_apply.sh --yes`
    - `[tf] run: terraform apply:` の次行に `terraform apply -input=false -auto-approve`

4) 開始/終了タイムスタンプ
- 各スクリプトは開始時と終了時に時刻を出力する（deploy.sh準拠）。
  - 精度: ミリ秒（`ui::ts` を使用）。
  - 開始: `ui::info <tag> "----- start: $(ui::ts) -----"`
  - 終了: `ui::info <tag> "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "<diff_ms>")) -----"`
  - 経過時間: `ui::epoch_ms` でmsエポックを取り、差分を `ui::fmt_elapsed_ms` で短く整形（<60s: S.MMMs / <1h: M:SS.MMM / ≥1h: H:MM:SS.MMM）。
  - 実装: `scripts/lib/ui.sh` の `ui::ts`/`ui::epoch_ms` は `gdate`/GNU `date` 優先、無ければ Python3、最後に秒精度へフォールバック。

5) ヘルプ/usage/引数エラー
- `-h|--help` で `usage()` を表示する。引数不正時は `ui::err` を用いて終了する。
- usage本文はstdoutで問題ない。その他の案内はUI関数でstderrへ。

6) 確認プロンプト（Yes/No）
- 規約（2行型/既定N）に従い `ui::ask_yesno` を使用する。
  - 案内行: 「<行為>の前に確認します（既定: N）」
  - 本プロンプト: 「<行為>しますか？ [y/N]」

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
 - Function URL の `cors.allow_methods` は `POST` のみとする（検証上、`OPTIONS` はValidationで拒否される。プリフライトはFunction URL側で処理）。

### 4. 構成方法（Terraform→Lambda環境変数）
- 出力先S3（バケット/プレフィックス）や各種動作パラメータは、Terraformの変数でデプロイ時に指定し、Lambdaの環境変数へ反映する（API実行時に変更はしない）。
- 主要な環境変数:
  - `OUTPUT_BUCKET`（必須）: 出力先S3バケット
  - `OUTPUT_PREFIX`（任意）: 出力プレフィックス
  - `RESULT_FORMAT`: `png`|`jpeg`
  - `PRESIGN_TTL_DEFAULT_SECONDS`, `PRESIGN_TTL_MAX_SECONDS`, `TTL_SAFETY_MARGIN_SECONDS`
  - `IMAGE_URL_ALLOW_REGEX`, `MAX_IMAGE_BYTES`
  - `INTERNAL_CORS_ENABLED`（既定:false）

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

#### 6.1 推奨ビルド手順（Docker不要, arm64既定）
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
  Pillow==11.3.0
zip -r infra/terraform/build/pillow-layer.zip python
```

### 7. 命名規約（既定・固定リソース）
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
  pip install Pillow==11.3.0 -t python
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
- 認証確認（auth/profile 共通）の表示項目は「Profile（profile時のみ）/ Account / Arn / Region」。Region の解決順は `AWS_REGION` → `AWS_DEFAULT_REGION` → `aws configure get region`（profile時は `--profile` 指定があれば優先）。
 - setup の入力は「前段で既定値を明示」し、プロンプト自体には既定値を表示しない（Enterで既定値を採用）。対象: リージョン、アーキテクチャ、Pillowバージョン。
- Pillow の既定は latest（オンライン解決）。解決不能時は 11.3.0 にフォールバック。
 - 認証（auth）は、Terraform(AWS Provider v6) の互換性のため原則として環境変数ベースの一時クレデンシャルを用いる。既に認証済でもセッションでない場合は AssumeRole+MFA により一時クレデンシャルを発行する（対話/引数）。
- B案（ラッパー方式）: 認証は `with_aws.sh` 経由でプロセス内に注入し、そのまま後続コマンドを実行する。eval不要・ディスク非保存・対話/手動の体験一致。
 - apply は plan 完了後に TTY安全の確認（既定N）を行い、y の場合のみ `--yes` 付与で自動適用する。`--yes` または setup の自動承認がある場合は確認を省略して自動適用し、Terraform 標準の確認プロンプトには依存しない。
 
### 9.1 確認プロンプト規約（Yes/No, 統一ルール）
- 用途: 破壊的/影響大な操作（例: plan適用、ファイル上書き、削除等）の前には必ず表示する。
- 2行型で統一: 
  - 案内行: 「<行為>の前に確認します（既定: N）」
  - 本プロンプト: 「<行為>しますか？ [y/N]:」
- 既定: N（EnterでN）。受理: y/Y/yes/Yes を肯定、それ以外は否定。
- 実装API: `ui::ask_yesno` を用いる（Silent版は確認用途に使わない）。
- 軽微操作の最終確認（例: プロファイル選択確定）も同形式に揃える。
- 非Yes/No入力（文字列/数値など）は、前段で既定値を明示したうえで `ui::ask_silent` を用い、Enterで既定を採用させる。
- デバッグ出力: `DEPLOY_DEBUG=1` で追加ログ（runコマンド/フラグ/作業ディレクトリなど）を stderr に出力。
 - CI は OIDC（例: `aws-actions/configure-aws-credentials@v4`）で一時クレデンシャルを環境に注入し、Terraform は環境変数ベースで実行する。

---

## 第3部: デプロイ認証ラッパー仕様（with_aws.sh）

- 対象ファイル: `scripts/deploy/with_aws.sh`
- 目的: デプロイや運用コマンド実行時に、安全かつ最新推奨に沿った認証（短期クレデンシャル）を、対話/非対話の両方で簡便に提供する。
- 方針: AWS CLI v2 のプロファイル（SSO/Identity Center 含む）を第一候補とし、必要に応じてAssumeRole+MFAの手動フローを維持。

#### 設計判断の背景（要約）
- 2025-09: 調査の結果、人的アクセスは SSO/Identity Center + プロファイル（短期認証/自動更新）が最新・最善であることを確認。
- `mode=profile` を既定に採用し、`export-credentials` によるブリッジでレガシーツールにも対応。
- `mode=auth` はプロファイルを置けない・使えない制約下での例外運用（短期/臨時）に限定。将来は内部ライブラリ化/段階的非推奨を検討。

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
- 注意（長時間ジョブ）: `--format env` は自動更新しない。長時間実行が想定される場合は、プロファイル側で `credential_process`（process形式）を採用する運用を推奨（本仕様では挙動変更は行わない）。
- フォールバック: `export-credentials` の出力に `AWS_SESSION_TOKEN` が含まれない（非セッション）場合は、環境変数の注入は行わず `AWS_PROFILE=<NAME>` を設定して実行する（credential_process/SSO の自動更新を活かすため）。

#### 2.2 mode=auth（互換・現状維持）
- 役割: 指定した情報（ロールARN/MFA/ベースプロファイル等）から短期クレデンシャルを取得し、環境変数へ適用。
- 対話: ロールARN、MFAデバイスARN、MFAコード、ベースプロファイル（任意）を未指定時に対話で取得。
- AssumeRole を実施して新規の一時クレデンシャルを適用した場合は、`AWS_PROFILE` を明示的に `unset` して環境変数の一時クレデンシャルで固定。
- すでに短期認証済みの環境なら、新規AssumeRoleはスキップ（現行踏襲）。

補足: `auth` は「例外運用」の位置付けであり、日常運用は `profile` を用いる。

利用が適切な場面（例）:
- プロファイルを置けない/使えない制約環境（使い捨てコンテナ、ロックダウン端末など）。
- 緊急の“その場しのぎ”クロスアカウント作業（プロファイル整備の余裕がない）。
- ツール側が環境変数の短期クレデンシャル固定を前提とする場合。
- 明示的に `AWS_PROFILE` を無効化してSTSセッションのみで固定したい検証。

ユーザー入力（未指定時に対話）:
- 必須: `--role-arn`, `--mfa-arn`, `MFAコード(6桁)`。
- 任意: `--base-profile`（空可）, `--duration`（秒, 既定3600）。

### 3. UI/対話仕様（mode=profile, 未指定時）
- 一覧表示（例）:
```
利用可能なAWSプロファイル:
 1) default
 2) soracom-org
 3) tamasui
 4) soracom-dev
 5) soracom-sng
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
bash scripts/deploy/with_aws.sh --mode profile --profile soracom-dev -- aws sts get-caller-identity
```
- 互換（auth 継続利用）:
```bash
bash scripts/deploy/with_aws.sh --mode auth --base-profile default -- aws s3 ls
```

### 6. エラー/リカバリ
- AWS CLI 不在: 明示エラー（現行踏襲）。
- `export-credentials` 失敗: プロファイル名/SSOログイン状態/CLI v2 を案内。SSOの場合は `aws sso login --profile <NAME>` をガイド。
- 入力中止: `q` で 130 終了。

### 7. 非目標（今回の変更で扱わない範囲）
- 自動 `aws sso login` 実行（セキュリティ/同意の観点で行わない）。
- `credential_process` への自動切替（将来のドキュメント補強で案内可能）。
- `auth` モードの入力UI改善（今回は現状維持）。

### 8. 受け入れ基準
- `--profile` 未指定かつ `mode=profile` で、一覧→選択→確認→実行の対話が行える。
- 無効入力は再入力を促し、`q` で中断できる。
- SSO未ログイン時は適切にエラーメッセージと再ログイン手順を案内する。
- 既定モードが `profile` となり、`--mode auth` 明示で従来の `auth` フローが使える。

### 9. 実装方針（参考・この段階では未実装）
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
- `scripts/tools/upgrade_terraform_providers.sh` と同じく `scripts/tools/lib/ui.sh` を利用したログ体裁を採用。
- ワークスペースは `infra/terraform` ディレクトリに固定し、移動後にコマンドを実行する。

### 3. 入出力仕様
- 引数: なし（`-h|--help` のみサポート）。
- 標準出力:
  1. `terraform version` の結果（CLI・初期化済みプロバイダー版の概要）。
  2. `terraform providers` の結果（モジュール別の要求プロバイダーと採用バージョン）。
  3. `.terraform.lock.hcl` の内容から、`provider` / `version` / `constraints` を含む行のみをファイルの順序通りにそのまま出力（空行は原文どおり保持）。
- 標準エラー: ログメッセージ（`ui::info`/`ui::ok`/`ui::warn`/`ui::err`）。
- 退出コード: 正常終了で `0`。`.terraform.lock.hcl` が無い等の未初期化時は `1` を返し、初期化手順（`terraform init` または `scripts/tools/upgrade_terraform_providers.sh`）を案内。

### 4. 振る舞い
1. タイムスタンプ付きの開始/終了ログを出力（`upgrade_terraform_providers.sh` と同様のトラップ構造）。
2. `-h|--help` の場合は使用方法を表示して終了。
3. `infra/terraform` に移動し、`terraform` コマンドの存在を確認。無ければ明示エラー。
4. `.terraform.lock.hcl` が存在しない場合は `ui::err` で未初期化を通知し、終了コード1で停止。
5. `terraform version` と `terraform providers` を順に実行し、実行コマンドを `ui::run` で事前表示。
6. `.terraform.lock.hcl` を Bash のテキスト処理で先頭から走査し、`provider` / `version` / `constraints` を含む行のみを抽出して、そのまま順に出力（出力順はファイル順、同一ブロック内の空行も保持）。
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
