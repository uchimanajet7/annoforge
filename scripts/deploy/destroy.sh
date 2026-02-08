#!/usr/bin/env bash
# Terraform管理リソースを削除（S3バケットも含まれます）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp destroy "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info destroy "----- start: ${START_TS} -----"
__af_end() {
  local __end_ms
  __end_ms="$(ui::epoch_ms)"
  local __diff
  __diff=$((__end_ms-START_MS))
  ui::info destroy "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"
}
trap __af_end EXIT

YES="false"

usage() {
  cat <<USAGE
使い方: bash scripts/deploy/destroy.sh [--yes]
  - Terraform管理の全リソースを削除します（S3バケット含む）。
  - 実行前に確認します。--yes 指定時のみ無人で実行します。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES="true"; shift;;
    -h|--help) usage; exit 0;;
    *) ui::err destroy "不明な引数: $1"; usage; exit 1;;
  esac
done

ui::hdr destroy "destroy"

if [[ "$YES" != "true" ]]; then
  ui::info destroy "destroy の前に確認します"
  ui::ask_yesno __GO destroy "destroy を実行しますか？" N
  if [[ "$__GO" != "true" ]]; then
    ui::info destroy "中止しました（何も変更していません）"
    exit 0
  fi
fi

cd "$(dirname "$0")/../../infra/terraform"

CMD=( terraform destroy -input=false )
if [[ "$YES" == "true" ]]; then
  CMD+=( -auto-approve )
fi
ui::run destroy "terraform destroy:"
printf "  %s\n" "${CMD[*]}" >&2
"${CMD[@]}"

ui::ok destroy "完了"
