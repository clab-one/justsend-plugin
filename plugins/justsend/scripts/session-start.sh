#!/usr/bin/env bash
# SessionStart — state the work-record contract once, and name whatever record
# is still open. Plain stdout is injected as context by both Claude Code and
# Codex, so this costs one short paragraph and no tool call.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

printf 'JustSend work memory is available through the `justsend` MCP server.\n'
printf 'Track substantive work: one record per task, keyed by `task_key`.\n'
printf 'Read before you write: always use `justsend_search` with objective/task terms, `including_agent: true`, and `limit: 5`; add `strategy: "resume"` when advertised.\n'
printf 'Resume with `justsend_context`. Read `skill://justsend-work` before the first write.\n'
printf 'Before the first use of an MCP tool, read its current schema and include every required argument.\n'
printf '`Invalid args` or a schema-validation error means the tool did not run and produced no evidence.\n'
printf 'Correct the payload and retry immediately; do not advance dependent research, plans, todos, or verification criteria until the corrected call succeeds.\n'
printf 'In `justsend_health`, current queue states are separate from `failed` cumulative terminal history; a failed intent never retries and is never success.\n'
printf 'Resume search resolves identity, then current agent work state, then history; `item.status` is not agent `work_status`. Reserve `justsend_list_records` for explicit inventory.\n'
printf 'Open with separate `title` and brief `body`; never use the retired `task` payload.\n'
printf 'Pass `project` as the repo directory uppercased with separators removed (ios-prod -> IOSPROD); the raw directory name forks a second numbering axis.\n'
printf 'Attach `image_path` on the first `justsend_work_start`; resumed starts do not change it.\n'
printf 'That image is one portrait newspaper page whose frame belongs to the renderer: pass the masthead, dateline, headline and deck as arguments (`--nameplate --dateline --hed --deck`) and write only the body under them.\n'
printf 'The nameplate is the work id (IOSPROD-17) when you pass `work_id`; a server-issued number arrives after the image is attached, and guessing it races, so those pages carry the project alone. This record title is the headline.\n'
printf 'The type scale and the page size are fixed: page text that sets `font-size` or `font-family`, and a body-level `<style>` or `<script>`, are rejected, while inside a figure (svg) or sample block (pre, code) type is yours. Anything that does not fit is rejected, not clipped - a body too tall, or a nameplate or edition past the right margin. Black ink on white paper, never the app theme.\n'
printf 'Close with the verified `summary` note on `justsend_work_complete`.\n'

if open=$(js_open_records); then
  printf '\nOpen JustSend record(s) in this directory: %s\n' "$(printf '%s' "$open" | tr '\n' ' ')"
  printf 'Continue that record instead of starting a second one.\n'
fi
exit 0
