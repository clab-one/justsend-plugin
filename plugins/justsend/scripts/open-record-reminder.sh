#!/usr/bin/env bash
# UserPromptSubmit — the portable form of a stop gate. A Stop hook cannot speak
# to the model without also blocking it, so the reminder rides the next prompt
# instead: still deterministic, never hijacks the session.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

open=$(js_open_records) || exit 0
printf 'Open JustSend record(s): %s. ' "$(printf '%s' "$open" | tr '\n' ' ')"
printf 'Before you finish, close each one with `justsend_work_complete` (`summary`: outcome, verification, failures, and what is still open), '
printf 'or leave `justsend_work_note` with `blocker: true` if a human has to act.\n'
exit 0
