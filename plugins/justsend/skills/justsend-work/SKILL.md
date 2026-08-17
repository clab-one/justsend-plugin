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
- **Read before you write.** Run `justsend_list_records` with this repo's tag, or
  `justsend_search`, or `justsend_get_record` with `work_id`, before starting. If
  a record for this task exists, continue it instead of opening a parallel one.
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
| Undo a record you created wrongly | `justsend_work_retract` (`task_key`, `reason`) |
| Append to a record your parent owns | `justsend_progress_note` (`task_key`, `item_id`, `note`) |
| Pick up where you left off | `justsend_context` (`task_key`, `limit`) |
| Find out whether this task already has a record | `justsend_list_records` (`tag`), `justsend_search`, `justsend_get_record` (`work_id` or `id`) |
| Survey what exists | `justsend_list_records`, `justsend_count_records`, `justsend_list_notes`, `justsend_list_tags`, `justsend_list_states`, `justsend_list_folders` |
| Check which account and database you are reading | `justsend_me` |

Ask `justsend_me` first when a list comes back empty: an empty library and
"reading a different account" look identical from the outside.

## Writes are queued, not immediate

The MCP server reads the library directly but never writes to it. Every write is
queued as an intent and applied by the JustSend app, which then syncs it. Two
consequences worth stating to the user rather than debugging:

- A record you just created appears once the app applies the intent. If JustSend
  is not running, the queue waits for the next launch. Nothing is lost — every
  intent carries an idempotency key.
- `Settings → Agent access → Delivery status` is where a queued or failed intent
  is visible.

## Status is a tag, not a state machine

The `status` column belongs to the user, who sets it in the app; every
agent-created record reads `pending`. Asking
`justsend_list_records(status: "done")` therefore returns nothing, however many
records you completed. What your calls write is tags: `status:in-progress` on
start, `status:done` on completion — and they accumulate, so a finished record
still carries `status:in-progress`.

Two consequences worth stating instead of debugging:

- To find what you finished, filter `tag: "status:done"`, never `status: "done"`.
- Do not treat `tag: "status:in-progress"` as "still open" — it includes
  everything you ever started. The authoritative open list is the one the plugin
  hook keeps per working directory, which is what the session-start and
  prompt-submit reminders read.

## What this skill does not do

It does not delete or rewrite the user's own content: there is no tool for it,
and `justsend_work_retract` reaches only records that carry your own anchor.
Never work around that by editing the database directly.
