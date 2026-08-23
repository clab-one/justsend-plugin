# JUSTSEND VERIFY — REVIEW & COMPLETE

The final phase. **Completion is declared only here.** The contract from `SKILL.md`
binds: tier, criteria, orchestrator-only ownership.

## Step 1 — Gate

`justsend_contract_status` — confirm every criterion is `surfaced` with its artifact
and its cleanup receipt. If any is unproven, go back to `loop.md`; do not paper over
it here. `justsend_work_complete` refuses to close while a criterion lacks evidence,
and the session-stop hook refuses a quiet stop for the same reason, so there is
nothing to gain by trying.

Re-run each criterion's scenario once more and state the result inline with the
artifact path.

## Step 2 — Review

- **HEAVY** → dispatch an independent read-only review. Do not self-certify HEAVY
  work; you cannot see the assumption you made twice.
- **LIGHT** → self-review, walking the same six aspects against each criterion, its
  evidence, and the diff read from the user's perspective. Confirm every changed
  line traces back to the request.

### The six aspects, and what is not a finding

A reviewer verifies exactly these, never edits code, and never widens the scope:

1. **Requirements completeness** — every asked-for deliverable exists; no silent
   scope shrink; nothing extra smuggled in. Scope the user deferred, recorded as
   such, is not a finding.
2. **Logical correctness** — the code does what the criteria claim; control and data
   flow hold under scrutiny. Behavior inherited unchanged from the surrounding code
   is not a finding of this diff.
3. **Edge cases** — boundary, empty, malformed, concurrent, and failing inputs
   behave sanely. A speculative case with no reachable input path is not a finding.
4. **Code quality** — dead code, leftover scaffolding, duplicated conventions,
   naming, the next reader. Pre-existing debt outside this diff is not a finding.
5. **Test coverage** — each changed contract is defended by a test that would fail
   on a plausible bug. Absence of tests for unchanged contracts is not a finding.
6. **Execution results** — the captured RED, GREEN and SURFACE artifacts are real,
   recent, and match the claims; re-run what is cheap to re-run.

### Fix-list protocol

1. Findings come back as a **numbered list**: aspect violated, severity,
   `file:line`, expected versus actual. No prose verdict without items, no edits.
2. Fix them in the main thread — `loop.md` § Fix-list intake.
3. Re-review the same scope against the updated diff plus the previous list.
4. Repeat until the review passes on all six aspects — or an item is genuinely
   stuck, in which case stop and report the item, what was tried, and what is
   missing. Never declare done with an open fix list.

For a `proof: "review"` criterion, save the verdict to a file and record it with
`justsend_evidence(kind: "surface", artifact_path: ...)`.

## Step 3 — Clean cutover

- Remove scaffolding, dead code, debug prints, and temporary shims this work
  introduced. Migrate every caller; leave no aliases or deprecated paths.
- Diagnostics clean on changed files; related tests green with nothing newly
  skipped.
- If the repo has a changelog, the new entry answers what changed, why it matters,
  and how to use it. Fewer than two of the three answered means rewrite it. Edit it
  in place; never regenerate the file.

## Step 4 — Close the record

`justsend_work_complete(task_key, summary)` appends the final audit note and closes
the task. `summary` states what changed, how it was verified, what failed, and what
is still open. The structured start body remains the readable brief; do not paste
raw logs into it. The tool re-checks the contract and refuses while anything is
unproven.

Two honest ways past a gate you genuinely cannot satisfy, both of which say so out
loud:

- `justsend_work_note(blocker: true)` when a human has to act — stamps
  `blocked_at`, which stands the completion gate and the Stop hook down and drops
  the record from the open-record reminder. It is not a close: the next
  `justsend_evidence` clears it and re-arms, and `justsend_contract_status` keeps
  reporting the contract with a `Blocked since` line. Say what is needed.
- `justsend_contract_set(enforce: false)` when the work is tracked rather than
  gated. State that you did it and why.

`justsend_work_status(task_key, "backlog")` is not a third way out. It files the
record for later without writing a note, which is the right call when the user
defers the work — but it closes nothing, proves nothing, and leaves the gate
exactly where it was. Reaching for it instead of one of the two exits above turns
an unfinished task into a silently parked one.

Never weaken a criterion after the fact to make a gate pass, and never claim an
artifact you did not capture.

## Done means

- Every requested deliverable is complete; no partial work presented as finished.
- Every affected artifact — callsites, tests, docs — is updated or intentionally
  left alone.
- The user-facing behavior is proven by captured evidence, not by a green suite.
- The work record is closed with a verification summary a human can act on.
