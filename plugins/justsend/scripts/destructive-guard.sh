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

command_field=$(printf '%s' "$payload" \
  | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
subject=${command_field:-$payload}

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
      norm=${token%/\*}; norm=${norm%/}
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
    [ "$token" = "-f" ] && return 0
    [ "$token" = "--force" ] && return 0
  done
  return 1
}

hits=""
add() { hits="${hits:+$hits, }$1"; }

if [[ $subject =~ ${WB}rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive[[:space:]].*--force|--force[[:space:]].*--recursive) ]]; then
  is_safe_rm "$subject" || add "rm -rf (recursive delete)"
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
