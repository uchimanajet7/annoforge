#!/usr/bin/env bash
# terraform plan を実行し、tfplan を保存。-detailed-exitcode で差分有無を判定。
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
使い方: bash scripts/deploy/tf_plan.sh
  - Terraform plan を実行し、-detailed-exitcode と tfplan 保存で差分を判定します。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0;;
    *) ui::err tf "不明な引数: $1"; usage; exit 1;;
  esac
done

ui::info tf "plan"
cd "$(dirname "$0")/../../infra/terraform"

# -detailed-exitcode: 0=差分なし, 2=差分あり, 1=エラー
# 表示: TTYなら色付き、非TTYやNO_COLOR=1なら無色
TF_ARGS=( -input=false -out=tfplan -detailed-exitcode )
if [[ ! -t 1 || "${NO_COLOR:-}" == "1" ]]; then
  TF_ARGS+=( -no-color )
fi
set +e
terraform plan "${TF_ARGS[@]}"
STATUS=$?
set -e
case "$STATUS" in
  0)
    ui::ok tf "plan 完了: 差分なし（tfplan 作成）";;
  2)
    ui::ok tf "plan 完了: 差分あり（tfplan 作成）";;
  *)
    ui::err tf "plan に失敗しました (exit=${STATUS})"; exit "$STATUS";;
esac
