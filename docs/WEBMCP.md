# AnnoForge WebMCP 仕様

- 仕様バージョン: 3.2
- 対象: `web/app.js` と `scripts/tools/web/`
- 人向け機能仕様: `docs/SPEC.md`
- 状態: 実装対象として確定

## 1. 目的

AnnoForge の同じ画面と同じ作業状態を、人と AI エージェントの双方が利用できるようにする。WebMCP 対応の通常経路は、エージェントが画像を開き、現在状態を確認し、アノテーションを反映し、結果を画像として受け取るところまでを一つのブラウザーセッションで完結させる。

WebMCP はコンテスト専用機能として扱わない。画像注釈作業を自動化・共同作業できる恒久的な製品機能として実装し、その結果として OpenAI WebMCP Challenge に応募可能な状態にする。

## 2. 参照仕様と採用判断

| 参照先 | 採用する内容 |
|---|---|
| [OpenAI WebMCP](https://learn.chatgpt.com/docs/webmcp) | ライブページ内のツール、トップレベル JavaScript からの命令的登録、狭い入力、検証可能な結果、人向け UI の維持 |
| [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/) | usefulness、execution、thoughtful WebMCP integration、human-agent experience を応募品質の判断軸にする |
| [WebMCP API draft](https://webmachinelearning.github.io/webmcp/) | `document.modelContext.registerTool()`、JSON Schema、`execute`、`AbortSignal` |
| [Chrome: Build tools](https://developer.chrome.com/docs/ai/webmcp/build-tools) | 明確なツール名、説明、入力スキーマ、実行結果 |
| [Chrome: Best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices) | 一つの目的に絞ったツール、状態の返却、既存 UI と同じ業務ロジックの利用 |
| [Chrome: Secure tools](https://developer.chrome.com/docs/ai/webmcp/secure-tools) | 入力検証、最小権限、競合する状態変更の防止 |
| [Konva Canvas Editor](https://konvajs.org/docs/sandbox/Canvas_Editor.html) | 画面上の Konva ノードではなく文書データを正本にし、固定したページ範囲を出力する構成 |
| [Konva Canvas Export](https://konvajs.org/docs/posts/canvas-export-image.html) | 出力範囲・倍率を明示した Canvas、Data URL、Blob の使い分け |
| [Label Studio export](https://labelstud.io/guide/export.html) | 画像注釈の座標と寸法を元画像の幅・高さへ結び付ける考え方 |
| [Figma static export](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma) | 表示ビューポートではなく選択対象・スライスの境界を成果物の範囲にする一般的な編集製品の挙動 |
| [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) | 最新安定版の判定、リリースアセット URL と SHA-256 digest の取得 |
| [Static Web Server](https://github.com/static-web-server/static-web-server/releases) | loopback に限定した静的配信、グレースフル終了、安全な既定値 |
| [ScanForge の SWS 起動処理](https://github.com/uchimanajet7/scanforge/blob/main/scripts/tools/web/run-sws.sh) | 起動時の最新版確認、更新確認、ポート競合処理、子プロセスの終了管理 |

ChatGPT の WebMCP 経路では、トップレベルページの JavaScript から命令的 API を使う。宣言的 API や iframe 内登録には依存しない。別プロセスの MCP サーバーは作らず、ツールは開いている AnnoForge ページの状態を直接操作する。

## 3. 製品境界

### 3.1 維持する人向け機能

- ファイル選択とドラッグ＆ドロップによる画像読込
- 矩形、直線、多角形、平行四辺形、円の作成・編集・削除
- JSON の表示、コピー、インポート、ダウンロード
- 注釈付き PNG のダウンロード
- ズーム、パン、色選択、全消去
- `file:` で直接開く既存利用

WebMCP のために、人向け UI のラベル、配置、操作手順、JSON 形式は変更しない。人向け PNG は UI、PNG 形式、ファイル名規則を維持しつつ、表示用ステージ全体を保存していた不正確な処理から、元画像の寸法・範囲を保存する共通出力へ修正する。

### 3.2 WebMCP が追加する機能

- URL または Data URL から画像を開く
- 現在のアノテーション JSON を取得する
- 現在の注釈付き画像をプレビューする
- 全アノテーションを置換する
- JSON の人向けダウンロードを開始する
- 注釈付き PNG をエージェントへ返す、または人向けダウンロードを開始する

### 3.3 対象外

- 会話への添付ファイルを ChatGPT クライアントがどの形式でツールへ渡すかの保証
- OCR、画像認識、注釈候補の生成など、AnnoForge 本体に存在しない判断機能
- 認証、クラウド保存、共同編集サーバー
- コンテスト終了後に不要になる応募専用 UI・モード・メタデータ
- Lambda、S3、Terraform、既存 API の変更

## 4. 共通契約

### 4.1 登録

`typeof document.modelContext?.registerTool === "function"` の場合だけ、DOMContentLoaded 後に7ツールを次の順で登録する。

1. `open_image_from_url`
2. `open_image_from_data_url`
3. `get_annotations`
4. `get_image_preview`
5. `replace_annotations`
6. `start_annotations_json_download`
7. `export_annotated_image`

API が存在しない通常ブラウザーでは登録を行わず、人向け機能をそのまま利用可能にする。

### 4.2 revision

- 初期値は `0`。
- 画像読込の成功、アノテーションの作成・移動・変形・削除・置換・実質的な全消去ごとに1増加する。
- `expectedRevision` を受け取る変更系ツールは、処理前に現在値との完全一致を確認する。
- 画像取得・デコードなど非同期処理では、状態を反映する直前にも一致を再確認する。
- 不一致、入力不正、取得失敗、デコード失敗、キャンセルでは状態を変更しない。
- 不一致時は `get_annotations` で最新状態を取り直して再実行するようエラーで示す。

### 4.3 入力と出力の共通制限

- すべての入力はオブジェクトで、スキーマにないキーを拒否する。
- 数値は有限値、revision は0以上の安全な整数とする。
- 対応画像形式は PNG、JPEG、WebP とする。
- URL 画像のバイト数上限は12 MiBとする。
- Data URL は文字列長と復号後バイト数の双方を12 MiB以下とする。
- ツールが返す Data URL は12 MiB以下とする。
- `AbortSignal` を取得・デコードの前後で確認し、キャンセル時は状態を変更しない。
- 成功結果は、エージェントが次の操作や検証に使える `revision`、件数、画像寸法を返す。

### 4.4 画像出力の共通契約

- 元画像座標系の確定済み `shapes[]` を正本とし、表示用ステージとは別の出力専用シーンへ元画像と注釈を再構成する。
- 最終 PNG の範囲は元画像境界、寸法は元画像の `naturalWidth × naturalHeight` とする。表示用ステージの余白は含めない。
- `thickness` は元画像座標系の px として最終 PNG へ描画し、プレビューでは画像と同じ比率で縮小する。
- パン、ズーム、フィット倍率、ステージ位置・寸法、ウィンドウ寸法は結果へ影響させない。
- 作図中のドラフト、Transformer、頂点アンカー、スナップマーカー、選択枠、選択・ドラッグ・一覧クリックによる一時的な強調表示は含めない。
- 矩形と円の確定済み表示ノードに現在の回転がある場合は PNG へ反映する。回転角を JSON に含めない既存仕様は維持し、回転の永続化は別の製品判断として本対応には含めない。
- 人向け保存、`export_annotated_image` の `download` と `data_url`、`get_image_preview` は同じ出力専用レンダラーを使う。
- 人向け保存と `download` は PNG Blob を使う。Data URL はツール結果として必要な `data_url` とプレビューだけで生成する。
- Canvas 作成、PNG 変換、要求寸法の検証に失敗した場合は明示的なエラーとする。ブラウザーごとの Canvas 上限が異なるため、製品独自の固定寸法上限は設けない。

## 5. ツール仕様

### 5.1 `open_image_from_url`

目的: ネットワーク上、または同じ loopback オリジン上の画像を現在ページへ開く。

入力:

```json
{
  "expectedRevision": 0,
  "url": "https://example.com/image.png"
}
```

制約:

- `url` は資格情報を含まない絶対 URL とする。
- HTTPS を許可する。
- HTTP は、現在ページが `127.0.0.1`、`localhost`、`::1` の HTTP で、画像 URL が同一オリジンの場合だけ許可する。
- リダイレクト後の URL にも同じ規則を適用する。
- `fetch` は `credentials: "omit"`、`referrerPolicy: "no-referrer"`、`cache: "no-store"`、CORS モードで実行する。
- HTTP 成功、許可 MIME、サイズ上限、画像デコードをすべて確認してから現在画像を置換する。

成功結果:

```json
{
  "loaded": true,
  "revision": 1,
  "image": {
    "originalWidth": 1600,
    "originalHeight": 900
  }
}
```

成功時だけ既存アノテーションを消去し、revision を1増加する。

### 5.2 `open_image_from_data_url`

目的: エージェントが会話や別ツールから取得した画像データを、ファイル選択ダイアログを介さず現在ページへ開く。

入力:

```json
{
  "expectedRevision": 0,
  "dataUrl": "data:image/png;base64,iVBORw0KGgo..."
}
```

制約:

- `data:image/png;base64,`、`data:image/jpeg;base64,`、`data:image/webp;base64,` のいずれかで始まる厳密な base64 Data URL とする。
- 文字列長、base64、復号後サイズ、画像デコードを検証する。
- 全検証と revision 再確認が成功してから状態へ反映する。

成功結果と状態遷移は `open_image_from_url` と同じとする。

### 5.3 `get_annotations`

目的: 現在の作業状態を読み取る。

入力: `{}`

成功結果:

```json
{
  "revision": 2,
  "draw": [],
  "annotationCount": 0,
  "image": {
    "loaded": true,
    "originalWidth": 1600,
    "originalHeight": 900
  }
}
```

画像未読込時は `loaded` を `false`、寸法を `null` とする。画像データとローカルファイル名は返さない。

### 5.4 `get_image_preview`

目的: エージェントが現在の画像とアノテーションの見た目を確認する。

入力:

```json
{
  "maxDimension": 1024
}
```

- `maxDimension` は省略可能で既定値1024。
- 指定範囲は64から2048の整数。
- 元画像境界の注釈付き画像を、縦横比を維持して最大辺以内へ直接描画する。
- 元画像より拡大しない。寸法は `scale = min(1, maxDimension / max(originalWidth, originalHeight))` とし、各辺を整数へ丸める。
- 最終 PNG の Data URL をいったん生成してから縮小する経路は使わない。
- 4.4 の共通契約に従い、表示状態と一時表示を含めない。

成功結果:

```json
{
  "revision": 2,
  "annotationCount": 1,
  "mimeType": "image/png",
  "width": 1024,
  "height": 576,
  "dataUrl": "data:image/png;base64,..."
}
```

このツールは状態を変更しない。生成中に revision が変化した場合は、古い見た目を返さず再実行を求める。

### 5.5 `replace_annotations`

目的: 現在の全アノテーションを、指定した `draw` 配列で原子的に置換する。

入力:

```json
{
  "expectedRevision": 1,
  "draw": [
    {
      "shape": "rectangle",
      "x": 10,
      "y": 20,
      "width": 100,
      "height": 80,
      "color": "FF0000",
      "thickness": 5
    }
  ]
}
```

共通項目:

- `color`: 先頭の `#` が任意の6桁 HEX
- `thickness`: 0より大きい有限数

形状ごとの必須項目:

| shape | 必須項目 | 追加制約 |
|---|---|---|
| `rectangle` | `x`, `y`, `width`, `height` | 幅・高さは5以上 |
| `line` | `x1`, `y1`, `x2`, `y2` | 線分長は5以上 |
| `polygon` | `points` | 偶数要素、6要素以上 |
| `parallelogram` | `points` | 正確に8要素 |
| `circle` | `x`, `y`, `radius` | 半径は3以上 |

全要素を検証してから置換する。空配列は全消去として成功する。成功時は revision を1増加する。

成功結果:

```json
{
  "replaced": true,
  "annotationCount": 1,
  "revision": 2
}
```

### 5.6 `start_annotations_json_download`

目的: 人が利用する既存の JSON ダウンロードを、エージェント操作から開始する。

入力:

```json
{
  "expectedRevision": 2
}
```

画像内にアノテーションが1件以上ある場合だけ開始する。JSON 自体は `get_annotations` で取得できるため、エージェント専用の重複エクスポートは作らない。

成功結果:

```json
{
  "started": true,
  "revision": 2,
  "annotationCount": 1
}
```

### 5.7 `export_annotated_image`

目的: 現在の注釈付き PNG を、エージェントへ返すか、人向けダウンロードとして保存する。

入力:

```json
{
  "expectedRevision": 2,
  "delivery": "data_url"
}
```

`delivery`:

- `data_url`: 元画像と同じ寸法・範囲の注釈付き PNG を Data URL としてツール結果へ返す。
- `download`: 人向け UI と同じ既存 PNG ダウンロードを開始する。

両経路とも4.4の共通契約に従う。`data_url` は生成中の revision 変化を検出し、12 MiBを超える場合は `download` の利用を案内する。`download` は PNG Blob の生成完了と revision の再確認後に開始し、それ以前に成功を返さない。

`data_url` の成功結果:

```json
{
  "delivered": "data_url",
  "revision": 2,
  "annotationCount": 1,
  "mimeType": "image/png",
  "width": 1200,
  "height": 800,
  "dataUrl": "data:image/png;base64,..."
}
```

`download` の成功結果:

```json
{
  "delivered": "download",
  "started": true,
  "revision": 2,
  "annotationCount": 1
}
```

## 6. ローカル静的サーバー

### 6.1 通常起動

リポジトリルートで次だけを実行する。

```bash
bash scripts/tools/web/start-local-web.sh
```

- URL は `http://127.0.0.1:8000/`。
- 画像パスなどの必須引数はない。
- ポートが必要な場合だけ `SWS_PORT=8001 bash scripts/tools/web/start-local-web.sh` とする。
- 停止は、起動した同じターミナルで `Ctrl+C`。

### 6.2 実装

- 通常起動のたびに GitHub Releases API の `latest` を確認する。`latest` は非プレリリース・非ドラフトの最新安定版とする。
- SWS が未配置の場合は最新安定版を取得する。配置済みの版と最新安定版が異なる場合は、対話環境では置換するか確認し、既定値を Yes とする。
- 非対話環境では配置済みの版を自動置換しない。`SWS_AUTO_UPDATE=1` または `SWS_ASSUME_YES=1` の場合だけ確認を省略して更新し、`SWS_ASSUME_NO=1` の場合は配置済みの版を継続利用する。
- `SWS_VERSION=<version|vversion|latest>` が指定された場合は、その版を明示要求として確認なしで取得または再利用する。
- 取得対象は GitHub Release の完全一致するアセット名から決定する。API が返す `sha256:` digest と実行ファイルのバージョンを検証してから `tools/web/static-web-server` へ配置する。
- 取得・展開・キャッシュはリポジトリ内の無視対象 `tools/web/` だけを使用する。
- `/tmp`、`/private/tmp`、`/var/folders` その他 OS 一時領域を使用しない。
- 既存の検証済みバイナリは、新しい取得物の検証が成功するまで上書きしない。
- `web/` だけを `127.0.0.1` に配信する。
- ディレクトリ一覧とキャッシュを無効にする。シンボリックリンク追跡は SWS の安全な既定値を利用し、版固有の `--disable-symlinks` は指定しない。
- 起動前に指定ポートの LISTEN プロセスを確認する。競合時はプロセス情報を表示し、対話環境で停止確認を既定 No として行う。承認時は SIGTERM 後に最大5秒待ち、残存時だけ SIGKILL の確認を既定 No として行う。非対話環境では既存プロセスを停止せず起動を中断する。
- 起動スクリプトは SWS を子プロセスとして管理する。Ctrl+C または SIGTERM を子へ転送し、最大5秒のグレースフル終了を待つ。残存時だけ対話環境では SIGKILL を既定 Yes で確認し、非対話環境または `SWS_FORCE_KILL=1` では強制終了する。
- 任意の配信ルート、画像専用 URL、アップロード API、停止 API、常駐デーモンは提供しない。

対応対象は macOS arm64/x86_64、Linux aarch64/x86_64/armv7 GNU とする。必要コマンドは `curl`、`jq`、`tar`、`lsof`、`ps`、SHA-256を計算できる `shasum` または `sha256sum` とする。その他の環境は、未検証バイナリを推測せず明示的に終了する。

## 7. 通常利用経路

1. 人またはエージェントがローカル静的サーバーを起動する。
2. エージェントが `http://127.0.0.1:8000/` を内蔵ブラウザーで開く。
3. エージェントが `get_annotations` で初期 revision を取得する。
4. エージェントが `open_image_from_data_url` または `open_image_from_url` で画像を開く。
5. `get_image_preview` で対象画像を視覚確認する。
6. `replace_annotations` でアノテーションを反映する。
7. `get_annotations` と `get_image_preview` で JSON と見た目を確認する。
8. `export_annotated_image` の `data_url` で最終 PNG を会話側へ返す。
9. 人がファイルとして必要な場合だけ、JSON ダウンロードまたは `delivery: "download"` を実行する。
10. 確認完了後、起動したターミナルで `Ctrl+C` を押して停止する。

この経路では、人がブラウザーのファイル選択ダイアログで入力画像を選ぶことを必須にしない。会話添付から Data URL を生成できるかはクライアント能力であり、WebMCP 自体がローカルファイルパスや添付バイト列へのアクセスを保証するものではない。

## 8. 受入条件

### 8.1 人向け回帰

- `file:` で開いた場合も既存のファイル選択、5形状、JSON、PNG、ズーム、パンが利用できる。
- WebMCP 非対応ブラウザーでエラーや追加 UI が出ない。
- 人向け JSON 形式、PNG形式、保存ボタン、ファイル名規則が維持される。
- 人向け PNG は元画像と同じピクセル寸法・画像境界で、表示状態に依存せず確定済み注釈だけを含む。

### 8.2 ローカルサーバー

- 引数なしの1コマンドで起動する。
- 通常起動時に GitHub の最新安定版を確認する。
- 初回取得が GitHub Release アセットの SHA-256 digest と版番号で検証される。
- 配置済み版が最新安定版と一致する場合は検証済みキャッシュを再利用する。
- 新しい安定版がある場合は対話環境で更新を確認し、拒否時は配置済み版を継続利用する。
- 非対話環境では明示的な自動更新指定なしに配置済み版を置換しない。
- `127.0.0.1:8000` 以外へ既定で公開しない。
- `web/` 外、ディレクトリ一覧、シンボリックリンク先を配信しない。
- HTML、JavaScript、CSS に `no-store` が付く。
- ポート競合時は対象を表示し、承認なしに既存プロセスを停止しない。
- `Ctrl+C` で自身のサーバープロセスだけが停止する。

### 8.3 WebMCP 完全経路

- 7ツールが重複なく登録される。
- Data URL と許可 URL の双方で PNG/JPEG/WebP を開ける。
- 不正入力、超過サイズ、禁止 URL、競合 revision、キャンセルで状態が変わらない。
- 5形状を置換し、JSON とプレビューの双方で確認できる。
- 元画像の縦横比を維持した指定最大辺のプレビューを取得でき、指定値が元画像より大きい場合は拡大しない。
- 最終 PNG を `data_url` としてエージェントが取得でき、返却寸法が元画像寸法と一致する。
- パン、ズーム、ステージ・ウィンドウ寸法、選択・ガイド表示を変えても、プレビューと最終 PNG の画像内容は変化しない。
- 人向け保存、`download`、`data_url`、プレビューの全経路が同じ確定モデルと元画像境界を使う。
- 必要な場合だけ既存の JSON/PNG ダウンロードを開始できる。

## 9. 応募時に示す製品価値

応募では、次の恒久的な製品価値を一つの実演として示す。

> 人と AI が同じ AnnoForge キャンバスを共有し、AI が会話から画像を開き、構造化アノテーションを作成し、見た目を検証し、完成 PNG を返せる。人は途中から同じ画面で確認・修正・保存できる。

ローカル静的サーバーやダウンロード処理を主役にはしない。それらは、ライブページ上の完全な入力・編集・検証・成果物返却を安定して利用するための製品基盤として扱う。
