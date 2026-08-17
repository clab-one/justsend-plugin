#!/usr/bin/env bash
# PreToolUse (Task) — a deterministic gate on delegation briefs. Ported from
# amaze-omp's delegation-guard, same contract, expressed in bash so it runs in
# Claude Code and Codex alike.
#
# The rule it enforces here: an executor brief must carry Target / Change /
# Acceptance as headings. A one-line brief with no acceptance criteria is the
# shape that comes back as a narrative claim instead of an artifact, and the
# subagent cannot be asked to fix that afterwards — it has already finished.
#
# amaze's other rule, the batch-size cap, is NOT enforced here and cannot be:
# this harness spawns one agent per Task call, so there is no batch to measure.
# That half lives in `hooks/post/justsend.ts`, where omp passes `tasks[]` and a
# real JSON parser is available.
#
# Why patterns against the raw payload and not a JSON parser: same reason as
# destructive-guard.sh — the prompt arrives with escaped quotes and newlines, so
# a flat field extractor truncates it at the first quote and would report every
# brief as missing every section. Headings survive escaping (`\n## Target`), so
# they are matched where they are.
set -uo pipefail

payload=$(cat 2>/dev/null) || exit 0
[ -n "$payload" ] || exit 0

# Only executor roles carry the contract. A read-only scout returns findings, not
# changes, and demanding Acceptance from it would be noise.
case $payload in
  *'"worker"'*) : ;;
  *) exit 0 ;;
esac

missing=""
for section in Target Change Acceptance; do
  # `#`..`######` then optional spaces then the word. `[[:<:]]`-style boundaries
  # are not portable, so require a non-letter (or end) after the word.
  if ! printf '%s' "$payload" | grep -qiE "#{1,6}[[:space:]]*${section}([^a-zA-Z]|$)"; then
    missing="${missing:+$missing, }# $section"
  fi
done

[ -n "$missing" ] || exit 0

reason="worker 브리프에 필수 섹션이 없습니다: ${missing}. Target(파일·심볼·비목표) / Change(단계별 변경) / Acceptance(관측 가능한 결과 + 증거 산출물) 세 섹션을 마크다운 헤딩으로 반드시 포함해야 합니다. 서브에이전트는 끝난 뒤에 고쳐 달라고 할 수 없습니다."

# Same shape destructive-guard.sh uses: the JSON tells Claude Code to deny, the
# stderr line is what the model actually reads, and exit 2 blocks the call.
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
printf '%s\n' "$reason" >&2
exit 2
