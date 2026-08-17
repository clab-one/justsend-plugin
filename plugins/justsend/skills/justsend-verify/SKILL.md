---
name: justsend-verify
description: "Evidence-first execution against a JustSend verification contract - LIGHT/HEAVY triage, success criteria registered up front, failing-then-passing artifacts per criterion, and a completion gate that refuses justsend_work_complete while anything is unproven. Use when a task must be provably done rather than plausibly done. Triggers: verify, prove it works, evidence-based, ship it verified, contract, failing-first, ultrawork."
---

# JustSend verification contract

Deliver exactly what was asked, working end to end, proven by captured evidence.
A green test suite means a unit-level contract holds — it never proves the
user-facing behavior works. The task is done when every criterion is `surfaced`
with its artifact on disk, and not before.

The rules below are not advice. `justsend_contract_set`, `justsend_evidence`, and
a `PreToolUse` hook on `justsend_work_complete` enforce them in code: GREEN
without a captured RED is refused, and completion is refused while a criterion is
unproven. Write the contract expecting to be held to it.

## Where the state lives

| What | Where | Read it with |
|---|---|---|
| Criteria, evidence, status | `.justsend/contract/<task_key>.json` | `justsend_contract_status` |
| Decisions, dead ends, blockers | the work record for the same `task_key` | `justsend_context` |

One `task_key` spans both. Choose it once — a short kebab slug of the objective
(`fix-login-race`, `settings-scroll-jitter`) — and reuse it in every call. The
record is the human-readable layer that syncs to the user's devices; the contract
file is the machine-checked one. Never duplicate contract state in prose.

## 1. Resume before you start

Run `justsend_contract_status` and `justsend_search` first. If this task already
has a contract or a record, continue it — `justsend_contract_set` and
`justsend_work_start` are both find-or-update on `task_key`, so re-registering is
safe and never forks a second one.

A compaction hook re-injects the contract summary, so after any context loss call
`justsend_contract_status` and resume from the unproven list instead of guessing
what you had already proven.

## 2. Triage the tier once

Judge by what this session will itself edit or execute. Delegated work is payload
and does not raise your tier.

- **LIGHT** (default) — a known pattern with no open design decisions: a one-spot
  bug fix, an endpoint following an existing pattern, a validation rule, a query
  tweak, copy or constants.
- **HEAVY** — any one of these forces it: a new module, layer, domain model, or
  abstraction; auth, security, session, or permission code; building or changing
  an external integration; a schema change or migration; concurrency, transaction
  boundaries, or cache invalidation; a refactor crossing domain boundaries; or
  the user asked for care ("carefully", "thoroughly", "design first").

When unsure, take HEAVY. If a HEAVY fact surfaces mid-task, upgrade immediately
and redo whatever LIGHT skipped. Never downgrade.

## 3. Register the contract

`justsend_contract_set(task_key, objective, tier, criteria)`. Each criterion is
`{id?, scenario, observable, proof?}`:

- **`scenario`** — the literal command, page action, or payload. Not a topic:
  `curl -XPOST /api/login -d '{"pw":""}'`, not "test empty password".
- **`observable`** — the single binary observation that decides PASS or FAIL.
  `HTTP 400 with code=EMPTY_PASSWORD`, not "handles it correctly".
- **`proof`** — `red-green` (default, failing-first enforced) or `review` for
  prose with no machine consumer. `review` criteria go straight to `surface`.

LIGHT takes 1–2 criteria: the happy path and the riskiest edge. HEAVY takes 3 or
more: the happy path, the edges that actually break (boundary, empty, malformed,
concurrent), and one adjacent-surface regression named by file and function.

Open the work record in the same breath: `justsend_work_start(task_key, task)`.

## 4. Prove each criterion, failing first

For every `red-green` criterion, in this order:

1. **RED** — run the scenario *before* the fix, capture the output to a file, then
   `justsend_evidence(kind: "red", artifact_path: ...)`. If it already passes, the
   criterion is wrong or the bug is elsewhere; fix the criterion, do not fake the
   red.
2. **Implement.** Fix the cause, not the symptom.
3. **GREEN** — re-run the identical scenario, capture, then
   `justsend_evidence(kind: "green", artifact_path: ...)`. Rejected if no RED
   exists: evidence produced after the working code proves nothing about the bug.
4. **SURFACE** — exercise the behavior the way a user reaches it (the endpoint,
   the screen, the CLI — not the unit test) and capture that.
   `justsend_evidence(kind: "surface", artifact_path: ...)`.

Artifacts must be real, non-empty files under the working directory, the temp
directory, or `~/.justsend`. Symlinks are resolved before the check, so pointing
at a file this run did not produce fails.

Record `cleanup` receipts for scaffolding you removed — a note is enough.

Leave a `justsend_work_note` at each real decision and each dead end. A log with
only successes sends the next reader into the same trap.

## 5. Complete

`justsend_work_complete(task_key, summary)` — the summary carries the outcome, how
it was verified, and what is still open. The gate refuses the call while any
criterion is unproven and names which ones.

Two honest ways past a gate you cannot satisfy:

- `justsend_work_note(blocker: true)` when a human has to act. This closes the
  record and disarms the gate; say what is needed.
- `justsend_contract_set(enforce: false)` when the work is genuinely tracked
  rather than gated. State that you did it and why.

Never satisfy a gate by weakening a criterion after the fact, and never claim an
artifact you did not capture.

## Delegation

Contracts and completion belong to the orchestrator. A delegated agent receives
`task_key` and `item_id` and appends with `justsend_progress_note` only — it never
registers criteria, records evidence, completes, or retracts.

## Tool routing

| You need to | Call |
|---|---|
| Register or update the criteria | `justsend_contract_set` |
| Record RED / GREEN / SURFACE / cleanup | `justsend_evidence` |
| See what is still unproven | `justsend_contract_status` |
| Open or resume the work record | `justsend_work_start` |
| Log a decision, a dead end, or a blocker | `justsend_work_note` |
| Finish (gated) | `justsend_work_complete` |
| Append as a delegated agent | `justsend_progress_note` |
| Recover state after compaction | `justsend_contract_status`, `justsend_context` |
