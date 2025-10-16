#!/usr/bin/env bash
# 利用ツール・ライブラリのバージョン差分を確認し、更新手順を提示する

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init

# 監視対象定義（id|type|target|source|regex|update_action|doc_anchor|latest_url|extra）
targets=()

targets+=(
  "pillow|pypi|Pillow|lambda/requirements.txt|Pillow==([0-9.]+)|bash scripts/deploy/build_layer.sh --version {latest}|docs/VERSIONS.md#pillow|https://pypi.org/project/Pillow/|"
)

targets+=(
  "konva|npm|konva|web/index.html|konva@([0-9.]+)|web/index.html の CDN バージョンを {latest} に更新|docs/VERSIONS.md#konva|https://www.jsdelivr.com/package/npm/konva|"
)

targets+=(
  "terraform_cli|hashicorp_release|terraform|CMD:terraform version|Terraform v([0-9.]+)|docs/VERSIONS.md#terraform-cli を参照|docs/VERSIONS.md#terraform-cli|https://releases.hashicorp.com/terraform/|"
)

targets+=(
  "terraform_provider_aws|hashicorp_provider|aws|infra/terraform/.terraform.lock.hcl||terraform init -upgrade && terraform plan|docs/VERSIONS.md#terraform-aws-provider|https://releases.hashicorp.com/terraform-provider-aws/|"
)

targets+=(
  "terraform_provider_archive|hashicorp_provider|archive|infra/terraform/.terraform.lock.hcl||terraform init -upgrade && terraform plan|docs/VERSIONS.md#terraform-archive-provider|https://releases.hashicorp.com/terraform-provider-archive/|"
)

targets+=(
  "aws_lambda_runtime|manual|aws_lambda_runtime|infra/terraform/main.tf|runtime[[:space:]]*=[[:space:]]*\"(python[0-9.]+)\"|docs/VERSIONS.md#aws-lambda-python-runtime を参照|docs/VERSIONS.md#aws-lambda-python-runtime|https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html|python3.13"
)

targets+=(
  "aws_cli|html_regex|https://awscli.amazonaws.com/v2/documentation/api/latest/index.html|CMD:aws --version|aws-cli/([0-9.]+)|docs/VERSIONS.md#開発環境ツール を参照|docs/VERSIONS.md#開発環境ツール|https://awscli.amazonaws.com/v2/documentation/api/latest/index.html|AWS CLI [0-9]+\\.[0-9]+\\.[0-9]+"
)

targets+=(
  "python3|html_regex|https://www.python.org/downloads/|CMD:python3 --version|Python ([0-9.]+)|docs/VERSIONS.md#開発環境ツール を参照|docs/VERSIONS.md#開発環境ツール|https://www.python.org/downloads/|Download Python [0-9]+\\.[0-9]+\\.[0-9]+"
)

targets+=(
  "pip|pypi|pip|CMD:pip --version|pip ([0-9.]+)|docs/VERSIONS.md#開発環境ツール を参照|docs/VERSIONS.md#開発環境ツール|https://pypi.org/project/pip/|"
)

targets+=(
  "zip|manual|zip|CMD:zip -v|Zip ([0-9.]+)|docs/VERSIONS.md#開発環境ツール を参照|docs/VERSIONS.md#開発環境ツール|https://infozip.sourceforge.net/Zip.html|3.0"
)

targets+=(
  "curl|html_regex|https://curl.se/download.html|CMD:curl --version|curl ([0-9.]+)|docs/VERSIONS.md#開発環境ツール を参照|docs/VERSIONS.md#開発環境ツール|https://curl.se/download.html|curl-[0-9]+\\.[0-9]+\\.[0-9]+\\.tar\\.xz"
)

targets+=(
  "jq|html_regex|https://jqlang.github.io/jq/|CMD:jq --version|jq-([0-9.]+)|docs/VERSIONS.md#開発環境ツール を参照|docs/VERSIONS.md#開発環境ツール|https://jqlang.github.io/jq/|Download jq [0-9]+\\.[0-9]+(?:\\.[0-9]+)?"
)

targets+=(
  "node|node_index|https://nodejs.org/dist/index.json|CMD:node --version|v([0-9.]+)|docs/VERSIONS.md#開発環境ツール を参照|docs/VERSIONS.md#開発環境ツール|https://nodejs.org/en/download/current/|"
)

want_json="false"

usage() {
  cat <<'USAGE'
使い方: bash scripts/tools/check_updates.sh [--json]
  --json  JSON形式で結果を出力します（標準出力に配列を1行で出力）。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) want_json="true"; shift;;
    -h|--help) usage; exit 0;;
    *) ui::err tools "不明な引数: $1"; usage; exit 1;;
  esac
done

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    ui::err tools "依存コマンドが見つかりません: $cmd"
    exit 1
  fi
done

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

normalize_version() {
  local value="$1"
  value="${value#v}"
  value="${value#jq-}"
  value="${value#curl-}"
  value="${value#release-}"
  value="${value//_/.}"
  echo "$value"
}

HTTP_STATUS=""
HTTP_ERROR_TEXT=""

http_get() {
  local url="$1"
  local accept="${2:-}"
  local ua="annoforge-version-check/1.0"
  local headers=(-H "User-Agent: ${ua}")
  [[ -n "$accept" ]] && headers+=(-H "Accept: ${accept}")

  local response
  if ! response=$(curl -sSL --compressed "${headers[@]}" -w $'\n%{http_code}' "$url" 2>/dev/null); then
    local exit_code=$?
    HTTP_STATUS=""
    HTTP_ERROR_TEXT="curl exit ${exit_code}"
    return 1
  fi

  HTTP_STATUS="${response##*$'\n'}"
  if [[ -z "$HTTP_STATUS" ]]; then
    HTTP_ERROR_TEXT="unable to determine HTTP status"
    return 1
  fi

  local body
  body="${response%$'\n'*}"

  if [[ "$HTTP_STATUS" -ge 400 ]]; then
    HTTP_ERROR_TEXT="HTTP ${HTTP_STATUS}"
    return 1
  fi

  HTTP_ERROR_TEXT=""
  printf '%s' "$body"
}

fetch_latest_version() {
  local type="$1"
  local target="$2"
  local extra="$3"
  local data
  FETCH_NOTE=""
  FETCH_ENDPOINT=""
  LATEST_VERSION=""

  case "$type" in
    pypi)
      FETCH_ENDPOINT="https://pypi.org/pypi/${target}/json"
      if ! data=$(http_get "$FETCH_ENDPOINT"); then
        return 1
      fi
      LATEST_VERSION="$(printf '%s' "$data" | jq -r '.info.version')" || return 1
      return 0
      ;;
    npm)
      FETCH_ENDPOINT="https://registry.npmjs.org/${target}/latest"
      if ! data=$(http_get "$FETCH_ENDPOINT"); then
        return 1
      fi
      LATEST_VERSION="$(printf '%s' "$data" | jq -r '.version')" || return 1
      return 0
      ;;
    hashicorp_release)
      FETCH_ENDPOINT="https://releases.hashicorp.com/${target}/index.json"
      if ! data=$(http_get "$FETCH_ENDPOINT"); then
        return 1
      fi
      LATEST_VERSION="$(printf '%s' "$data" | jq -r '.versions
          | keys
          | map(select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$")))
          | sort_by(split(".") | map(tonumber))
          | last')" || return 1
      return 0
      ;;
    hashicorp_provider)
      FETCH_ENDPOINT="https://releases.hashicorp.com/terraform-provider-${target}/index.json"
      if ! data=$(http_get "$FETCH_ENDPOINT"); then
        return 1
      fi
      LATEST_VERSION="$(printf '%s' "$data" | jq -r '.versions
          | keys
          | map(select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$")))
          | sort_by(split(".") | map(tonumber))
          | last')" || return 1
      return 0
      ;;
    html_regex)
      FETCH_ENDPOINT="$target"
      if ! data=$(http_get "$FETCH_ENDPOINT"); then
        return 1
      fi
      local normalized match version
      normalized=$(printf '%s' "$data" | tr '\r\n' ' ')
      match="$(printf '%s\n' "$normalized" | grep -Eo "$extra" | head -n1 || true)"
      if [[ -n "$match" ]]; then
        version="$(printf '%s\n' "$match" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || true)"
        if [[ -n "$version" ]]; then
          LATEST_VERSION="$version"
          return 0
        fi
      fi
      FETCH_NOTE="pattern not found (${extra})"
      return 1
      ;;
    aws_cli_manifest)
      FETCH_ENDPOINT="$target"
      if ! data=$(http_get "$FETCH_ENDPOINT"); then
        return 1
      fi
      LATEST_VERSION="$(printf '%s' "$data" | jq -r '.versions | map(.version) | map(select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))) | sort_by(split(".") | map(tonumber)) | last')" || return 1
      if [[ -z "$LATEST_VERSION" || "$LATEST_VERSION" == "null" ]]; then
        FETCH_NOTE="failed to parse aws cli manifest"
        return 1
      fi
      return 0
      ;;
    node_index)
      FETCH_ENDPOINT="$target"
      if ! data=$(http_get "$FETCH_ENDPOINT"); then
        return 1
      fi
      LATEST_VERSION="$(printf '%s' "$data" | jq -r '
        map(select(.version | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))) |
        sort_by(.version | sub("^v";"") | split(".") | map(tonumber)) |
        last |
        .version
      ' 2>/dev/null)" || return 1
      if [[ -z "$LATEST_VERSION" || "$LATEST_VERSION" == "null" ]]; then
        FETCH_NOTE="failed to parse node index"
        return 1
      fi
      return 0
      ;;
    manual)
      FETCH_ENDPOINT="(manual)"
      FETCH_NOTE="自動取得対象外"
      LATEST_VERSION="${extra}"
      return 0
      ;;
    *)
      FETCH_NOTE="unsupported fetch type: ${type}"
      return 1
      ;;
  esac
}

extract_current_from_file() {
  local path="$1"
  local regex="$2"
  if [[ ! -f "${ROOT_DIR}/${path}" ]]; then
    return 1
  fi
  while IFS= read -r line; do
    if [[ "$line" =~ $regex ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
  done < "${ROOT_DIR}/${path}"
  return 2
}

extract_current_from_cmd() {
  local cmdline="$1"
  local regex="$2"
  local bin="$cmdline"
  if [[ "$cmdline" == *" "* ]]; then
    bin="${cmdline%% *}"
  fi
  if ! command -v "$bin" >/dev/null 2>&1; then
    return 1
  fi
  local output
  if ! output=$(eval "$cmdline" 2>/dev/null); then
    return 2
  fi
  if [[ "$output" =~ $regex ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 3
}

extract_provider_version() {
  local provider="$1"
  local path="$2"
  local abs="${ROOT_DIR}/${path}"
  if [[ ! -f "$abs" ]]; then
    return 1
  fi
  local in_block=0
  while IFS= read -r line; do
    if [[ $line =~ provider[[:space:]]*\"registry\.terraform\.io/hashicorp/${provider}\" ]]; then
      in_block=1
      continue
    fi
    if [[ $in_block -eq 1 ]]; then
      if [[ $line =~ ^\} ]]; then
        in_block=0
        continue
      fi
      if [[ $line =~ version[[:space:]]*=[[:space:]]*\"([0-9.]+)\" ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
      fi
    fi
  done < "$abs"
  return 2
}

results=()
needs_update=()
up_to_date=()
missing=()
unknown=()
info_only=()
FETCH_ENDPOINT=""
FETCH_NOTE=""
LATEST_VERSION=""

add_result() {
  local record="$1"
  local status="$2"
  results+=("$record")
  case "$status" in
    needs-update) needs_update+=("$record");;
    up-to-date) up_to_date+=("$record");;
    missing) missing+=("$record");;
    unknown) unknown+=("$record");;
    info-only) info_only+=("$record");;
  esac
}

describe_source() {
  local source="$1"
  if [[ "$source" == CMD:* ]]; then
    printf 'command "%s"' "${source#CMD:}"
  else
    printf 'file "%s"' "$source"
  fi
}

colorize() {
  local color="$1"
  local text="$2"
  if [[ "${UI_COLOR:-0}" -eq 1 ]]; then
    case "$color" in
      yellow) printf '\033[33m%s\033[0m' "$text";;
      green)  printf '\033[32m%s\033[0m' "$text";;
      red)    printf '\033[31m%s\033[0m' "$text";;
      cyan)   printf '\033[36m%s\033[0m' "$text";;
      bold)   printf '\033[1m%s\033[0m' "$text";;
      dim)    printf '\033[2m%s\033[0m' "$text";;
      *)      printf '%s' "$text";;
    esac
  else
    printf '%s' "$text"
  fi
}

describe_fetch() {
  local endpoint="$1"
  if [[ -z "$endpoint" ]]; then
    echo "(unknown)"
  elif [[ "$endpoint" == "(manual)" ]]; then
    echo "scripts/tools/check_updates.sh (manual)"
  else
    echo "$endpoint"
  fi
}

for entry in "${targets[@]}"; do
  IFS='|' read -r id type target source regex update_action doc_anchor latest_url extra <<<"$entry"

  current_version=""
  latest_version=""
  status="unknown"
  notes=""
  FETCH_NOTE=""
  FETCH_ENDPOINT=""
  HTTP_STATUS=""
  HTTP_ERROR_TEXT=""
  LATEST_VERSION=""
  failure_note=""

  ui::info tools "checking ${id} ..."
  ui::info tools "  current source: $(describe_source "$source")"

  if [[ "$source" == CMD:* ]]; then
    if ! current_version=$(extract_current_from_cmd "${source#CMD:}" "$regex"); then
      case $? in
        1) status="missing"; notes="コマンド未インストール: ${source#CMD:}";;
        2) status="missing"; notes="コマンド実行に失敗しました";;
        3) status="missing"; notes="コマンド出力からバージョンを抽出できませんでした";;
      esac
    fi
  elif [[ "$type" == "hashicorp_provider" ]]; then
    if ! current_version=$(extract_provider_version "$target" "$source"); then
      case $? in
        1) status="missing"; notes="ロックファイル未存在: ${source}";;
        2) status="missing"; notes="provider ${target} のバージョンを抽出できませんでした";;
      esac
    fi
  else
    if ! current_version=$(extract_current_from_file "$source" "$regex"); then
      case $? in
        1) status="missing"; notes="ファイル未存在: ${source}";;
        2) status="missing"; notes="現行バージョンを抽出できませんでした";;
      esac
    fi
  fi

  # 最新版取得（missingでも試す）
  latest_fetch_err=""
  if fetch_latest_version "$type" "$target" "$extra"; then
    latest_version="$LATEST_VERSION"
  else
    latest_fetch_err="fetch_failed"
    latest_version="$LATEST_VERSION"
  fi
  ui::info tools "  latest source: $(describe_fetch "$FETCH_ENDPOINT")"

  if [[ -n "$latest_version" ]]; then
    latest_version="$(normalize_version "$latest_version")"
  fi
  if [[ -n "$current_version" ]]; then
    current_version="$(normalize_version "$current_version")"
  fi

  if [[ -z "$latest_fetch_err" && -n "${FETCH_NOTE:-}" ]]; then
    notes="${notes:+${notes}; }${FETCH_NOTE}"
  fi
  if [[ -n "$latest_fetch_err" ]]; then
    failure_note="$FETCH_NOTE"
    if [[ -z "$failure_note" ]]; then
      if [[ -n "$HTTP_ERROR_TEXT" ]]; then
        failure_note="$HTTP_ERROR_TEXT"
      elif [[ -n "$HTTP_STATUS" ]]; then
        failure_note="fetch failed (HTTP ${HTTP_STATUS})"
      else
        failure_note="fetch failed"
      fi
    fi
    notes="${notes:+${notes}; }${failure_note}"
  fi

  if [[ -n "$latest_fetch_err" || -z "$latest_version" ]]; then
    if [[ "$type" == "manual" ]]; then
      status="info-only"
      if [[ -z "$notes" ]]; then
        notes="自動取得対象外。リンク先を参照してください。"
      fi
    else
      status="unknown"
      if [[ -z "$notes" ]]; then
        notes="最新版情報を取得できませんでした"
      fi
    fi
  elif [[ -z "$current_version" ]]; then
    # 既に missing として設定済みの場合はそのまま
    if [[ "$status" != "missing" ]]; then
      status="missing"
      if [[ -z "$notes" ]]; then
        notes="現行バージョンが取得できませんでした"
      fi
    fi
  else
    if [[ "$current_version" == "$latest_version" ]]; then
      status="up-to-date"
      notes="最新バージョンです"
    else
      status="needs-update"
      notes="最新版との差分があります"
    fi
  fi

  record="${id}|${status}|${current_version}|${latest_version}|${update_action}|${doc_anchor}|${latest_url}|${notes}"
  add_result "$record" "$status"
done

print_records() {
  local label="$1"
  local list_name="$2"
  eval "local items=(\"\${${list_name}[@]-}\")"
  if [[ ${#items[@]} -eq 0 ]]; then
    return
  fi
  local label_colored="$label"
  case "$label" in
    "[needs-update]") label_colored="$(colorize yellow "$label")";;
    "[up-to-date]")   label_colored="$(colorize green "$label")";;
    "[missing]")      label_colored="$(colorize red "$label")";;
    "[unknown]")      label_colored="$(colorize yellow "$label")";;
    "[info-only]")    label_colored="$(colorize cyan "$label")";;
  esac
  ui::info tools "----------------------------------------"
  ui::info tools "${label_colored}"
  local shown=0
  for rec in "${items[@]}"; do
    IFS='|' read -r id status current latest action doc latest_url notes <<<"$rec"
    if [[ -z "$id" && -z "$status" && -z "$current" && -z "$latest" && -z "$action" && -z "$doc" && -z "$latest_url" && -z "$notes" ]]; then
      continue
    fi
    shown=1
    local id_colored="$(colorize bold "$id")"
    local summary="  - ${id_colored}"
    if [[ -n "$current" || -n "$latest" ]]; then
      local current_fmt current_colored latest_colored
      current_fmt="${current:-?}"
      latest_colored="${latest:-?}"
      if [[ -n "$current_fmt" ]]; then
        current_colored="$(colorize dim "$current_fmt")"
      else
        current_colored="$current_fmt"
      fi
      latest_colored="$(colorize bold "$latest_colored")"
      summary+=" (${current_colored} -> ${latest_colored})"
    fi
    local status_colored="[$status]"
    case "$status" in
      needs-update) status_colored="$(colorize yellow "[$status]")";;
      up-to-date)   status_colored="$(colorize green "[$status]")";;
      missing|unknown) status_colored="$(colorize red "[$status]")";;
      info-only)    status_colored="$(colorize cyan "[$status]")";;
    esac
    summary+=" ${status_colored}"
    ui::info tools "${summary}"
    if [[ -n "$action" ]]; then
      ui::info tools "      action: ${action//\{latest\}/${latest}}"
    fi
    if [[ -n "$doc" ]]; then
      ui::info tools "      doc   : ${doc}"
    fi
    if [[ -n "$latest_url" ]]; then
      ui::info tools "      ref   : ${latest_url}"
    fi
    if [[ -n "$notes" ]]; then
      ui::info tools "      notes : ${notes}"
    fi
  done
  if [[ $shown -eq 0 ]]; then
    ui::info tools "  (none)"
  fi
}

print_records "[needs-update]" needs_update
print_records "[up-to-date]" up_to_date
print_records "[missing]" missing
print_records "[unknown]" unknown
print_records "[info-only]" info_only

if [[ "$want_json" == "true" ]]; then
  json_escape() {
    jq -Rn --arg v "$1" '$v'
  }
  json_items=()
  for rec in "${results[@]}"; do
    IFS='|' read -r id status current latest action doc latest_url notes <<<"$rec"
    action="${action//\{latest\}/${latest}}"
    json_items+=("{
      \"id\": $(json_escape "$id"),
      \"status\": $(json_escape "$status"),
      \"current\": $(json_escape "$current"),
      \"latest\": $(json_escape "$latest"),
      \"action\": $(json_escape "$action"),
      \"doc\": $(json_escape "$doc"),
      \"latest_url\": $(json_escape "$latest_url"),
      \"notes\": $(json_escape "$notes")
    }")
  done
  printf '[%s]\n' "$(IFS=','; echo "${json_items[*]}")"
fi
