#!/usr/bin/env bash
# terraform apply を実行。tfplan があればそれを使用。--yes で確認省略。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp tf "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info tf "----- start: ${START_TS} -----"
__af_end() { local __end_ms=$(ui::epoch_ms); local __diff=$((__end_ms-START_MS)); ui::info tf "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"; }
trap __af_end EXIT

YES="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES="true"; shift;;
    -h|--help) echo "使い方: bash scripts/deploy/tf_apply.sh [--yes]"; exit 0;;
    *) ui::err tf "不明な引数: $1"; exit 1;;
  esac
done

ui::info tf "apply"
ui::debug tf "cwd=$(pwd)"
cd "$(dirname "$0")/../../infra/terraform"

  if [[ -f tfplan ]]; then
    ui::debug tf "using plan file: tfplan"
    if [[ "$YES" == "true" ]]; then
    ui::run tf "terraform apply:"
    printf "  %s\n" "terraform apply -input=false -auto-approve tfplan" >&2
    terraform apply -input=false -auto-approve tfplan
    else
    ui::run tf "terraform apply:"
    printf "  %s\n" "terraform apply -input=false tfplan" >&2
    terraform apply -input=false tfplan
    fi
  else
    ui::debug tf "no plan file found; applying without saved plan"
    if [[ "$YES" == "true" ]]; then
    ui::run tf "terraform apply:"
    printf "  %s\n" "terraform apply -input=false -auto-approve" >&2
    terraform apply -input=false -auto-approve
    else
    ui::run tf "terraform apply:"
    printf "  %s\n" "terraform apply -input=false" >&2
    terraform apply -input=false
    fi
  fi

URL=$(terraform output -raw function_url 2>/dev/null || true)
[[ -n "$URL" ]] && ui::info tf "Function URL: ${URL}"
ui::ok tf "apply 完了"
