#!/usr/bin/env bash
# Bake a checked diagram into the record's image.
#
# The scope is the reason this script exists: the first `<svg>` only, at
# `viewBox` x 2, on painted paper. The draft's eyebrow and headline are wrapper -
# they help a human read the draft in a browser and they do not belong in a
# library of record images, where the record already carries its own title.
#
# It refuses to write a PNG for a page that fails the check, and it measures what
# it wrote. A clipped or mis-scaled image that reaches a record cannot be fixed
# later: the attachment happens once, at creation.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCALE=2

usage() { printf 'usage: hero-bake.sh <draft.html> <out.png> [--scale N]\n' >&2; exit 2; }

[ $# -ge 2 ] || usage
SRC="$1"; OUT="$2"; shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --scale) SCALE="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -f "$SRC" ] || { printf 'no such file: %s\n' "$SRC" >&2; exit 2; }

# 1. Check first. A bake that skips the check is how an unreadable page becomes
#    permanent - the record keeps the first image and only the first.
python3 "$HERE/hero-check.py" "$SRC"

# 2. Chrome renders it. Any of these three is the same engine; a machine without
#    one cannot bake, and saying so beats writing a wrong image.
CHROME=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v chromium || true)" \
  "$(command -v google-chrome || true)"; do
  [ -n "$candidate" ] && [ -x "$candidate" ] && { CHROME="$candidate"; break; }
done
[ -n "$CHROME" ] || {
  printf 'no Chrome or Chromium found - install one, or draw on a machine that has it\n' >&2
  exit 3
}

# 3. Strip to the first `<svg>`, sized in CSS pixels to its own viewBox, so the
#    written PNG is exactly viewBox x SCALE. The paper is painted here as well as
#    in the svg: a transparent record image loses its ink on a dark background.
FRAME="$(mktemp -t hero-bake).html"
DIMS="$(python3 - "$SRC" "$FRAME" <<'PY'
import pathlib, re, sys

src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
page = src.read_text(encoding="utf-8")

svg = re.search(r"<svg\b.*?</svg>", page, re.S)
if not svg:
    sys.exit("no <svg> in the draft")
svg = svg.group(0)

box = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg)
if not box:
    sys.exit('the svg needs viewBox="0 0 W H"')
w, h = box.groups()

style = re.search(r"<style>(.*?)</style>", page, re.S)
style = style.group(1) if style else ""
root = re.search(r":root\s*\{.*?\}", style, re.S)
text_rules = "\n".join(re.findall(r"svg text[^\n{]*\{[^}]*\}", style))

dst.write_text(
    "<!DOCTYPE html>\n<html lang=\"ko\"><head><meta charset=\"UTF-8\"><style>\n"
    "*{margin:0;padding:0}\n"
    f"{root.group(0) if root else ''}\n"
    f"body{{width:{w}px;height:{h}px;overflow:hidden;background:#ffffff;"
    "-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}\n"
    f"svg{{width:{w}px;height:{h}px;display:block}}\n{text_rules}\n"
    f"</style></head><body>\n{svg}\n</body></html>",
    encoding="utf-8")
print(f"{w} {h}")
PY
)"
read -r VB_W VB_H <<<"$DIMS"

"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor="$SCALE" \
  --window-size="$VB_W,$VB_H" \
  --screenshot="$OUT" "file://$FRAME" >/dev/null 2>&1 || true
rm -f "$FRAME"
[ -s "$OUT" ] || { printf 'chrome wrote no image\n' >&2; exit 4; }

# 4. Measure what was written. `sips` ships with macOS; Python's stdlib reads the
#    PNG header anywhere else. Either way the claim is verified, not assumed.
if command -v sips >/dev/null 2>&1; then
  GOT_W="$(sips -g pixelWidth "$OUT" | awk '/pixelWidth/{print $2}')"
  GOT_H="$(sips -g pixelHeight "$OUT" | awk '/pixelHeight/{print $2}')"
else
  read -r GOT_W GOT_H <<<"$(python3 -c "
import struct, sys
with open(sys.argv[1], 'rb') as f:
    head = f.read(24)
print(*struct.unpack('>II', head[16:24]))" "$OUT")"
fi
WANT_W=$((VB_W * SCALE)); WANT_H=$((VB_H * SCALE))
if [ "$GOT_W" != "$WANT_W" ] || [ "$GOT_H" != "$WANT_H" ]; then
  printf 'size mismatch: wrote %sx%s, viewBox %sx%s at scale %s wants %sx%s\n' \
    "$GOT_W" "$GOT_H" "$VB_W" "$VB_H" "$SCALE" "$WANT_W" "$WANT_H" >&2
  rm -f "$OUT"
  exit 5
fi

printf 'baked %s  %sx%s (viewBox %sx%s x%s)  %s bytes\n' \
  "$OUT" "$GOT_W" "$GOT_H" "$VB_W" "$VB_H" "$SCALE" "$(wc -c <"$OUT" | tr -d ' ')"
