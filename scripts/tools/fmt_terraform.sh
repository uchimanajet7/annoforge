#!/usr/bin/env bash
# Terraform fmt/validate ラッパー（ローカル/CI共通）
# 用途:
#   - 整形適用:   bash scripts/tools/fmt_terraform.sh --write
#   - 整形確認:   bash scripts/tools/fmt_terraform.sh --check
#   - 検証:       bash scripts/tools/fmt_terraform.sh --validate
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF_DIR="${ROOT_DIR}/infra/terraform"

if [[ -f "${ROOT_DIR}/scripts/lib/ui.sh" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/ui.sh"; ui::init || true
  info() { ui::info tf_fmt "$*"; }
  ok()   { ui::ok   tf_fmt "$*"; }
  err()  { ui::err  tf_fmt "$*"; }
else
  info() { printf '[INFO] %s\n' "$*" >&2; }
  ok()   { printf '[ OK ] %s\n' "$*" >&2; }
  err()  { printf '[ERR ] %s\n' "$*" >&2; }
fi

DO_WRITE="false"
DO_CHECK="false"
DO_VALIDATE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write) DO_WRITE="true"; shift ;;
    --check) DO_CHECK="true"; shift ;;
    --validate) DO_VALIDATE="true"; shift ;;
    -h|--help)
      cat <<USAGE
Usage: bash scripts/tools/fmt_terraform.sh [--write] [--check] [--validate]
  --write     Run 'terraform fmt -recursive' in infra/terraform
  --check     Run 'terraform fmt -check -recursive -diff'
  --validate  Run 'terraform init -backend=false -input=false' then 'terraform validate -no-color'
USAGE
      exit 0
      ;;
    *) err "Unknown arg: $1"; exit 2 ;;
  esac
done

if ! command -v terraform >/dev/null 2>&1; then
  err "terraform not found. Install Terraform and retry."
  exit 127
fi

cd "$TF_DIR"

if [[ "$DO_WRITE" == "true" ]]; then
  info "terraform fmt -recursive"
  terraform fmt -recursive
  ok "fmt applied"
fi

if [[ "$DO_CHECK" == "true" ]]; then
  info "terraform fmt -check -recursive -diff"
  terraform fmt -check -recursive -diff
  ok "fmt check passed"
fi

if [[ "$DO_VALIDATE" == "true" ]]; then
  info "terraform init -backend=false -input=false"
  terraform init -backend=false -input=false
  info "terraform validate -no-color"
  terraform validate -no-color
  ok "validate passed"
fi

if [[ "$DO_WRITE$DO_CHECK$DO_VALIDATE" == "falsefalsefalse" ]]; then
  info "No action specified. See --help"
fi

