#!/usr/bin/env bash
# terraform init を実行（冪等）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp tf "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info tf "----- start: ${START_TS} -----"
__af_end() {
  local __end_ms
  __end_ms="$(ui::epoch_ms)"
  local __diff
  __diff=$((__end_ms-START_MS))
  ui::info tf "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"
}
trap __af_end EXIT

# usage対応（-h|--help）
usage() {
  cat <<USAGE
使い方: bash scripts/deploy/tf_init.sh
  - Terraform init を実行します（冪等）。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0;;
    *) ui::err tf "不明な引数: $1"; usage; exit 1;;
  esac
done

ui::info tf "init"
cd "$(dirname "$0")/../../infra/terraform"
terraform init -input=false
ui::ok tf "init 完了"
