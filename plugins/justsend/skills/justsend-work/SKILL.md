---
name: justsend-work
description: Track substantive work in JustSend work records - open one record per task_key, append progress notes that carry decisions and dead ends, close with verified evidence. Use when starting, resuming, reporting on, or finishing a task that produces a deliverable.
---

# JustSend work records

A work record is a memo in the user's own JustSend library, so the user reads and
edits it in the app like any other note, and it syncs to their phone. Notes
accumulate under it in time order. That is the whole storage model — there is no
board, no sprint, and no separate agent log.

## JustSend work records

Substantive work is tracked in JustSend through the `justsend` MCP server: code,
config, infrastructure, and investigations that produce a deliverable. Questions
and one-off lookups are not tracked.

- **One record per task, keyed by `task_key`.** Choose it once at the start
  (kebab-case, e.g. `settings-scroll-jitter`) and reuse it in every later call.
  `justsend_work_start` is find-or-create on that key, so calling it again is
  safe and never opens a second record.
- **Always bind the record to its repository.** Pass `project` with the
  repository name (the working-directory basename, e.g. `mac-prod`) on
  `justsend_work_start`. It becomes a tag, and that tag is the only way to ask
  "what work exists for this repo" later — `justsend_list_records(tag: "mac-prod")`.
  A record created without it is findable by full-text search alone. Pass
  `work_id` instead when the task carries an issue number (e.g. `IOSPROD-202`):
  the number goes to the front of the title and the project tag is derived from
  it, so `work_id` and `project` are alternatives, not both.
- **Read before you write.** Run `justsend_list_records` with this repo's tag
  and `including_agent: true` (see "Reads exclude your own records by
  default" below), or `justsend_search` with `including_agent: true`, or
  `justsend_get_record` with `work_id` (unaffected by that default). If a
  record for this task exists, continue it instead of opening a parallel one.
- **Resume from the record, not from memory.** After a break or a context
  compaction, `justsend_context` returns the compact current state.
- **Notes carry what a diff cannot.** Use `justsend_work_note` for progress,
  decisions and the reason behind them, and dead ends. Write the failed attempts
  down: a log that records only successes sends the next reader into the same
  trap. Set `blocker: true` when you are stopping and a human has to act.
- **Close with evidence.** `justsend_work_complete` takes the outcome, how it was
  verified — the command, the screen, the trace — and what is still open. A
  summary with no verification is not a summary.
- **Delegated work appends; it does not close.** A subagent receives `task_key`
  and `item_id` from its parent and uses `justsend_progress_note` only. Starting,
  completing, and retracting a record belong to the parent.
- **`justsend_work_retract` is for a record you created wrongly.** It moves the
  record to the trash, recoverable for 30 days, and frees the `task_key`. It is
  not a way to close finished work.
- **Never put a secret in a note.** Tokens, passwords, keys, and private URLs
  stay out of titles, notes, and summaries; pass them through the environment.
  Records sync to the user's other devices.
- **A denial is a setting, not a bug.** Reading and appending are separate
  toggles in JustSend → Settings → Agent access, and every call is audited
  server-side. If a tool answers "access is disabled", name the toggle the user
  has to turn on instead of retrying.

## Tool routing

| You need to | Call |
|---|---|
| Open or reopen the record for this task | `justsend_work_start` (`task_key`, `task`, plus `project` for the repo — or `work_id` when there is an issue number) |
| Add progress, a decision, a dead end, or a blocker | `justsend_work_note` (`task_key`, `note`, `blocker`) |
| Finish the task | `justsend_work_complete` (`task_key`, `summary`) |
| File work you are not starting yet, or pick it up later | `justsend_work_status` (`task_key`, `status`) — `backlog`, `todo`, `in-progress`, `done`, `canceled`, and it writes no note |
| Undo a record you created wrongly | `justsend_work_retract` (`task_key`, `reason`) |
| Append to a record your parent owns | `justsend_progress_note` (`task_key`, `item_id`, `note`) |
| Pick up where you left off | `justsend_context` (`task_key`, `limit`) |
| Find out whether this task already has a record | `justsend_list_records` (`tag`, `including_agent: true`), `justsend_search` (`including_agent: true`), `justsend_get_record` (`work_id` or `id`) |
| Survey what exists | `justsend_list_records`, `justsend_count_records`, `justsend_list_notes`, `justsend_list_tags`, `justsend_list_states`, `justsend_list_folders` |
| Check which account and database you are reading | `justsend_me` |
| Find out why a write has not appeared | `justsend_health` — the account, the two database paths, `queue` counts (`pending`, `retrying`, `blocked`, `failed`) and `last_applied_at` |

## Reads exclude your own records by default

`justsend_list_records` and `justsend_search` silently drop every record
whose `category` is `agent` unless you pass `including_agent: true` — the
same rule the app's own list uses. A plain `justsend_list_records(tag:
"IOSPROD")` call returns `[]` even when hundreds of agent-created records
carry that tag, and an empty list reads as "no prior work" when it is
actually "wrong flag."

- Checking for prior work on a project: `justsend_list_records(tag:
  <PROJECT>, including_agent: true)`, or `category: "agent"` to see only the
  agent's own records.
- `justsend_get_record` looked up by `work_id` is NOT affected — it has no
  agent filter, so `justsend_get_record(work_id: "IOSPROD-202")` finds your
  own numbered record without the flag.
- To pick the next number for a numbered project (`work_id` continuing a
  sequence like `IOSPROD-213`), list the project's tag with
  `including_agent: true` and take the highest existing suffix — there is no
  separate "next number" tool, and skipping `including_agent` makes every
  project look brand new.

Ask `justsend_me` first when a list comes back empty: an empty library and
"reading a different account" look identical from the outside. When it is a
record *you wrote* that is missing, ask `justsend_health` instead — it answers
the account question too, and adds the one thing `justsend_me` cannot: whether
the app is applying at all. A non-zero `queue.pending` with a stale
`last_applied_at` means the write is waiting, not lost.

## Writes are queued, but identity is not

The MCP server reads the library directly but never writes to it. Every write is
queued as an intent and applied by the JustSend app, which then syncs it.
Nothing is lost while the app is closed — every intent carries an idempotency
key, and the queue drains at the next launch.

What you do **not** have to wait for is the record itself.
`justsend_work_start` issues `item_id` and returns it immediately, so notes and
the completion can be written straight after it, with the app still down. Do not
sleep, poll, or re-call `justsend_work_start` to "check whether it landed": the
id you were handed is the id the app will materialise.

The queue state that comes back names who has to act:

- `pending` — waiting for the app. Normal.
- `retrying` — a transient failure, retried with backoff. The ordinary case is
  the app running signed out, so it cannot yet tell which account the record
  belongs to; signing in drains it.
- `blocked` — needs the user. Say so instead of retrying.
- `failed` — permanent. The note body is still in the intent, so report it
  rather than rewriting the work from memory.

`Settings → Agent access → Delivery status` shows the same thing in the app, and
`justsend_health` returns the counts plus `last_applied_at`.

## Two status axes, and only one of them is yours

A record carries two unrelated notions of status, and asking the wrong one
returns an empty list that reads like missing work.

- `status` is the user's own memo status column, set in the app. Every
  agent-created record reads `pending` there, so
  `justsend_list_records(status: "done")` returns nothing however many records
  you completed. Leave this axis alone.
- `work_status` is the axis your calls write, as a `status:` tag —
  `backlog`, `todo`, `in-progress`, `done`, `canceled`. Filter it with
  `justsend_list_records(work_status: "done")`, and count it with
  `justsend_list_states`. It tolerates the spelling drift the phone accepts
  (`status:completed`, `status:in_progress`), so you do not have to guess the
  exact tag text.

Each stamp **replaces** the previous one rather than piling up: `work_start`
writes `status:in-progress`, `work_complete` writes `status:done`, and the old
tag is removed as the new one lands. So `work_status: "in-progress"` is a
truthful open list, not a list of everything you ever started, and
`justsend_work_status` is how you move a record between states without writing a
note — file it to `backlog` when you are deferring, back to `in-progress` when
you resume.

Closing still belongs to `justsend_work_complete` or `justsend_work_cancel`,
not to `justsend_work_status`: those two write the closing note that makes the
record readable months later. A record whose status says `done` with no note
saying how is a record nobody can use.

For "what is open in this directory", the plugin hook's own per-directory list
is still the authority — that is what the session-start and prompt-submit
reminders read.

## What this skill does not do

It does not delete or rewrite the user's own content: there is no tool for it,
and `justsend_work_retract` reaches only records that carry your own anchor.
Never work around that by editing the database directly.
