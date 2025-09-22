#!/usr/bin/env bash
# エンドツーエンドのスモークテスト: /annotate → presignedUrl → HEAD 200
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp smoke "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info smoke "----- start: ${START_TS} -----"
__af_end() { local __end_ms=$(ui::epoch_ms); local __diff=$((__end_ms-START_MS)); ui::info smoke "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"; }
trap __af_end EXIT

# 既定は小さめで安定したCDNを使用（外部取得遅延での誤検知を避ける）
IMAGE_URL="https://placehold.co/256x256.png"
SMOKE_TIMEOUT_FUNC="${SMOKE_TIMEOUT_FUNC:-25}"  # POSTの全体最大秒
SMOKE_TIMEOUT_HEAD="${SMOKE_TIMEOUT_HEAD:-10}"  # HEAD確認の最大秒
# readiness待ち（Function URLの伝播/コールドを吸収）。0で無効。
SMOKE_READY_WAIT_SECONDS="${SMOKE_READY_WAIT_SECONDS:-90}"
ALL_SHAPES="false"

usage() {
  cat <<USAGE
使い方: bash scripts/deploy/smoke.sh [--image-url URL] [--all-shapes]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-url) IMAGE_URL="$2"; shift 2;;
    --all-shapes) ALL_SHAPES="true"; shift ;;
    -h|--help) usage; exit 0;;
    *) ui::err smoke "不明な引数: $1"; usage; exit 1;;
  esac
done

cd "$(dirname "$0")/../../infra/terraform"
set +e
URL=$(terraform output -raw function_url 2>/dev/null)
RC=$?
set -e
if [[ $RC -ne 0 || -z "${URL:-}" || ! "$URL" =~ ^https?:// ]]; then
  ui::err smoke "Function URL を取得できません（terraform outputs 未定義/空）。"
  ui::info smoke "取得手順: cd infra/terraform && terraform init && terraform plan -out=tfplan && terraform apply tfplan"
  exit 2
fi
ui::info smoke "Function URL: ${URL}"
BASE_URL="${URL%/}"

# Readiness プローブ: GET /annotate でHTTP応答が得られるまで待機
if [[ ${SMOKE_READY_WAIT_SECONDS} -gt 0 ]]; then
  ui::info smoke "0) readiness: GET /annotate の到達性を確認（最長 ${SMOKE_READY_WAIT_SECONDS}s）"
  ui::run smoke "GET:"
  printf "  %s\n" "curl -sS -o /dev/null -w \"%{http_code}\" --connect-timeout 3 --max-time 4 \"${BASE_URL}/annotate\"" >&2
  printf "  %s\n" "${BASE_URL}/annotate" >&2
  READY_OK=0
  for ((i=1; i<=SMOKE_READY_WAIT_SECONDS; i++)); do
    set +e
    RC_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 4 "${BASE_URL}/annotate")
    set -e
    case "$RC_CODE" in
      200|400|404|415|422)
        ui::ok smoke "ready (status=${RC_CODE}, ${i}s)"
        READY_OK=1
        break
        ;;
    esac
    # 15秒ごとに進捗表示（人向けに現在の経過/残り/最後の応答コードを通知）
    if (( i % 15 == 0 )); then
      REM=$(( SMOKE_READY_WAIT_SECONDS - i ))
      ui::info smoke "readiness待機中: 経過 ${i}s / ${SMOKE_READY_WAIT_SECONDS}s (残り ${REM}s, 最後の応答: ${RC_CODE:--})"
    fi
    sleep 1
  done
  if [[ $READY_OK -eq 0 ]]; then
    ui::warn smoke "readiness確認がタイムアウトしました（続行します）"
  fi
fi

:

# リクエスト本文（最小 or 全図形）
BODY_MIN="{\"imageUrl\":\"${IMAGE_URL}\",\"draw\":[{\"shape\":\"line\",\"x1\":10,\"y1\":10,\"x2\":200,\"y2\":120,\"color\":\"FF0000\",\"thickness\":5},{\"shape\":\"rectangle\",\"x\":50,\"y\":50,\"width\":150,\"height\":90,\"color\":\"0000FF\",\"thickness\":3}],\"ttlSeconds\":3600,\"resultFormat\":\"png\"}"
BODY_ALL="{\"imageUrl\":\"${IMAGE_URL}\",\"draw\":[{\"shape\":\"line\",\"x1\":10,\"y1\":10,\"x2\":200,\"y2\":120,\"color\":\"FF0000\",\"thickness\":5},{\"shape\":\"rectangle\",\"x\":50,\"y\":50,\"width\":120,\"height\":80,\"color\":\"0000FF\",\"thickness\":3},{\"shape\":\"circle\",\"x\":160,\"y\":160,\"radius\":40,\"color\":\"00AA00\",\"thickness\":4},{\"shape\":\"polygon\",\"points\":[30,200,60,160,100,150,120,190,80,220],\"color\":\"FFA500\",\"thickness\":3},{\"shape\":\"parallelogram\",\"points\":[180,40,220,60,200,100],\"color\":\"800080\",\"thickness\":3}],\"ttlSeconds\":3600,\"resultFormat\":\"png\"}"
BODY_PAYLOAD="$BODY_MIN"
if [[ "$ALL_SHAPES" == "true" ]]; then
  BODY_PAYLOAD="$BODY_ALL"
fi

# 実行コマンド（POST）: run行ではURLのみを表示。次行にコピー用の1行コマンド（jq付き）。
POST_CMD="curl -sS --connect-timeout 5 --max-time \"${SMOKE_TIMEOUT_FUNC}\" -X POST -H 'Content-Type: application/json' -d '${BODY_PAYLOAD}' \"${BASE_URL}/annotate\" | jq ."
ui::info smoke "1) POST /annotate で画像を処理し presignedUrl を取得"
ui::run smoke "POST:"
printf "  %s\n" "${POST_CMD}" >&2
printf "  %s\n" "${BASE_URL}/annotate" >&2
RESP=$(eval "${POST_CMD}") || true

ui::ok smoke "response:"
echo "${RESP}" | jq . >&2

PURL=$(echo "${RESP}" | jq -r .presignedUrl 2>/dev/null || true)
if [[ -z "$PURL" || "$PURL" == "null" ]]; then
  ui::err smoke "presignedUrl を取得できませんでした"
  ui::info smoke "外部画像の応答遅延やネットワーク要因の可能性があります。--image-url で小さな画像を指定するか、SMOKE_TIMEOUT_FUNC を延長してください。"
  exit 1
fi

# HEAD検証（最終応答コードで判定するためリダイレクト追従）
ui::info smoke "2) presignedUrl の到達性を確認（HEAD, リダイレクト追従, 期待=200）"
ui::run smoke "HEAD:"
printf "  %s\n" "curl -sS -L -o /dev/null -w \"%{http_code}\" --connect-timeout 5 --max-time \"${SMOKE_TIMEOUT_HEAD}\" \"${PURL}\"" >&2
printf "  %s\n" "${PURL}" >&2
set +e
CODE=$(curl -sS -L -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time "${SMOKE_TIMEOUT_HEAD}" "$PURL")
set -e
if [[ "$CODE" != "200" ]]; then
  ui::err smoke "presignedUrl の到達性検証に失敗 (status=${CODE})"
  exit 1
fi
ui::debug smoke "presignedUrl HEAD status: ${CODE}"

CT=$(echo "${RESP}" | jq -r .metadata.contentType 2>/dev/null || echo "")
SZ=$(echo "${RESP}" | jq -r .metadata.fileSize 2>/dev/null || echo "")
EXP=$(echo "${RESP}" | jq -r .metadata.expiresAt 2>/dev/null || echo "")
ui::ok smoke "contentType=${CT} size=${SZ} expiresAt=${EXP}"
