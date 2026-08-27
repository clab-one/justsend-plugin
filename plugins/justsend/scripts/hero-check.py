#!/usr/bin/env python3
"""Check a record diagram before it becomes a record's image.

No third-party dependencies: this runs wherever an agent runs, and a check that
needs `pip install` is a check nobody runs. Every rule here is one that, when
broken, produces an image a reader cannot trace or a page whose geometry moves
between machines. See skills/justsend-work/reference/hero-diagram.md.

Adapted from the accessible-SVG and single-file checks of Diagram Design
(Cathryn Lavery, MIT); the skin, grid and palette rules are ours.
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

PAPER = "#ffffff"
PALETTE = {
    "#ffffff", "#121212", "#363636", "#666666", "#e2e2e2", "#d0021b",
    "rgba(208,2,27,0.06)", "rgba(18,18,18,0.02)", "rgba(18,18,18,0.03)",
    "rgba(18,18,18,0.05)", "rgba(18,18,18,0.20)", "rgba(18,18,18,0.30)",
    "transparent", "none", "url(#arrow)", "url(#arrow-accent)",
}
FONT_VARS = {"var(--sans)", "var(--mono)", "var(--serif)"}
GRID = 4
REMOTE = re.compile(r"""(?:https?:)?//""")
COLOR_ATTRS = ("fill", "stroke")
GEOMETRY_ATTRS = ("x", "y", "width", "height")


class Page(HTMLParser):
    """Collects only what the rules below judge."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.svg_depth = 0
        self.defs_depth = 0
        self.ovals: list[dict[str, str]] = []
        self.diamonds: list[dict[str, str]] = []
        self.paths: list[dict[str, str]] = []
        self.svg_count = 0
        self.first_svg_children: list[str] = []
        self.svg_attrs: dict[str, str] = {}
        self.title_text = ""
        self.desc_text = ""
        self.ids: list[str] = []
        self.in_title = False
        self.in_desc = False
        self.scripts = 0
        self.lines: list[dict[str, str]] = []
        self.rects: list[dict[str, str]] = []
        self.colors: list[tuple[str, str]] = []
        self.fonts: list[str] = []
        self.remote: list[str] = []
        self.writing_mode = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag == "svg":
            self.svg_count += 1
            self.svg_depth += 1
            if self.svg_count == 1:
                self.svg_attrs = a
            return
        if self.svg_depth == 1 and self.svg_count == 1:
            self.first_svg_children.append(tag)
        if tag == "defs":
            self.defs_depth += 1
        # A marker's polygon lives in <defs> and is arrowhead, not a decision node.
        figure = self.svg_depth > 0 and self.defs_depth == 0
        if figure and tag in ("ellipse", "circle"):
            self.ovals.append(a)
        if figure and tag == "polygon":
            self.diamonds.append(a)
        if figure and tag == "path":
            self.paths.append(a)
        if tag == "script":
            self.scripts += 1
        if tag == "title" and self.svg_depth:
            self.in_title = True
        if tag == "desc":
            self.in_desc = True
        if tag == "line":
            self.lines.append(a)
        if tag == "rect" and self.svg_depth:
            self.rects.append(a)
        if "id" in a:
            self.ids.append(a["id"])
        if "style" in a and "writing-mode" in a["style"]:
            self.writing_mode += 1
        if a.get("writing-mode"):
            self.writing_mode += 1
        for key in COLOR_ATTRS:
            if key in a and self.svg_depth:
                self.colors.append((key, a[key].strip()))
        if "font-family" in a:
            self.fonts.append(a["font-family"].strip())
        for key in ("src", "href", "xlink:href", "poster", "srcset"):
            if key in a and REMOTE.search(a[key]):
                self.remote.append(f"<{tag} {key}={a[key][:60]}>")

    def handle_endtag(self, tag: str) -> None:
        if tag == "svg":
            self.svg_depth = max(0, self.svg_depth - 1)
        if tag == "defs":
            self.defs_depth = max(0, self.defs_depth - 1)
        if tag == "title":
            self.in_title = False
        if tag == "desc":
            self.in_desc = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_text += data
        if self.in_desc:
            self.desc_text += data


HAIRLINE = "#e2e2e2"

# The ten story types. Five of them are named after an element without which the
# drawing is simply not that type — a sequence with no lifelines, a timeline with
# no axis. Those five are checkable. The other five are declaration only: a flow
# may be linear with no diamond, a state may have square corners, and a checker
# that guessed validity from the shape inventory would reject correct drawings.
DEFINING = ("sequence", "timeline", "swimlane", "cause", "loop")
DECLARATION_ONLY = ("flow", "pipeline", "state", "structure", "comparison")
TYPES = DEFINING + DECLARATION_ONLY


def num(value: str | None) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def segment(line: dict[str, str]) -> tuple[float, float, float, float]:
    return tuple(num(line.get(k)) or 0.0 for k in ("x1", "y1", "x2", "y2"))  # type: ignore[return-value]


def horizontal(line: dict[str, str]) -> bool:
    x1, y1, x2, y2 = segment(line)
    return y1 == y2 and x1 != x2


def vertical(line: dict[str, str]) -> bool:
    x1, y1, x2, y2 = segment(line)
    return x1 == x2 and y1 != y2


def span(line: dict[str, str]) -> float:
    x1, y1, x2, y2 = segment(line)
    return abs(x2 - x1) if horizontal(line) else abs(y2 - y1)


def headed(el: dict[str, str]) -> bool:
    return bool(el.get("marker-end", "").strip())


def touches(line: dict[str, str], y: float) -> bool:
    _, y1, _, y2 = segment(line)
    return min(y1, y2) - 4 <= y <= max(y1, y2) + 4


def path_returns(el: dict[str, str]) -> bool:
    """True when an arrow-headed path ends back before where it started."""
    if not headed(el):
        return False
    values = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", el.get("d", ""))]
    if len(values) < 4:
        return False
    return values[-2] < values[0] or values[-1] < values[1]


def defining_element(kind: str, page: Page, vb_w: float) -> list[str]:
    """Look for the one element the type is named after. Nothing else.

    This never infers validity from the shape inventory: it cannot tell a truthful
    `구조` from a wrong one, and it does not try. It answers one question — does
    the page contain the element without which the declared type is meaningless.
    """
    lines = page.lines
    if kind == "sequence":
        lifelines = [l for l in lines if vertical(l) and l.get("stroke-dasharray", "").strip()]
        if len(lifelines) < 2:
            return [f"sequence: needs two or more dashed vertical lifelines, found {len(lifelines)}"]
    elif kind == "timeline":
        axes = [l for l in lines if horizontal(l) and headed(l) and span(l) >= 0.7 * vb_w]
        if len(axes) != 1:
            return [f"timeline: needs one arrow-headed time axis across 70% of the page, found {len(axes)}"]
    elif kind == "swimlane":
        # Declared *and* measured. The class is needed because the legend strip is
        # also a full-width hairline and counting by geometry alone reads a
        # one-lane page as two; the geometry is still needed because `lane` on two
        # short strokes is not a pair of lanes.
        named = [l for l in lines if "lane" in l.get("class", "").split()]
        dividers = [l for l in named if horizontal(l) and not headed(l)
                    and l.get("stroke", "").strip().lower() == HAIRLINE
                    and span(l) >= 0.8 * vb_w]
        if len(dividers) < 2:
            short = len(named) - len(dividers)
            detail = f", {short} marked lane(s) are not full-width hairlines" if short else ""
            return [f'swimlane: needs two or more full-width <line class="lane"> '
                    f'hairline dividers, found {len(dividers)}{detail}']
    elif kind == "cause":
        spines = [l for l in lines if horizontal(l) and headed(l) and span(l) >= 0.5 * vb_w]
        if len(spines) != 1:
            return [f"cause: needs one spine running to the effect, found {len(spines)}"]
        ribs = [l for l in lines if vertical(l) and touches(l, segment(spines[0])[1])]
        if len(ribs) < 2:
            return [f"cause: needs two or more ribs meeting the spine, found {len(ribs)}"]
    elif kind == "loop":
        returns = [p for p in page.paths if path_returns(p)]
        if not returns:
            return ["loop: needs an arrow-headed <path> that returns to an earlier point"]
    return []


def divisible(value: str) -> bool:
    try:
        return float(value) % GRID == 0
    except ValueError:
        return False


def check(path: Path, asked: str | None = None) -> list[str]:
    source = path.read_text(encoding="utf-8")
    page = Page()
    page.feed(source)
    bad: list[str] = []

    # 10. static, single file — a remote reference makes the page render differently
    # on the next machine, which is the whole reason the fonts are local.
    if page.scripts:
        bad.append(f"<script> is not allowed in a record image ({page.scripts})")
    for hit in page.remote:
        bad.append(f"remote reference: {hit}")
    for hit in re.findall(r"@import\s+url\([^)]*\)|url\((?:https?:)?//[^)]*\)", source):
        bad.append(f"remote reference in CSS: {hit[:60]}")

    # 9. accessible figure
    if page.svg_count != 1:
        bad.append(f"exactly one <svg> expected, found {page.svg_count}")
    if page.svg_attrs.get("role") != "img":
        bad.append('<svg> needs role="img"')
    labelled = page.svg_attrs.get("aria-labelledby", "").split()
    if len(labelled) != 2:
        bad.append('aria-labelledby must name <title> then <desc>')
    else:
        if labelled[0] in {"title", "desc"} or labelled[1] in {"title", "desc"}:
            bad.append(f"prefix the ids for this drawing, not bare {labelled}")
        for wanted in labelled:
            if wanted not in page.ids:
                bad.append(f"aria-labelledby names {wanted}, which no element carries")
    if page.first_svg_children[:1] != ["title"]:
        got = page.first_svg_children[0] if page.first_svg_children else "nothing"
        bad.append(f"<title> must be the svg's first child, found {got}")
    if not page.title_text.strip():
        bad.append("<title> is empty")
    if not page.desc_text.strip():
        bad.append("<desc> is empty — one sentence about what the drawing shows")

    # 7. box geometry on the grid, and the viewBox itself
    box = page.svg_attrs.get("viewbox", page.svg_attrs.get("viewBox", "")).split()
    if len(box) != 4:
        bad.append("<svg> needs a four-value viewBox")
    else:
        for dim in box[2:]:
            if not divisible(dim):
                bad.append(f"viewBox dimension {dim} is not divisible by {GRID}")
    for rect in page.rects:
        for key in GEOMETRY_ATTRS:
            value = rect.get(key)
            if value and not value.endswith("%") and not divisible(value):
                bad.append(f'rect {key}="{value}" is not divisible by {GRID}')

    # paper is painted: a transparent record image loses its ink on a dark background
    paper_rects = [r for r in page.rects
                   if r.get("fill", "").lower() == PAPER
                   and r.get("width", "").endswith("%")]
    if not paper_rects:
        bad.append(f'the svg needs a full-bleed <rect fill="{PAPER}"> as its paper')

    # 2. no diagonal connectors
    for line in page.lines:
        x1, y1, x2, y2 = (line.get(k, "0") for k in ("x1", "y1", "x2", "y2"))
        if x1 != x2 and y1 != y2:
            bad.append(f"diagonal <line> {x1},{y1} -> {x2},{y2}: use an orthogonal elbow")

    # the skin is not a suggestion
    for key, value in page.colors:
        if value and value.lower() not in PALETTE:
            bad.append(f'{key}="{value}" is outside the record palette')
    for family in page.fonts:
        if family not in FONT_VARS:
            bad.append(f'font-family="{family}": call the three stacks by var(--sans|--mono|--serif)')

    # 8. no vertical text
    if page.writing_mode:
        bad.append("vertical writing-mode is not allowed")

    # the declared story type — the page says which of the ten it is, and a claim
    # outside the vocabulary is a typo the reader would inherit as a wrong legend.
    declared = page.svg_attrs.get("data-type", "").strip()
    if declared and declared not in TYPES:
        bad.append(f'data-type="{declared}" is not one of: {" ".join(sorted(TYPES))}')
    if asked and asked not in TYPES:
        bad.append(f'--type {asked} is not one of: {" ".join(sorted(TYPES))}')
    if asked and declared and asked != declared:
        bad.append(f'--type {asked} contradicts the page, which declares {declared}')
    kind = asked or declared
    if kind in TYPES:
        width = num(box[2]) if len(box) == 4 else None
        bad.extend(defining_element(kind, page, width or 1000.0))

    return bad


def main(argv: list[str]) -> int:
    args = argv[1:]
    asked: str | None = None
    if args and args[0] == "--type":
        if len(args) < 2:
            print("usage: hero-check.py [--type <story>] <diagram.html>", file=sys.stderr)
            return 2
        asked, args = args[1], args[2:]
    if len(args) != 1:
        print(f"usage: hero-check.py [--type <story>] <diagram.html>\n"
              f"stories: {' '.join(sorted(TYPES))}", file=sys.stderr)
        return 2
    path = Path(args[0])
    if not path.is_file():
        print(f"no such file: {path}", file=sys.stderr)
        return 2
    problems = check(path, asked)
    if not problems:
        print(f"OK {path}")
        return 0
    print(f"FAIL {path}", file=sys.stderr)
    for problem in problems:
        print(f"  - {problem}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
