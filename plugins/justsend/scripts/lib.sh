# Shared helpers for the JustSend plugin hooks. POSIX sh plus grep/sed only —
# no jq, no python. A hook that needs a dependency the user does not have is a
# hook that fails on the machine you cannot inspect.

# State lives outside the plugin so a plugin update never wipes it, and is keyed
# by working directory so two repos do not share one open-record list.
js_state_dir() {
  base="${CLAUDE_PLUGIN_DATA:-${PLUGIN_DATA:-${XDG_STATE_HOME:-$HOME/.local/state}/justsend-plugin}}"
  key=$(printf '%s' "${JUSTSEND_HOOK_CWD:-$PWD}" | tr -c 'A-Za-z0-9._-' '_')
  printf '%s/records/%s' "$base" "$key"
}

js_open_file() { printf '%s/open' "$(js_state_dir)"; }

# Pull one string field out of a flat JSON payload. Deliberately simple: the
# hook payloads that carry these fields are one level deep, and a real parser
# would be a dependency (see above).
js_field() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

js_open_records() {
  f=$(js_open_file)
  [ -s "$f" ] || return 1
  cat "$f"
}
