#!/usr/bin/env bash
# 必須/推奨ツールのバージョン確認
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info tools "----- start: ${START_TS} -----"
__af_end() {
  local __end_ms
  __end_ms="$(ui::epoch_ms)"
  local __diff
  __diff=$((__end_ms-START_MS))
  ui::info tools "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"
}
trap __af_end EXIT

# usage対応（-h|--help）
usage() {
  cat <<USAGE
使い方: bash scripts/tools/check_versions.sh
  - 必須/推奨ツールのバージョンを表示します。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0;;
    *) ui::err tools "不明な引数: $1"; usage; exit 1;;
  esac
done

ui::info tools "Terraform: $(terraform version 2>/dev/null | head -n1 || echo 'not found')"
ui::info tools "AWS CLI: $(aws --version 2>/dev/null || echo 'not found')"
ui::info tools "Python3: $(python3 --version 2>/dev/null || echo 'not found')"
ui::info tools "pip: $(pip --version 2>/dev/null || echo 'not found')"
ui::info tools "zip: $(zip -v 2>/dev/null | head -n1 || echo 'not found')"
ui::info tools "curl: $(curl --version 2>/dev/null | head -n1 || echo 'not found')"
ui::info tools "jq: $(jq --version 2>/dev/null || echo 'not found')"
