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

## Six shapes of story

Pick by what the reader must learn, then draw the smallest version of it.

| Type | Use when | Convention |
|---|---|---|
| **흐름** flow | A decision decides the outcome | Top→down. Oval start/end, rect step, diamond decision (≤3 exits). Label every branch |
| **단계** pipeline | Order matters, no branching | Left→right or top→down. Rect steps, one arrow each, chips for what enters and leaves |
| **상태** state | The same thing is in one of several states | Rounded rects, labelled transitions, the terminal state last |
| **구조** structure | Parts and who calls whom | Boxes grouped by zone, arrows for calls. Dashed for optional or async |
| **순서** sequence | Messages between actors over time | Actors across the top, lifelines down, messages as horizontal arrows in time order |
| **비교** comparison | Two axes place the options | Two axes, quiet quadrant labels, ≤12 items, the focal item in accent |

Above nine nodes it is two diagrams. Split it: overview first, detail second.

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

Start from this skeleton. The eyebrow and the `<h1>` are wrapper: they help you
read the draft in a browser and the bake drops them.

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
  <svg viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg"
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
plugins/justsend/scripts/hero-check.py  draft.html          # rules 1-10, no deps
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

The taxonomy, the connector rules and the accessible-SVG contract in this file are
adapted from **Diagram Design** by Cathryn Lavery (MIT), restructured for one
purpose: a single record image, one fixed skin, no profile resolution. Upstream
ships 39 types, client profiles, motion, importers and a gallery; none of that is
here. Full license text: `THIRD_PARTY_LICENSES.md`.
