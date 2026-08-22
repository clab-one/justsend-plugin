#!/usr/bin/env bash
# Bridge from the shell hooks to mcp/contract.mjs, which owns the contract state.
# The gate logic lives in one place so the hook and the MCP tools can never
# disagree about whether a criterion is proven.
#
# Node is required by the bundled MCP server anyway, so calling it here adds no
# dependency. If node is missing we exit 0: a gate that fails closed on its own
# plumbing would block every completion on a machine we cannot inspect.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

cmd=${1:-}
[ -n "$cmd" ] || exit 0

js_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for c in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

node_bin=$(js_node) || exit 0
server="$(dirname "$0")/../mcp/contract.mjs"
[ -f "$server" ] || exit 0

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
if [ -z "$task_key" ] && { [ "$cmd" = "gate" ] || [ "$cmd" = "close" ] || [ "$cmd" = "block" ]; }; then
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
  exec "$node_bin" "$server" "$cmd" ${task_key:+"$task_key"}
