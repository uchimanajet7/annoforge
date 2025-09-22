#!/usr/bin/env bash
# OGP PNG 生成スクリプト
# 目的: web/ogp.svg から 1200x630 の ogp.png を生成します。
# 依存: Google Chrome/Chromium のヘッドレスモード（インストール済み想定）。

set -euo pipefail

# リポジトリルートへ移動
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

SVG_PATH="web/ogp.svg"
PNG_PATH="web/ogp.png"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info ogp "----- start: ${START_TS} -----"
__af_end() { local __end_ms=$(ui::epoch_ms); local __diff=$((__end_ms-START_MS)); ui::info ogp "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"; }
trap __af_end EXIT

# usage対応（-h|--help）
usage() {
  cat <<USAGE
使い方: bash scripts/tools/generate_ogp_png.sh
  - web/ogp.svg から 1200x630 の web/ogp.png を生成します。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0;;
    *) ui::err ogp "不明な引数: $1"; usage; exit 1;;
  esac
done

if [[ ! -f "$SVG_PATH" ]]; then
  ui::err ogp "SVGが見つかりません: $SVG_PATH"
  exit 1
fi

# Chrome/Chromium の実体を探す（macOS/一般Linux対応）
find_chrome() {
  local candidates=(
    "google-chrome"
    "google-chrome-stable"
    "chromium"
    "chromium-browser"
    "chrome"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  )
  for c in "${candidates[@]}"; do
    if command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

CHROME_BIN="$(find_chrome || true)"
if [[ -z "$CHROME_BIN" ]]; then
  ui::err ogp "Google Chrome/Chromium が見つかりません。インストール後に再実行してください。"
  ui::info ogp "macOS例: brew install --cask google-chrome"
  exit 1
fi

# 絶対パスを file:// で指定
ABS_SVG="$(cd "$(dirname "$SVG_PATH")" && pwd)/$(basename "$SVG_PATH")"

ui::info ogp "Using Chrome: $CHROME_BIN"
ui::info ogp "Input:  $ABS_SVG"
ui::info ogp "Output: $PNG_PATH"

# --headless=new を優先。古い版は --headless で動作
set +e
"$CHROME_BIN" \
  --headless=new \
  --disable-gpu \
  --screenshot="$PNG_PATH" \
  --window-size=1200,630 \
  "file://$ABS_SVG"
RET=$?
set -e

if [[ $RET -ne 0 ]]; then
  ui::warn ogp "--headless=new が失敗。互換モードで再試行します。"
  "$CHROME_BIN" \
    --headless \
    --disable-gpu \
    --screenshot="$PNG_PATH" \
    --window-size=1200,630 \
    "file://$ABS_SVG"
fi

if [[ ! -s "$PNG_PATH" ]]; then
  ui::err ogp "出力が生成されませんでした: $PNG_PATH"
  exit 1
fi

ui::ok ogp "生成完了: $PNG_PATH (1200x630)"
