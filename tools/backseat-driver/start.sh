#!/bin/bash
# BackSeatDriver — SessionStart hook. Stands up the state subtree for this session
# and launches its steering window.
#
# The window is launched fully detached through Start-Process. A plain background
# child would keep the hook's stdout pipe open and the engine would sit there
# waiting for it to close.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

payload=$(cat)
sid=$(bsd_session_id "$payload") || exit 0
[ -n "$sid" ] || exit 0

# Remote/web containers have no desktop to put a window on.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

cwd=$(bsd_json_str cwd "$payload" 2>/dev/null) || cwd=""
[ -n "$cwd" ] || cwd=$(pwd)

dir="$BSD_ROOT/$sid"
mkdir -p "$dir/inbox"
rm -f "$dir/dead"

# Best-effort session title. The engine writes ~/.claude/sessions/<pid>.json with a
# `name` field, but not necessarily before this hook runs — so fall back to the
# project folder and let the window upgrade the header once the file appears.
title=""
for f in "$HOME"/.claude/sessions/*.json; do
  [ -f "$f" ] || continue
  meta=$(cat "$f" 2>/dev/null) || continue
  case "$meta" in
    *"\"$sid\""*) title=$(bsd_json_str name "$meta" 2>/dev/null) ;;
  esac
  [ -n "$title" ] && break
done
[ -n "$title" ] || title=$(basename "$cwd")

printf '{"sessionId":"%s","cwd":"%s","title":"%s","startedAt":%s}\n' \
  "$(bsd_json_escape "$sid")" "$(bsd_json_escape "$cwd")" \
  "$(bsd_json_escape "$title")" "$(date +%s)" > "$dir/meta.json"

# Don't stack a second window on a session that already has a live one (resume,
# reconnect, a second SessionStart matcher firing).
if [ -f "$dir/window.pid" ]; then
  wpid=$(cat "$dir/window.pid" 2>/dev/null)
  if [ -n "$wpid" ] && tasklist //FI "PID eq $wpid" 2>/dev/null | grep -q "$wpid"; then
    exit 0
  fi
fi

winps=$(cygpath -w "$HERE/window.ps1" 2>/dev/null) || winps="$HERE/window.ps1"

# The script path is quoted inside the argument list: Start-Process joins the array
# with spaces and does no quoting of its own, so an unquoted path containing spaces
# (as every path under "Documents\Shamash Pro 4 App" does) is split into fragments.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \
  "Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','\"$winps\"','-SessionId','$sid')" \
  >/dev/null 2>&1 || true

cat <<JSON
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"BackSeatDriver is live for this session. A small always-on-top window is open on the owner's desktop. Anything they type there is delivered to you mid-turn, at the next tool boundary, wrapped in a <<BACKSEAT DRIVER>> block. Treat those notes as direct owner instructions that supersede conflicting earlier ones, and fold them into whatever you are already doing rather than stopping to ask."},"systemMessage":"BackSeatDriver window open."}
JSON
exit 0
