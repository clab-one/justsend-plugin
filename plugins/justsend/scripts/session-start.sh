#!/usr/bin/env bash
# SessionStart — state the work-record contract once, and name whatever record
# is still open. Plain stdout is injected as context by both Claude Code and
# Codex, so this costs one short paragraph and no tool call.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

printf 'JustSend work memory is available through the `justsend` MCP server.\n'
printf 'Track substantive work: one record per task, keyed by `task_key`.\n'
printf 'Read before you write (`justsend_search`, or `justsend_get_record` with `work_id`).\n'
printf 'Resume with `justsend_context`. Read `skill://justsend-work` before the first write.\n'
printf 'Before the first use of an MCP tool, read its current schema and include every required argument.\n'
printf '`Invalid args` or a schema-validation error means the tool did not run and produced no evidence.\n'
printf 'Correct the payload and retry immediately; do not advance dependent research, plans, todos, or verification criteria until the corrected call succeeds.\n'
printf 'Open with separate `title` and brief `body`; never use the retired `task` payload.\n'
printf 'Attach `image_path` on the first `justsend_work_start`; resumed starts do not change it.\n'
printf 'Close with the verified `summary` note on `justsend_work_complete`.\n'

if open=$(js_open_records); then
  printf '\nOpen JustSend record(s) in this directory: %s\n' "$(printf '%s' "$open" | tr '\n' ' ')"
  printf 'Continue that record instead of starting a second one.\n'
fi
exit 0
