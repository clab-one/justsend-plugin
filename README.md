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

On **Claude Code** and **Codex** the plugin carries both MCP servers, so one
install is the whole thing — no `mcp add` step:

```bash
claude plugin marketplace add clab-one/justsend-plugin
claude plugin install justsend@justsend-plugin --scope user
```

```bash
codex plugin marketplace add clab-one/justsend-plugin
codex plugin add justsend@justsend-plugin
```

Verify with `claude mcp list` / `codex mcp list`; you want two entries:

```
plugin:justsend:records:  /Applications/JustSendMac.app/Contents/MacOS/JustSendMCP  ✔ Connected
plugin:justsend:contract: node .../plugins/justsend/mcp/contract.mjs                ✔ Connected
```

If you previously registered the server by hand, remove it. Claude Code hides the
duplicate; Codex does not, and you end up with two copies of all 15 record tools:

```bash
codex mcp remove justsend
claude mcp remove justsend -s user
```

The contract server runs on `node` from `PATH`, and the record server expects the
app in `/Applications`. Override either at install time:

```bash
claude plugin install justsend@justsend-plugin --scope user \
  --config node_path=/usr/local/bin/node \
  --config helper_path=/Users/me/Applications/JustSendMac.app/Contents/MacOS/JustSendMCP
```

### omp (17.1.3)

omp reads the `.claude-plugin/marketplace.json` catalog and the manifest's
`mcpServers`, so the contract server arrives with the plugin here too. It does
not resolve `${user_config.*}`, so register the record server yourself in
`~/.omp/agent/mcp.json`:

```bash
omp plugin marketplace add clab-one/justsend-plugin
omp plugin install justsend@justsend-plugin
```

```json
{
  "mcpServers": { "justsend": { "type": "stdio", "command": "/Applications/JustSendMac.app/Contents/MacOS/JustSendMCP" } }
}
```

### Harnesses with no plugin surface

Hermes, OpenCode, and Gemini CLI take MCP servers only. Register both by hand;
`$PLUGIN` is wherever you cloned or installed this repository.

```bash
# Hermes (0.20.1) — confirms the tool list before enabling
hermes mcp add justsend --command /Applications/JustSendMac.app/Contents/MacOS/JustSendMCP
hermes skills install clab-one/justsend-plugin/plugins/justsend/skills/justsend-work

# Gemini CLI (0.45.0) — user scope, or the default project scope drops a .gemini/ directory
gemini mcp add justsend /Applications/JustSendMac.app/Contents/MacOS/JustSendMCP -s user
```

Gemini also suppresses every MCP server — user scope included — in a folder it
does not trust: `gemini mcp list` reports `Disabled` and never attempts the
connection. Trust the folder from `/permissions`, or run with
`GEMINI_CLI_TRUST_WORKSPACE=true`, and confirm the entry reads `Connected`.

OpenCode, in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "justsend": {
      "type": "local",
      "command": ["/Applications/JustSendMac.app/Contents/MacOS/JustSendMCP"],
      "enabled": true
    },
    "justsend-contract": {
      "type": "local",
      "command": ["node", "$PLUGIN/plugins/justsend/mcp/contract.mjs"],
      "enabled": true
    }
  }
}
```

### pi (0.79.3)

pi has **no MCP client** — `mcpServers` appears nowhere in its distribution — so
no tool reaches it. The skills still install as drop-ins:

```bash
mkdir -p ~/.pi/agent/skills
cp -R plugins/justsend/skills/justsend-work ~/.pi/agent/skills/
cp -R plugins/justsend/skills/justsend-verify ~/.pi/agent/skills/
```

## What each harness actually gets

Measured on 2026-08-17 against the versions named.

| Harness | Record tools | Contract tools | Skills | Hooks |
|---|---|---|---|---|
| Claude Code 2.1.220 | ✅ from the plugin | ✅ from the plugin | ✅ | ✅ 6 events |
| Codex 0.146.0 | ✅ from the plugin | ✅ from the plugin | ✅ | ✅ after hook trust |
| omp 17.1.3 | ✅ `mcp.json` | ✅ from the plugin | ✅ | ✅ `hooks/post/justsend.ts` |
| Hermes 0.20.1 | ✅ manual | ✅ manual | ✅ skill registry | ❌ |
| OpenCode 1.17.17 | ✅ manual | ✅ manual | ❌ | ❌ |
| Gemini CLI 0.45.0 | ✅ manual | ✅ manual | ❌ | ❌ |
| OpenClaw | documented only | documented only | ✅ bundle mapping | ❌ detected, not run |
| pi 0.79.3 | ❌ no MCP support | ❌ no MCP support | ✅ drop-in | ❌ |

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
