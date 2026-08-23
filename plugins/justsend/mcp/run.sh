#!/bin/sh
# Launch mcp/contract.mjs under whatever JavaScript runtime this machine has.
#
# The manifests point at this script rather than at a runtime because a plugin
# manifest can only carry variables its host substitutes, and hosts substitute
# `${CLAUDE_PLUGIN_ROOT}` (omp additionally `${OMP_PLUGIN_ROOT}`) and nothing
# else. Naming a per-machine interpreter there is therefore impossible: up to
# 0.6.0 the Claude manifest said `${user_config.node_path}`, and omp 17.4.0
# spawned that string literally and died with `Executable not found in $PATH`
# (measured 2026-08-21 - the substring `user_config` does not occur anywhere in
# the omp binary). A path this script computes at runtime has no such limit.
#
# The optional arguments are contract.mjs subcommands, not runtime commands:
# `run.sh gate alpha` becomes `bun contract.mjs gate alpha` or the exact same
# node invocation. One resolver therefore owns both the stdio server and every
# lifecycle gate; a machine cannot run MCP while silently skipping its gate.
set -eu

# Parameter expansion, not `dirname`: with a PATH that cannot find `dirname`,
# `$(dirname …)` is empty, `cd -- ""` is a silent no-op in bash 3.2 (which is
# /bin/sh on macOS), and the server path would resolve against the *client's*
# working directory instead of the plugin (observed 2026-08-21).
case "$0" in
  */*) dir=${0%/*} ;;
  *) dir=. ;;
esac
here=$(CDPATH='' cd -- "$dir" 2>/dev/null && pwd) || here=$dir
server="$here/contract.mjs"

# Every failure here is loud on purpose. A stdio server that exits quietly is
# indistinguishable from a broken install at the client, which sees only that
# the server closed the pipe. `command -v` resolves a bare name on PATH and an
# absolute path alike, so one form covers both kinds of candidate - and it turns
# a mistyped override into the message below instead of `exec` leaking a raw
# "No such file or directory" tagged with a line number from this script.
runtime=''
if [ -n "${JUSTSEND_CONTRACT_RUNTIME:-}" ]; then
  runtime=$(command -v "$JUSTSEND_CONTRACT_RUNTIME" 2>/dev/null) || {
    echo "justsend contract server: JUSTSEND_CONTRACT_RUNTIME=$JUSTSEND_CONTRACT_RUNTIME cannot be executed." >&2
    exit 1
  }
else
  for c in bun node "$HOME/.bun/bin/bun" "$HOME/.local/bin/node" \
    /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    runtime=$(command -v "$c" 2>/dev/null) && break
    runtime=''
  done
  [ -n "$runtime" ] || {
    echo "justsend contract server: no JavaScript runtime found. Install bun or node, or set JUSTSEND_CONTRACT_RUNTIME to one." >&2
    exit 1
  }
fi

[ -f "$server" ] || {
  echo "justsend contract server: $server is missing - the plugin install is incomplete." >&2
  exit 1
}

exec "$runtime" "$server" "$@"
