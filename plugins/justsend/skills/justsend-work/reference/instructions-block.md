## JustSend work records

Substantive work is tracked in JustSend through the `justsend` MCP server: code,
config, infrastructure, and investigations that produce a deliverable. Questions
and one-off lookups are not tracked.

- **One record per task, keyed by `task_key`.** Choose it once at the start
  (kebab-case, e.g. `settings-scroll-jitter`) and reuse it in every later call.
  `justsend_work_start` is find-or-create on that key, so calling it again is
  safe and never opens a second record.
- **Always bind the record to its repository.** Pass `project` with the repository
  name (the working-directory basename) on `justsend_work_start`. It becomes a
  tag, and that tag is the only way to ask "what work exists for this repo" later.
  Pass `work_id` instead when the task carries an issue number (e.g.
  `IOSPROD-202`); the project tag is then derived from it.
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
- **`status` is a tag, not a state machine.** Every agent-created record reads
  `pending`; your calls write `status:in-progress` and `status:done` as tags, and
  they accumulate. Filter `tag: "status:done"`, never `status: "done"`.
- **When the work has to be provably done, register a contract.**
  `justsend_contract_set` takes the success criteria, `justsend_evidence` records
  the failing-then-passing artifact for each, and `justsend_work_complete` is
  refused while any criterion is unproven. See the `justsend-verify` skill.
