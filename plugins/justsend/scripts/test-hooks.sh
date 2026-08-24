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

# **인용부호가 섞인 명령.** JSON 은 명령 안의 `"` 를 `\"` 로 싣는다. 예전에는 명령을
# `[^"]*` 로 꺼내 그 앞토막만 검사했으므로 아래 둘이 통과했다(실측 2026-08-23) - 위험
# 패턴이 잘린 뒤쪽에 있었기 때문이다. 이제 검사는 payload 전체에 걸린다.
blocks_json() {
  if printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1" \
    | bash ./destructive-guard.sh >/dev/null 2>&1
  then printf 'FAIL blocks(quoted): %s\n' "$1"; fail=$((fail+1)); else pass=$((pass+1)); fi
}
allows_json() {
  if printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1" \
    | bash ./destructive-guard.sh >/dev/null 2>&1
  then pass=$((pass+1)); else printf 'FAIL allows(quoted): %s\n' "$1"; fail=$((fail+1)); fi
}
blocks_json 'git commit -m \"x\" && rm -rf /'
blocks_json 'echo \"hi\" ; rm -rf /var/data'
blocks_json 'psql -c \"drop table users;\"'
allows_json 'git commit -m \"drop the table copy\"'
allows_json 'echo \"cleaning\" && rm -rf node_modules dist'

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
if bash ./open-record-reminder.sh | grep -q summary; then pass=$((pass+1)); else printf 'FAIL reminder omitted summary\n'; fail=$((fail+1)); fi
post '{"tool_name":"mcp__justsend__justsend_work_complete","tool_input":{"task_key":"delta","summary":"s"}}'
if [ -z "$(bash ./open-record-reminder.sh)" ]; then pass=$((pass+1)); else printf 'FAIL reminder spoke with nothing open\n'; fail=$((fail+1)); fi

# --- 적대적 payload ----------------------------------------------------------
# 훅의 stdin 은 신뢰 경계다. `task_key` 는 도구를 부른 쪽이 정하는 문자열이고, 그것을
# 셸 스크립트가 `grep`/`sed` 로 가른 뒤 파일 경로와 상태 파일 내용으로 쓴다. 그래서 두
# 가지를 고정한다: 값이 **명령으로 해석되지 않는다**, 값이 **상태 디렉터리 밖에 파일을
# 만들지 못한다**. 지금 통과하는 것을 고정해 두는 것이 요점이다 - 다음에 `eval` 이나
# 인용 없는 확장이 들어오면 이 자리가 먼저 깨진다.
mark="$(mktemp -u /tmp/js-hostile-XXXXXX)"
hostile() {
  printf '{"tool_name":"mcp__justsend__justsend_work_start","tool_input":{"task_key":"%s","task":"x"}}' "$1" \
    | bash ./record-state.sh >/dev/null 2>&1
}
hostile '$(touch '"$mark"')'
hostile '`touch '"$mark"'`'
hostile 'a;touch '"$mark"
hostile '../../../../tmp/js-escape-hook'
hostile '$(echo hi)/../../etc/x'
if [ -e "$mark" ]; then
  printf 'FAIL hostile task_key executed a command\n'; fail=$((fail+1)); rm -f "$mark"
else pass=$((pass+1)); fi
if [ -e /tmp/js-escape-hook ]; then
  printf 'FAIL hostile task_key wrote outside the state directory\n'; fail=$((fail+1))
  rm -f /tmp/js-escape-hook
else pass=$((pass+1)); fi
# 상태 파일은 여전히 상태 디렉터리 아래 한 곳이다.
if [ "$(find "$JUSTSEND_STATE_DIR" -name open -type f | wc -l | tr -d ' ')" = 1 ]; then
  pass=$((pass+1))
else printf 'FAIL hostile task_key split the state file\n'; fail=$((fail+1)); fi
# the verb comes from tool_name, not from the payload text
post '{"tool_name":"mcp__justsend__justsend_work_start","tool_input":{"task_key":"epsilon","task":"close it with justsend_work_complete once the contract is green"}}'
if grep -qx epsilon "$state" 2>/dev/null; then pass=$((pass+1)); else printf 'FAIL start quoting justsend_work_complete did not open record\n'; fail=$((fail+1)); fi
post '{"tool_name":"mcp__justsend__justsend_work_complete","tool_input":{"task_key":"epsilon","summary":"s"}}'
if grep -qx epsilon "$state" 2>/dev/null; then printf 'FAIL complete did not close the quoting record\n'; fail=$((fail+1)); else pass=$((pass+1)); fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

