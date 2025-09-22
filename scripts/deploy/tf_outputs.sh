#!/usr/bin/env bash
# Terraformの outputs を一覧表示するヘルパー（表示専用）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp tfout "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info tfout "----- start: ${START_TS} -----"
__af_end() { local __end_ms=$(ui::epoch_ms); local __diff=$((__end_ms-START_MS)); ui::info tfout "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"; }
trap __af_end EXIT

usage() {
  cat <<USAGE
使い方: bash scripts/deploy/tf_outputs.sh
  - Terraformの outputs をまとめて表示します（function_url/function_arn/alias_arn/layer_arn）。
  - 呼び出し例の実行は 'bash scripts/deploy/smoke.sh' の出力(run行)をご参照ください（本スクリプトは表示専用）。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0;;
    *) ui::err tfout "不明な引数: $1"; usage; exit 1;;
  esac
done

cd "${ROOT_DIR}/infra/terraform"

ui::hdr tfout "Terraform outputs"
set +e
URL=$(terraform output -raw function_url 2>/dev/null)
URL_RC=$?
F_ARN=$(terraform output -raw function_arn 2>/dev/null)
F_RC=$?
A_ARN=$(terraform output -raw alias_arn 2>/dev/null)
A_RC=$?
L_ARN=$(terraform output -raw layer_arn 2>/dev/null)
L_RC=$?
set -e

printf "  function_url = %s\n" "${URL:-(none)}" >&2
printf "  function_arn = %s\n" "${F_ARN:-(none)}" >&2
printf "  alias_arn    = %s\n" "${A_ARN:-(none)}" >&2
printf "  layer_arn    = %s\n" "${L_ARN:-(none)}" >&2

missing=0
if [[ ${URL_RC} -ne 0 || -z "${URL:-}" || ! "$URL" =~ ^https?:// ]]; then missing=1; fi
if [[ ${F_RC} -ne 0 || -z "${F_ARN:-}" || "${F_ARN}" != arn:* ]]; then missing=1; fi
if [[ ${A_RC} -ne 0 || -z "${A_ARN:-}" || "${A_ARN}" != arn:* ]]; then missing=1; fi
if [[ ${L_RC} -ne 0 || -z "${L_ARN:-}" || "${L_ARN}" != arn:* ]]; then missing=1; fi

if [[ ${missing} -ne 0 ]]; then
  ui::err tfout "Terraform outputs が取得できません（未定義/空/形式不正）。'terraform apply' 済みか確認してください。"
  ui::info tfout "手順: cd infra/terraform && terraform init && terraform plan -out=tfplan && terraform apply tfplan"
  exit 2
fi

ui::info tfout "呼び出し例は 'bash scripts/deploy/smoke.sh' の出力(run行)をご参照ください。"
ui::ok tfout "表示完了"
