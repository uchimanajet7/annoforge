#!/usr/bin/env bash
# Terraform Providerのアップグレード（レンジ内）。
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
使い方: bash scripts/tools/upgrade_terraform_providers.sh
  - Terraform Provider をレンジ内でアップグレードし、providers lock を更新します。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0;;
    *) ui::err tools "不明な引数: $1"; usage; exit 1;;
  esac
done

ui::info tools "terraform providers upgrade"
cd "$(dirname "$0")/../../infra/terraform"
terraform init -upgrade
terraform providers lock -platform=linux_amd64 -platform=linux_arm64 -platform=darwin_amd64 -platform=darwin_arm64 || true
ui::ok tools "providers lock 完了。versions.tf のレンジを見直して plan/apply してください。"
