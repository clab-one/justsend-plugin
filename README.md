# justsend-plugin

Work memory for coding agents, backed by [JustSend](https://github.com/clab-one)
on the user's own Mac.

The plugin carries the **discipline**: one record per task, notes that carry
decisions and dead ends, completion that carries evidence. The **enforcement**
lives in the MCP server — permissions, auditing, and idempotency are checked
server-side on every call, so they hold whether or not this plugin is installed.

Works in Claude Code and Codex from the same directory.

## Install

The JustSend Mac app ships the MCP server. Register it with the path the app
gives you (Settings → Agent access → *Copy setup prompt*):

```bash
# Claude Code
claude mcp add justsend -s user -- "/Applications/JustSendMac.app/Contents/MacOS/JustSendMCP"
# Codex
codex mcp add justsend -- "/Applications/JustSendMac.app/Contents/MacOS/JustSendMCP"
```

No arguments, no environment variables, no token: the server resolves the
account database itself. Confirm with `justsend_me`.

Then install the plugin:

```bash
# Claude Code
claude plugin marketplace add clab-one/justsend-plugin
claude plugin install justsend@justsend-plugin --scope user

# Codex
codex plugin marketplace add clab-one/justsend-plugin
codex plugin add justsend@justsend-plugin
```

Codex asks you to review and trust the plugin's hooks before it runs them. That
prompt is expected, and declining costs visibility only.

Finally, append
[`instructions-block.md`](plugins/justsend/skills/justsend-work/reference/instructions-block.md)
to your `AGENTS.md` and `CLAUDE.md` so the contract survives a session that never
loads the skill.

## What is in it

| Component | Does |
|---|---|
| `skills/justsend-work` | The work-record contract and tool routing |
| `hooks` → `SessionStart` | States the contract once and names any record left open in this directory |
| `hooks` → `UserPromptSubmit` | Reminds you to close the open record, or mark it blocked |
| `hooks` → `PostToolUse` | Tracks which `task_key` is open, from the tool calls themselves |
| `hooks` → `PreToolUse` (`Bash`) | Blocks high-confidence destructive commands (`rm -rf`, `git reset --hard`, force-push, `DROP TABLE`, `kubectl delete`, …), with build-output directories exempted |

Hooks are advisory by design: every one of them exits 0 on doubt, and the only
one that blocks is the destructive-command guard. Anything that must not be
bypassed is enforced by the server as a tool error, not by a hook.

The MCP server is **not** bundled here. Its path is machine-specific — the app
knows where it is, this repository cannot.

## Development

```bash
bash plugins/justsend/scripts/test-hooks.sh   # hook contract tests, no dependencies
claude plugin validate ./plugins/justsend --strict
```

Hook scripts are POSIX-ish bash with `grep`/`sed` only. No `jq`, no `python`: a
hook that needs a dependency the user does not have is a hook that fails on the
machine you cannot inspect.

## License

MIT
