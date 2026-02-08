#!/usr/bin/env bash
# ShellCheck ラッパー。ローカル/CI共通。
# 用途:
#   - warnings もエラーとして扱う:   bash scripts/tools/lint_shell.sh --strict
#   - 既定は情報表示のみ:        bash scripts/tools/lint_shell.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# UI 初期化。ui.sh がある場合は読み込み、無ければ簡易出力に切り替える。
if [[ -f "${ROOT_DIR}/scripts/lib/ui.sh" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/lib/ui.sh"; ui::init || true
  info() { ui::info lint "$*"; }
  ok()   { ui::ok   lint "$*"; }
  err()  { ui::err  lint "$*"; }
else
  info() { printf '[INFO] %s\n' "$*" >&2; }
  ok()   { printf '[ OK ] %s\n' "$*" >&2; }
  err()  { printf '[ERR ] %s\n' "$*" >&2; }
fi

STRICT="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT="true"; shift ;;
    -h|--help)
      cat <<USAGE
Usage: bash scripts/tools/lint_shell.sh [--strict]
  --strict  Treat warnings as errors (exit non-zero)
USAGE
      exit 0
      ;;
    *) err "Unknown arg: $1"; exit 2 ;;
  esac
done

if ! command -v shellcheck >/dev/null 2>&1; then
  err "shellcheck not found. Install it and retry (e.g., 'brew install shellcheck' or 'apt-get install -y shellcheck')."
  exit 127
fi

FILES_LIST=$(cd "${ROOT_DIR}" && git ls-files 'scripts/**/*.sh')
if [[ -z "$FILES_LIST" ]]; then
  info "No shell scripts under scripts/. Skipping."
  exit 0
fi

# macOS既定の Bash 3.2 に合わせ、配列/mapfile を使わずに引数を構築する。
set --
while IFS= read -r f; do
  set -- "$@" "$f"
done <<< "$FILES_LIST"

info "Checking $# shell scripts..."
LEVEL="warning"
[[ "$STRICT" == "true" ]] && LEVEL="error"

shellcheck -S "$LEVEL" "$@"
ok "ShellCheck passed (level=$LEVEL)"
