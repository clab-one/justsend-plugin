# JUSTSEND VERIFY — PLAN

Load this only when open design decisions remain: unclear module boundaries,
several viable decompositions, or a multi-file build whose dependency order is not
obvious. A known procedure, however many steps, does not need a plan phase — plan
in the work record and go to `loop.md`.

The contract from `SKILL.md` still binds: tier, criteria already registered via
`justsend_contract_set`, and single-owner contract transitions.

## Step 1 — Discovery, in parallel

Never guess from memory. Locate with the right tool and re-read before you claim or
change anything. Fire independent lookups in one action; serialize only when one
output strictly feeds the next.

- Symbols — definition, references, rename impact, diagnostics → the language
  server, not text search. A text rename silently drops callsites.
- Structural shapes and codemods → an AST tool. Regex on syntax is a bug waiting
  for the second call site.
- Plain-text lookup, configs, docs → grep and glob.
- Unfamiliar layout → map the relevant files and boundaries before editing.
- External API or library behavior → read the source or the docs, not memory.

Record every non-obvious fact with a `file:line` reference in a
`justsend_work_note`. That note is what a later reader has instead of your context.

## Step 2 — Adversarial critique (HEAVY, or a genuinely contested design)

Pressure-test the design before committing to it. Skip it entirely for LIGHT.

Review the design against four lenses, citing `file:line` evidence for every
finding:

- **Scope** — reject over-engineering, scope creep, and premature abstraction.
- **Correctness** — identify missed edge cases and blast radius.
- **Evidence** — reject claims that lack a source citation.
- **Architecture** — identify leaky abstractions and hidden coupling while keeping
  the simplest design that fits.

Keep only findings supported by evidence. Sort them into hard constraints,
decisions, risks with mitigations, and open questions.

## Step 3 — Settle the order before writing code

Produce the executable plan: one unit per atomic change, each carrying its own
verification, in dependency order. Every open question becomes a gate the user
answers before the units that depend on it — not an assumption you make for them.

For HEAVY work this is a hard boundary: constraints, decomposition, dependency
order, and per-unit verification are all settled before production edits start. Do
not interleave planning with editing. Every unit's success criteria must be
checkable against the six review aspects in `review.md`, because that is what will
judge it — a unit whose criteria cannot be judged that way is under-specified.
Tighten it now, while it is cheap.

## Step 4 — Record and hand off

1. Fold the plan into the todo list: one item per unit, an edit plus its
   verification.
2. `justsend_work_note(task_key, note)` with the plan summary and the decisions
   behind it. The contract is already on record from Phase 1; this is the prose a
   human reads.

**Next:** read `loop.md` and begin execution.
