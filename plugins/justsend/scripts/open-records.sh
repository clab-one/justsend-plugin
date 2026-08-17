#!/usr/bin/env bash
# Print the task_keys still open in this directory, one per line. Exits 1 when
# there are none, so callers can branch on the exit code instead of parsing.
#
# This is the one reader every surface goes through — the shell hooks and the
# omp TypeScript hook alike — so "what is open" has a single answer.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
js_open_records
