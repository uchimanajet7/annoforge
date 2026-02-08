#!/usr/bin/env bash
# 設定入力: 全項目を一括収集します。region/bucket/prefix/arch/pillow_version/apply_yes/image_url
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp setup "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info setup "----- start: ${START_TS} -----"
__af_end() {
  local __end_ms
  __end_ms="$(ui::epoch_ms)"
  local __diff
  __diff=$((__end_ms-START_MS))
  ui::info setup "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"
}
trap __af_end EXIT

BASE_PROFILE=""
# deploy.sh からの引き継ぎ。未指定項目は対話で補完します。
AWS_REGION_INPUT=""
BUCKET=""
PREFIX=""
ARCH=""
PILLOW_VERSION=""
IMAGE_URL=""
usage() {
  cat <<USAGE
使い方: bash scripts/deploy/setup.sh [--base-profile NAME] [--region REGION] [--bucket NAME] [--prefix PREFIX] [--arch arm64|x86_64] [--pillow-version VER|latest] [--image-url URL]
  すべての入力を一括で対話収集し、__OUT_* を標準出力に出力します。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-profile) BASE_PROFILE="$2"; shift 2;;
    --region) AWS_REGION_INPUT="$2"; shift 2;;
    --bucket) BUCKET="$2"; shift 2;;
    --prefix) PREFIX="$2"; shift 2;;
    --arch) ARCH="$2"; shift 2;;
    --pillow-version) PILLOW_VERSION="$2"; shift 2;;
    --image-url) IMAGE_URL="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) ui::err setup "不明な引数: $1"; usage; exit 1;;
  esac
done

ui::hdr setup "設定入力(setup)"

# 既定リージョンの算出。base-profile を優先します。
DEFAULT_REGION=""
if [[ -n "$BASE_PROFILE" ]]; then
  set +e; DEFAULT_REGION=$(aws configure get region --profile "$BASE_PROFILE" 2>/dev/null); set -e
fi
if [[ -z "$DEFAULT_REGION" ]]; then
  set +e; DEFAULT_REGION=$(aws configure get region 2>/dev/null); set -e
fi

# 入力収集
APPLY_YES="false"

if [[ -z "$AWS_REGION_INPUT" ]]; then
  if [[ -n "$DEFAULT_REGION" ]]; then
    ui::info setup "既定: リージョン=${DEFAULT_REGION}。Enterで採用します。"
    ui::ask_silent AWS_REGION_INPUT setup "AWSリージョン" "$DEFAULT_REGION"
  else
    ui::ask AWS_REGION_INPUT setup "AWSリージョン (例 us-west-2)" ""
  fi
fi

if [[ -z "$BUCKET" ]]; then
  ui::info setup "バケット名は小文字英数字とハイフンです。3〜63文字です。"
  ui::ask BUCKET setup "出力S3バケット名。グローバル一意が必要です。" ""
fi
if [[ -z "$PREFIX" ]]; then
  ui::ask PREFIX setup "出力プレフィックス。入力は任意です。" ""
fi
if [[ -z "$ARCH" ]]; then
  ui::info setup "既定: アーキテクチャ=arm64。Enterで採用します。"
  ui::ask_silent ARCH setup "アーキテクチャ。arm64 または x86_64。" "arm64"
fi
if [[ -z "$PILLOW_VERSION" ]]; then
  ui::info setup "既定: Pillow=latest。Enterで採用します。"
  ui::ask_silent PILLOW_VERSION setup "Pillowバージョン。例: 12.1.0 または latest" "latest"
fi
ui::info setup "自動承認を有効にする前に確認します"
ui::ask_yesno APPLY_YES setup "Terraform apply を自動承認しますか？" N
if [[ -z "$IMAGE_URL" ]]; then
  ui::ask IMAGE_URL setup "スモークテスト画像URL。入力は任意です。" ""
fi

# バリデーション
case "$ARCH" in arm64|x86_64) :;; *) ui::err setup "arch は arm64 か x86_64 を指定してください"; exit 1;; esac
if [[ -z "$AWS_REGION_INPUT" ]]; then ui::err setup "AWSリージョンは必須です"; exit 1; fi
if [[ -z "$BUCKET" ]]; then ui::err setup "バケット名は必須です"; exit 1; fi

# バケット衝突確認
ui::info setup "バケットの衝突確認"
set +e
OUT=$(aws s3api head-bucket --bucket "$BUCKET" 2>&1)
RC=$?
set -e
if [[ $RC -eq 0 ]]; then
  ui::err setup "バケット名 '${BUCKET}' は既に存在します。他者所有の可能性もあるため、ユニークな名前に変更してください。"
  exit 1
fi
if echo "$OUT" | grep -q "(404)"; then
  ui::ok setup "衝突は検出されませんでした。作成可能と想定します。"
else
  ui::warn setup "衝突不明: バケットの存在可否を判定できません。認証ラッパー経由で実行し、リージョン設定をご確認ください。"
  ui::info setup "参考出力: $OUT"
fi

# 最終確認。要約を表示します。
ui::ok setup "確定: region=${AWS_REGION_INPUT} bucket=${BUCKET} prefix=${PREFIX} arch=${ARCH} pillow=${PILLOW_VERSION} apply_yes=${APPLY_YES} image_url=${IMAGE_URL}"

# 機械可読出力。標準出力へ出力します。
echo "__OUT_REGION=${AWS_REGION_INPUT}"
echo "__OUT_BUCKET=${BUCKET}"
echo "__OUT_PREFIX=${PREFIX}"
echo "__OUT_ARCH=${ARCH}"
echo "__OUT_PILLOW_VERSION=${PILLOW_VERSION}"
echo "__OUT_APPLY_YES=${APPLY_YES}"
echo "__OUT_IMAGE_URL=${IMAGE_URL}"
