#!/usr/bin/env bash
# infra/terraform/dev.auto.tfvars を生成（既存時は確認、--yesで上書き）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp make_tfvars "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info make_tfvars "----- start: ${START_TS} -----"
__af_end() { local __end_ms=$(ui::epoch_ms); local __diff=$((__end_ms-START_MS)); ui::info make_tfvars "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"; }
trap __af_end EXIT

REGION=""
BUCKET=""
PREFIX=""
ARCH="arm64"
YES="false"
FUNC="annoforge-api"
ALIAS="prod"

usage() {
  cat <<USAGE
使い方: bash scripts/deploy/make_tfvars.sh [--region REGION] [--bucket NAME] [--prefix PREFIX] [--arch arm64|x86_64] [--yes]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2;;
    --bucket) BUCKET="$2"; shift 2;;
    --prefix) PREFIX="$2"; shift 2;;
    --arch) ARCH="$2"; shift 2;;
    --yes) YES="true"; shift;;
    -h|--help) usage; exit 0;;
    *) ui::err make_tfvars "不明な引数: $1"; usage; exit 1;;
  esac
done

# 引数が無ければ環境変数（DEPLOY_*）を参照
REGION=${REGION:-${DEPLOY_REGION:-${REGION:-}}}
BUCKET=${BUCKET:-${DEPLOY_BUCKET:-${BUCKET:-}}}
PREFIX=${PREFIX:-${DEPLOY_PREFIX:-${PREFIX:-}}}
ARCH=${ARCH:-${DEPLOY_ARCH:-${ARCH:-arm64}}}

# 入力不要: REGION は引数が無ければ既定を自動採用、BUCKET は必須
if [[ -z "$REGION" ]]; then
  REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
  if [[ -z "$REGION" ]]; then set +e; REGION=$(aws configure get region 2>/dev/null); set -e; fi
fi
if [[ -z "$BUCKET" ]]; then
  ui::err make_tfvars "バケット名が未指定です。setup で決定した値を --bucket に渡してください。"
  exit 1
fi

TFVARS_PATH="infra/terraform/dev.auto.tfvars"
mkdir -p "$(dirname "$TFVARS_PATH")"

if [[ -f "$TFVARS_PATH" && "$YES" != "true" ]]; then
  ui::info make_tfvars "上書きする前に確認します（既定: N）"
  ui::ask_yesno OVERWRITE make_tfvars "${TFVARS_PATH} を上書きしますか？" N
  if [[ "$OVERWRITE" != "true" ]]; then ui::info make_tfvars "中止しました"; exit 1; fi
fi

cat > "$TFVARS_PATH" <<EOF
aws_region                  = "${REGION}"
architecture                = "${ARCH}"
function_name               = "${FUNC}"
alias_name                  = "${ALIAS}"
output_bucket               = "${BUCKET}"
output_prefix               = "${PREFIX}"
result_format               = "png"
presign_ttl_default_seconds = 3600
presign_ttl_max_seconds     = 86400
ttl_safety_margin_seconds   = 300
image_url_allow_regex       = ""
max_image_bytes             = 10485760
cors_allow_origins          = ["*"]
existing_layer_arn          = ""
pillow_layer_zip_path       = "./build/pillow-layer.zip"
internal_cors_enabled       = false
EOF

ui::ok make_tfvars "生成しました: ${TFVARS_PATH}"
