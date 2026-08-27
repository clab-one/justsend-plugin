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
printf 'That image is one diagram. Read skills/justsend-work/reference/hero-diagram.md, ask what the reader must learn, and copy that type from templates/hero/ (ten are drawn: flow pipeline state structure sequence comparison loop timeline swimlane cause); declare it with <svg data-type>, then run scripts/hero-check.py and scripts/hero-bake.sh.\n'
printf 'Eight colors, three local families (Charter, Helvetica Neue, SF Mono with Korean fallbacks), Korean labels, no remote font; nine nodes at most, and the editorial red marks the failure, the refusal, the dead end - never decoration.\n'
printf 'The bake is the export contract: it checks first and writes nothing for a page that fails, keeps the first `<svg>` only at `viewBox` x 2 on painted paper, then measures the written pixels and deletes the image if they disagree.\n'
printf 'Close with the verified `summary` note on `justsend_work_complete`.\n'

if open=$(js_open_records); then
  printf '\nOpen JustSend record(s) in this directory: %s\n' "$(printf '%s' "$open" | tr '\n' ' ')"
  printf 'Continue that record instead of starting a second one.\n'
fi
exit 0
