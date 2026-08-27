# The record's diagram

One record carries one diagram: the mechanism of this task, drawn once, before the
first `justsend_work_start`. It is not a page you typeset and not a screenshot of
your terminal. Nine nodes at most. If a table or a sentence carries it better, the
honest answer is not to draw.

Everything needed is in this repository — the tokens below, `scripts/hero-check.py`,
and `scripts/hero-bake.sh`. There is no profile to resolve, no marker to read, no
skin to pull from a website: a record drawn on one machine is the same drawing on
every other one.

## The skin — these values, not your taste

| Role | Value | Where it goes |
|---|---|---|
| `paper` | `#ffffff` | Page background, and the SVG's first rect |
| `ink` | `#121212` | Node names, primary strokes |
| `muted` | `#363636` | Arrows, legend text |
| `soft` | `#666666` | Technical sublabels, eyebrow |
| `rule` | `#e2e2e2` | Hairlines, the legend separator |
| `accent` | `#d0021b` | The failure, the refusal, the dead end |
| `accent-tint` | `rgba(208,2,27,0.06)` | Fill behind an accent-stroked box |
| fills | `rgba(18,18,18,0.03)` `rgba(18,18,18,0.05)` | Start/end ovals, stores |

```css
:root{
  --serif: Charter, "Times New Roman", AppleMyungjo, "Hiragino Mincho ProN", "Songti SC", serif;
  --sans: "Helvetica Neue", Arial, "Apple SD Gothic Neo", "Hiragino Sans", "PingFang SC", sans-serif;
  --mono: "SF Mono", Menlo, ui-monospace, monospace;
}
```

Three families, all local. **Never load a remote font.** A page waiting on
`fonts.googleapis.com` re-flows Hangul into a fallback, the glyph widths change, and
the geometry moves — the check rejects any remote reference for that reason.

Labels are Korean; identifiers, paths, commands, numbers and hashes are `--mono`.
Korean has no uppercase, so track an eyebrow (`0.18em`) but never
`text-transform: uppercase`. Dates read `2026. 8. 26.`, sizes `1200×1700`, hashes
seven characters.

**The red is a verdict, not decoration.** One or two elements per drawing, and they
are the thing that failed, was refused, or ran out of road. A drawing with four red
boxes has decided nothing. A drawing with none is fine — not every mechanism has a
dead end.

No dark variant. No dot pattern. No shadows. No secondary container behind the
figure. The record image is one light page because it hangs in a library beside the
others.

## Ten shapes of story

**Ask what the reader must learn, then take that template.** Every one of the ten
is a real page with coordinates in `plugins/justsend/templates/hero/<key>.html`:
open it, keep the frame, replace the labels. Writing coordinates from scratch is
how a record ends up as a flowchart that was never the right shape.

| The reader must learn… | Type | Template |
|---|---|---|
| which condition decided the outcome | **흐름** flow | `flow.html` |
| what happens in what order, no branching | **단계** pipeline | `pipeline.html` |
| which of several states the thing is in | **상태** state | `state.html` |
| which parts exist and who calls whom | **구조** structure | `structure.html` |
| who said what to whom, in time order | **순서** sequence | `sequence.html` |
| where the options fall on two axes | **비교** comparison | `comparison.html` |
| that it comes back around until a condition holds | **루프** loop | `loop.html` |
| that the *gaps* between events are the point | **시간축** timeline | `timeline.html` |
| that the same flow splits by who performs it | **주체별 흐름** swimlane | `swimlane.html` |
| that one failure has several causes behind it | **원인 분해** cause | `cause.html` |

Above nine nodes it is two diagrams. Split it: overview first, detail second.

### What each type owes the reader

| Type | Convention |
|---|---|
| 흐름 | Top→down. Oval start/end, rect step, diamond decision (≤3 exits). Label every branch — an unlabelled fork decides nothing |
| 단계 | Left→right or top→down. Rect steps, one arrow each, chips for what enters and leaves |
| 상태 | Rounded rects, transitions carry the event that causes them, the terminal state last |
| 구조 | Boxes grouped by zone, arrows for calls. Dashed for optional or async |
| 순서 | Actors across the top, dashed lifelines down, messages as horizontal arrows in time order |
| 비교 | Two axes, quiet quadrant labels, ≤12 items, the focal item in accent |
| 루프 | Forward steps in a row, one returning path carrying the condition that sends it back. The return is accent when it is a failure |
| 시간축 | **Distance is proportional to elapsed time**, and the page states the scale (`하루 = 96px`). Equal spacing for unequal gaps makes this type a lie |
| 주체별 흐름 | Horizontal bands per actor, the actor's name at the left, a handoff crossing a band with one elbow. Each divider is a full-width hairline carrying `class="lane"` — the legend strip is a full-width hairline too, so lanes are declared, not guessed |
| 원인 분해 | A spine to the effect, **right-angled** ribs for cause groups. Ours is a comb, not a fish: rule 2 rejects a slanted line everywhere, so 60° bones are not available here |

## What the check judges, and what it cannot

Declare the type on the svg — `<svg data-type="loop">` — and the check reads it
with no flag, so `hero-bake.sh` enforces it too. `--type <key>` asserts a type
from the outside and contradicting the page is an error.

Five of the ten are named after an element without which the drawing is not that
type, and the check looks for exactly that element and nothing more:

| Type | The element it looks for |
|---|---|
| 순서 | two or more dashed vertical lifelines |
| 시간축 | one arrow-headed time axis across 70% of the page |
| 주체별 흐름 | two or more full-width `<line class="lane">` hairlines |
| 원인 분해 | one spine, and two or more ribs meeting it |
| 루프 | one arrow-headed `<path>` that ends back before it started |

The other five — 흐름 · 단계 · 상태 · 구조 · 비교 — are **declaration only.** A flow
can be linear with no diamond, a state machine can have square corners, a
comparison can carry one axis if the second is implied. A check that guessed
validity from the shape inventory would reject correct drawings, so it does not
guess.

**Nothing here judges meaning.** The check cannot tell a truthful 구조 from a
wrong one, cannot see whether your timeline's pixels match your dates, and cannot
know if 비교 was the right choice. Those stay with you, and the legend is where you
promise them to the reader.

## The rules that keep it readable

These are not style preferences — each one exists because breaking it makes a
drawing that cannot be traced.

1. **Arrows before boxes.** Z-order puts the lines behind the nodes, so a stroke
   never crosses a node's face.
2. **No diagonals.** A connector between nodes that share neither x nor y runs
   orthogonally with a quarter-arc elbow (`r=8`, `r=6` when tight). A slanted
   `<line>` is an automatic fail, and the check enforces it: every `<line>` has
   `x1==x2` or `y1==y2`.
3. **Every arrow label wears a mask, above the line.** An opaque `paper` rect
   behind the text, with a visible **6–10px gap** between the mask's edge and the
   stroke. A label sitting on its own arrow hides the connection it names. For a
   vertical segment, put the label beside the line with the same gap.
4. **No two connectors overlap.** Not a shared path, not parallel-on-top, not for a
   single segment. Two arrows on the same box edge get their own attach points,
   ≥12px apart. If you are stacking strokes, the layout is wrong or the diagram is
   over budget.
5. **A connector does not pass behind a box that is neither its source nor its
   destination.** Reroute. In the rare case where the intervening box is
   unavoidable, dash the stroke and put the label at the visible end.
6. **A label mask does not overlap a node drawn after it.** Nodes are painted last,
   so a mask that lands inside one is covered and the text renders as a fragment on
   the border. Place labels on segments that run through open canvas.
7. **Box geometry sits on a 4px grid.** Every rect `x`, `y`, `width`, `height`, and
   both `viewBox` dimensions divide by 4. Stroke widths, opacities and text
   baselines are exempt.
8. **The legend is a bottom strip**, after a hairline, never floating inside the
   figure — and it names every shape used and nothing else.
9. **The figure is an accessible image.** `role="img"`, `aria-labelledby` naming
   `<title>` then `<desc>`, `<title>` as the SVG's **first child**, and IDs prefixed
   for this drawing (`record-hero-title`, never bare `title`). `<desc>` is one
   sentence about what the drawing shows — what a reader gets without the image, not
   a shape-by-shape narration.
10. **Static, single file.** No `<script>`, no remote reference of any kind, no
    external image. The HTML is self-contained or it is not a record image.

## The page

Every template already carries this frame — copy the one for your type instead of
typing it out. It is here so you can read what the frame is made of. The eyebrow
and the `<h1>` are wrapper: they help you read the draft in a browser and the bake
drops them.

```html
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>…</title><style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{ /* the three stacks above */ }
  body{width:1200px;height:900px;overflow:hidden;font-family:var(--sans);
       background:#ffffff;color:#121212;padding:48px 40px;
       display:flex;flex-direction:column;
       -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:0.18em;color:#666666}
  h1{font-family:var(--serif);font-size:40px;font-weight:400;letter-spacing:-0.02em;
     line-height:1.15;margin:8px 0 16px}
  svg{width:100%;display:block}
  svg text{font-family:var(--sans)}
  svg text.mono{font-family:var(--mono)}
</style></head>
<body>
  <p class="eyebrow">흐름 · JUSTSEND 기록</p>
  <h1>이 기록의 제목</h1>
  <svg viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg" data-type="flow"
       role="img" aria-labelledby="record-hero-title record-hero-desc">
    <title id="record-hero-title">한 줄 이름</title>
    <desc id="record-hero-desc">이 그림이 무엇을 보여주는지 한 문장.</desc>
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#363636"/></marker>
      <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#d0021b"/></marker>
    </defs>
    <rect width="100%" height="100%" fill="#ffffff"/>
    <!-- arrows, then labels, then boxes, then the legend strip -->
  </svg>
</body>
</html>
```

Node names go in `--sans` at 12px/600. Technical sublabels go in `--mono` at 9px
with `class="mono"`. Arrow labels are `--mono` 8px, ≤14 characters.

## Check, then bake

```bash
plugins/justsend/templates/hero/loop.html                   # start here, not from zero
plugins/justsend/scripts/hero-check.py  draft.html          # rules 1-10 + declared type
plugins/justsend/scripts/hero-check.py  --type loop draft.html   # assert from outside
plugins/justsend/scripts/hero-bake.sh   draft.html out.png  # checks, then bakes
```

The bake keeps **the first `<svg>` only**, at `viewBox` × 2 — a 1000×640 viewBox
becomes a 2000×1280 PNG — on painted paper. The size decision was made when you
chose the viewBox; the bake only picks the multiplier. It re-runs the check first
and refuses to write a PNG for a page that fails, and it verifies the written
pixel size, so a clipped or mis-scaled image cannot reach a record.

Transparent PNGs are refused: the app shows this image on a dark background, and
transparent ink disappears there.

Pass the PNG to `justsend_work_start` as `image_path`. That is the only moment it
attaches — a resumed start returns `image_status: ignored_existing_record`.

## Attribution

The connector rules and the accessible-SVG contract in this file are adapted from
**Diagram Design** by Cathryn Lavery (MIT), restructured for one purpose: a single
record image, one fixed skin, no profile resolution. Full license text:
`THIRD_PARTY_LICENSES.md`.

Upstream ships 39 reference recipes — they are recipes, not switches on a
generator, and nothing here generates a drawing for you. Of those 39, seven are
numeric charts (bar, line, scatter, polar, radar, sankey, treemap) and four are
planning boards (gantt, kanban, story-map, journey): a record image carries a
mechanism, and numbers belong in the body's table. Twelve fold into 구조 and five
into 비교, because four files describing "boxes in zones with call arrows" are one
convention. What is deliberately still folded away: `tree` and `nested` are 구조
with a hierarchy, `er` and `db-schema` are 구조 with a data shape.

**One shape here departs from upstream.** Upstream `fishbone` requires 60° bones
off the spine; our rule 2 rejects a slanted `<line>` on every page, for every
type. So 원인 분해 is a comb with right-angled ribs — the same story inside our
rules — and it is not named `fishbone`, so nobody inherits the wrong expectation.
