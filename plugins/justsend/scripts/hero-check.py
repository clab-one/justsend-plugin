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
        if tag == "title":
            self.in_title = False
        if tag == "desc":
            self.in_desc = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_text += data
        if self.in_desc:
            self.desc_text += data


def divisible(value: str) -> bool:
    try:
        return float(value) % GRID == 0
    except ValueError:
        return False


def check(path: Path) -> list[str]:
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

    return bad


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: hero-check.py <diagram.html>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    if not path.is_file():
        print(f"no such file: {path}", file=sys.stderr)
        return 2
    problems = check(path)
    if not problems:
        print(f"OK {path}")
        return 0
    print(f"FAIL {path}", file=sys.stderr)
    for problem in problems:
        print(f"  - {problem}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
