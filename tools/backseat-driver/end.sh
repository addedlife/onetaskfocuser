#!/bin/bash
# BackSeatDriver — SessionEnd hook. Closes the window and archives the trail.
#
# The `dead` marker is the polite path: the window's own timer notices it and shuts
# itself down. The taskkill is the fallback for a window that is wedged.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

payload=$(cat)
sid=$(bsd_session_id "$payload") || exit 0
[ -n "$sid" ] || exit 0

dir="$BSD_ROOT/$sid"
[ -d "$dir" ] || exit 0

touch "$dir/dead"

if [ -f "$dir/consumed.md" ] && [ -s "$dir/consumed.md" ]; then
  mkdir -p "$BSD_ROOT/archive"
  cp "$dir/consumed.md" "$BSD_ROOT/archive/$(date +%Y%m%d-%H%M%S)-${sid:0:8}.md" 2>/dev/null || true
fi

# Give the window a beat to notice the marker, then insist.
( sleep 3
  if [ -f "$dir/window.pid" ]; then
    wpid=$(cat "$dir/window.pid" 2>/dev/null)
    [ -n "$wpid" ] && taskkill //PID "$wpid" //F >/dev/null 2>&1
  fi
  rm -rf "$dir"
) >/dev/null 2>&1 &

exit 0
