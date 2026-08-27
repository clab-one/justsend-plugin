## JustSend work records

Substantive work is tracked in JustSend through the `justsend` MCP server: code,
config, infrastructure, and investigations that produce a deliverable. Questions
and one-off lookups are not tracked.

- **Validate every MCP call.** Before the first use of an MCP tool, read its
  current schema and include every required argument. `Invalid args` or a
  schema-validation error means the tool did not run and produced no evidence.
  Correct the payload and retry immediately; do not advance dependent research,
  plans, todos, or verification criteria until the corrected call succeeds.
- **One record per task, keyed by `task_key`.** Choose it once at the start
  (kebab-case, e.g. `settings-scroll-jitter`) and reuse it in every later call.
  `justsend_work_start` is find-or-create on that key, so calling it again is
  safe and never opens a second record. Pass separate `title` and start-time
  `body`: the body is the lede, scope, method and success criteria, not results.
  It returns `item_id` immediately; waiting or polling buys nothing.
- **Open the record with one diagram.** The representative image is a single
  diagram — the mechanism of this task, drawn once. The contract, the skin and the
  tools all ship in this plugin: read
  `skills/justsend-work/reference/hero-diagram.md`, ask what the reader must learn,
  and copy the template for that answer from `templates/hero/` — ten types are
  drawn already (`flow` `pipeline` `state` `structure` `sequence` `comparison`
  `loop` `timeline` `swimlane` `cause`), so keep the frame and replace the labels.
  Declare it with `<svg data-type="loop">`, then run
  `scripts/hero-check.py draft.html` and `scripts/hero-bake.sh draft.html out.png`. Eight colors (paper `#ffffff`, ink
  `#121212`, hairline `#e2e2e2`, one editorial red `#d0021b`), three local families
  (Charter → AppleMyungjo, Helvetica Neue → Apple SD Gothic Neo, SF Mono), Korean
  labels, and **no remote font** — a page waiting on a font CDN re-flows Hangul and
  the geometry moves. Nine nodes at most, and the red marks the failure, the
  refusal, the dead end, never decoration. The bake is the export contract: it
  checks first and writes nothing for a page that fails, keeps the first `<svg>`
  only at `viewBox` × 2 on painted paper, and deletes the image if the written
  pixels disagree. Draw it before the first `justsend_work_start` and pass it as
  `image_path`. A resumed start does not change the existing body or image, so
  creation is the one attachment chance. Notes are exempt.
- **Always bind the record to its repository under the project's own name.** Pass
  `project` as the repository directory uppercased with separators removed
  (`ios-prod` -> `IOSPROD`, `mac-prod` -> `MACPROD`) on `justsend_work_start`. That
  string is both the tag and the numbering axis: the server issues the next number
  against it, so `IOSPROD` continues the series at `IOSPROD-220`, while the raw
  directory name forks a second axis (`ios-prod-1`) that restarts the count and no
  saved folder on `IOSPROD` collects. Pass `work_id` instead when the task already
  carries an issue number (e.g. `IOSPROD-202`); the project tag is derived from it.
- **Read before you write.** Search for prior work with `justsend_search`, using a
  concise query derived from the objective, stable `task_key` or work id, and
  distinctive domain terms. Always pass `including_agent: true`; otherwise a plain
  call can return `[]` while matching agent work exists. Use `limit: 5`. When its
  schema advertises it, also pass `strategy: "resume"`; the server searches
  identity, current state, then history. Older servers get the same query and flags
  without `strategy`. `resolved_scope` and `match_source` identify the evidence source;
  user memo `status` is not agent `work_status`. Use `justsend_get_record(work_id:)`
  when the exact work id is known. Do not use a newest-first list as a substitute
  for relevance search. If a matching record exists, continue it instead of
  opening a parallel one. Reserve
  `justsend_list_records` for an explicit inventory by tag, status, kind, or
  newest-first order. Its `limit` is only the leading slice, never the whole
  library. State the search query or list filters and `limit` when reporting scope.
- **Treat failed writes as failed work.** In `justsend_health`, `pending`,
  `retrying`, and `blocked` describe the current queue; `failed` is cumulative
  terminal history, not pending work. A failed intent never retries and is never a
  healthy result. Report its returned error, fix the cause, and do not claim that
  intent succeeded. Report current queue health separately from cumulative
  failures.
- **Resume from the record, not from memory.** After a break or a context
  compaction, `justsend_context` returns the compact current state.
- **Notes carry what a diff cannot.** Use `justsend_work_note` for progress,
  decisions and the reason behind them, and dead ends. Write the failed attempts
  down: a log that records only successes sends the next reader into the same
  trap. Set `blocker: true` when you are stopping and a human has to act.
- **Close with evidence.** `justsend_work_complete` requires `summary`: outcome,
  verification, failures and what remains. It appends the final audit note; the
  structured start body and representative image remain unchanged.
- **Progress appends do not control lifecycle.** `justsend_progress_note` adds a
  note to an existing `task_key` and `item_id`; it never starts, completes, or
  retracts the record.
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
- **Two status axes.** `status` is the user's memo column and reads `pending` on
  every agent-created record — leave it alone. Your calls write the `work_status`
  axis (`backlog`, `todo`, `in-progress`, `done`, `canceled`), each stamp
  replacing the last, so filter `justsend_list_records(work_status: "done")`.
  `justsend_work_status` moves a record between those states without a note;
  closing still goes through `justsend_work_complete`.
- **When the work has to be provably done, register a contract.**
  `justsend_contract_set` takes the success criteria, `justsend_evidence` records
  the failing-then-passing artifact for each, and `justsend_work_complete` is
  refused while any criterion is unproven, and
  `justsend_contract_status(format: "report")` renders the result table to paste
  into the closing summary. See the `justsend-work` skill.
