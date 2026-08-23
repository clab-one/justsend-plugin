#!/usr/bin/env bash
# Bridge from the shell hooks to mcp/contract.mjs, which owns the contract state.
# The gate logic lives in one place so the hook and the MCP tools can never
# disagree about whether a criterion is proven.
#
# mcp/run.sh is the only runtime resolver. If the MCP server can run, these
# lifecycle commands run under the same Bun, Node, or explicit override. A
# resolver failure stays loud instead of turning a missing gate into success.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

cmd=${1:-}
[ -n "$cmd" ] || exit 0

fail_closed() {
  reason='The JustSend verification gate could not run; completion remains blocked.'
  if [ "$cmd" = "gate" ]; then
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"The JustSend verification gate could not run; completion remains blocked."}}'
  fi
  printf '%s\n' "$reason" >&2
  exit 2
}

runner="$(dirname "$0")/../mcp/run.sh"
if [ ! -x "$runner" ]; then
  printf 'justsend contract hook: %s is missing or not executable.\n' "$runner" >&2
  if [ "$cmd" = "gate" ] || [ "$cmd" = "continuation" ]; then fail_closed; fi
  exit 1
fi

# task_key comes from the hook payload for the tool-scoped events, and is absent
# for the session-scoped ones (which use the active contract instead).
#
# `block` reads the payload for a second reason: only the note itself says
# whether it is a blocker, and the flag is matched the way record-state.sh
# matches it so the reminder list and the gate cannot disagree. A caller that
# already knows — the omp hook, which decides in TypeScript and passes the key
# as an argument — is trusted, and stdin is left alone so nothing can wait on a
# pipe the harness never writes.
task_key=${2:-}
if [ -z "$task_key" ] && {
  [ "$cmd" = "gate" ] || [ "$cmd" = "close" ] || [ "$cmd" = "release" ] \
    || [ "$cmd" = "abandon" ] || [ "$cmd" = "block" ];
}; then
  payload=$(cat 2>/dev/null) || payload=""
  if [ "$cmd" = "block" ]; then
    # Matched on the field, not on the word: a glob for `blocker` followed by
    # `true` anywhere also fires on `"blocker": false` in a note whose body
    # happens to say "true". A loose match on a reminder is noise; the same
    # match on a gate is a silent way out.
    printf '%s' "$payload" | grep -qE '"blocker"[[:space:]]*:[[:space:]]*true' || exit 0
  fi
  task_key=$(printf '%s' "$payload" | js_field task_key)
fi

JUSTSEND_HOOK_CWD="${JUSTSEND_HOOK_CWD:-$PWD}" \
  "$runner" "$cmd" ${task_key:+"$task_key"}
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 2 ] \
  && { [ "$cmd" = "gate" ] || [ "$cmd" = "continuation" ]; }; then
  fail_closed
fi
exit "$status"
