#!/usr/bin/env bash
# ONE command for live Firestore (Bug Log, tasks, shailos) from a cloud session.
#
#   tools/firestore-bridge/ask.sh list_bugs '{"status":"unresolved","limit":50}'
#   tools/firestore-bridge/ask.sh add_bug_note '{"bugId":"abc","note":"..."}'
#   tools/firestore-bridge/ask.sh set_bug_status '{"bugId":"abc","status":"resolved","note":"..."}'
#
# Prints the tool's JSON result on stdout. Everything else goes to stderr, so
# `... | python3 -m json.tool` works.
#
# Two roads, picked automatically:
#
#   FAST (~2s)  MCP_READ_TOKEN is in the environment → call the deployed MCP
#               endpoint directly over HTTPS. Nothing to push, nothing to wait
#               for. This is the road every cloud session SHOULD be on; see
#               docs/ops/CLOUD_ACCESS.md for the one-time setup.
#   SLOW (~90s) No token → the GitHub Actions bridge. The token exists there as
#               a repo secret, so the call is made inside a workflow run and the
#               answer comes back encrypted to a throwaway key generated here.
#
# The slow road touches neither your branch nor your working tree: the request
# commit is assembled with git plumbing in a temporary index and pushed straight
# to a refs/heads/bridge/* ref.
set -euo pipefail

TOOL="${1:-}"
ARGS="${2:-{\}}"
ENDPOINT="${MCP_ENDPOINT:-https://onetaskonly-app.web.app/mcp}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ -z "$TOOL" ]; then
  echo "usage: ask.sh <tool> '<json args>'" >&2
  echo "tools: list_bugs add_bug_note set_bug_status list_tasks get_task search_tasks" >&2
  echo "       list_shailos get_shaila search_shailos get_settings get_meta" >&2
  exit 1
fi

rpc_body() {
  TOOL="$TOOL" ARGS="$ARGS" python3 -c '
import json, os
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call",
                  "params":{"name":os.environ["TOOL"],
                            "arguments":json.loads(os.environ["ARGS"] or "{}")}}))'
}

# ── Fast road ───────────────────────────────────────────────────────────────
if [ -n "${MCP_READ_TOKEN:-}" ]; then
  echo "bridge: direct call (MCP_READ_TOKEN present)" >&2
  rpc_body | curl -sS --fail-with-body --max-time 45 -X POST "$ENDPOINT" \
    -H "authorization: Bearer $MCP_READ_TOKEN" \
    -H 'content-type: application/json' \
    --data-binary @-
  echo
  exit 0
fi

# ── Slow road ───────────────────────────────────────────────────────────────
echo "bridge: no MCP_READ_TOKEN — going around through GitHub Actions (~90s)." >&2
echo "bridge: to make this instant, see docs/ops/CLOUD_ACCESS.md." >&2

KEYS="$(mktemp -d)"
PUBKEY="$(node "$REPO_ROOT/tools/firestore-bridge/keygen.mjs" "$KEYS")"
BRANCH="bridge/$(date +%s)-$$"

REQ="$(mktemp)"
TOOL="$TOOL" ARGS="$ARGS" PUBKEY="$PUBKEY" python3 -c '
import json, os
print(json.dumps({"tool": os.environ["TOOL"],
                  "args": json.loads(os.environ["ARGS"] or "{}"),
                  "pubkey": os.environ["PUBKEY"]}))' > "$REQ"

# The workflow file is read from the pushed ref, so the request commit has to be
# built on top of a ref that HAS it — origin/main, not necessarily your branch.
git -C "$REPO_ROOT" fetch -q origin main
BLOB="$(git -C "$REPO_ROOT" hash-object -w "$REQ")"
IDX="$(mktemp)"; rm -f "$IDX"
export GIT_INDEX_FILE="$IDX"
git -C "$REPO_ROOT" read-tree origin/main
git -C "$REPO_ROOT" update-index --add --cacheinfo "100644,$BLOB,.bridge-request.json"
TREE="$(git -C "$REPO_ROOT" write-tree)"
COMMIT="$(git -C "$REPO_ROOT" commit-tree "$TREE" -p origin/main -m "bridge: $TOOL")"
unset GIT_INDEX_FILE
git -C "$REPO_ROOT" push -q origin "$COMMIT:refs/heads/$BRANCH"
echo "bridge: pushed $BRANCH, waiting for the run…" >&2

# Poll the branch itself rather than the Actions API: the runner commits the
# answer back onto it, and `git fetch` needs no gh CLI and no actions:read.
RESP=""
for _ in $(seq 1 40); do
  sleep 6
  git -C "$REPO_ROOT" fetch -q origin "$BRANCH" 2>/dev/null || true
  if git -C "$REPO_ROOT" cat-file -e "origin/$BRANCH:.bridge-response.json" 2>/dev/null; then
    RESP="$(mktemp)"
    git -C "$REPO_ROOT" show "origin/$BRANCH:.bridge-response.json" > "$RESP"
    break
  fi
done

# Throwaway ref. A session whose token cannot delete branches just leaves it —
# it is one dangling ref, and saying so beats failing the whole call.
git -C "$REPO_ROOT" push -q origin --delete "$BRANCH" 2>/dev/null \
  || echo "bridge: could not delete $BRANCH (no delete permission) — harmless." >&2

if [ -z "$RESP" ]; then
  echo "bridge: no answer after 4 minutes. Check the run:" >&2
  echo "  https://github.com/addedlife/onetaskfocuser/actions/workflows/firestore-bridge.yml" >&2
  exit 1
fi

node "$REPO_ROOT/tools/firestore-bridge/open.mjs" "$KEYS" "$RESP"
echo
