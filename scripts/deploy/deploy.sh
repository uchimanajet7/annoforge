#!/usr/bin/env bash
# 用途別スクリプトを順に呼び出すエントリーポイント
# - 設定入力→レイヤー作成→tfvars→init→plan→apply→スモーク
# - 認証は with_aws.sh に一元化（このスクリプトは認証を行いません）
# - 失敗時は直前フェーズ名を表示し、個別スクリプトの再実行を促す
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp deploy "$0"
if [[ "${DEPLOY_DEBUG:-}" == "1" ]]; then
  set -x
fi

# 既定値（詳細は各スクリプト側で対話補完）
REGION=""
BUCKET=""
PREFIX=""
ARCH=""
PILLOW_VERSION=""
YES="false"
IMAGE_URL=""

usage() {
  cat <<USAGE
使い方: bash scripts/deploy/deploy.sh [オプション]
オプション:
  --region <REGION>
  --bucket <S3_BUCKET_NAME>
  --prefix <S3_PREFIX>
  --arch <arm64|x86_64>
  --pillow-version <ver|latest>
  --image-url <URL>           # スモーク用画像URL（任意）
  --yes                       # 途中確認を自動承諾
  -h, --help                  # ヘルプ
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2;;
    --bucket) BUCKET="$2"; shift 2;;
    --prefix) PREFIX="$2"; shift 2;;
    --arch) ARCH="$2"; shift 2;;
    --pillow-version) PILLOW_VERSION="$2"; shift 2;;
    --image-url) IMAGE_URL="$2"; shift 2;;
    --yes) YES="true"; shift;;
    -h|--help) usage; exit 0;;
    *) ui::err deploy "不明な引数: $1"; usage; exit 1;;
  esac
done

info() { ui::info deploy "$*"; }
hdr() { ui::hdr deploy "$*"; }
run() { ui::run deploy "$*"; }
fail() { ui::err deploy "$*"; exit 1; }

# 開始タイムスタンプ（ミリ秒）
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
info "----- start: ${START_TS} -----"

# 前提チェック（認証は with_aws.sh 経由が前提）
if [[ -z "${AWS_PROFILE-}" && ( -z "${AWS_ACCESS_KEY_ID-}" || -z "${AWS_SESSION_TOKEN-}" ) ]]; then
  hdr "前提エラー: 認証が未注入（with_aws.sh 経由で実行してください）"
  ui::err deploy "このエントリーポイントは認証を行いません。プロセス環境に一時クレデンシャルを注入した上で実行してください。"
  ui::info deploy "実行例（既存プロファイル）:"
  ui::run  deploy "with_aws.sh:"
  printf "  %s\n" "bash scripts/deploy/with_aws.sh --mode profile --profile <WORK_PROFILE> -- bash scripts/deploy/deploy.sh" >&2
  ui::info deploy "実行例（AssumeRole+MFA）:"
  ui::run  deploy "with_aws.sh:"
  printf "  %s\n" "bash scripts/deploy/with_aws.sh --mode auth --base-profile default --role-arn arn:aws:iam::<ACCOUNT_ID>:role/OrganizationAccountDeveloperRole --mfa-arn arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE> --duration 3600 -- bash scripts/deploy/deploy.sh" >&2
  exit 1
fi

# 1) 設定入力 (setup)
hdr "設定入力(setup)"
ui::run deploy "setup.sh:"
printf "  %s\n" "bash ${SCRIPT_DIR}/setup.sh" >&2
TMP_SETUP=$(mktemp)
bash "${SCRIPT_DIR}/setup.sh" | tee "$TMP_SETUP"
REGION=$(grep -E '^__OUT_REGION=' "$TMP_SETUP" | tail -n1 | cut -d= -f2- || true)
BUCKET=$(grep -E '^__OUT_BUCKET=' "$TMP_SETUP" | tail -n1 | cut -d= -f2- || true)
PREFIX=$(grep -E '^__OUT_PREFIX=' "$TMP_SETUP" | tail -n1 | cut -d= -f2- || true)
ARCH=$(grep -E '^__OUT_ARCH=' "$TMP_SETUP" | tail -n1 | cut -d= -f2- || true)
PILLOW_VERSION=$(grep -E '^__OUT_PILLOW_VERSION=' "$TMP_SETUP" | tail -n1 | cut -d= -f2- || true)
APPLY_YES=$(grep -E '^__OUT_APPLY_YES=' "$TMP_SETUP" | tail -n1 | cut -d= -f2- || echo "false")
IMAGE_URL=$(grep -E '^__OUT_IMAGE_URL=' "$TMP_SETUP" | tail -n1 | cut -d= -f2- || true)
rm -f "$TMP_SETUP"

# 2) レイヤー作成
hdr "Pillowレイヤー作成(build_layer)"
BL_ARGS=()
[[ -n "$ARCH" ]] && BL_ARGS+=(--arch "$ARCH")
[[ -n "$PILLOW_VERSION" ]] && BL_ARGS+=(--version "$PILLOW_VERSION")
RUN_BL_ARGS="${BL_ARGS[*]-}"
ui::run deploy "build_layer.sh:"
if (( ${#BL_ARGS[@]} )); then
  printf "  %s\n" "bash ${SCRIPT_DIR}/build_layer.sh ${RUN_BL_ARGS}" >&2
else
  printf "  %s\n" "bash ${SCRIPT_DIR}/build_layer.sh" >&2
fi
if (( ${#BL_ARGS[@]} )); then
  bash "${SCRIPT_DIR}/build_layer.sh" "${BL_ARGS[@]}"
else
  bash "${SCRIPT_DIR}/build_layer.sh"
fi

# 3) tfvars生成
hdr "tfvars生成(make_tfvars)"
MT_ARGS=(--region "$REGION" --bucket "$BUCKET" --prefix "$PREFIX")
[[ -n "$ARCH" ]] && MT_ARGS+=(--arch "$ARCH")
[[ "${YES}" == "true" ]] && MT_ARGS+=(--yes)
[[ "${APPLY_YES:-false}" == "true" ]] && MT_ARGS+=(--yes)
RUN_MT_ARGS="${MT_ARGS[*]-}"
ui::run deploy "make_tfvars.sh:"
if (( ${#MT_ARGS[@]} )); then
  printf "  %s\n" "bash ${SCRIPT_DIR}/make_tfvars.sh ${RUN_MT_ARGS}" >&2
else
  printf "  %s\n" "bash ${SCRIPT_DIR}/make_tfvars.sh" >&2
fi
if (( ${#MT_ARGS[@]} )); then
  bash "${SCRIPT_DIR}/make_tfvars.sh" "${MT_ARGS[@]}"
else
  bash "${SCRIPT_DIR}/make_tfvars.sh"
fi

# 4) terraform init
hdr "Terraform init"
ui::run deploy "tf_init.sh:"
printf "  %s\n" "bash ${SCRIPT_DIR}/tf_init.sh" >&2
bash "${SCRIPT_DIR}/tf_init.sh"

# 5) terraform plan
hdr "Terraform plan"
ui::run deploy "tf_plan.sh:"
printf "  %s\n" "bash ${SCRIPT_DIR}/tf_plan.sh" >&2
bash "${SCRIPT_DIR}/tf_plan.sh"
STATUS=$?
ui::debug deploy "after tf_plan.sh status=${STATUS}"
ui::debug deploy "enter apply section"

# 6) terraform apply（TTY安全・既定Nで確認。YES/自動承認のみ無人化）
hdr "Terraform apply"
TA_ARGS=()
AUTO_APPLY="false"
if [[ "${YES}" == "true" || "${APPLY_YES:-false}" == "true" ]]; then
  AUTO_APPLY="true"
fi

if [[ "${AUTO_APPLY}" != "true" ]]; then
  ui::info deploy "plan の内容を apply する前に確認します（既定: N）"
  ui::ask_yesno __GO deploy "plan の内容を apply しますか？" N
  if [[ "${__GO}" != "true" ]]; then
    ui::info deploy "apply をスキップしました（正常終了）。再適用は以下を参照してください。"
    ui::run  deploy "tf_apply.sh:"
    printf "  %s\n" "bash ${SCRIPT_DIR}/tf_apply.sh --yes" >&2
    exit 0
  fi
  TA_ARGS+=(--yes)
else
  TA_ARGS+=(--yes)
fi

RUN_TA_ARGS="${TA_ARGS[*]-}"
ui::debug deploy "apply flags(final): ${RUN_TA_ARGS}"
ui::run deploy "tf_apply.sh:"
if (( ${#TA_ARGS[@]} )); then
  printf "  %s\n" "bash ${SCRIPT_DIR}/tf_apply.sh ${RUN_TA_ARGS}" >&2
else
  printf "  %s\n" "bash ${SCRIPT_DIR}/tf_apply.sh" >&2
fi
bash "${SCRIPT_DIR}/tf_apply.sh" "${TA_ARGS[@]}"

# 7) スモークテスト
hdr "スモークテスト(smoke)"
SM_ARGS=()
[[ -n "$IMAGE_URL" ]] && SM_ARGS+=(--image-url "$IMAGE_URL")
RUN_SM_ARGS="${SM_ARGS[*]-}"
ui::run deploy "smoke.sh:"
if (( ${#SM_ARGS[@]} )); then
  printf "  %s\n" "bash ${SCRIPT_DIR}/smoke.sh ${RUN_SM_ARGS}" >&2
else
  printf "  %s\n" "bash ${SCRIPT_DIR}/smoke.sh" >&2
fi
if (( ${#SM_ARGS[@]} )); then
  bash "${SCRIPT_DIR}/smoke.sh" "${SM_ARGS[@]}"
else
  bash "${SCRIPT_DIR}/smoke.sh"
fi

# 終了タイムスタンプ（ミリ秒）
END_TS=$(ui::ts)
END_MS=$(ui::epoch_ms)
DIFF_MS=$((END_MS-START_MS))
info "----- end: ${END_TS} (elapsed=$(ui::fmt_elapsed_ms "${DIFF_MS}")) -----"
