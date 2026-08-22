#!/usr/bin/env bash
# Defends the observable contract of the hooks: which commands the guard blocks,
# which safe exceptions pass, and that the open-record state opens and closes on
# the right tool calls. Run it before publishing a change: bash scripts/test-hooks.sh
set -uo pipefail
cd "$(dirname "$0")"

fail=0
pass=0

# --- destructive guard ------------------------------------------------------
guard() { printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1" | bash ./destructive-guard.sh >/dev/null 2>&1; }

blocks() {
  if guard "$1"; then printf 'FAIL blocks: %s\n' "$1"; fail=$((fail+1)); else pass=$((pass+1)); fi
}
allows() {
  if guard "$1"; then pass=$((pass+1)); else printf 'FAIL allows: %s\n' "$1"; fail=$((fail+1)); fi
}

blocks 'rm -rf /var/data'
blocks 'git reset --hard HEAD~3'
blocks 'git push -f origin main'
blocks 'git push origin main --force'
blocks "psql -c 'drop table users;'"
blocks "psql -c 'truncate users;'"
blocks 'kubectl delete pod my-pod'
blocks 'docker system prune'
blocks 'git checkout .'
blocks 'rm -rf node_modules /'
blocks 'rm -rf node_modules && rm -rf /'

allows 'rm -rf node_modules dist'
allows 'rm -rf ./node_modules/ .next/*'
allows 'rm -rf dist && bun run build'
allows 'git push --force-with-lease origin main'
allows 'git status'
allows 'git commit -m "drop the table copy"'

# --- open-record state ------------------------------------------------------
export JUSTSEND_STATE_DIR=$(mktemp -d)
export JUSTSEND_HOOK_CWD=/tmp/js-test-project
. ./lib.sh
state=$(js_open_file)

post() { printf '%s' "$1" | bash ./record-state.sh >/dev/null 2>&1; }

post '{"tool_name":"mcp__justsend__justsend_work_start","tool_input":{"task_key":"alpha","task":"x"}}'
if grep -qx alpha "$state" 2>/dev/null; then pass=$((pass+1)); else printf 'FAIL start did not open record\n'; fail=$((fail+1)); fi

post '{"tool_name":"mcp__justsend__justsend_work_start","tool_input":{"task_key":"alpha","task":"x"}}'
if [ "$(grep -c . "$state")" = 1 ]; then pass=$((pass+1)); else printf 'FAIL repeat start duplicated record\n'; fail=$((fail+1)); fi

post '{"tool_name":"mcp__justsend__justsend_work_note","tool_input":{"task_key":"alpha","note":"n"}}'
if grep -qx alpha "$state" 2>/dev/null; then pass=$((pass+1)); else printf 'FAIL plain note closed the record\n'; fail=$((fail+1)); fi

post '{"tool_name":"mcp__justsend__justsend_work_note","tool_input":{"task_key":"alpha","note":"n","blocker":true}}'
if grep -qx alpha "$state" 2>/dev/null; then printf 'FAIL blocker note left the gate armed\n'; fail=$((fail+1)); else pass=$((pass+1)); fi

post '{"tool_name":"mcp__justsend__justsend_work_start","tool_input":{"task_key":"beta","task":"y"}}'
post '{"tool_name":"mcp__justsend__justsend_work_complete","tool_input":{"task_key":"beta","summary":"s"}}'
if [ -s "$state" ]; then printf 'FAIL complete did not close the record\n'; fail=$((fail+1)); else pass=$((pass+1)); fi

post '{"tool_name":"mcp__justsend__justsend_progress_note","tool_input":{"task_key":"gamma","item_id":"i","note":"n"}}'
if [ -s "$state" ]; then printf 'FAIL progress_note opened a record\n'; fail=$((fail+1)); else pass=$((pass+1)); fi

# reminder speaks only when something is open
post '{"tool_name":"mcp__justsend__justsend_work_start","tool_input":{"task_key":"delta","task":"z"}}'
if bash ./open-record-reminder.sh | grep -q delta; then pass=$((pass+1)); else printf 'FAIL reminder omitted the open record\n'; fail=$((fail+1)); fi
post '{"tool_name":"mcp__justsend__justsend_work_complete","tool_input":{"task_key":"delta","summary":"s"}}'
if [ -z "$(bash ./open-record-reminder.sh)" ]; then pass=$((pass+1)); else printf 'FAIL reminder spoke with nothing open\n'; fail=$((fail+1)); fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

