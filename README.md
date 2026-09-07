# AnnoForge

ブラウザーで画像に図形の注釈を付け、注釈付きPNGと注釈JSONを保存できるツールです。通常の画像編集・保存に、AWS環境の構築は必要ありません。

[AnnoForgeを開く](https://uchimanajet7.github.io/annoforge/)

## できること

- 矩形・直線・多角形・平行四辺形・円の注釈を作成し、位置・形・色を編集する。
- 重なった図形を一覧から選び、対象の図形だけを編集する。
- 元画像と同じ寸法の注釈付きPNGを保存する。
- 注釈JSONをコピー・保存・インポートして再利用する。
- WebMCP対応のAIエージェントと、同じページで注釈を確認・編集する。

## すぐに使う

1. [AnnoForge](https://uchimanajet7.github.io/annoforge/)を開きます。
2. 「画像を選択」、キャンバスへのドラッグ&ドロップ、または「URLから画像を開く」で画像を読み込みます。URLの入力条件は[画像を開く](docs/GETTING_STARTED.md#画像を開く)を参照してください。
3. 図形ツールで注釈を描きます。修正するときは選択ツールへ切り替えます。重なって選べない図形は「アノテーション一覧」から選択できます。
4. 「注釈付き画像を保存」でPNGを、「JSON形式」欄のダウンロードボタンでJSONを保存します。ブラウザーのダウンロード一覧で保存完了を確認してください。

作業状態は自動保存されません。ページを閉じる・再読み込みする・別の画像を開く前に、必要なPNGとJSONを保存してください。JSONには元画像が含まれないため、元画像も手元に保管してください。

ローカルで使う場合は、取得したリポジトリの [web/index.html](web/index.html) をブラウザーで開けます。描画ライブラリの読み込みにはインターネット接続が必要です。図形ごとの操作やJSONの再利用は[はじめに](docs/GETTING_STARTED.md)を参照してください。

## WebMCPでAIエージェントと使う

[WebMCP](https://webmachinelearning.github.io/webmcp/)対応環境では、エージェントが画像の読み込み、注釈の確認・更新、PNG・JSONの取得を行い、人が同じページで結果を編集できます。画像認識や注釈候補の生成はエージェント側が担当します。

利用にはSite tools対応クライアントが必要です。ChatGPT / Codexの対応環境・利用条件は[OpenAIのSite tools案内](https://learn.chatgpt.com/docs/webmcp)を確認してください。非対応の環境でも、通常の画面操作は利用できます。

PNG画像とJSONファイルを会話へ提示するには、クライアント側でのファイル受信と添付が必要です。ページを開くだけで自動添付される機能ではありません。[利用手順](docs/GETTING_STARTED.md#webmcpでaiエージェントと使う)と[受信・添付の接続方法](docs/WEBMCP.md#411-クライアント側の受信と会話への添付)を参照してください。

## AWS Lambda APIを使う場合

注釈JSONを使って画像へ注釈を描画し、S3に保存してダウンロード用の期限付きURLを返すAWS Lambda APIも同梱しています。自分のAWS環境にデプロイして使う、Web UIとは別の利用方法です。

必要なツール・AWS認証・デプロイ・動作確認・片付けは、[APIの導入手順](docs/GETTING_STARTED.md#aws-lambda-apiを導入する)を参照してください。

## ドキュメント

| 目的 | 参照先 |
|---|---|
| 画像編集、WebMCPの利用、自分のサイトの公開を始める | [はじめに](docs/GETTING_STARTED.md) |
| Web UIの動作、注釈JSON、APIの仕様を調べる | [製品仕様](docs/SPEC.md) |
| WebMCPのツール仕様やクライアント連携を調べる | [WebMCP仕様](docs/WEBMCP.md) |
| AWS APIをデプロイ・検証・削除する、問題を調べる | [デプロイ手順・トラブルシュート](docs/DEPLOY.md) |
| ローカル開発環境を用意し、テストや静的検査を実行する | [開発セットアップ（macOS）](docs/DEV_SETUP.md) |
| 依存ツールのバージョン運用を確認する | [バージョン運用](docs/VERSIONS.md) |

## ライセンス

[MIT License](LICENSE)

## 開発の背景

[AnnoForge 開発メモ — WebUIで注釈設定 → AWS Lambdaで画像に注釈を追加してみた](https://uchimanajet7.hatenablog.com/entry/2025/10/14/180000)
