# justsend-plugin

Work memory and verification for coding agents, backed by
[JustSend](https://github.com/clab-one) on the user's own Mac.

Two halves of the same job:

- **Work records** — one record per `task_key`, notes that carry decisions and
  dead ends, completion that carries evidence. Served by the JustSend app's own
  MCP binary, which checks permissions, auditing, and idempotency server-side on
  every call.
- **A verification contract** — success criteria registered before the work,
  proven by a failing-then-passing artifact per criterion, and a completion gate
  that refuses `justsend_work_complete` while anything is unproven. Served by a
  bundled zero-dependency MCP server in this repository.

The second half exists because an agent asked to "verify before finishing" will
report success it never observed. The transitions are enforced in code:
`GREEN` without a captured `RED` is refused, an artifact that is missing, empty,
or outside the allowed roots is refused, and completion is refused with the
unproven criteria named.

## Install

There are two pieces and they arrive differently.

The **contract server** ships inside this plugin, so a plugin install is the
whole story for it. The **record server is the JustSend app itself** — it listens
on loopback HTTP while it runs, and the address and token belong to that machine.
A plugin cannot carry them, so you register that one with values the app hands
you.

Get them from the app: **Settings → Agent access → Copy setup prompt**. It writes
a prompt to the clipboard with your endpoint and token already substituted, and
every command below in it. Paste that into your agent and it installs itself.

The rest of this section is what that prompt does, if you would rather do it by
hand. Substitute your own values for `PORT` and `TOKEN`.

```
URL    http://127.0.0.1:PORT/mcp
```

Two things follow from the app being the server:

- **The app has to be running.** Close JustSend and the record tools are gone.
  The contract server is unaffected; it is a node script.
- **The port is stable.** It is chosen once and kept, so the URL you write into a
  client config stays correct across restarts. If something else takes the port
  while the app is closed, the app moves and says so on that settings row — copy
  the prompt again.

### Plugin

```bash
claude plugin marketplace add clab-one/justsend-plugin
claude plugin install justsend@justsend-plugin --scope user
```

```bash
codex plugin marketplace add clab-one/justsend-plugin
codex plugin add justsend@justsend-plugin
```

```bash
omp plugin marketplace add clab-one/justsend-plugin
omp plugin install justsend@justsend-plugin
```

That gives you the skills, the hooks, and one MCP entry:

```
plugin:justsend:contract: node .../plugins/justsend/mcp/contract.mjs   ✔ Connected
```

The contract server runs `node` from `PATH`. Override it at install time:

```bash
claude plugin install justsend@justsend-plugin --scope user \
  --config node_path=/usr/local/bin/node
```

Hermes, OpenCode, Gemini CLI and pi have no plugin surface that fits this
layout. Clone the repository and point at it:

```bash
git clone https://github.com/clab-one/justsend-plugin ~/justsend-plugin
hermes skills install clab-one/justsend-plugin/plugins/justsend/skills/justsend-work
```

pi has no MCP client at all, so the record tools are out of reach there. Copy the
skills in by hand and stop at that:

```bash
mkdir -p ~/.pi/agent/skills
cp -R ~/justsend-plugin/plugins/justsend/skills/justsend-work ~/.pi/agent/skills/
cp -R ~/justsend-plugin/plugins/justsend/skills/justsend-verify ~/.pi/agent/skills/
```

### Record server

Remove any older entry first. Versions before 0.3.0 pointed at a helper
executable inside the app bundle; that executable is gone, and a stale entry sits
in the list looking installed rather than failing loudly.

```bash
claude mcp remove justsend -s user
codex mcp remove justsend
hermes mcp remove justsend
gemini mcp remove justsend
```

```bash
# Claude Code
claude mcp add --transport http justsend http://127.0.0.1:PORT/mcp \
  --header "Authorization: Bearer TOKEN" -s user

# Codex — reads the token from the environment, not a flag
export JUSTSEND_MCP_TOKEN=TOKEN
codex mcp add justsend --url http://127.0.0.1:PORT/mcp \
  --bearer-token-env-var JUSTSEND_MCP_TOKEN

# Gemini CLI — pass -s user, or the default project scope drops a .gemini/ directory
gemini mcp add justsend http://127.0.0.1:PORT/mcp -t http -s user \
  -H "Authorization: Bearer TOKEN"

# Hermes — asks for the header value; give it "Authorization: Bearer TOKEN"
hermes mcp add justsend --url http://127.0.0.1:PORT/mcp --auth header
```

Gemini also suppresses every MCP server — user scope included — in a folder it
does not trust: `gemini mcp list` reports `Disabled` and never attempts the
connection. Trust the folder from `/permissions`, or run with
`GEMINI_CLI_TRUST_WORKSPACE=true`, and confirm the entry reads `Connected`.

omp, in `~/.omp/agent/mcp.json`:

```json
{
  "mcpServers": {
    "justsend": {
      "type": "http",
      "url": "http://127.0.0.1:PORT/mcp",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

OpenCode, in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "justsend": {
      "type": "remote",
      "url": "http://127.0.0.1:PORT/mcp",
      "headers": { "Authorization": "Bearer TOKEN" },
      "enabled": true
    },
    "justsend-contract": {
      "type": "local",
      "command": ["node", "~/justsend-plugin/plugins/justsend/mcp/contract.mjs"],
      "enabled": true
    }
  }
}
```

A `401` means the token in the config does not match the app's. Copy the setup
prompt again rather than guessing at it.

## What each harness actually gets

Measured on 2026-08-17 against the versions named. **Record tools are registered
per machine** (endpoint + token, from the app's setup prompt), so no harness gets
them from the plugin — that column is about whether the harness speaks HTTP at
all, and all six do.

| Harness | Record tools (HTTP) | Contract tools | Skills | Hooks |
|---|---|---|---|---|
| Claude Code 2.1.220 | ✅ `--transport http` + `--header` | ✅ from the plugin | ✅ | ✅ 6 events |
| Codex 0.146.0 | ✅ `--url` + `--bearer-token-env-var` | ✅ from the plugin | ✅ | ✅ after hook trust |
| omp 17.1.3 | ✅ `mcp.json` `type: http` | ✅ from the plugin | ✅ | ✅ `hooks/post/justsend.ts` |
| Hermes 0.20.1 | ✅ `--url` + `--auth header` | ✅ manual | ✅ skill registry | ❌ |
| OpenCode 1.17.17 | ✅ `type: remote` + `headers` | ✅ manual | ❌ | ❌ |
| Gemini CLI 0.45.0 | ✅ `-t http` + `-H` | ✅ manual | ❌ | ❌ |
| OpenClaw | documented only | documented only | ✅ bundle mapping | ❌ detected, not run |
| pi 0.79.3 | ❌ no MCP client | ❌ no MCP client | ✅ drop-in | ❌ |

Whatever a harness does not run, append
[`instructions-block.md`](plugins/justsend/skills/justsend-work/reference/instructions-block.md)
to `AGENTS.md` (and `CLAUDE.md` / `GEMINI.md` where those apply). A file is the
floor; skills and hooks are the ceiling.

## Components

| Component | Does |
|---|---|
| `skills/justsend-work` | Work-record discipline and tool routing |
| `skills/justsend-verify` | Tier triage, contract registration, the failing-first loop, the gate |
| `mcp/contract.mjs` | The contract tools *and* the hooks' view of the same state. Zero dependencies, node stdlib only |
| `hooks` → `SessionStart` | States the contract, names any open record, restates the active contract |
| `hooks` → `UserPromptSubmit` | Reminds you to close the open record, or mark it blocked |
| `hooks` → `PostToolUse` | Tracks the open `task_key`; closes the contract when the record completes |
| `hooks` → `PreToolUse` (`Bash`) | Blocks high-confidence destructive commands, build-output directories exempted |
| `hooks` → `PreToolUse` (`justsend_work_complete`) | **The gate.** Refuses completion while a criterion is unproven |
| `hooks` → `PreCompact` | Re-injects the contract summary so it survives compaction |
| `hooks` → `Stop` | Refuses a quiet stop while a criterion is unproven |

### Contract tools

| Tool | Does |
|---|---|
| `justsend_contract_set` | Register or update criteria; upserts by id, preserves evidence, arms the gate |
| `justsend_evidence` | Record `red` / `green` / `surface` / `cleanup`; enforces failing-first and artifact validity |
| `justsend_contract_status` | Per-criterion status, evidence paths, unproven list — one call after a compaction |

### State

| What | Where |
|---|---|
| Criteria and evidence | `<cwd>/.justsend/contract/<task_key>.json` |
| Open-record list | `${XDG_STATE_HOME:-~/.local/state}/justsend-plugin`, shared across harnesses on purpose — one person, one task, whichever client they are in. Override with `JUSTSEND_STATE_DIR` |

Whether `.justsend/` is committed is your call: committing it puts the evidence
trail in the diff a reviewer reads, and ignoring it keeps working state out of
history. Nothing in the plugin depends on the choice.

Two honest ways past a gate you cannot satisfy: `justsend_work_note(blocker:
true)` when a human has to act, or `justsend_contract_set(enforce: false)` when
the work is tracked rather than gated. Both are visible in the record.

Every other hook is advisory and exits 0 on doubt. The two that block —
the destructive-command guard and the completion gate — fail *open* if their own
plumbing is missing (no `node`, no script), because a guard that fails closed on
its own bug is worse than no guard.

## Development

```bash
bash plugins/justsend/scripts/test-hooks.sh   # shell hook contract, no dependencies
bun test                                      # omp hook + contract transitions
claude plugin validate ./plugins/justsend --strict
```

Hook scripts are POSIX-ish bash with `grep`/`sed` only. No `jq`, no `python`: a
hook that needs a dependency the user does not have is a hook that fails on the
machine you cannot inspect. `mcp/contract.mjs` is plain `.mjs` for the same
reason — no build step, no `node_modules`, runs on any node with `fetch`-era
stdlib.

Tests live in `plugins/justsend/tests/`, deliberately outside `hooks/post/`:
omp loads every `.ts` under `hooks/post/` as an extension, and a test file there
fails to load on every session start.

## License

MIT
