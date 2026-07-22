#!/bin/bash
# BackSeatDriver — Stop hook. The backstop.
#
# PostToolUse only fires at tool boundaries. A note written while Claude is composing
# its final answer — past the last tool call — would otherwise sit until the owner
# sent a fresh message, which is exactly the "launch another turn and re-dump the
# context" cost this whole thing exists to avoid.
#
# `decision: block` + `reason` tells the engine not to end the turn and feeds the
# reason back to Claude, so the work simply continues with the new instruction.
#
# This cannot loop: each pass DELETES the notes it read, and notes only ever appear
# through a deliberate owner action in the window. No notes, no block.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

payload=$(cat)
sid=$(bsd_session_id "$payload") || exit 0
[ -n "$sid" ] || exit 0

dir="$BSD_ROOT/$sid"
[ -d "$dir/inbox" ] || exit 0

BSD_NOTES=""
bsd_take_notes "$dir" || exit 0

ctx=$(bsd_wrap)
esc=$(bsd_json_escape "$ctx")

printf '{"decision":"block","reason":"%s","systemMessage":"BackSeatDriver: steering arrived late — continuing instead of ending the turn."}\n' "$esc"
exit 0
