#!/usr/bin/env bash
# WebMCP を含む AnnoForge のローカル確認用静的サーバーを起動する。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  printf '%s\n' 'Usage: bash scripts/tools/web/start-local-web.sh'
  printf '%s\n' 'Optional: SWS_PORT=8001 bash scripts/tools/web/start-local-web.sh'
}

if (( $# > 0 )); then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
fi

exec bash "${SCRIPT_DIR}/run-sws.sh"
