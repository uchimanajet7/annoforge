# AnnoForge WebMCP 仕様

- 仕様バージョン: 3.3
- 人向け機能仕様: [SPEC.md](./SPEC.md)

## 1. 適用範囲

本仕様は、ブラウザーで開いている AnnoForge が WebMCP を介して提供する機能、外部インターフェース、制約、エラー時の動作を定義する。

WebMCP ツールと人向け UI は、同じブラウザーセッションの画像とアノテーションを共有する。どちらから行った変更も同じ作業状態へ反映する。

## 2. 実行時仕様

### 2.1 ツール登録

ページ初期化時に `document.modelContext.registerTool()` が利用可能な場合、AnnoForge は次の7ツールを登録する。

| ツール名 | 表示名 | 状態変更 |
|---|---|---|
| `open_image_from_url` | URLから画像を開く | あり |
| `open_image_from_data_url` | Data URLから画像を開く | あり |
| `get_annotations` | 現在のアノテーションを取得 | なし |
| `get_image_preview` | 現在の画像プレビューを取得 | なし |
| `replace_annotations` | アノテーションを置換 | あり |
| `start_annotations_json_download` | アノテーションJSONの保存を開始 | ダウンロード要求 |
| `export_annotated_image` | 注釈付き画像を出力 | `delivery` による |

`document.modelContext.registerTool()` が利用できない場合、ツールを登録しない。この場合も人向け UI は利用でき、WebMCP 用の UI やエラーは表示しない。

ツールは AnnoForge のトップレベルページが登録する。iframe 内のページからは登録しない。

### 2.2 作業状態と revision

`revision` は現在の作業状態を識別する0以上の安全な整数とし、初期値を `0` とする。

次の操作が成功するたびに `revision` を1増加する。

- 画像の読み込み
- アノテーションの作成、移動、変形、色変更、削除、置換
- アノテーションが存在する状態での全消去

人向けUIで確定済み形状の色が実際に変化した場合もrevisionを1増加し、`get_annotations`、プレビュー、完成PNGは同じ更新後の `color` を使用する。形状の選択、選択解除、同じ色の再選択だけではrevisionを増加しない。

`expectedRevision` を受け取るツールは、その値が現在の `revision` と一致する場合だけ処理する。非同期処理は、結果を作業状態へ反映する直前にも一致を確認する。

revision が一致しない場合、ツールはエラーを返し、作業状態を変更しない。呼び出し側は `get_annotations` で最新の `revision` を取得してから再実行する。

### 2.3 共通入力

- ツール入力はオブジェクトとする。
- 必須フィールドがない入力を拒否する。
- 定義されていないフィールドを含む入力を拒否する。
- 数値フィールドは有限数とする。
- `revision` と `expectedRevision` は0以上の安全な整数とする。
- ツールは `AbortSignal` によるキャンセルを受け付ける。

### 2.4 共通エラー動作

次の場合、ツールはエラーを返す。

- 入力がスキーマに一致しない
- `expectedRevision` が現在の `revision` と一致しない
- 実行がキャンセルされた
- 画像の取得、デコード、描画、または PNG 変換に失敗した
- 出力を要求された寸法で生成できない
- ツール固有の事前条件を満たさない

エラー時は画像とアノテーションを変更しない。ダウンロードを行うツールは、出力の生成と revision の再確認が完了するまでブラウザーへダウンロードを要求しない。

### 2.5 出力結果とフォールバックの境界

- ファイル出力は、成果物の生成、ブラウザーへのダウンロード要求、ブラウザーによる保存完了、会話への表示または添付を別の状態として扱う。
- `outcome: "download_requested"` は、AnnoForge が成果物を生成し、ブラウザーへダウンロード要求を送信したことだけを表す。ブラウザーによる保存完了、キャンセル、保存先は確認していない。
- `outcome: "data_returned"` は、Data URL を WebMCP のツール結果オブジェクト内の文字列として呼び出し元へ返したことだけを表す。呼び出し元による画像表示、ファイル化、会話添付は確認していない。
- ツール結果は、通常のブラウザー操作を実行する許可や指示を含まない。WebMCP ツールがエラーになった場合または保存完了を確認できない場合、呼び出し側は、利用者が通常のブラウザー操作を許可しているときだけ、既存の画面上の保存操作を使用できる。
- AnnoForge は WebMCP 失敗時に通常のブラウザー操作へ自動で切り替えず、独自の `fallback` フィールドも返さない。実行経路の選択と権限確認は呼び出し側の責務とする。

## 3. データ仕様

### 3.1 画像入力

対応形式は PNG、JPEG、WebP とする。

URL から取得する画像データは12 MiB以下とする。Data URL は12 × 1024 × 1024文字以下、復号後の画像データは12 MiB以下とする。

### 3.2 アノテーション JSON

アノテーションは、元画像の左上を原点とするピクセル座標で表す。

```json
{
  "draw": []
}
```

`draw` の各要素は、形状ごとに定義されたフィールドだけを持つ。

共通フィールド:

| フィールド | 型 | 制約 |
|---|---|---|
| `shape` | string | `rectangle`、`line`、`polygon`、`parallelogram`、`circle` のいずれか |
| `color` | string | 先頭の `#` を省略できる6桁 HEX |
| `thickness` | number | 0より大きい有限数。単位は元画像座標系の px |

形状別フィールド:

| `shape` | フィールド | 制約 |
|---|---|---|
| `rectangle` | `x`, `y`, `width`, `height` | すべて有限数。`width` と `height` は5以上 |
| `line` | `x1`, `y1`, `x2`, `y2` | すべて有限数。線分長は5以上 |
| `polygon` | `points` | `[x1, y1, x2, y2, ...]` 形式の有限数配列。偶数要素かつ6要素以上 |
| `parallelogram` | `points` | 連続する4頂点を表す有限数配列。8要素 |
| `circle` | `x`, `y`, `radius` | すべて有限数。`radius` は3以上 |

回転角はアノテーション JSON に含めない。

### 3.3 画像出力

- 出力形式は PNG とする。
- 最終画像の範囲は元画像の境界とする。
- 最終画像の寸法は元画像の `naturalWidth × naturalHeight` とする。
- 表示領域の余白を含めない。
- `thickness` は元画像座標系の px で描画する。
- パン、ズーム、フィット倍率、ステージ位置、ステージ寸法、ウィンドウ寸法の影響を受けない。
- 作図中の図形、Transformer、頂点アンカー、スナップマーカー、選択枠、ガイド、一時的な強調表示を含めない。
- 矩形と円に現在の回転がある場合、その回転を反映する。
- 人向け UI から保存する PNG、`get_image_preview`、`export_annotated_image` は、同じ確定済みアノテーションと元画像範囲を使用する。
- ブラウザーの Canvas 上限を超える場合はエラーとする。製品固有の固定寸法上限は設けない。

## 4. ツール仕様

### 4.1 `open_image_from_url`

指定した URL から画像を読み込み、現在の画像を置換する。

入力:

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `expectedRevision` | integer | 必須 | 現在の `revision` と一致する0以上の安全な整数 |
| `url` | string | 必須 | 資格情報を含まない絶対 URL |

URL の許可条件:

- HTTPS URL を許可する。
- HTTP URL は、現在のページが `127.0.0.1`、`localhost`、または `::1` の HTTP ページであり、画像 URL がそのページと同一オリジンの場合だけ許可する。
- リダイレクト後の URL にも同じ条件を適用する。
- 取得時に資格情報とリファラーを送信せず、キャッシュを使用しない。
- 配信元が CORS を許可していることを必要とする。
- HTTP 応答、MIME、データサイズ、画像デコードを検証する。

成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `loaded` | boolean | `true` |
| `revision` | integer | 読み込み後の revision |
| `image.originalWidth` | integer | 元画像の幅 |
| `image.originalHeight` | integer | 元画像の高さ |

成功時は既存のアノテーションをすべて消去し、`revision` を1増加する。

### 4.2 `open_image_from_data_url`

指定した Data URL から画像を読み込み、現在の画像を置換する。

入力:

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `expectedRevision` | integer | 必須 | 現在の `revision` と一致する0以上の安全な整数 |
| `dataUrl` | string | 必須 | `data:image/png;base64,`、`data:image/jpeg;base64,`、`data:image/webp;base64,` のいずれかで始まる base64 Data URL |

Data URL の構文、文字数、base64、復号後サイズ、画像デコードを検証する。

成功結果と状態変更は `open_image_from_url` と同じとする。

### 4.3 `get_annotations`

現在のアノテーションと画像状態を取得する。作業状態は変更しない。

入力は空のオブジェクト `{}` とする。

成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `revision` | integer | 現在の revision |
| `draw` | array | 3.2で定義した全アノテーション |
| `annotationCount` | integer | `draw` の要素数 |
| `image.loaded` | boolean | 画像が読み込まれている場合は `true` |
| `image.originalWidth` | integer または null | 元画像の幅。未読み込み時は `null` |
| `image.originalHeight` | integer または null | 元画像の高さ。未読み込み時は `null` |

画像データとローカルファイル名は返さない。

### 4.4 `get_image_preview`

現在の画像と確定済みアノテーションを PNG Data URL として取得する。作業状態は変更しない。

入力:

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `maxDimension` | integer | 任意 | 64以上2048以下。既定値は1024 |

出力寸法は次の倍率で求め、各辺を整数へ丸める。

```text
scale = min(1, maxDimension / max(originalWidth, originalHeight))
```

元画像の縦横比を維持し、元画像より拡大しない。生成中に revision が変化した場合はエラーを返す。

成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `revision` | integer | 生成対象の revision |
| `annotationCount` | integer | アノテーション数 |
| `mimeType` | string | `image/png` |
| `width` | integer | プレビューの幅 |
| `height` | integer | プレビューの高さ |
| `dataUrl` | string | PNG Data URL |

画像が読み込まれていない場合はエラーとする。Data URL が12 × 1024 × 1024文字を超える場合は、`maxDimension` を小さくして再実行する。

### 4.5 `replace_annotations`

現在の全アノテーションを指定した `draw` で置換する。

入力:

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `expectedRevision` | integer | 必須 | 現在の `revision` と一致する0以上の安全な整数 |
| `draw` | array | 必須 | 3.2で定義したアノテーション配列 |

全要素の検証に成功した場合だけ置換する。空配列は全消去とする。成功時は `revision` を1増加する。

成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `replaced` | boolean | `true` |
| `annotationCount` | integer | 置換後のアノテーション数 |
| `revision` | integer | 置換後の revision |

### 4.6 `start_annotations_json_download`

現在のアノテーション JSON を生成し、ブラウザーへダウンロードを要求する。

入力:

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `expectedRevision` | integer | 必須 | 現在の `revision` と一致する0以上の安全な整数 |

アノテーションが1件以上ある場合だけダウンロードを要求する。アノテーションがない場合はエラーとする。

成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `outcome` | string | `download_requested` |
| `requestDispatched` | boolean | `true` |
| `completionVerified` | boolean | `false` |
| `filename` | string | ダウンロード要求に指定したファイル名 |
| `mimeType` | string | `application/json` |
| `byteLength` | integer | 生成した JSON Blob のバイト数 |
| `revision` | integer | ダウンロード対象の revision |
| `annotationCount` | integer | アノテーション数 |

成功結果はブラウザーへの要求送信までを示す。保存完了は、利用者または呼び出し側がブラウザーのダウンロード一覧で確認する。

### 4.7 `export_annotated_image`

現在の注釈付き PNG を Data URL として返すか、ブラウザーへダウンロードを要求する。

入力:

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `expectedRevision` | integer | 必須 | 現在の `revision` と一致する0以上の安全な整数 |
| `delivery` | string | 必須 | `data_url` または `download` |

`delivery: "data_url"` の成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `outcome` | string | `data_returned` |
| `delivery` | string | `data_url` |
| `revision` | integer | 出力対象の revision |
| `annotationCount` | integer | アノテーション数 |
| `mimeType` | string | `image/png` |
| `width` | integer | 元画像の幅 |
| `height` | integer | 元画像の高さ |
| `dataUrl` | string | PNG Data URL |

`delivery: "download"` の成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `outcome` | string | `download_requested` |
| `requestDispatched` | boolean | `true` |
| `completionVerified` | boolean | `false` |
| `filename` | string | ダウンロード要求に指定したファイル名 |
| `mimeType` | string | `image/png` |
| `byteLength` | integer | 生成した PNG Blob のバイト数 |
| `revision` | integer | ダウンロード対象の revision |
| `annotationCount` | integer | アノテーション数 |
| `width` | integer | 元画像の幅 |
| `height` | integer | 元画像の高さ |

画像が読み込まれていない場合はエラーとする。生成中に revision が変化した場合はエラーを返す。`data_url` が12 × 1024 × 1024文字を超える場合は、`delivery: "download"` を使用する。

`data_url` の成功結果は、ツール呼び出し元へ PNG データを返したことを示す。会話への画像表示またはファイル添付は呼び出し側の機能であり、このツールの成功条件には含めない。`download` の成功結果はブラウザーへの要求送信までを示し、保存完了はブラウザーのダウンロード一覧で別途確認する。

## 5. ローカル静的サーバー仕様

### 5.1 外部インターフェース

起動コマンド:

```bash
bash scripts/tools/web/start-local-web.sh
```

位置引数は受け付けない。`--help` または `-h` を指定した場合は使用方法を表示して終了する。

| 項目 | 値 |
|---|---|
| 既定 URL | `http://127.0.0.1:8000/` |
| 配信ルート | `web/` |
| 停止操作 | 起動したターミナルで `Ctrl+C` |

環境変数:

| 環境変数 | 制約または動作 |
|---|---|
| `SWS_PORT` | 1以上65535以下の整数。既定値は8000 |
| `SWS_VERSION` | `version`、`vversion`、または `latest`。指定した版を取得または再利用する |
| `SWS_AUTO_UPDATE=1` | 配置済みの版より新しい安定版がある場合、確認せず更新する |
| `SWS_ASSUME_YES=1` | 更新確認を Yes として扱う |
| `SWS_ASSUME_NO=1` | 配置済みの版を継続利用する |
| `SWS_FORCE_KILL=1` | SIGTERM 後も残る対象プロセスを、追加確認なしで SIGKILL する |

### 5.2 対応環境

| OS | アーキテクチャ |
|---|---|
| macOS | arm64、x86_64 |
| Linux GNU | aarch64、x86_64、armv7 |

必要コマンドは `curl`、`jq`、`tar`、`lsof`、`ps`、および SHA-256 を計算できる `shasum` または `sha256sum` とする。対応外の環境では実行ファイルを推測せず、エラーを表示して終了する。

### 5.3 起動時の動作

- 起動のたびに Static Web Server の最新安定版を確認する。
- 実行ファイルがない場合は、対応するリリースアセットを取得する。
- 取得した実行ファイルは、公開された SHA-256 digest と版番号の検証に成功した場合だけ配置する。
- 配置済みの版と最新安定版が異なる場合、対話環境では更新するか確認する。既定値は Yes とする。
- 非対話環境では、`SWS_AUTO_UPDATE=1` または `SWS_ASSUME_YES=1` がない限り配置済みの版を置換しない。
- サーバーは `127.0.0.1` だけで待ち受ける。
- `web/` の外部、ディレクトリ一覧、シンボリックリンク先を配信しない。
- 配信するファイルには `Cache-Control: no-store` を付与する。
- 指定ポートが使用中の場合は対象プロセスを表示する。対話環境では停止確認を既定値 No で行い、非対話環境では既存プロセスを停止せず終了する。
- `Ctrl+C` または SIGTERM を受けた場合は、起動したサーバープロセスだけを停止する。

## 6. 対象外

- OCR、画像認識、アノテーション候補の生成
- 認証、クラウド保存、サーバーを介した共同編集
- ローカルファイルパスの直接読み取り
- 会話へ添付したファイルから Data URL を生成するクライアント機能
- 返却した Data URL を画像またはファイルとして会話へ表示・添付するクライアント機能
- ブラウザーによるダウンロードの保存完了、キャンセル、保存先をページから確認する機能
