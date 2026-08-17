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
task_key=${2:-}
if [ "$cmd" = "gate" ] || [ "$cmd" = "close" ]; then
  if [ -z "$task_key" ]; then
    payload=$(cat 2>/dev/null) || payload=""
    task_key=$(printf '%s' "$payload" | js_field task_key)
  fi
fi

JUSTSEND_HOOK_CWD="${JUSTSEND_HOOK_CWD:-$PWD}" \
  exec "$node_bin" "$server" "$cmd" ${task_key:+"$task_key"}
