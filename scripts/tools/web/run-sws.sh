#!/usr/bin/env bash
# Static Web Server の最新版確認、検証付き取得、起動、終了管理を行う。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
WEB_ROOT="${ROOT_DIR}/web"
CONFIG_FILE="${SCRIPT_DIR}/sws.dev.toml"
TOOLS_DIR="${ROOT_DIR}/tools/web"
SWS_BINARY="${TOOLS_DIR}/static-web-server"
SWS_PORT="${SWS_PORT:-8000}"
REQUESTED_RAW="${SWS_VERSION:-}"
REQUESTED_VERSION="${SWS_VERSION:-}"
SWS_TAG=""
TARGET_SWS_VERSION=""
CURRENT_SWS_VERSION=""
RUNTIME_SWS_VERSION=""
RELEASE_JSON=""
ASSET_NAME=""
ASSET_URL=""
ASSET_SHA256=""
INSTALL_STAGING_DIR=""
SERVER_PID=""
SIGNAL_ATTEMPTS=0
FORCE_KILL_FLAG="${SWS_FORCE_KILL:-}"

source "${ROOT_DIR}/scripts/lib/ui.sh"
ui::init
LOG_TAG="web"

usage() {
  printf '%s\n' 'Usage: bash scripts/tools/web/start-local-web.sh'
  printf '%s\n' 'Optional: SWS_PORT=8001 bash scripts/tools/web/start-local-web.sh'
}

fail() {
  ui::err "${LOG_TAG}" "$1"
  exit 1
}

is_true() {
  case "${1:-}" in
    1|true|TRUE|True|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

cleanup_install() {
  case "${INSTALL_STAGING_DIR:-}" in
    "${TOOLS_DIR}"/.install.*)
      if [[ -d "${INSTALL_STAGING_DIR}" ]]; then
        rm -rf -- "${INSTALL_STAGING_DIR}"
      fi
      INSTALL_STAGING_DIR=""
      ;;
    '')
      ;;
    *)
      ui::err "${LOG_TAG}" 'Refusing to clean an unexpected installation path.'
      return 1
      ;;
  esac
}

process_is_running() {
  local pid="$1"
  local state
  state="$(ps -o stat= -p "${pid}" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
  [[ -n "${state}" && "${state}" != Z* ]]
}

wait_for_process_exit() {
  local pid="$1"
  local limit="${2:-20}"
  local attempt=0
  while (( attempt < limit )); do
    if ! process_is_running "${pid}"; then
      return 0
    fi
    sleep 0.25
    attempt=$((attempt + 1))
  done
  ! process_is_running "${pid}"
}

script_exit_trap() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  cleanup_install
  if [[ -n "${SERVER_PID}" ]] && process_is_running "${SERVER_PID}"; then
    ui::warn "${LOG_TAG}" "起動スクリプト終了のため Static Web Server を停止します (PID=${SERVER_PID})。"
    kill -TERM "${SERVER_PID}" 2>/dev/null
    if ! wait_for_process_exit "${SERVER_PID}" 20; then
      kill -KILL "${SERVER_PID}" 2>/dev/null
      wait_for_process_exit "${SERVER_PID}" 20
    fi
    wait "${SERVER_PID}" 2>/dev/null
  fi
  exit "${status}"
}

trap 'script_exit_trap' EXIT

if (( $# > 0 )); then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ui::err "${LOG_TAG}" "Unknown option: $1"
      usage >&2
      exit 2
      ;;
  esac
fi

case "${SWS_PORT}" in
  ''|*[!0-9]*)
    ui::err "${LOG_TAG}" 'SWS_PORT must be an integer from 1 to 65535.'
    exit 2
    ;;
esac

if (( ${#SWS_PORT} > 5 )) || (( 10#${SWS_PORT} < 1 )) || (( 10#${SWS_PORT} > 65535 )); then
  ui::err "${LOG_TAG}" 'SWS_PORT must be an integer from 1 to 65535.'
  exit 2
fi

if [[ ! -f "${WEB_ROOT}/index.html" ]] || [[ ! -f "${CONFIG_FILE}" ]]; then
  fail 'Required AnnoForge web files are missing.'
fi

for command_name in curl jq tar lsof ps; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    fail "Required command not found: ${command_name}"
  fi
done

if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
  fail 'Required SHA-256 command not found: shasum or sha256sum'
fi

sha256_file() {
  local file_path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
  else
    sha256sum "${file_path}" | awk '{print $1}'
  fi
}

binary_version() {
  local binary_path="$1"
  local output
  if ! output="$("${binary_path}" --version 2>/dev/null)"; then
    return 1
  fi
  printf '%s\n' "${output}" \
    | grep -Eo 'v?[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z][0-9A-Za-z.+-]*)?' \
    | head -n1 \
    | sed 's/^v//'
}

installed_version() {
  if [[ ! -x "${SWS_BINARY}" ]]; then
    return 1
  fi
  binary_version "${SWS_BINARY}"
}

github_release_get() {
  local url="$1"
  curl -fsSL \
    --proto '=https' \
    --tlsv1.2 \
    -H 'Accept: application/vnd.github+json' \
    -H 'User-Agent: annoforge-local-web/1.0' \
    "${url}"
}

validate_release_tag() {
  local tag="$1"
  [[ "${tag}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z][0-9A-Za-z.+-]*)?$ ]]
}

determine_version() {
  case "${REQUESTED_VERSION}" in
    '')
      ;;
    latest)
      REQUESTED_VERSION=""
      ;;
    v*)
      SWS_TAG="${REQUESTED_VERSION}"
      ;;
    *)
      SWS_TAG="v${REQUESTED_VERSION}"
      ;;
  esac

  if [[ -z "${SWS_TAG}" ]]; then
    ui::info "${LOG_TAG}" 'Checking the latest Static Web Server release.'
    if ! RELEASE_JSON="$(github_release_get 'https://api.github.com/repos/static-web-server/static-web-server/releases/latest')"; then
      fail 'Failed to retrieve the latest Static Web Server release.'
    fi
    if ! SWS_TAG="$(printf '%s' "${RELEASE_JSON}" | jq -er 'select(.draft == false and .prerelease == false) | .tag_name | strings | select(length > 0)')"; then
      fail 'The latest Static Web Server release response is invalid.'
    fi
  fi

  if ! validate_release_tag "${SWS_TAG}"; then
    fail "Unsupported Static Web Server release tag: ${SWS_TAG}"
  fi

  TARGET_SWS_VERSION="${SWS_TAG#v}"
  ui::info "${LOG_TAG}" "Target Static Web Server version: ${TARGET_SWS_VERSION}"
}

load_release_metadata() {
  if [[ -n "${RELEASE_JSON}" ]] \
    && printf '%s' "${RELEASE_JSON}" | jq -e --arg tag "${SWS_TAG}" '.tag_name == $tag and .draft == false' >/dev/null; then
    return 0
  fi

  ui::info "${LOG_TAG}" "Retrieving Static Web Server release metadata: ${SWS_TAG}"
  if ! RELEASE_JSON="$(github_release_get "https://api.github.com/repos/static-web-server/static-web-server/releases/tags/${SWS_TAG}")"; then
    fail "Failed to retrieve Static Web Server release metadata: ${SWS_TAG}"
  fi
  if ! printf '%s' "${RELEASE_JSON}" | jq -e --arg tag "${SWS_TAG}" '.tag_name == $tag and .draft == false' >/dev/null; then
    fail "Static Web Server release metadata does not match ${SWS_TAG}."
  fi
}

detect_asset_name() {
  local os_name machine_name
  os_name="$(uname -s)"
  machine_name="$(uname -m)"

  case "${os_name}:${machine_name}" in
    Darwin:arm64|Darwin:aarch64)
      printf 'static-web-server-%s-aarch64-apple-darwin.tar.gz\n' "${SWS_TAG}"
      ;;
    Darwin:x86_64)
      printf 'static-web-server-%s-x86_64-apple-darwin.tar.gz\n' "${SWS_TAG}"
      ;;
    Linux:arm64|Linux:aarch64)
      printf 'static-web-server-%s-aarch64-unknown-linux-gnu.tar.gz\n' "${SWS_TAG}"
      ;;
    Linux:armv7l)
      printf 'static-web-server-%s-armv7-unknown-linux-gnueabihf.tar.gz\n' "${SWS_TAG}"
      ;;
    Linux:x86_64)
      printf 'static-web-server-%s-x86_64-unknown-linux-gnu.tar.gz\n' "${SWS_TAG}"
      ;;
    *)
      fail "Unsupported platform: ${os_name} ${machine_name}"
      ;;
  esac
}

resolve_asset_metadata() {
  local asset_record expected_url digest
  load_release_metadata
  ASSET_NAME="$(detect_asset_name)"

  if ! asset_record="$(printf '%s' "${RELEASE_JSON}" | jq -er --arg name "${ASSET_NAME}" '
    first(.assets[]? | select(.name == $name and .state == "uploaded")) as $asset
    | select($asset != null)
    | [$asset.browser_download_url, $asset.digest]
    | @tsv
  ')"; then
    fail "Static Web Server release asset not found: ${ASSET_NAME}"
  fi

  IFS=$'\t' read -r ASSET_URL digest <<<"${asset_record}"
  expected_url="https://github.com/static-web-server/static-web-server/releases/download/${SWS_TAG}/${ASSET_NAME}"
  if [[ "${ASSET_URL}" != "${expected_url}" ]]; then
    fail 'Static Web Server release asset URL verification failed.'
  fi
  if [[ ! "${digest}" =~ ^sha256:[0-9a-fA-F]{64}$ ]]; then
    fail "Static Web Server release asset has no valid SHA-256 digest: ${ASSET_NAME}"
  fi
  ASSET_SHA256="$(printf '%s' "${digest#sha256:}" | tr '[:upper:]' '[:lower:]')"
}

needs_download() {
  CURRENT_SWS_VERSION="$(installed_version || true)"
  if [[ -z "${CURRENT_SWS_VERSION}" ]]; then
    return 0
  fi
  ui::info "${LOG_TAG}" "Installed Static Web Server version: ${CURRENT_SWS_VERSION}"
  [[ "${CURRENT_SWS_VERSION}" != "${TARGET_SWS_VERSION}" ]]
}

confirm_update() {
  if [[ -z "${CURRENT_SWS_VERSION}" ]]; then
    return 0
  fi
  if [[ -n "${REQUESTED_RAW}" ]]; then
    return 0
  fi
  if is_true "${SWS_AUTO_UPDATE:-}" || is_true "${SWS_ASSUME_YES:-}"; then
    return 0
  fi
  if is_true "${SWS_ASSUME_NO:-}"; then
    ui::info "${LOG_TAG}" "Keeping installed Static Web Server ${CURRENT_SWS_VERSION}."
    return 1
  fi
  if [[ ! -t 0 ]]; then
    ui::info "${LOG_TAG}" "Non-interactive input: keeping Static Web Server ${CURRENT_SWS_VERSION}. Set SWS_AUTO_UPDATE=1 to update automatically."
    return 1
  fi

  local answer="false"
  ui::ask_yesno answer "${LOG_TAG}" "Static Web Server ${CURRENT_SWS_VERSION} -> ${TARGET_SWS_VERSION}: update?" Y
  [[ "${answer}" == 'true' ]]
}

install_sws() {
  local archive_path actual_sha extracted_binary candidate extracted_version
  resolve_asset_metadata
  mkdir -p "${TOOLS_DIR}"
  INSTALL_STAGING_DIR="$(mktemp -d "${TOOLS_DIR}/.install.XXXXXX")"
  archive_path="${INSTALL_STAGING_DIR}/${ASSET_NAME}"

  ui::info "${LOG_TAG}" "Downloading Static Web Server ${TARGET_SWS_VERSION} (${ASSET_NAME})"
  curl -fsSL --proto '=https' --tlsv1.2 "${ASSET_URL}" -o "${archive_path}"

  actual_sha="$(sha256_file "${archive_path}")"
  if [[ "${actual_sha}" != "${ASSET_SHA256}" ]]; then
    fail 'Static Web Server archive SHA-256 verification failed.'
  fi

  tar -xzf "${archive_path}" -C "${INSTALL_STAGING_DIR}"
  extracted_binary=""
  while IFS= read -r candidate; do
    if [[ -n "${extracted_binary}" ]]; then
      fail 'Static Web Server archive contains multiple candidate binaries.'
    fi
    extracted_binary="${candidate}"
  done < <(find "${INSTALL_STAGING_DIR}" -maxdepth 3 -type f -name 'static-web-server' -print)

  if [[ -z "${extracted_binary}" ]]; then
    fail 'Static Web Server archive did not contain the expected binary.'
  fi
  chmod 0755 "${extracted_binary}"

  extracted_version="$(binary_version "${extracted_binary}" || true)"
  if [[ "${extracted_version}" != "${TARGET_SWS_VERSION}" ]]; then
    fail 'Static Web Server binary version verification failed.'
  fi

  mv -f "${extracted_binary}" "${SWS_BINARY}"
  cleanup_install
  ui::ok "${LOG_TAG}" "Static Web Server ${TARGET_SWS_VERSION} is ready."
}

terminate_conflicts() {
  local -a targets=("$@")
  local -a watching=()
  local pid attempt

  for pid in "${targets[@]}"; do
    if [[ "${pid}" == '1' ]]; then
      ui::err "${LOG_TAG}" 'PID 1 will not be stopped.'
      return 1
    fi
  done

  ui::info "${LOG_TAG}" "Sending SIGTERM to: ${targets[*]}"
  for pid in "${targets[@]}"; do
    if ! kill -TERM "${pid}" 2>/dev/null && process_is_running "${pid}"; then
      ui::warn "${LOG_TAG}" "Could not send SIGTERM to PID ${pid}."
    fi
  done

  watching=("${targets[@]}")
  attempt=0
  while (( attempt < 20 )); do
    local -a remaining=()
    for pid in "${watching[@]}"; do
      if process_is_running "${pid}"; then
        remaining+=("${pid}")
      fi
    done
    if (( ${#remaining[@]} == 0 )); then
      ui::ok "${LOG_TAG}" "Processes using port ${SWS_PORT} stopped."
      return 0
    fi
    watching=("${remaining[@]}")
    sleep 0.25
    attempt=$((attempt + 1))
  done

  ui::warn "${LOG_TAG}" "SIGTERM did not stop: ${watching[*]}"
  if is_true "${FORCE_KILL_FLAG}"; then
    ui::warn "${LOG_TAG}" 'SWS_FORCE_KILL is enabled; sending SIGKILL.'
  else
    local escalate="false"
    ui::ask_yesno escalate "${LOG_TAG}" 'Send SIGKILL to the remaining processes?' N
    if [[ "${escalate}" != 'true' ]]; then
      return 1
    fi
  fi

  for pid in "${watching[@]}"; do
    kill -KILL "${pid}" 2>/dev/null || true
  done
  for pid in "${watching[@]}"; do
    if ! wait_for_process_exit "${pid}" 20; then
      ui::err "${LOG_TAG}" "Could not stop PID ${pid}."
      return 1
    fi
  done
  ui::ok "${LOG_TAG}" 'Forced stop completed.'
}

check_port_conflict() {
  local -a conflict_pids=()
  local pid details answer details_line

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    [[ "${pid}" =~ ^[0-9]+$ ]] || continue
    conflict_pids+=("${pid}")
  done < <(lsof -nP -t -iTCP:"${SWS_PORT}" -sTCP:LISTEN 2>/dev/null | sort -u || true)

  if (( ${#conflict_pids[@]} == 0 )); then
    return 0
  fi

  ui::warn "${LOG_TAG}" "Port ${SWS_PORT} is already in use."
  if details="$(lsof -nP -iTCP:"${SWS_PORT}" -sTCP:LISTEN 2>/dev/null)"; then
    while IFS= read -r details_line; do
      [[ -n "${details_line}" ]] || continue
      ui::info "${LOG_TAG}" "  ${details_line}"
    done <<<"${details}"
  fi

  if [[ ! -t 0 ]]; then
    fail "Cannot stop an existing process in non-interactive mode. Change SWS_PORT=${SWS_PORT} or stop it manually."
  fi

  answer="false"
  ui::ask_yesno answer "${LOG_TAG}" 'Stop the existing process?' N
  if [[ "${answer}" != 'true' ]]; then
    fail "Startup cancelled because port ${SWS_PORT} is in use."
  fi
  if ! terminate_conflicts "${conflict_pids[@]}"; then
    fail 'Startup cancelled because the existing process could not be stopped.'
  fi
}

handle_signal() {
  local signal_name="$1"
  local label answer
  SIGNAL_ATTEMPTS=$((SIGNAL_ATTEMPTS + 1))
  label="SIG${signal_name}"
  ui::warn "${LOG_TAG}" "${label} received; stopping Static Web Server."

  if [[ -z "${SERVER_PID}" ]] || ! process_is_running "${SERVER_PID}"; then
    return 0
  fi

  if ! kill -"${signal_name}" "${SERVER_PID}" 2>/dev/null; then
    kill -TERM "${SERVER_PID}" 2>/dev/null || true
  fi

  if (( SIGNAL_ATTEMPTS == 1 )) && wait_for_process_exit "${SERVER_PID}" 20; then
    ui::ok "${LOG_TAG}" 'Static Web Server stopped gracefully.'
    return 0
  fi
  if ! process_is_running "${SERVER_PID}"; then
    ui::ok "${LOG_TAG}" 'Static Web Server stopped gracefully.'
    return 0
  fi

  ui::warn "${LOG_TAG}" "Static Web Server did not stop within 5 seconds (PID=${SERVER_PID})."
  if is_true "${FORCE_KILL_FLAG}"; then
    ui::warn "${LOG_TAG}" 'SWS_FORCE_KILL is enabled; sending SIGKILL.'
  elif [[ -t 0 ]]; then
    answer="false"
    ui::ask_yesno answer "${LOG_TAG}" 'Send SIGKILL to Static Web Server?' Y
    if [[ "${answer}" != 'true' ]]; then
      ui::warn "${LOG_TAG}" "Static Web Server is still running (PID=${SERVER_PID})."
      return 0
    fi
  else
    ui::warn "${LOG_TAG}" 'Non-interactive shutdown; sending SIGKILL.'
  fi

  kill -KILL "${SERVER_PID}" 2>/dev/null || true
  if wait_for_process_exit "${SERVER_PID}" 20; then
    ui::ok "${LOG_TAG}" 'Static Web Server forced stop completed.'
  else
    ui::err "${LOG_TAG}" "Static Web Server could not be stopped (PID=${SERVER_PID})."
  fi
}

determine_version
if needs_download; then
  if confirm_update; then
    install_sws
  else
    ui::info "${LOG_TAG}" "Starting with installed Static Web Server ${CURRENT_SWS_VERSION}."
  fi
else
  ui::info "${LOG_TAG}" 'Installed Static Web Server already matches the target version.'
fi

RUNTIME_SWS_VERSION="$(installed_version || true)"
if [[ -z "${RUNTIME_SWS_VERSION}" ]]; then
  fail 'No runnable Static Web Server binary is available.'
fi

check_port_conflict

trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM

ui::info "${LOG_TAG}" "Starting Static Web Server ${RUNTIME_SWS_VERSION}."
ui::info "${LOG_TAG}" "AnnoForge: http://127.0.0.1:${SWS_PORT}/"
ui::info "${LOG_TAG}" 'Stop: Ctrl+C'

"${SWS_BINARY}" \
  --host 127.0.0.1 \
  --port "${SWS_PORT}" \
  --root "${WEB_ROOT}" \
  --config-file "${CONFIG_FILE}" \
  --log-level info \
  --directory-listing false \
  --cache-control-headers false &
SERVER_PID=$!
ui::info "${LOG_TAG}" "Static Web Server PID: ${SERVER_PID}"

status=0
while true; do
  set +e
  wait "${SERVER_PID}"
  wait_status=$?
  set -e
  status=${wait_status}

  if process_is_running "${SERVER_PID}"; then
    continue
  fi

  set +e
  wait "${SERVER_PID}" 2>/dev/null
  reap_status=$?
  set -e
  if (( reap_status != 127 )); then
    status=${reap_status}
  fi
  break
done

SERVER_PID=""
trap - INT TERM

if (( status == 0 )); then
  ui::ok "${LOG_TAG}" 'Static Web Server stopped.'
else
  ui::warn "${LOG_TAG}" "Static Web Server exited with status ${status}."
fi

exit "${status}"
