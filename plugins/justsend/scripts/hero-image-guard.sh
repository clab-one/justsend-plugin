#!/usr/bin/env bash
# A task record opens with a picture, or it does not open.
#
# The image is not decoration. One record is one task, and the record's job is to
# be recognisable months later on a phone list where every row is text. The
# picture is what makes that row answerable at a glance, which is why the app
# draws it in the list and at the top of the detail.
#
# This has to be enforced here, not remembered. An agent that forgets `image_path`
# gets a record that can never have one: `justsend_work_start` honours the image
# only when it creates the record, so a second call with the image returns
# `materialized: true` and attaches nothing (measured 2026-08-22 —
# `justsend-platform-4` sat with zero attachments and no way to add one). The
# only repair is retract-and-recreate, so the cheap place to stop it is before
# the first call lands.
#
# Notes are exempt on purpose. `justsend_work_note` is a comment on the task, and
# a comment does not get its own hero picture.
set -uo pipefail

payload=$(cat 2>/dev/null) || exit 0
[ -n "$payload" ] || exit 0

# Only the tool that opens a record. The matcher in hooks.json already narrows
# this, but the hook must not assume it was wired correctly.
printf '%s' "$payload" | grep -q '"justsend_work_start"' || exit 0

# `image_path` present and non-empty. Bash regex rather than a JSON parser for
# the same reason as the other guards: `jq` is not on every machine that runs
# this, and a guard that needs a dependency is a guard that silently stops
# guarding.
image=$(printf '%s' "$payload" \
  | grep -o '"image_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -1 \
  | sed 's/.*:[[:space:]]*"//; s/"$//')

if [ -n "$image" ]; then
  # Path has to exist now. The tool checks the bytes too, but failing here keeps
  # a half-written record from being queued at all.
  if [ -f "$image" ]; then
    exit 0
  fi
  printf '%s\n' "image_path does not point at a file: $image" >&2
  exit 2
fi

cat >&2 <<'REASON'
justsend_work_start needs image_path — one task record, one picture.

The image cannot be added later: work_start honours it only when the record is
created, so a second call with the image attaches nothing and the record is
stuck without one for good.

Draw it, do not set type large. eli5 in one line: big picture, very few words,
for someone who knows nothing about the task. The picture carries the mechanism
— what moves where, and where it stops.

  mac-prod/scripts/hero.sh --tokens                  # this app's language + theme
  mac-prod/scripts/hero.sh --out hero.png < body.html

The renderer supplies only `<html lang>` and the theme tokens (--paper --panel
--inset --ink --muted --faint --line --line-strong --fill --fill-soft --on-fill
--mark --on-mark). Layout and words are yours, and they must be in the language
the record is written in.
REASON
exit 2
