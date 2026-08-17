# justsend-plugin

Work memory for coding agents, backed by [JustSend](https://github.com/clab-one)
on the user's own Mac.

The plugin carries the **discipline**: one record per task, notes that carry
decisions and dead ends, completion that carries evidence. The **enforcement**
lives in the MCP server — permissions, auditing, and idempotency are checked
server-side on every call, so they hold whether or not this plugin is installed.

## Two things to install

1. **The MCP server** — a stdio binary inside the JustSend Mac app. It needs no
   arguments, no environment variables, and no token; it resolves the account
   database itself. Its path is machine-specific, so this repository does not
   ship it: the app hands you a setup prompt with its own path filled in
   (**Settings → Agent access → Copy setup prompt**).

   ```
   /Applications/JustSendMac.app/Contents/MacOS/JustSendMCP
   ```

2. **This plugin** — the skill and the lifecycle hooks. Every harness gets the
   skill; hooks depend on what the harness runs (see the matrix).

## Per-harness install

Verified on 2026-08-17 with the versions named. `$HELPER` is the path above.

### Claude Code (2.1.220)

```bash
claude mcp add justsend -s user -- "$HELPER"
claude plugin marketplace add clab-one/justsend-plugin
claude plugin install justsend@justsend-plugin --scope user
```

Skill plus all four hooks (`SessionStart`, `UserPromptSubmit`, `PostToolUse`,
`PreToolUse`).

### Codex (codex-cli 0.146.0)

```bash
codex mcp add justsend -- "$HELPER"
codex plugin marketplace add clab-one/justsend-plugin
codex plugin add justsend@justsend-plugin
```

Same components. Codex asks you to review and trust plugin hooks before it runs
them; that prompt is expected.

### omp (17.1.3)

```bash
omp plugin marketplace add clab-one/justsend-plugin
omp plugin install justsend@justsend-plugin
```

omp reads the `.claude-plugin/marketplace.json` catalog directly. It does not run
`hooks/hooks.json`, so the plugin also ships `hooks/post/justsend.ts`, an
omp-native hook that shells out to the same scripts — one matcher, one tracker,
two harness shapes.

For the MCP server, add it to `~/.omp/agent/mcp.json` (or run `/mcp add` in a
session):

```json
{
  "mcpServers": { "justsend": { "type": "stdio", "command": "/Applications/JustSendMac.app/Contents/MacOS/JustSendMCP" } }
}
```

### Hermes (0.20.1)

```bash
hermes mcp add justsend --command "$HELPER"      # then confirm the 15 tools
hermes skills install clab-one/justsend-plugin/plugins/justsend/skills/justsend-work
```

Hermes takes the skill through its own skill registry; the plugin format is not a
Hermes plugin, so `hermes plugins install` is not the route.

### OpenCode (1.17.17)

Add to `~/.config/opencode/opencode.json` (or `opencode mcp add justsend`, which
prompts):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "justsend": {
      "type": "local",
      "command": ["/Applications/JustSendMac.app/Contents/MacOS/JustSendMCP"],
      "enabled": true
    }
  }
}
```

Verify with `opencode mcp list`. OpenCode takes the contract through `AGENTS.md`.

### Gemini CLI

```bash
gemini mcp add justsend "$HELPER" -s user
```

Use `-s user`; the default is project scope, which drops a `.gemini/` directory
into whatever repository you happen to be in. Gemini reads `GEMINI.md`, so put
the contract block there as well as in `AGENTS.md`.

### OpenClaw

Documented from OpenClaw's own docs, not verified here (not installed on the
machine this was built on):

```bash
openclaw plugins install ./justsend-plugin/plugins/justsend
# or from this repository as a Claude/Codex bundle marketplace
openclaw plugins install justsend --marketplace clab-one/justsend-plugin
openclaw gateway restart
```

OpenClaw maps bundle `skills/` into native skills and merges bundle MCP config;
`hooks/hooks.json` is detected but not executed. Register the server in
`~/.openclaw/openclaw.json` under `mcp.servers.justsend.command`, and put the
contract block in `~/.openclaw/workspace/AGENTS.md`.

### pi (0.79.3)

pi has **no MCP client** — `mcpServers` appears nowhere in its distribution — so
the JustSend tools cannot reach it. The skill still installs as a drop-in:

```bash
mkdir -p ~/.pi/agent/skills/justsend-work
cp plugins/justsend/skills/justsend-work/SKILL.md ~/.pi/agent/skills/justsend-work/
```

## What each harness actually gets

| Harness | MCP tools | Skill | Hooks |
|---|---|---|---|
| Claude Code | ✅ `claude mcp add` | ✅ plugin | ✅ `hooks/hooks.json` (4 events) |
| Codex | ✅ `codex mcp add` | ✅ plugin | ✅ after hook trust |
| omp | ✅ `mcp.json` | ✅ plugin | ✅ `hooks/post/justsend.ts` |
| Hermes | ✅ `hermes mcp add` | ✅ skill registry | ❌ |
| OpenCode | ✅ `opencode.json` | ❌ | ❌ |
| Gemini CLI | ✅ `gemini mcp add` | ❌ | ❌ |
| OpenClaw | ✅ `openclaw.json` | ✅ bundle mapping | ❌ (detected, not executed) |
| pi | ❌ no MCP support | ✅ drop-in | ❌ |

Whatever the harness does not run, append
[`instructions-block.md`](plugins/justsend/skills/justsend-work/reference/instructions-block.md)
to `AGENTS.md` (and `CLAUDE.md` / `GEMINI.md` where those apply). The contract in
a file is the floor; skills and hooks are the ceiling.

## Components

| Component | Does |
|---|---|
| `skills/justsend-work` | The work-record contract and tool routing |
| `hooks` → `SessionStart` | States the contract once and names any record left open in this directory |
| `hooks` → `UserPromptSubmit` | Reminds you to close the open record, or mark it blocked |
| `hooks` → `PostToolUse` | Tracks which `task_key` is open, from the tool calls themselves |
| `hooks` → `PreToolUse` (`Bash`) | Blocks high-confidence destructive commands (`rm -rf`, `git reset --hard`, force-push, `DROP TABLE`, `kubectl delete`, …), with build-output directories exempted |
| `hooks/post/justsend.ts` | The same four behaviours for omp, plus compaction survival for the open record |

Hooks are advisory by design: every one exits 0 on doubt, and the only one that
blocks is the destructive-command guard. Anything that must not be bypassed is
enforced by the server as a tool error, not by a hook.

Open-record state lives in `${XDG_STATE_HOME:-~/.local/state}/justsend-plugin`,
shared across harnesses on purpose — one person, one task, whichever client they
are in. Override with `JUSTSEND_STATE_DIR`.

## Development

```bash
bash plugins/justsend/scripts/test-hooks.sh        # shell hook contract, no dependencies
bun test plugins/justsend/hooks/post               # omp hook, against the real scripts
claude plugin validate ./plugins/justsend --strict
```

Hook scripts are POSIX-ish bash with `grep`/`sed` only. No `jq`, no `python`: a
hook that needs a dependency the user does not have is a hook that fails on the
machine you cannot inspect.

## License

MIT
