#!/usr/bin/env bash
# 認証ラッパー: 一時クレデンシャルをプロセス内に注入し、そのまま後続コマンドを実行する
# - eval不要・ディスク非保存・秘匿値を標準出力に出さない
# - mode=auth: AssumeRole + MFA を内蔵ロジックで実行し、export 行のみを取り込む
# - mode=profile: aws configure export-credentials --format env を内部で実行し、export 行のみを取り込む
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../lib/ui.sh"; ui::init
ui::debug_fp with_aws "$0"

# 開始/終了タイムスタンプ
START_TS=$(ui::ts)
START_MS=$(ui::epoch_ms)
ui::info with_aws "----- start: ${START_TS} -----"
__af_end() { local __end_ms=$(ui::epoch_ms); local __diff=$((__end_ms-START_MS)); ui::info with_aws "----- end: $(ui::ts) (elapsed=$(ui::fmt_elapsed_ms "${__diff}")) -----"; }
trap __af_end EXIT

MODE="profile"       # profile | auth（既定: profile）
PROFILE=""           # mode=profile 用
BASE_PROFILE=""      # mode=auth 用（任意）
ROLE_ARN=""          # mode=auth 用
MFA_ARN=""           # mode=auth 用
DURATION="3600"       # mode=auth 用

  usage() {
    cat <<USAGE
    使い方: scripts/deploy/with_aws.sh [--mode profile|auth] [オプション] -- <command...>

    モード:
      --mode auth        AssumeRole + MFA で一時クレデンシャルを取得（内蔵）
        --base-profile NAME
        --role-arn ARN
        --mfa-arn  ARN
        --duration SECONDS

      --mode profile     AWS CLI v2 の credential source を用いる（既定）
        --profile NAME   export-credentials の対象プロファイル（未指定時は対話選択）

コマンド:
  -- の後に続くコマンドを、そのまま認証済み環境で exec します。
  省略時は bash を起動（セッション型）。
USAGE
}

# 引数解析（-- まで）
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2;;
    --profile) PROFILE="$2"; shift 2;;
    --base-profile) BASE_PROFILE="$2"; shift 2;;
    --role-arn) ROLE_ARN="$2"; shift 2;;
    --mfa-arn) MFA_ARN="$2"; shift 2;;
    --duration) DURATION="$2"; shift 2;;
    --) shift; break;;
    -h|--help) usage; exit 0;;
    *) ARGS+=("$1"); shift;;
  esac
done

# 残りは実行コマンド（未指定なら bash）
if [[ $# -gt 0 ]]; then
  CMD=("$@")
else
  CMD=(bash)
fi

info() { ui::info with_aws "$*"; }
hdr()  { ui::hdr with_aws "$*"; }
err()  { ui::err with_aws "$*"; }

  apply_exports() {
  # 標準入力から export 行だけを抽出して安全に eval
  local line filtered=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # export VAR=... の形式に限定（英数下線のみ許可）
    if [[ "$line" =~ ^export[[:space:]]+[A-Z0-9_]+=.*$ ]]; then
      filtered+=("$line")
    fi
  done
  if (( ${#filtered[@]} )); then
    # shellcheck disable=SC2048,SC2086
    eval "${filtered[*]}"
  fi
  }

  # 現在の環境で AWS アカウント情報を表示（必要に応じてプロファイル名も表示）
  print_identity_current() {
    local __profile_name="${1:-}"
    if [[ -n "$__profile_name" ]]; then
      info "使用プロファイル: $__profile_name"
    fi
    set +e
    local ACCOUNT ARN REGION
    ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
    ARN=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null || echo "unknown")
    set -e
    REGION="${AWS_REGION:-}"
    [[ -z "$REGION" ]] && REGION="${AWS_DEFAULT_REGION:-}"
    if [[ -z "$REGION" ]]; then
      if [[ -n "$__profile_name" ]]; then
        set +e; REGION=$(aws configure get region --profile "$__profile_name" 2>/dev/null); set -e
      else
        set +e; REGION=$(aws configure get region 2>/dev/null); set -e
      fi
    fi
    [[ -z "$REGION" ]] && REGION="unknown"
    info "AWS認証確認"; printf "  Account: %s\n  Arn    : %s\n  Region : %s\n" "$ACCOUNT" "$ARN" "$REGION" >&2
  }

  # AssumeRole + MFA を実行し、標準出力に export 行のみを出力する
  assume_role_and_emit_exports() {
    # 既存認証検知
    set +e
    aws sts get-caller-identity >/dev/null 2>&1
    AUTH_OK=$?
    set -e
    if [[ ${AUTH_OK} -eq 0 ]]; then
      info "既にAWS認証済みのためauthをスキップ"
      ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
      ARN=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null || echo "unknown")
      REGION="${AWS_REGION:-}"
      [[ -z "$REGION" ]] && REGION="${AWS_DEFAULT_REGION:-}"
      if [[ -z "$REGION" ]]; then
        if [[ -n "$BASE_PROFILE" ]]; then
          set +e; REGION=$(aws configure get region --profile "$BASE_PROFILE" 2>/dev/null); set -e
        else
          set +e; REGION=$(aws configure get region 2>/dev/null); set -e
        fi
      fi
      [[ -z "$REGION" ]] && REGION="unknown"
      info "AWS認証確認"; printf "  Account: %s\n  Arn    : %s\n  Region : %s\n" "$ACCOUNT" "$ARN" "$REGION" >&2
      return 0
    fi

    # 入力補完（対話）: 入力は ask_silent で統一
    if [[ -z "$ROLE_ARN" || -z "$MFA_ARN" ]]; then
      ui::ask_silent ROLE_ARN   with_aws "AssumeRoleのロールARN" "${ROLE_ARN:-}"
      ui::ask_silent MFA_ARN    with_aws "MFAデバイスARN" "${MFA_ARN:-}"
    fi
    if [[ -z "$BASE_PROFILE" ]]; then
      ui::ask_silent BASE_PROFILE with_aws "ベースプロファイル名（未入力可）" "${BASE_PROFILE:-}"
    fi
    ui::ask_silent MFA_CODE with_aws "MFAコード(6桁)" "${MFA_CODE:-}"

    ARGS=(
      --role-arn "$ROLE_ARN"
      --role-session-name "annoforge-deploy-$(whoami)-$(date +%Y%m%d%H%M%S)"
      --serial-number "$MFA_ARN"
      --token-code "$MFA_CODE"
      --duration-seconds "$DURATION"
      --output text
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken,Expiration]'
    )
    [[ -n "$BASE_PROFILE" ]] && ARGS+=(--profile "$BASE_PROFILE")

    set +e
    RESP=$(aws sts assume-role "${ARGS[@]}")
    STATUS=$?
    set -e
    if [[ ${STATUS} -ne 0 ]]; then
      err "AssumeRole に失敗しました。引数/コードを再確認してください。"
      return ${STATUS}
    fi

    # 出力は4列（AKID, SK, TOKEN, EXPIRATION）
    AKID=$(echo "$RESP" | awk '{print $1}')
    SK=$(echo   "$RESP" | awk '{print $2}')
    TOKEN=$(echo "$RESP" | awk '{print $3}')
    EXP=$(echo   "$RESP" | awk '{print $4}')

    ACCOUNT=$(AWS_ACCESS_KEY_ID="$AKID" AWS_SECRET_ACCESS_KEY="$SK" AWS_SESSION_TOKEN="$TOKEN" aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
    ARN_I=$(AWS_ACCESS_KEY_ID="$AKID" AWS_SECRET_ACCESS_KEY="$SK" AWS_SESSION_TOKEN="$TOKEN" aws sts get-caller-identity --query Arn --output text 2>/dev/null || echo "unknown")
    REGION="${AWS_REGION:-}"
    [[ -z "$REGION" ]] && REGION="${AWS_DEFAULT_REGION:-}"
    if [[ -z "$REGION" ]]; then
      if [[ -n "$BASE_PROFILE" ]]; then
        set +e; REGION=$(aws configure get region --profile "$BASE_PROFILE" 2>/dev/null); set -e
      else
        set +e; REGION=$(aws configure get region 2>/dev/null); set -e
      fi
    fi
    [[ -z "$REGION" ]] && REGION="unknown"
    info "AWS認証確認"; printf "  Account: %s\n  Arn    : %s\n  Region : %s\n" "$ACCOUNT" "$ARN_I" "$REGION" >&2
    ui::info with_aws "Assumed role until $EXP"

    # 標準出力: export 行のみ
    cat <<EXPORT
export AWS_ACCESS_KEY_ID='$AKID'
export AWS_SECRET_ACCESS_KEY='$SK'
export AWS_SESSION_TOKEN='$TOKEN'
EXPORT
  }

# 前提確認
if ! command -v aws >/dev/null 2>&1; then
  err "AWS CLI が見つかりません。インストール後に再実行してください。"
  exit 127
fi

  case "$MODE" in
    profile)
    # --profile 未指定時は対話選択
    if [[ -z "$PROFILE" ]]; then
      hdr "プロファイル選択(profile)"
      # プロファイル一覧取得
      set +e
      PROFILES=()
      while IFS= read -r __p; do
        [[ -n "$__p" ]] && PROFILES+=("$__p")
      done < <(aws configure list-profiles 2>/dev/null)
      STATUS=$?
      set -e
      if [[ $STATUS -ne 0 || ${#PROFILES[@]} -eq 0 ]]; then
        err "プロファイル一覧の取得に失敗しました。AWS CLI v2 と設定(~/.aws/config)をご確認ください。"
        exit 2
      fi
      # 表示関数
      _print_profiles() {
        ui::info with_aws "利用可能なAWSプロファイル:"
        local i
        for ((i=0; i<${#PROFILES[@]}; i++)); do
          printf "  %d) %s\n" $((i+1)) "${PROFILES[$i]}" >&2
        done
      }
      _print_profiles
      # 入力ループ
      while :; do
        ui::ask_silent ans with_aws "[1-${#PROFILES[@]} または プロファイル名, ?=再表示, q=中止]" ""
        [[ -z "$ans" ]] && continue
        if [[ "$ans" == "q" || "$ans" == "Q" ]]; then
          err "中止しました"
          exit 130
        fi
        if [[ "$ans" == "?" ]]; then
          _print_profiles
          continue
        fi
        picked=""
        if [[ "$ans" =~ ^[0-9]+$ ]]; then
          idx=$ans
          if (( idx>=1 && idx<=${#PROFILES[@]} )); then
            picked="${PROFILES[$((idx-1))]}"
          fi
        else
          # 名前一致検証（完全一致）
          for name in "${PROFILES[@]}"; do
            if [[ "$name" == "$ans" ]]; then picked="$name"; break; fi
          done
        fi
        if [[ -z "$picked" ]]; then
          err "無効な入力です。番号または一覧にあるプロファイル名を指定してください。"
          continue
        fi
        ui::info with_aws "選択の適用前に確認します（既定: N）"
        ui::ask_yesno __CONFIRM with_aws "選択: $picked で実行しますか？" N
        if [[ "$__CONFIRM" == "true" ]]; then PROFILE="$picked"; break; fi
      done
    fi
    hdr "認証(profile)"
    set +e
    CREDS=$(aws configure export-credentials --profile "$PROFILE" --format env 2>/dev/null)
    STATUS=$?
    set -e
    if [[ $STATUS -ne 0 || -z "$CREDS" ]]; then
      err "export-credentials に失敗しました（--profile=$PROFILE）。CLI v2/プロファイル設定をご確認ください。SSOプロファイルの場合は 'aws sso login --profile $PROFILE' を実行してから再試行してください。"
      exit 1
    fi
    # セッショントークンの有無で分岐
    if printf '%s\n' "$CREDS" | grep -q 'AWS_SESSION_TOKEN='; then
      apply_exports <<< "$CREDS"
      # 認証確認（環境変数ベース）
      print_identity_current "$PROFILE"
    else
      info "選択プロファイルはセッション型ではありません。環境変数注入は行わず、AWS_PROFILE='$PROFILE' で実行します。"
      # 既存の環境変数クレデンシャルがあれば解除して、プロファイル解決を優先
      unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN 2>/dev/null || true
      export AWS_PROFILE="$PROFILE"
      # 認証確認（AWS_PROFILE ベース）
      print_identity_current "$PROFILE"
    fi
    ;;
  auth)
    hdr "認証(auth)"
    set +e
    CREDS=$(assume_role_and_emit_exports)
    STATUS=$?
    set -e
    if [[ $STATUS -ne 0 ]]; then
      err "AssumeRole 処理が失敗しました（引数/コードをご確認ください）"
      exit $STATUS
    fi
    # 認証済みの場合、出力が空のことがあります（その場合は現環境を使用）
    if [[ -n "$CREDS" ]]; then
      apply_exports <<< "$CREDS"
      # AWS_PROFILE は明示的に解除（踏襲）
      unset AWS_PROFILE || true
    fi
    ;;
  *)
    err "--mode は auth か profile を指定してください"; exit 2;;
esac

hdr "実行"
# ラベルはコマンド名（bash/sh/zsh 経由なら第2引数のスクリプト名）
__label="$(basename "${CMD[0]}")"
case "${CMD[0]}" in
  bash|sh|zsh)
    if [[ ${#CMD[@]} -ge 2 ]]; then __label="$(basename "${CMD[1]}")"; fi
    ;;
esac
ui::run with_aws "${__label}:"
printf "  %s\n" "${CMD[*]}" >&2
"${CMD[@]}"
RC=$?
exit $RC
