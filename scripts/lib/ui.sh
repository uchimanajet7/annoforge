#!/usr/bin/env bash
# 共通UIライブラリ（色/装飾/入出力の一貫化）
set -euo pipefail

# 検出: 色の有効/無効（stderrがTTYでNO_COLORなし、かつCLICOLOR!=0 なら有効。CLICOLOR_FORCE/DEPLOY_COLOR=1で強制有効）
ui::init() {
  UI_COLOR=0
  if [[ "${DEPLOY_COLOR:-}" == "1" || "${CLICOLOR_FORCE:-}" == "1" ]]; then
    UI_COLOR=1
  elif [[ -t 2 && -z "${NO_COLOR:-}" && "${CLICOLOR:-1}" != "0" ]]; then
    # tputが使えれば色を有効化
    if command -v tput >/dev/null 2>&1 && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
      UI_COLOR=1
    else
      UI_COLOR=1
    fi
  fi

  if [[ $UI_COLOR -eq 1 ]]; then
    UI_RESET="\033[0m"; UI_BOLD="\033[1m"
    UI_FG_RED="\033[31m"; UI_FG_GREEN="\033[32m"; UI_FG_YELLOW="\033[33m"; UI_FG_BLUE="\033[34m"; UI_FG_CYAN="\033[36m"; UI_DIM="\033[2m"
  else
    UI_RESET=""; UI_BOLD=""; UI_FG_RED=""; UI_FG_GREEN=""; UI_FG_YELLOW=""; UI_FG_BLUE=""; UI_FG_CYAN=""; UI_DIM=""
  fi
}

ui::_tag() {
  local tag="$1"; local color="$2"; local bold="$3"
  local open=""; local close="${UI_RESET}"
  case "$color" in
    red)   open="${UI_FG_RED}";;
    green) open="${UI_FG_GREEN}";;
    yellow)open="${UI_FG_YELLOW}";;
    blue)  open="${UI_FG_BLUE}";;
    cyan)  open="${UI_FG_CYAN}";;
    dim)   open="${UI_DIM}"; close="${UI_RESET}";;
    *)     open=""; close="";;
  esac
  [[ "$bold" == "1" ]] && open="${UI_BOLD}${open}"
  printf "%b[%s]%b" "$open" "$tag" "$close"
}

ui::_out() {
  # /dev/tty を使うのは「制御端末がある（-t 0/1/2 のいずれか真）」場合に限定する
  if [[ -t 2 || -t 1 || -t 0 ]]; then
    if [[ -r /dev/tty ]]; then printf '%s' "/dev/tty"; return; fi
  fi
  if [[ -t 2 ]]; then printf '%s' "/dev/stderr"; return; fi
  if [[ -t 1 ]]; then printf '%s' "/dev/stdout"; return; fi
  printf '%s' "/dev/stderr"
}

ui::hdr()   { # $1=tag $2=msg
  local out; out="$(ui::_out)"
  ui::_tag "$1" blue 1 >"$out"; printf " %s\n" "$2" >"$out";
}
ui::info()  { local out; out="$(ui::_out)"; ui::_tag "$1" dim 0 >"$out"; printf " %s\n" "$2" >"$out"; }
ui::ok()    { local out; out="$(ui::_out)"; ui::_tag "$1" green 0 >"$out"; printf " %s\n" "$2" >"$out"; }
ui::warn()  { local out; out="$(ui::_out)"; ui::_tag "$1" yellow 0 >"$out"; printf " %s\n" "$2" >"$out"; }
ui::err()   { local out; out="$(ui::_out)"; ui::_tag "$1" red 1 >"$out"; printf " %s\n" "$2" >"$out"; }
ui::run()   { # $1=tag $2=command shown
  local out; out="$(ui::_out)"; ui::_tag "$1" dim 0 >"$out"; printf " run: %s\n" "$2" >"$out"; }

# デバッグ出力（DEPLOY_DEBUG=1 のときのみ表示）
ui::debug() { # $1=tag $2=message
  if [[ "${DEPLOY_DEBUG:-}" == "1" ]]; then
    ui::_tag "$1" dim 0 >&2; printf " [debug] %s\n" "$2" >&2;
  fi
}

# 時刻スタンプ（ミリ秒）: gdate/GNU date があればミリ秒、なければ ns サポート判定、最後に秒精度へフォールバック
ui::ts() {
  if command -v gdate >/dev/null 2>&1; then
    gdate '+%Y/%m/%d %H:%M:%S.%3N (%Z)'
    return
  fi
  if date --version >/dev/null 2>&1; then
    date '+%Y/%m/%d %H:%M:%S.%3N (%Z)'
    return
  fi
  local ns
  ns=$(date '+%N' 2>/dev/null || true)
  if [[ "$ns" =~ ^[0-9]+$ && ${#ns} -ge 3 ]]; then
    local ms=${ns:0:3}
    printf '%s.%03d (%s)\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$ms" "$(date '+%Z')"
    return
  fi
  date '+%Y/%m/%d %H:%M:%S (%Z)'
}

# エポック（ミリ秒）を取得
ui::epoch_ms() {
  if command -v gdate >/dev/null 2>&1; then
    gdate +%s%3N 2>/dev/null && return
  fi
  if date --version >/dev/null 2>&1; then
    date +%s%3N 2>/dev/null && return
  fi
  local ns
  ns=$(date '+%N' 2>/dev/null || true)
  if [[ "$ns" =~ ^[0-9]+$ && ${#ns} -ge 3 ]]; then
    local sec
    sec=$(date '+%s' 2>/dev/null)
    printf '%s' $(( sec*1000 + 10#${ns:0:3} ))
    return
  fi
  printf '%s' $(( $(date +%s 2>/dev/null) * 1000 ))
}

# ミリ秒を可読フォーマットへ変換
# <60s:  S.MMMs / <1h: M:SS.MMM / >=1h: H:MM:SS.MMM
ui::fmt_elapsed_ms() { # $1=millis
  local ms=${1:-0}
  if [[ $ms -lt 0 ]]; then ms=0; fi
  local total_s=$(( ms / 1000 ))
  local rem_ms=$(( ms % 1000 ))
  local s=$(( total_s % 60 ))
  local m=$(( (total_s / 60) % 60 ))
  local h=$(( total_s / 3600 ))
  if (( h == 0 && m == 0 )); then
    printf '%d.%03ds' "$s" "$rem_ms"
  elif (( h == 0 )); then
    printf '%d:%02d.%03d' "$m" "$s" "$rem_ms"
  else
    printf '%d:%02d:%02d.%03d' "$h" "$m" "$s" "$rem_ms"
  fi
}

# デバッグ: 指定ファイルのフィンガープリント（ハッシュ先頭12桁と更新時刻）を表示
# 使い方: ui::debug_fp <tag> <file>
ui::debug_fp() {
  if [[ "${DEPLOY_DEBUG:-}" != "1" ]]; then return; fi
  local tag="$1"; local file="$2"
  local hash="" short="" mt="" mth=""
  if [[ -r "$file" ]]; then
    if command -v shasum >/dev/null 2>&1; then
      hash=$(shasum -a 256 "$file" 2>/dev/null | awk '{print $1}')
    elif command -v sha256sum >/dev/null 2>&1; then
      hash=$(sha256sum "$file" 2>/dev/null | awk '{print $1}')
    elif command -v cksum >/dev/null 2>&1; then
      hash=$(cksum "$file" 2>/dev/null | awk '{print $1}')
    else
      hash="unknown"
    fi
    short="${hash:0:12}"
    set +e
    if stat -f %m "$file" >/dev/null 2>&1; then
      mt=$(stat -f %m "$file")
    elif stat -c %Y "$file" >/dev/null 2>&1; then
      mt=$(stat -c %Y "$file")
    fi
    if [[ -n "$mt" ]]; then
      if date -r "$mt" '+%Y-%m-%d %H:%M:%S %Z' >/dev/null 2>&1; then
        mth=$(date -r "$mt" '+%Y-%m-%d %H:%M:%S %Z')
      elif date -d "@$mt" '+%Y-%m-%d %H:%M:%S %Z' >/dev/null 2>&1; then
        mth=$(date -d "@$mt" '+%Y-%m-%d %H:%M:%S %Z')
      else
        mth="$mt"
      fi
    fi
    set -e
    ui::debug "$tag" "fp=${short:-unknown} mtime=${mth:-unknown} file=${file}"
  else
    ui::debug "$tag" "fp=unreadable file=${file}"
  fi
}

# プロンプト（stderrに表示してstdinから読み取り）。$4が既定値なら空入力時にセット。
ui::ask() { # $1=__varname $2=tag $3=prompt $4=default
  local __var="$1"; shift; local tag="$1"; shift; local prompt="$1"; shift; local def="${1:-}"
  local suffix=""; [[ -n "$def" ]] && suffix=" [${def}]"
  local out; out="$(ui::_out)"
  ui::_tag "$tag" cyan 1 >"$out"; printf " %s%s: " "$prompt" "$suffix" >"$out"
  local ans
  if [[ -t 2 || -t 1 || -t 0 ]] && [[ -r /dev/tty ]]; then IFS= read -r ans < /dev/tty; else IFS= read -r ans; fi
  if [[ -z "$ans" && -n "$def" ]]; then ans="$def"; fi
  printf -v "$__var" '%s' "$ans"
}

# 既定値を画面に表示しない版のプロンプト関数
# - 表示は常に「<prompt>: 」のみ
# - 入力が空の場合でも、第4引数の既定値があれば適用する
# - 使い所: 既定値を匂わせたくないが、Enterで既定を採用させたいケース
ui::ask_silent() { # $1=__varname $2=tag $3=prompt $4=default
  local __var="$1"; shift; local tag="$1"; shift; local prompt="$1"; shift; local def="${1:-}"
  local out; out="$(ui::_out)"
  ui::_tag "$tag" cyan 1 >"$out"; printf " %s: " "$prompt" >"$out"
  local ans
  if [[ -t 2 || -t 1 || -t 0 ]] && [[ -r /dev/tty ]]; then IFS= read -r ans < /dev/tty; else IFS= read -r ans; fi
  if [[ -z "$ans" && -n "$def" ]]; then ans="$def"; fi
  printf -v "$__var" '%s' "$ans"
}

ui::ask_yesno() { # $1=__varname(bool) $2=tag $3=prompt $4=default(Y/N)
  local __var="$1"; shift; local tag="$1"; shift; local prompt="$1"; shift; local defYN="${1:-N}"
  local hint="[y/N]"; [[ "$defYN" =~ ^[Yy]$ ]] && hint="[Y/n]"
  local out; out="$(ui::_out)"
  ui::_tag "$tag" cyan 1 >"$out"; printf " %s %s: " "$prompt" "$hint" >"$out"
  local ans; if [[ -t 2 || -t 1 || -t 0 ]] && [[ -r /dev/tty ]]; then IFS= read -r ans < /dev/tty; else IFS= read -r ans; fi; ans="${ans:-$defYN}"
  case "$ans" in Y|y|Yes|yes) printf -v "$__var" 'true';; *) printf -v "$__var" 'false';; esac
}

# 既定ヒントを表示しないYes/Noプロンプト
# - 表示は常に「<prompt>: 」のみ
# - 入力が空なら第4引数(Y/N)の既定を採用
# - 返値は 'true' または 'false'
# （削除）ui::ask_yesno_silent は方針により廃止（確認用途は ui::ask_yesno を使用）
