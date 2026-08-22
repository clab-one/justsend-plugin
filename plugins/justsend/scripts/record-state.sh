#!/usr/bin/env bash
# PostToolUse — track which task_key is open, so the reminder can name it.
# Advisory: on any doubt this exits 0 and records nothing.
#
# `work_start` opens, `work_complete` and `work_retract` close, and a note with
# `blocker: true` drops the task from this list too — a blocked task is waiting
# on a human, not on the agent, so nagging about it is noise. This file only
# owns the reminder; the contract gate is disarmed separately by
# `contract.sh block`. `progress_note` never opens a record: the parent owns it.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

payload=$(cat 2>/dev/null) || exit 0
[ -n "$payload" ] || exit 0

task_key=$(printf '%s' "$payload" | js_field task_key)
[ -n "$task_key" ] || exit 0

dir=$(js_state_dir); file=$(js_open_file)
mkdir -p "$dir" 2>/dev/null || exit 0

js_forget() {
  [ -f "$file" ] || return 0
  grep -v -x -F "$task_key" "$file" > "$file.tmp" 2>/dev/null || : > "$file.tmp"
  mv "$file.tmp" "$file"
}

case $payload in
  *justsend_work_complete*|*justsend_work_retract*|*justsend_work_cancel*) js_forget ;;
  *justsend_work_note*)
    # One spelling of "is this a blocker" across both scripts: a glob for `true`
    # anywhere after the word also fires on `"blocker": false` in a note whose
    # body says "true". contract.sh matches the field the same way.
    printf '%s' "$payload" | grep -qE '"blocker"[[:space:]]*:[[:space:]]*true' && js_forget
    ;;
  *justsend_work_start*)
    touch "$file"
    grep -q -x -F "$task_key" "$file" 2>/dev/null || printf '%s\n' "$task_key" >> "$file"
    ;;
esac
exit 0
