#!/bin/bash
# BackSeatDriver — PostToolUse hook. The hot path.
#
# Runs after EVERY tool call, so the idle case must stay cheap: read stdin, pull
# the session id with builtins, stat one directory, exit. Measured cost of the
# process spawn itself is ~63ms on this machine, which dominates everything the
# script does inside.
#
# When notes are waiting, they are emitted as `additionalContext`, which the engine
# places next to the tool result — i.e. inside the running turn. That is the whole
# trick: it is the one documented way to get new text into a turn already underway.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

payload=$(cat)
sid=$(bsd_session_id "$payload") || exit 0
[ -n "$sid" ] || exit 0

# Subagents run tools under the SAME session_id, so without this a Task/Explore
# subagent would consume the owner's steering into its own context and the main
# thread would never see it. Notes are for the main loop only.
case "$payload" in
  *'"agent_id"'*) exit 0 ;;
esac

dir="$BSD_ROOT/$sid"
[ -d "$dir/inbox" ] || exit 0

BSD_NOTES=""
bsd_take_notes "$dir" || exit 0

ctx=$(bsd_wrap)
esc=$(bsd_json_escape "$ctx")

printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"},"systemMessage":"BackSeatDriver: steering folded into this turn."}\n' "$esc"
exit 0
