# Cloud session → Firestore bridge

A Claude Code **cloud** session has no Firebase credential of any kind:

- the admin service-account key lives only on the owner's PC,
- `firestore.rules` correctly denies unauthenticated reads,
- the deployed MCP endpoint (`apps/web/functions/mcp.js`) wants a bearer token
  the session cannot see.

That is why session after session recorded "no live pull possible from this
sandbox" and worked the Bug Log from pasted text. The token *does* exist as the
`MCP_READ_TOKEN` repo secret, which GitHub Actions can read — so the call is made
there, and the answer is carried back encrypted.

**Actions logs are readable by anyone who can read the repo.** The response is
therefore encrypted to a one-time RSA key generated inside the session
(AES-256-GCM payload, RSA-OAEP-SHA256 wrapped key). The private half never
leaves the session, so the Bug Log stays private even while the repo is public.
The tool name and arguments are dispatch inputs and *are* in the clear — those
are the session's own words (a ticket id, a fix note), never owner data.

## The three commands

```bash
KEYS=$(mktemp -d)
PUBKEY=$(node tools/firestore-bridge/keygen.mjs "$KEYS")     # 1. one-time keypair

# 2. dispatch (gh, or the GitHub MCP actions_run_trigger tool) on branch main:
#    workflow: firestore-bridge.yml
#    inputs:   tool=list_bugs  args={"status":"unresolved","limit":50}  pubkey=$PUBKEY

node tools/firestore-bridge/open.mjs "$KEYS" run.log                # 3. decrypt
```

`run.log` is the raw job log — the envelope is located by its markers, so there
is no need to trim it first.

## Tools available through the bridge

Everything `apps/web/functions/mcp.js` registers, including the write path:

| tool | arguments |
|---|---|
| `list_bugs` | `{status: unresolved\|paused\|resolved\|future\|all, limit}` |
| `add_bug_note` | `{bugId, note}` |
| `set_bug_status` | `{bugId, status, note}` — `resolved` **requires** a note |
| `list_tasks` / `get_task` / `search_tasks` | see `mcp.js` |
| `list_shailos` / `get_shaila` / `search_shailos` | see `mcp.js` |
| `get_settings` / `get_meta` / `get_legacy_app_state` | — |

## When this is the wrong tool

On the owner's PC, the service-account key is right there — use it directly.
This bridge is for sessions that have no key at all; it costs a workflow run per
call, so batch a sweep (one `list_bugs`, then one `set_bug_status` per ticket)
rather than polling.
