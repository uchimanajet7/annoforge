#!/usr/bin/env bash
# Pillow レイヤーZIP作成（manylinux wheel利用）
# 既定は lambda/requirements.txt の固定値。--version latest 指定時のみ PyPI を参照します。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp layer "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info layer "----- start: ${START_TS} -----"
__af_end() {
  local __end_ms
  __end_ms="$(ui::epoch_ms)"
  local __diff
  __diff=$((__end_ms-START_MS))
  ui::info layer "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"
}
trap __af_end EXIT

DEFAULT_ARCH="arm64"   # arm64 | x86_64
REQUIREMENTS_FILE="${ROOT_DIR}/lambda/requirements.txt"

read_pinned_pillow_version() {
  local version=""
  if [[ -f "$REQUIREMENTS_FILE" ]]; then
    version="$(sed -nE 's/^[[:space:]]*Pillow==([0-9.]+)[[:space:]]*$/\1/p' "$REQUIREMENTS_FILE" | head -n1)"
  fi
  printf '%s' "$version"
}

ARCH="$DEFAULT_ARCH"
VERSION=""

usage() {
  cat <<USAGE
使い方: bash scripts/deploy/build_layer.sh [--arch arm64|x86_64] [--version <semver|latest>]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2;;
    --version) VERSION="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) ui::err layer "不明な引数: $1"; usage; exit 1;;
  esac
done

DEFAULT_PILLOW_VERSION="$(read_pinned_pillow_version)"
if [[ -z "$VERSION" ]]; then
  if [[ -z "$DEFAULT_PILLOW_VERSION" ]]; then
    ui::err layer "Pillow固定値を取得できません: ${REQUIREMENTS_FILE}"
    exit 1
  fi
  VERSION="$DEFAULT_PILLOW_VERSION"
fi

resolve_latest() {
  # PyPIからJSONを取得して info.version を抜き出す（失敗時は空文字）
  set +e
LATEST=$(curl -fsSL https://pypi.org/pypi/Pillow/json | jq -r '.info.version' 2>/dev/null)
  CODE=$?
  set -e
  if [[ $CODE -ne 0 || -z "$LATEST" ]]; then
    echo ""; return 0
  fi
  echo "$LATEST"
}

if [[ "$VERSION" == "latest" ]]; then
  ui::info layer "PyPIから最新安定版を解決します..."
  LATEST="$(resolve_latest)"
  if [[ -n "$LATEST" ]]; then
    VERSION="$LATEST"
    ui::info layer "解決: Pillow==${VERSION}"
  else
    if [[ -z "$DEFAULT_PILLOW_VERSION" ]]; then
      ui::err layer "最新版の解決に失敗し、フォールバック用のPillow固定値も取得できません: ${REQUIREMENTS_FILE}"
      exit 1
    fi
    ui::warn layer "最新版の解決に失敗。固定値 ${DEFAULT_PILLOW_VERSION} を使用します。"
    VERSION="$DEFAULT_PILLOW_VERSION"
  fi
fi

if [[ "$ARCH" == "arm64" ]]; then
  PLATFORM=manylinux2014_aarch64
elif [[ "$ARCH" == "x86_64" ]]; then
  PLATFORM=manylinux2014_x86_64
else
  ui::err layer "--arch は arm64 か x86_64 を指定してください"; exit 1
fi

ui::hdr layer "Pillow レイヤー作成"
ui::info layer "Pillow==${VERSION} / ${PLATFORM} でレイヤーを作成します"

# 実行ディレクトリに依存しないよう、作業は build/ 配下の一時ディレクトリで行う
OUTPUT_PATH_REL="infra/terraform/build/pillow-layer.zip"
OUTPUT_DIR="${ROOT_DIR}/infra/terraform/build"
OUTPUT_PATH="${ROOT_DIR}/${OUTPUT_PATH_REL}"
WORK_DIR_REL="infra/terraform/build/.tmp-layer-build"
WORK_DIR="${ROOT_DIR}/${WORK_DIR_REL}"

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_PATH}" >/dev/null 2>&1 || true
rm -rf "${WORK_DIR}" >/dev/null 2>&1 || true
mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

python3 -m venv .venv-build-layer
source .venv-build-layer/bin/activate
python -m pip install --upgrade pip >/dev/null

pip install \
  --platform "${PLATFORM}" \
  --implementation cp \
  --python-version 3.13 \
  --abi cp313 \
  --only-binary=:all: \
  -t python \
  "Pillow==${VERSION}"

zip -rq "${OUTPUT_PATH}" python
deactivate
rm -rf .venv-build-layer python >/dev/null 2>&1 || true
cd "${ROOT_DIR}"
rm -rf "${WORK_DIR}" >/dev/null 2>&1 || true

ui::ok layer "完了: ${OUTPUT_PATH_REL}"
