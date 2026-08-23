#!/usr/bin/env bash
# PreToolUse (Bash) — a deterministic gate on high-confidence destructive shell
# commands. Ported from amaze-omp's destructive-guard, same contract, same safe
# exceptions, expressed in bash so it runs in Claude Code and Codex alike.
#
# Why bash regex and not a JSON parser: the payload is the hook's stdin and the
# only field that matters is the command. Patterns are matched against the raw
# payload, which cannot be truncated by an escaped quote; the command is
# extracted only for the safe-exception checks, where a failed extraction falls
# through to "not safe" and blocks. Wrong in the direction that keeps data.
set -uo pipefail

SAFE_DIRS="node_modules dist .next __pycache__ .cache build .turbo coverage"
WB='(^|[^a-zA-Z0-9_])'   # portable word boundary: POSIX classes, no \b

payload=$(cat 2>/dev/null) || exit 0
[ -n "$payload" ] || exit 0

# **위험 패턴은 payload 전체에 걸고, 꺼낸 명령은 안전 예외 판정에만 쓴다.**
#
# 이 파일은 처음부터 그렇게 적혀 있었지만 코드는 그러지 않았다(실측 2026-08-23):
# `subject=${command_field:-$payload}` 가 패턴 검사까지 **꺼낸 명령**으로 돌렸고,
# 꺼내는 정규식이 `[^"]*` 라 인용부호에서 잘렸다. 그래서 이것이 통과했다:
#
#   git commit -m "x" && rm -rf /
#   echo "hi" ; rm -rf /var/data
#
# 잘린 앞토막(`git commit -m `)에는 위험 패턴이 없다. JSON 은 그 인용부호를 `\"` 로
# 싣기 때문에 진짜 훅 payload 에서도 같은 자리에서 잘린다.
#
# 꺼내기도 탈출 인용부호를 살려 고친다. 실패하면 빈 값이고, 그때 안전 예외 판정은
# "안전하지 않다"로 떨어져 막는다 - 데이터를 지키는 방향의 실패다.
command_field=$(printf '%s' "$payload" \
  | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\]|\\.)*)".*/\1/p' | head -n 1)
command_field=${command_field//\\\"/\"}
command_field=${command_field//\\\\/\\}
subject=$payload

# Every rm segment must target only safe build-output directories. A safe
# segment followed by a dangerous one ("rm -rf node_modules && rm -rf /") is not
# safe, so this checks each segment and requires all of them to pass.
is_safe_rm() {
  local cmd=$1 seg rest token norm safe found=0
  while IFS= read -r seg; do
    [[ $seg =~ (^|[^a-zA-Z0-9_])rm[[:space:]]+- ]] || continue
    found=1
    [[ $seg =~ ^[[:space:]]*rm[[:space:]]+((-{1,2}[a-zA-Z][a-zA-Z-]*[[:space:]]+)+)(.+)$ ]] || return 1
    rest=${BASH_REMATCH[3]}
    for token in $rest; do
      # 인용부호를 벗긴다. `bash -c "rm -rf node_modules"` 처럼 감싸인 정당한 청소가
      # 따옴표 하나 때문에 낯선 경로로 읽히지 않게 한다.
      norm=${token//\"/}; norm=${norm//\'/}
      norm=${norm%/\*}; norm=${norm%/}
      safe=1
      for d in $SAFE_DIRS; do
        [ "$norm" = "$d" ] && { safe=0; break; }
        case $norm in */$d) safe=0; break ;; esac
      done
      [ $safe -eq 0 ] || return 1
    done
  done <<EOF
$(printf '%s' "$cmd" | tr ';|&' '\n\n\n')
EOF
  [ $found -eq 1 ]
}

# Token-level check so "git push origin main --force" is caught while
# "--force-with-lease" is not. One regex cannot do both.
has_force_push() {
  local cmd=$1 rest seg token
  [[ $cmd =~ (^|[^a-zA-Z0-9_])git[[:space:]]+push($|[^a-zA-Z0-9_]) ]] || return 1
  rest=${cmd#*git}
  seg=$(printf '%s' "$rest" | tr ';|&' '\n\n\n' | head -n 1)
  for token in $seg; do
    # payload 를 그대로 보므로 토큰 끝에 JSON 문장부호가 붙는다(`--force"}}`). 벗기지
    # 않으면 문자열 동일성 비교가 빗나가 `git push origin main --force` 를 놓친다.
    token=${token//[\"\{\},]/}
    [ "$token" = "-f" ] && return 0
    [ "$token" = "--force" ] && return 0
  done
  return 1
}

hits=""
add() { hits="${hits:+$hits, }$1"; }

if [[ $subject =~ ${WB}rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive[[:space:]].*--force|--force[[:space:]].*--recursive) ]]; then
  # 안전 예외는 **명령 문자열**에만 물어본다. payload 를 그대로 주면 JSON 의 중괄호와
  # 인용부호가 토큰이 되어 언제나 "안전하지 않다"가 되고, `rm -rf node_modules` 같은
  # 정당한 청소가 막힌다. 꺼내지 못했으면 안전 판정 자체를 포기한다(= 막는다).
  is_safe_rm "${command_field:-$payload}" || add "rm -rf (recursive delete)"
fi
[[ $subject =~ ${WB}git[[:space:]]+reset[[:space:]]+--hard($|[^a-zA-Z0-9_]) ]] \
  && add "git reset --hard (loses uncommitted work)"
[[ $subject =~ ${WB}git[[:space:]]+(checkout|restore)[[:space:]]+\. ]] \
  && add "git checkout/restore . (loses uncommitted work)"
shopt -s nocasematch
[[ $subject =~ ${WB}DROP[[:space:]]+(TABLE|DATABASE)($|[^a-zA-Z0-9_]) ]] \
  && add "DROP TABLE/DATABASE (data loss)"
[[ $subject =~ ${WB}TRUNCATE[[:space:]]+(TABLE[[:space:]]+)?[^[:space:]] ]] \
  && add "TRUNCATE (data loss)"
shopt -u nocasematch
[[ $subject =~ ${WB}kubectl[[:space:]]+delete($|[^a-zA-Z0-9_]) ]] \
  && add "kubectl delete (production impact)"
[[ $subject =~ ${WB}docker[[:space:]]+(rm[[:space:]]+-f|system[[:space:]]+prune)($|[^a-zA-Z0-9_]) ]] \
  && add "docker rm -f / system prune (removes containers and images)"
has_force_push "$subject" && add "git push --force (rewrites history)"

[ -n "$hits" ] || exit 0

reason="Destructive command detected: ${hits}. Confirm this is intended; run a narrower command, or ask the user to run it themselves."
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
  "\"$reason\""
printf '%s\n' "$reason" >&2
exit 2
