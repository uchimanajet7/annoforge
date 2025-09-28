#!/usr/bin/env bash
# Terraform Provider のロック情報を確認して表示する。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init

START_TS="$(ui::ts)"
START_MS="$(ui::epoch_ms)"
ui::info tools "----- start: ${START_TS} -----"
__af_end() {
  local __end_ms
  __end_ms="$(ui::epoch_ms)"
  local __diff
  __diff=$((__end_ms-START_MS))
  ui::info tools "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"
}
trap __af_end EXIT

usage() {
  cat <<USAGE
使い方: bash scripts/tools/show_terraform_providers.sh
  - terraform init 済みのプロジェクトで、現在ロックされている Provider 情報を表示します。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) ui::err tools "不明な引数: $1"; usage; exit 1 ;;
  esac
  shift
done

ui::info tools "Terraform Provider 情報を収集します"

cd "${SCRIPT_DIR}/../../infra/terraform"

if ! command -v terraform >/dev/null 2>&1; then
  ui::err tools "terraform コマンドが見つかりません。インストール後に再実行してください。"
  exit 1
fi

if [[ ! -f .terraform.lock.hcl ]]; then
  ui::err tools ".terraform.lock.hcl が存在しません。terraform init を実行して初期化してください。"
  exit 1
fi

ui::run tools "terraform version"
terraform version
printf '\n'

ui::run tools "terraform providers"
terraform providers
printf '\n'

ui::info tools "ロックファイル (.terraform.lock.hcl) のサマリ"
if awk '
  /^[[:space:]]*provider[[:space:]]/ {
    if (printed_provider) {
      print ""
    }
    print
    in_provider=1
    printed_provider=1
    found=1
    last_printed=NR
    next
  }
  in_provider && /^[[:space:]]*version[[:space:]]*= / {
    print
    found=1
    last_printed=NR
    next
  }
  in_provider && /^[[:space:]]*constraints[[:space:]]*= / {
    print
    found=1
    last_printed=NR
    in_provider=0
    next
  }
  END {
    exit(found ? 0 : 1)
  }
' .terraform.lock.hcl; then
  ui::ok tools "ロックファイルの主要行を出力しました。versions.tf の制約と乖離が無いか確認してください。"
else
  ui::warn tools "対象行が見つかりませんでした。必要に応じて .terraform.lock.hcl を直接参照してください。"
fi
