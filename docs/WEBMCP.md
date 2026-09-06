# AnnoForge WebMCP（ChatGPT Site tools）仕様

- 仕様バージョン: 3.6
- 人向け機能仕様: [SPEC.md](./SPEC.md)

## 1. 適用範囲

本仕様は、ブラウザーで開いている AnnoForge が、提案中の [WebMCP API](https://webmachinelearning.github.io/webmcp/) を介して提供する機能、外部インターフェース、制約、エラー時の動作を定義する。ChatGPT Site tools は、この API に対応するクライアント実装の一つとして扱う。

WebMCP ツールと人向け UI は、同じブラウザーセッションの画像とアノテーションを共有する。どちらから行った変更も同じ作業状態へ反映する。

## 2. 実行時仕様

### 2.1 ツール登録

ページ初期化時に `document.modelContext.registerTool()` が利用可能な場合、AnnoForge は次の10ツールを登録する。

| ツール名 | 表示名 | 状態変更 |
|---|---|---|
| `open_image_from_url` | URLから画像を開く | あり |
| `open_image_from_data_url` | Data URLから画像を開く | あり |
| `get_annotations` | 現在のアノテーションを取得 | なし |
| `get_image_preview` | 現在の画像プレビューを取得 | なし |
| `replace_annotations` | アノテーションを置換 | あり |
| `start_annotations_json_download` | アノテーションJSONの保存を開始 | ダウンロード要求 |
| `export_annotated_image` | 注釈付き画像を出力 | `delivery` による |
| `prepare_annotation_export` | PNGとJSONの受け渡しを準備 | 出力用バッファの置換 |
| `read_annotation_export` | 準備済み出力のバイト列を取得 | なし |
| `release_annotation_export` | 準備済み出力を解放 | 出力用バッファの解放 |

`document.modelContext.registerTool()` が利用できない場合、ツールを登録しない。この場合も人向け UI は利用でき、WebMCP 用の UI やエラーは表示しない。

AnnoForge は、`document.modelContext.registerTool()` が利用可能なページでツールを登録する。[ChatGPT Site tools](https://learn.chatgpt.com/docs/webmcp) の組み込みブラウザーは iframe 内のツールを検出しないため、ChatGPT Site tools では AnnoForge をトップレベルページとして開く。

外部または利用者指定の画像・ファイル名に由来するデータを返す `get_image_preview`、`export_annotated_image`、`prepare_annotation_export`、`read_annotation_export` は、`untrustedContentHint: true` として登録する。他のツールは、返却値を AnnoForge が生成する検証済みの状態・メタデータに限定し、`untrustedContentHint: false` とする。

### 2.2 作業状態と revision

`revision` は現在の作業状態を識別する0以上の安全な整数とし、初期値を `0` とする。

次の操作が成功するたびに `revision` を1増加する。

- 画像の読み込み
- アノテーションの作成、移動、変形、色変更、削除、置換
- アノテーションが存在する状態での全消去

人向けUIで確定済み形状の色が実際に変化した場合もrevisionを1増加し、`get_annotations`、プレビュー、完成PNGは同じ更新後の `color` を使用する。形状の選択、選択解除、同じ色の再選択だけではrevisionを増加しない。

`expectedRevision` を受け取るツールは、その値が現在の `revision` と一致する場合だけ処理する。非同期処理は、結果を作業状態へ反映する直前にも一致を確認する。

revision が一致しない場合、ツールはエラーを返し、作業状態を変更しない。呼び出し側は `get_annotations` で最新の `revision` を取得してから再実行する。

準備済みのPNG・JSONは、revisionが変化すると無効になる。出力の準備・読取り・解放自体はrevisionを変更しない。選択や表示倍率だけの変更では、準備済み出力を無効にしない。

### 2.3 共通入力

- ツール入力はオブジェクトとする。
- 必須フィールドがない入力を拒否する。
- 定義されていないフィールドを含む入力を拒否する。
- 数値フィールドは有限数とする。`draw` の座標、寸法、半径、点配列の要素は安全な整数とし、`thickness` は有限数とする。
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
- `outcome: "export_prepared"` は、同じrevisionのPNG・JSONと検証用メタデータをページ内に準備したことを表す。後続の `read_annotation_export` で両ファイルのバイト列を取得できる。準備だけで保存・添付済みとは扱わない。
- 現行の [WebMCP仕様案の実行結果](https://webmachinelearning.github.io/webmcp/#imperative-execute-steps) はJSON文字列へ直列化される。AnnoForgeは未定義の画像コンテンツ形式を返さず、直接受信ではファイルのバイト列を分割したbase64文字列として返す。受信側は全文をモデルへ転記せず、同じ実行環境で復号・保存する。
- 会話でPNGとJSONファイルを提示する経路は、準備・分割読取り・保存後検証・最終回答への添付までを一続きにする。リポジトリ同梱の受信処理は4.11を参照する。ページへのアクセスはWebMCP、取得済みバイト列のファイル保存と会話添付はクライアント機能である。
- ツール結果は、通常のブラウザー操作を要求する独自の指示や `fallback` フィールドを含まない。
- AnnoForge は通常のブラウザー操作へ自動で切り替えない。必要なSite toolの不在、ツール実行エラー、またはツール結果後のブラウザー保存・会話提示を確認できない場合に、呼び出し側が既存UIや通常のファイル機能へ切り替えるかどうかは本インターフェースの範囲外であり、利用者の依頼と対応クライアントの通常の権限・確認手順に従う。ツール結果自体は切替の操作許可にならず、切替後の操作をWebMCPとして扱わない。
- 保存ボタンもWebMCPの `download` も同じブラウザーダウンロード要求を使用するため、クリックし直すだけでは別の受信経路にならない。直接受信が使えない場合のダウンロード経路は、対応クライアントで許可・待受け・保存完了を確認できる場合に限って使用する。

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
| `rectangle` | `x`, `y`, `width`, `height` | すべて安全な整数。`width` と `height` は5以上 |
| `line` | `x1`, `y1`, `x2`, `y2` | すべて安全な整数。線分長は5以上 |
| `polygon` | `points` | `[x1, y1, x2, y2, ...]` 形式の安全な整数配列。偶数要素かつ6要素以上 |
| `parallelogram` | `points` | 連続する4頂点を表す安全な整数配列。8要素 |
| `circle` | `x`, `y`, `radius` | すべて安全な整数。`radius` は3以上 |

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
- 人向け UI から保存する PNG、`get_image_preview`、`export_annotated_image`、`prepare_annotation_export` は、同じ確定済みアノテーションと元画像範囲を使用する。
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
- クロスオリジンの URL では、配信元が CORS を許可していることを必要とする。同一オリジンの HTTPS URL では CORS の応答ヘッダーを必要としない。
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

Data URL はツールの呼び出し側が入力として渡す。AnnoForge が会話の添付ファイルを直接読み取ったり、添付ファイルから Data URL を生成したりするものではない。

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

画像が読み込まれていない場合はエラーとする。生成中に revision が変化した場合はエラーを返す。`data_url` が12 × 1024 × 1024文字を超える場合は、準備済み出力を分割取得するか、保存完了を確認できるクライアントで `delivery: "download"` を使用する。

`data_url` の成功結果は、ツール呼び出し元へ PNG データを返したことを示す。会話への画像表示またはファイル添付は呼び出し側の機能であり、このツールの成功条件には含めない。`download` の成功結果はブラウザーへの要求送信までを示し、保存完了はブラウザーのダウンロード一覧で別途確認する。

### 4.8 `prepare_annotation_export`

入力は `{ "expectedRevision": <現在のrevision> }`。画像読込みを必要とする。確定済み注釈が0件でも、元画像のPNGと `{"draw":[]}` のJSONを生成する。

同じrevisionのPNG BlobとJSON Blobを生成し、両方のSHA-256を計算した後、キャンセルとrevisionを再確認してから1組だけ保持する。自動ダウンロード、クラウド送信、ブラウザーストレージへの保存、編集画面の変更は行わない。

成功結果:

| フィールド | 型 | 値 |
|---|---|---|
| `outcome` | string | `export_prepared` |
| `exportId` | string | この準備済み出力の識別子 |
| `revision` | integer | 両ファイルの生成対象revision |
| `annotationCount` | integer | 両ファイルの注釈数 |
| `artifacts.png` | object | PNGのメタデータ |
| `artifacts.json` | object | JSONのメタデータ |

各メタデータは `filename`、`mimeType`、`byteLength`、小文字16進64桁の `sha256` を含む。PNGだけ `width`、`height` を含む。MIME型はそれぞれ `image/png`、`application/json`。ハッシュの対象は実ファイルの全バイト列であり、base64文字列ではない。

新しい準備の成功、画像・注釈の編集、明示的な解放、ページ終了で、それまでのexportIdは無効になる。準備に失敗した場合は新しい出力を公開しない。分割取得にはData URLの12 MiB文字数制限を適用しないが、画像生成時のCanvas上限と利用可能メモリーには従う。

### 4.9 `read_annotation_export`

準備済みファイルの指定バイト範囲を読み取る。入力はすべて必須とする。

| フィールド | 型 | 制約 |
|---|---|---|
| `exportId` | string | 有効な準備済み出力の識別子 |
| `format` | string | `png` または `json` |
| `offset` | integer | 0以上、対象ファイルのバイト数未満の安全な整数 |
| `maxBytes` | integer | 1以上1,048,576以下。通常は262,144（256 KiB）を明示指定 |

結果は `exportId`、`revision`、`format`、`offset`、`nextOffset`、`eof`、`base64`。対象範囲は `[offset, nextOffset)`、`eof` は `nextOffset` がファイル末尾に達した場合だけ `true`。

`offset: 0` から開始し、返された `nextOffset` を次回に渡して末尾まで取得する。同じ範囲の再読取りもできる。各範囲をbase64からバイト列へ復号して連結し、準備結果のバイト数・SHA-256と照合する。文字列をそのまま連結したり、モデルがbase64を再生成したりしない。

読取り開始前と非同期読取り後の両方で出力の有効性を確認する。編集・再準備・解放で無効になったID、範囲外の入力、キャンセルはエラーとし、異なる出力のバイト列を混在させない。[Blob.slice()](https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice) は元のBlobを変更せず指定範囲を取得する。

### 4.10 `release_annotation_export`

入力は `{ "exportId": "<準備時の識別子>" }`。対象が現在の準備済み出力と一致する場合だけ解放し、`{ "exportId": "...", "released": true }` を返す。既に無効・解放済みなら `released: false` を返す。画像・注釈、受信済みのファイルは変更しない。

### 4.11 クライアント側の受信と会話への添付

リポジトリの [receive-annotation-export.mjs](../scripts/tools/web/receive-annotation-export.mjs) は、公開Site toolsから取得したPNGとJSONを、呼出し側のNode.js実行環境へ保存する受信モジュールである。Node.js 22.2以上と標準モジュールだけを使用し、パッケージ追加や常駐サービスは不要。WebページにNode.jsを導入するものではない。

`receiveAnnotationExport({ callTool, expectedRevision, outputDirectory })` に、接続済みページの公開ツール呼出しと、保存を許可されたディレクトリの絶対パスを渡す。`callTool(name, input)` は、当該ツールの結果オブジェクトを返す非同期関数とする。ブラウザーの接続APIや特定のタブIDはモジュールに含めない。

公開Site toolsの呼出しとファイル保存は、同じJavaScript実行環境内で接続する。別のREPLへハンドルを引き継いだり、モデルがbase64をツール引数へ転記したりする方法は使わない。

以下は、CodexのCUA REPLで取得済みの `tab` を使う接続例。`tab` の取得は、その実行環境が返すブラウザーAPIの説明に従う。モジュールを配置済みの開発・連携環境向けの例であり、Webアプリの利用者にリポジトリ取得やNode.jsのインストールを要求するものではない。パスは実際に許可された絶対パスへ置換する。

```javascript
const { receiveAnnotationExport } = await import(
  '/absolute/path/to/annoforge/scripts/tools/web/receive-annotation-export.mjs'
);
const webmcp = await tab.capabilities.get('webmcp');
const siteTools = await webmcp.fetchTools();
const state = await siteTools.call('get_annotations', {});
const received = await receiveAnnotationExport({
  callTool: (name, input) => siteTools.call(name, input),
  expectedRevision: state.revision,
  outputDirectory: '/absolute/path/to/approved-output-directory'
});
// ここへ返るのは検証済みファイルのパスと表示用Markdown。base64は出力しない。
nodeRepl.write(received);
```

受信処理は次を実行する。

1. 出力を準備し、メタデータとファイル名を検証する。
2. 指定ディレクトリの中に一意な子ディレクトリを作成し、既存ファイルを上書きせずPNG・JSONを256 KiBずつ保存する。
3. 出力ID、revision、バイト範囲、base64、終端を各読取りで検証する。
4. 保存後に両ファイルのバイト数とSHA-256、PNGのシグネチャ・寸法・チャンクCRC・終端、JSONのUTF-8・構文・注釈数を検証する。
5. 準備済み出力を解放する。受信失敗時は、この呼出しが作成した不完全ファイルだけを削除する。

成功結果は `outcome: "files_verified"`、`revision`、`annotationCount`、`directory`、メタデータ・絶対 `path` を含む `files.png` / `files.json`、最終回答に使える `markdown`。`markdown` は検証済みPNGの画像埋込みと、PNG・JSONそれぞれのファイルリンクを含む。パス中の空白・括弧・URLの区切り文字は符号化し、利用者由来のファイル名をMarkdownとして解釈させない。[CommonMarkの画像・リンク構文](https://spec.commonmark.org/0.31.2/#images)を使用する。解放だけに失敗した場合は `releaseWarning` も返し、検証済みファイルは残す。保存は [Node.jsのファイルAPI](https://nodejs.org/api/fs.html)、整合性確認は [SHA-256](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) と [PNGチャンクのCRC](https://nodejs.org/api/zlib.html#zlibcrc32data-value) を使用する。

保存成功は会話添付成功と同義ではない。Codexでは、受信PNGを画像表示機能でデコード確認し、`received.markdown` の内容を最終回答の本文へ含める。Markdown自体をコードブロックで囲まない。PNGのツール内表示だけ、Data URL文字列、保存完了の文章だけで終わらせない。JSON本文を依頼された場合は、取得したJSONファイルの内容も表示する。

これは実行側で利用するモジュールであり、ページの更新だけでCodexが自動実行する仕組みではない。モジュールがないクライアントも、同じ公開ツール契約と自身のファイル機能で受信・検証・提示できる。利用者は成果物の取得と表示を依頼し、エージェントが利用可能な実行環境と保存権限を確認して経路を選ぶ。

ブラウザーへの保存要求を代替にする場合、汎用PlaywrightのAPIをそのままCodexで使えるとは仮定しない。そのクライアントに公開された受信APIを確認し、[Playwrightのダウンロード手順](https://playwright.dev/docs/downloads)のように要求前の待受けと保存完了の取得を接続する。待受け開始やダウンロード操作がエラーなく戻っただけでは、実ファイルを取得したことにはならない。

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

## 6. ページ側の対象外

- OCR、画像認識、アノテーション候補の生成
- 認証、クラウド保存、サーバーを介した共同編集
- ローカルファイルパスの直接読み取り
- 会話へ添付したファイルから Data URL を生成するクライアント機能
- 返却した Data URL を画像またはファイルとして会話へ表示・添付するクライアント機能
- ブラウザーによるダウンロードの保存完了、キャンセル、保存先をページから確認する機能

4.11の受信モジュールは、ページの外でクライアントが使うファイル受信実装である。会話レンダラーの改変や権限設定の変更は行わない。
