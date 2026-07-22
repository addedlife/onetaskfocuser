#!/bin/bash
# BackSeatDriver — shared helpers for the hook scripts.
#
# State layout, one subtree per Claude Code session:
#   ~/.claude/backseat/<session_id>/
#       meta.json      { sessionId, cwd, title, startedAt, windowPid }
#       window.pid     PID of the WPF steering window
#       dead           marker written by end.sh; the window exits when it sees it
#       inbox/         one *.note file per steering note the owner sends
#       consumed.md    audit trail of everything folded into a turn
#
# One note = one file is deliberate. Appending to a single inbox file races with
# the drain (window appends between our read and our truncate = lost note). With
# one file per note there is nothing to truncate: we read a file, we delete it.

BSD_ROOT="${HOME}/.claude/backseat"

# Pull a top-level string value out of the hook payload using only shell builtins.
# PostToolUse payloads carry the full tool result and can be megabytes; every fork
# here would be paid on each tool call, so this stays fork-free.
bsd_json_str() {
  local key="$1" payload="$2" rest
  case "$payload" in
    *"\"$key\""*) ;;
    *) return 1 ;;
  esac
  rest=${payload#*"\"$key\""}
  rest=${rest#*:}
  rest=${rest#"${rest%%[![:space:]]*}"}   # strip leading whitespace
  case "$rest" in
    '"'*) ;;
    *) return 1 ;;
  esac
  rest=${rest#\"}
  printf '%s' "${rest%%\"*}"
}

bsd_session_id() { bsd_json_str session_id "$1"; }

# Escape a string for embedding in a JSON string literal. Pure builtins for the
# common characters; one `tr` for the stray control bytes, which only runs on the
# rare path where a note actually exists.
bsd_json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\r'/}
  s=${s//$'\t'/\\t}
  s=${s//$'\n'/\\n}
  printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037'
}

# Collect and consume every pending note for a session.
# Sets BSD_NOTES and returns 0 when there was something; returns 1 when idle.
bsd_take_notes() {
  local dir="$1" inbox="$dir/inbox" f body out=""
  local -a files

  shopt -s nullglob
  files=("$inbox"/*.note)
  shopt -u nullglob
  [ ${#files[@]} -eq 0 ] && return 1

  # Filenames are <epoch_ms>-<rand>.note, so a lexicographic sort is chronological.
  IFS=$'\n' read -r -d '' -a files < <(printf '%s\n' "${files[@]}" | sort && printf '\0')

  for f in "${files[@]}"; do
    body=$(cat "$f" 2>/dev/null) || continue
    [ -z "$body" ] && { rm -f "$f"; continue; }
    out+="${body}"$'\n'
    printf -- '--- folded in %s ---\n%s\n\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$body" >> "$dir/consumed.md"
    rm -f "$f"
  done

  [ -z "$out" ] && return 1
  BSD_NOTES="$out"
  return 0
}

# The wrapper that tells Claude what this text is and how much weight it carries.
bsd_wrap() {
  cat <<WRAP
<<BACKSEAT DRIVER — live steering from the owner, delivered mid-turn>>
The owner typed this into the BackSeatDriver window while you were working. Treat it
exactly as if they had just said it to you directly. It supersedes earlier instructions
where the two conflict. Fold it into the work already in progress: do not stop and ask
for confirmation, do not restart, and do not re-summarize context you already hold.

${BSD_NOTES}
<</BACKSEAT DRIVER>>
WRAP
}
