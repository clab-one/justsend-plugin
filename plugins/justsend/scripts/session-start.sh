#!/usr/bin/env bash
# SessionStart — state the work-record contract once, and name whatever record
# is still open. Plain stdout is injected as context by both Claude Code and
# Codex, so this costs one short paragraph and no tool call.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

printf 'JustSend work memory is available through the `justsend` MCP server.\n'
printf 'Track substantive work: one record per task, keyed by `task_key`.\n'
printf 'Read before you write (`justsend_search`, or `justsend_get_record` with `work_id`).\n'
printf 'Resume with `justsend_context`. Close with `justsend_work_complete` and the evidence.\n'
# 그림은 나중에 붙일 수 없다 - 만드는 순간에만 받는다. 그래서 매 세션 첫 줄에 함께 실린다.
printf 'Open every task record with a picture: pass `image_path` on `justsend_work_start`.\n'
printf 'It is honoured only at creation — a later call attaches nothing.\n'

if open=$(js_open_records); then
  printf '\nOpen JustSend record(s) in this directory: %s\n' "$(printf '%s' "$open" | tr '\n' ' ')"
  printf 'Continue that record instead of starting a second one.\n'
fi
exit 0
