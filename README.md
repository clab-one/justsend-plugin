# justsend-plugin

Work memory and verification for coding agents, backed by
[JustSend](https://github.com/clab-one) on the user's own Mac.

The plugin provides two components:

- **Work records** — one record per `task_key`, notes that carry decisions and
  dead ends, and completion that carries evidence. The JustSend app's MCP
  helper checks permissions, auditing, and idempotency on every call.
- **A verification contract** — success criteria registered before the work,
  proven by a failing-then-passing artifact per criterion, and a completion gate
  that refuses `justsend_work_complete` while anything is unproven. The plugin
  provides this zero-dependency MCP server.

The contract enforces the verification transitions: `GREEN` requires a
captured `RED`, artifacts must exist, be non-empty, and remain under allowed
roots, and completion reports any unproven criteria.

## Install

Install the helper from the canonical guide:
**https://justsend.cloud/install**. The app's **Settings → Agent access** screen
links to this page.

This README documents plugin installation and harness-specific helper
registration. Install the helper before registering the record server.

The helper path is:

```
HELPER  /usr/local/bin/justsend-mcp
```

The helper is distributed as a standalone website download. The following
behavior applies to the record server:

- **Reads do not need the app.** `justsend_me`, search, and every list tool read
  the app's own store directly, so they answer with JustSend closed.
- **Writes wait for the app.** An append enqueues an intent that the app applies
  and syncs; the tool answers `queued` until it does. Report a pending write
  rather than calling it written.
- **No port or token is required.** Register the fixed helper path. If the
  helper is moved or removed, reinstall it using the canonical guide.

> **Version history:** 0.6.0 distributes the helper outside the app bundle at
> `/usr/local/bin/justsend-mcp`; 0.5.0 replaced loopback HTTP; 0.3.0–0.4.1
> registered `127.0.0.1` with a bearer token.


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

pi has no MCP client, so record tools are unavailable. Copy the skills manually:

```bash
mkdir -p ~/.pi/agent/skills
cp -R ~/justsend-plugin/plugins/justsend/skills/justsend-work ~/.pi/agent/skills/
cp -R ~/justsend-plugin/plugins/justsend/skills/justsend-verify ~/.pi/agent/skills/
```

### Record server

Remove any older entry first. Versions 0.3.0–0.4.1 registered an HTTP endpoint
with a bearer token; that endpoint no longer exists.

```bash
claude mcp remove justsend -s user
codex mcp remove justsend
hermes mcp remove justsend
gemini mcp remove justsend
```

```bash
# Claude Code — everything after `--` is the command to launch
claude mcp add justsend -s user -- /usr/local/bin/justsend-mcp

# Codex
codex mcp add justsend -- /usr/local/bin/justsend-mcp

# Gemini CLI — pass -s user to avoid project-local configuration
gemini mcp add justsend /usr/local/bin/justsend-mcp -s user

# Hermes
hermes mcp add justsend --command /usr/local/bin/justsend-mcp
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
      "type": "stdio",
      "command": "/usr/local/bin/justsend-mcp"
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
      "type": "local",
      "command": ["/usr/local/bin/justsend-mcp"],
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

A client that reports the server as failed should verify the helper path:
run `/usr/local/bin/justsend-mcp` by hand and provide a JSON line containing
`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"probe","version":"0"}}}`
on stdin. If the file is missing, install the helper from
https://justsend.cloud/install.

## What each harness actually gets

Measurements were taken on 2026-08-17 against the named versions. The omp row
was re-run against the rebuilt app on 2026-08-20; the other five were not
re-installed on that machine.
**Record tools are registered per machine** using `/usr/local/bin/justsend-mcp`;
the plugin does not provide those tools. The table records whether each harness
can launch a local stdio server.

| Harness | Record tools (stdio) | Contract tools | Skills | Hooks |
|---|---|---|---|---|
| Claude Code 2.1.220 | ✅ `claude mcp add justsend -s user -- /usr/local/bin/justsend-mcp` | ✅ from the plugin | ✅ | ✅ 6 events |
| Codex 0.146.0 | ✅ `codex mcp add justsend -- /usr/local/bin/justsend-mcp` | ✅ from the plugin | ✅ | ✅ after hook trust |
| omp 17.1.3 | ✅ `mcp.json` `command: /usr/local/bin/justsend-mcp` | ✅ from the plugin | ✅ | ✅ `hooks/post/justsend.ts` |
| Hermes 0.20.1 | ✅ `hermes mcp add justsend --command /usr/local/bin/justsend-mcp` | ✅ manual | ✅ skill registry | ❌ |
| OpenCode 1.17.17 | ✅ `type: local`, `command: /usr/local/bin/justsend-mcp` | ✅ manual | ❌ | ❌ |
| Gemini CLI 0.45.0 | ✅ `gemini mcp add justsend /usr/local/bin/justsend-mcp -s user` | ✅ manual | ❌ | ❌ |
| OpenClaw | documented only | documented only | ✅ bundle mapping | ❌ detected, not run |
| pi 0.79.3 | ❌ no MCP client | ❌ no MCP client | ✅ drop-in | ❌ |

For a harness without a plugin-managed integration, append
[`instructions-block.md`](plugins/justsend/skills/justsend-work/reference/instructions-block.md)
to `AGENTS.md` (and `CLAUDE.md` / `GEMINI.md` where those apply). Skills and
hooks provide additional automation.

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

Commit `.justsend/` to include the evidence trail in the review diff, or ignore
it to keep working state out of history. Nothing in the plugin depends on this
choice.

Use `justsend_work_note(blocker:true)` when a human must act, or
`justsend_contract_set(enforce: false)` when work is tracked without a gate.
Both choices remain visible in the record.

Other hooks are advisory and exit 0 on doubt. The destructive-command guard and
completion gate fail open when their own plumbing is missing (`node` or the
script), so missing guard infrastructure does not block the harness.

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
