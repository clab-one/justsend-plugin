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
roots, and completion reports any unproven criteria. Each capture is copied to
a content-addressed, read-only snapshot that the plugin never overwrites, plus a
SHA-256, size, and capture time. The digest is proof identity; this is integrity
discipline inside the user's account, not protection from a malicious same-user
process. The stdio server supports modern
MCP `2026-07-28` (`server/discover` and per-request metadata) alongside explicit
legacy initialize versions through `2025-11-25`; it never echoes an unsupported
client version.

## Install

Install the helper from the canonical guide:
**https://justsend.cloud/install**. The app's **Settings → Agent access** screen
links to this page. Plugin 0.9.0's card-authoring payload requires helper 1.3.0
or later; verify `justsend_health.server_version` before enabling the plugin.

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
- **Writes wait for the app, identity does not.** An append enqueues an intent
  that the app applies and syncs, and the tool answers `queued` until it does —
  report a pending write rather than calling it written. But
  `justsend_work_start` issues the record's `item_id` immediately, so notes and
  completion can follow at once instead of waiting for the queue to drain.
- **Status and delivery are queryable.** `justsend_work_status` moves a record
  between `backlog`, `todo`, `in-progress`, `done`, and `canceled` without
  writing a note, and `justsend_health` reports which account and database are
  in use, the queue counts, and when the app last applied anything.
- **No port or token is required.** Register the fixed helper path. If the
  helper is moved or removed, reinstall it using the canonical guide.

> **Version history:** 0.9.0 serializes concurrent contract writers, rejects
> ambiguous task identities, snapshots evidence by SHA-256, moves strict/advisory
> policy outside the agent tool schema, and supports MCP 2026-07-28 alongside
> legacy initialize. It removes the agent `enforce` input and the internal
> `saveContract` module export; callers use locked tool mutations instead. 0.8.0 requires JustSend MCP helper 1.3.0 or later, cleanly
> separates record `title` and start `body`, and makes the structured brief plus
> representative `image_path` explicit at record creation. Completion remains the
> verified `summary` audit note. 0.7.0 launches the
> contract server through `mcp/run.sh`, so no host has to substitute a runtime
> path; 0.6.0 distributes
> the helper outside the app bundle at `/usr/local/bin/justsend-mcp`; 0.5.0
> replaced loopback HTTP; 0.3.0–0.4.1 registered `127.0.0.1` with a bearer
> token.


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
plugin:justsend:contract: .../plugins/justsend/mcp/run.sh   ✔ Connected
```

Installation takes no flags. The manifest launches `mcp/run.sh`, which finds a
runtime itself: `$JUSTSEND_CONTRACT_RUNTIME` when set, otherwise `bun` or `node`
on `PATH`, otherwise the usual install locations. Set
`JUSTSEND_CONTRACT_RUNTIME` only when the runtime lives somewhere unusual — and
set it in the environment the harness is *launched from*, because the harness
passes its own environment to the server it spawns:

```bash
echo 'export JUSTSEND_CONTRACT_RUNTIME=/opt/custom/bin/node' >> ~/.zshrc
exec zsh          # then restart the harness, which reads the variable at spawn
```

A harness already running will not pick it up; it spawned the server with the
environment it had. Verified on omp 17.4.0 on 2026-08-21 by pointing the
variable at a wrapper and confirming the wrapper was the process that ran
`mcp/contract.mjs`.

The indirection is not decoration. A plugin manifest can only carry variables its
host substitutes, and hosts substitute `${CLAUDE_PLUGIN_ROOT}` — omp additionally
`${OMP_PLUGIN_ROOT}` — and nothing else, so a manifest cannot name a runtime that
varies per machine. Up to 0.6.0 this one tried: omp 17.4.0 spawned the literal
string `${user_config.node_path}` and reported
`Executable not found in $PATH`.

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
      "command": ["~/justsend-plugin/plugins/justsend/mcp/run.sh"],
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
was re-run against the rebuilt app on 2026-08-20, and again on 2026-08-21 with
plugin 0.7.0 on omp 17.4.0, where `justsend:contract` was observed connecting
through `mcp/run.sh` and answering a `justsend_contract_status` call. The other
five were not re-installed on that machine.
**Record tools are registered per machine** using `/usr/local/bin/justsend-mcp`;
the plugin does not provide those tools. The table records whether each harness
can launch a local stdio server.

| Harness | Record tools (stdio) | Contract tools | Skills | Hooks |
|---|---|---|---|---|
| Claude Code 2.1.220 | ✅ `claude mcp add justsend -s user -- /usr/local/bin/justsend-mcp` | ✅ from the plugin | ✅ | ✅ 6 events |
| Codex 0.146.0 | ✅ `codex mcp add justsend -- /usr/local/bin/justsend-mcp` | ✅ from the plugin | ✅ | ✅ after hook trust |
| omp 17.4.0 | ✅ `mcp.json` `command: /usr/local/bin/justsend-mcp` | ✅ from the plugin | ✅ | ✅ `hooks/post/justsend.ts` |
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
| `skills/justsend-work` | One skill: record discipline, tool routing, tier triage, contract registration, and the writing rules. `plan.md`, `loop.md` and `review.md` load only when their phase begins |
| `mcp/contract.mjs` | The contract tools *and* the hooks' view of the same state. Zero dependencies, node stdlib only |
| `hooks` → `SessionStart` | States the contract, names any open record, restates the active contract |
| `hooks` → `UserPromptSubmit` | Reminds you to close the open record, or mark it blocked |
| `hooks` → `PostToolUse` | Tracks the open `task_key`; closes the contract when the record completes; stands both gates down on a note with `blocker: true` |
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
| Criteria and evidence receipts | `<cwd>/.justsend/contract/<task_key>.json` |
| Immutable evidence bytes | `<cwd>/.justsend/evidence/sha256/<prefix>/<sha256>` |
| Verification policy | `${XDG_CONFIG_HOME:-~/.config}/justsend-plugin/config.json` |
| Open-record list | `${XDG_STATE_HOME:-~/.local/state}/justsend-plugin`, shared across harnesses on purpose — one person, one task, whichever client they are in. Override with `JUSTSEND_STATE_DIR` |

Commit `.justsend/` to include the evidence trail in the review diff, or ignore
it to keep working state out of history. Nothing in the plugin depends on this
choice. Contract writes are serialized per task and carry a monotonic revision,
so concurrent Claude, Codex, and omp processes do not overwrite one another. A
crashed writer can leave `<task_key>.lock`; the gate then fails closed with the
owner metadata instead of guessing that the lock is stale. Remove that directory
only after confirming its recorded process is gone. A successful completion gate
also writes a 60-second revision lease: contract and evidence mutations are
refused until the matching `close` consumes it. A failed omp completion releases
it immediately; a crashed or older harness recovers when it expires.

Verification defaults to `strict`. A user can choose advisory mode outside the
agent tool surface:

```json
{"verification":{"mode":"advisory"}}
```

An agent cannot change this policy through `justsend_contract_set`. Use
`justsend_work_note(blocker:true)` when a human must act. The blocker note stamps `blocked_at`,
which stands the completion gate and the Stop gate down without marking the work
done — the next `justsend_evidence` clears it and re-arms, and
`justsend_contract_status` keeps reporting a `Blocked since` line.

`justsend_contract_status(format: "report")` renders the contract as one artifact —
the objective, a table row per criterion with its result, and what is still
unproven — so the record body and the closing summary quote one generated table
instead of two hand-assembled ones. The hooks keep the terse `summarize()` view,
which carries evidence paths and per-criterion status the agent needs and a person
does not. The skill carries the rest: what the app renders, and what it prints as
literal characters.

Other hooks are advisory and exit 0 on doubt. The verification server and every
completion lifecycle command share `mcp/run.sh`; Bun, Node, and an explicit
`JUSTSEND_CONTRACT_RUNTIME` therefore resolve identically. Missing verification
plumbing fails loudly rather than turning an absent gate into permission.

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
