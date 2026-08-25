# JUSTSEND VERIFY — LOOP

Execute until every criterion is `surfaced` with its artifact on disk and, for a
`red-green` criterion, its teardown receipt recorded. That is the whole exit
condition, and it is the one the gate checks. The contract from `SKILL.md` binds:
tier, criteria, and single-owner contract transitions.

## The loop, per criterion

Batch independent reads and searches within a step. Never parallelize RED and GREEN
of the same criterion — the order is the proof.

1. **PICK** — mark the todo `in_progress`.
2. **PIN + RED** — if you are touching existing behavior, first pin it with a test
   that passes on the unchanged code, so you can tell your change from a
   pre-existing break. Then capture the failing proof through the cheapest faithful
   channel: a unit test where a seam exists, an integration test where the behavior
   lives in wiring, or the criterion's real scenario captured failing when there is
   no seam. It must fail for the RIGHT reason — a syntax or import error is not a
   RED. Save the output to a file, then
   `justsend_evidence(kind: "red", artifact_path: ...)`. No production code yet.
3. **GREEN** — write the smallest change that flips RED to GREEN. Re-run, save,
   `justsend_evidence(kind: "green", artifact_path: ...)`. The tool refuses GREEN
   with no prior RED, so the order is enforced in code, not by discipline. If GREEN
   is far larger than the criterion implies, the proof was too coarse — split it.
4. **SURFACE** — exercise the behavior the way a user reaches it, yourself, and
   capture that. `justsend_evidence(kind: "surface", artifact_path: ...)`.
5. **CLEAN** — tear down everything this criterion's QA spawned, then
   `justsend_evidence(kind: "cleanup", note: ...)`.
6. **VERIFY** — diagnostics clean on changed files; related tests green with
   nothing newly skipped.
7. **CLOSE** — mark the todo done. Record any non-obvious choice as a
   `justsend_work_note` — what was decided on purpose, versus what merely happened.
   Re-run every criterion's scenario after each increment.

## Surface channels

Prove it through the channel that actually exercises the surface, and keep the
artifact. `--dry-run`, "should work", and "looks correct" are not evidence.

| Surface | How | Artifact |
|---|---|---|
| HTTP endpoint | `curl -i` | status line + headers + body |
| Service or TUI | run it on a real pty | boot log + the driven interaction |
| Web page | drive a real browser | action log + screenshot |
| Desktop or GUI app | drive the running app | action log + screenshot |
| CLI or data-shaped | run it | stdout, a DB-state diff, or a parsed dump |

Name the exact invocation up front — the literal command with concrete inputs — and
the single binary observable that decides PASS or FAIL.

## Prose targets have no seam

For a prompt, a skill file, a rule, or a document, the wording is not behavior.
Never pin sentences, phrase presence, or word counts: that is pretend-coverage that
breaks on every edit while proving nothing. Pin only a machine-consumed value — a
parsed frontmatter field, a sentinel a hook greps, a JSON sample through its real
validator — or one equality between two shipped copies. A pure-prose change with no
machine consumer gets `proof: "review"` and ships on review plus reading it.

## Cleanup receipts, paired and never skipped

The moment QA spawns a resource, register its teardown as its own todo. Before the
criterion closes, tear it down and record the receipt:

- process IDs → kill, then confirm the signal fails
- browser contexts → close them
- containers → remove; bound ports → confirm nothing listens
- temp files → remove the paths you created; unset QA-only env vars

This one is enforced. A `red-green` criterion that reached `surfaced` with no
receipt blocks completion and the end of the turn, and the gate names it. A
criterion that spawned nothing costs one call to say so — the assertion is the
point, not the cleanup. `review` criteria are exempt: a judgement over what was
read has no teardown to assert.

## Fix-list intake

Review runs read-only and never edits. Every fix lands here.

1. Fold each item into the todo list, keeping the reviewer's numbering, severity,
   and `file:line`.
2. Fix each through the loop above — a behavior fix earns its own
   RED→GREEN→SURFACE; a code-quality fix earns diagnostics-clean plus green tests.
3. Never argue a finding away silently. Fix it, or record a one-line rebuttal with
   evidence for the reviewer to re-judge.
4. When the list is empty, return to `review.md`. If an item is genuinely stuck,
   say exactly where: what was tried, what is missing.

**Next:** when every criterion is proven, read `review.md`.
