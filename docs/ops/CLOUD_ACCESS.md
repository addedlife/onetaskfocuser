# CLOUD_ACCESS — live data from a Claude Code cloud session

**If you only read one line: `tools/firestore-bridge/ask.sh list_bugs '{"status":"unresolved"}'`.**
That is the Bug Log, live, from any cloud session, with no setup and nothing to look up.

This file exists because session after session rediscovered the same thing the hard
way — grepping for a Firebase key that isn't there, concluding "no live pull is
possible from this sandbox", and working the Bug Log from pasted text. It is not
true and has not been since the bridge landed. `CLAUDE.md` and `docs/ops/MAP.md`
both point here.

## The one command

```bash
tools/firestore-bridge/ask.sh <tool> '<json args>'
```

```bash
# The whole buglog workflow — pull, note, close
tools/firestore-bridge/ask.sh list_bugs      '{"status":"unresolved","limit":50}'
tools/firestore-bridge/ask.sh add_bug_note   '{"bugId":"abc123","note":"..."}'
tools/firestore-bridge/ask.sh set_bug_status '{"bugId":"abc123","status":"resolved","note":"..."}'
```

Result JSON on stdout, progress on stderr, so it pipes:

```bash
tools/firestore-bridge/ask.sh list_bugs '{"status":"unresolved"}' \
  | python3 -c 'import sys,json; [print(b["id"], "|", b.get("summary") or b["text"][:80])
                for b in json.load(sys.stdin)["result"]["structuredContent"]["bugs"]]'
```

## The tools

**Named tools** — one per known shape, the everyday ones:
`list_bugs` · `add_bug_note` · `set_bug_status` · `list_tasks` · `get_task` ·
`search_tasks` · `list_shailos` · `get_shaila` · `search_shailos` · `get_settings` ·
`get_meta` · `get_legacy_app_state`.

`set_bug_status: resolved` requires a note — by design. Notes are an array of
`{at, text}` maps and `add_bug_note` appends for you; a raw Firestore write to
`notes` REPLACES the array, so use the tool.

**General tools** — anything the named ones do not cover:

| Tool | Does |
|---|---|
| `firestore_get` | one document by full path; `withSubcollections` lists its child collections |
| `firestore_list` | a collection, with `where` / `orderBy` / `fields` / `limit` |
| `firestore_set` | write a document (merge by default) |
| `firestore_delete` | delete a document |
| `rtdb_get` | Realtime Database — the phone relay queue, host heartbeats, presence |
| `rtdb_set` | write an RTDB path |
| `storage_list` | Cloud Storage objects under a prefix, e.g. `phone-media/` |
| `storage_read` | one object: metadata, a 1-hour signed URL, and the text if small |
| `auth_get_user` | a Firebase Auth user by uid or email |

```bash
tools/firestore-bridge/ask.sh firestore_get  '{"path":"users/rabbidanziger/config/settings"}'
tools/firestore-bridge/ask.sh firestore_list '{"path":"users/rabbidanziger/bugs","fields":["status","summary"],"limit":30}'
tools/firestore-bridge/ask.sh rtdb_get       '{"path":"relay","shallow":true}'
tools/firestore-bridge/ask.sh storage_list   '{"prefix":"phone-media/","limit":20}'
```

### The rules the write tools enforce

Reads go anywhere in the project. Writes do not, and the fence is in
`apps/web/functions/mcp.js` where it can be read and changed, not in the token —
a token is all-or-nothing and cannot say "not that path".

- Every write tool needs `confirm: true`. There is no way to write by accident.
- Firestore writes are confined to `users/rabbidanziger/**`. Everything the app
  stores is under there, so this costs nothing and keeps a confused session out of
  other trees.
- `firestore_delete` refuses a document that has subcollections. Firestore does not
  delete children with the parent, and silently orphaning them is worse than a
  refusal — empty the children first.
- `rtdb_set` refuses `relay/commands`, `relay/queue`, `presence/*` and `hosts/*`.
  That is live phone-link state; a malformed write there stops messaging for real.
- On a big collection, pass `fields` — the mask is applied server-side, so hundreds
  of fat documents come back as hundreds of one-liners. Same for `rtdb_get` with
  `shallow: true` on a node whose size you do not know.

Anything genuinely outside these limits — deleting a whole tree, touching another
project, rotating credentials — is still a job for the owner's PC, where the admin
key lives. That is deliberate.

## What the script does, and why it is worth knowing

It picks one of two roads automatically.

**Fast (~2 seconds).** `MCP_READ_TOKEN` is in the environment → one HTTPS POST to
the deployed MCP endpoint. Set this up once (below) and every future session is on
this road.

**Slow (~90 seconds), today's default.** No token in the sandbox, so the call is
made where the token does exist: inside a GitHub Actions run. The script generates
a throwaway RSA keypair, pushes a request commit to a `bridge/*` ref, waits, and
decrypts the answer. Actions logs are readable by anyone who can read this public
repo, so the payload is AES-256-GCM under an RSA-OAEP-wrapped key whose private
half never leaves the session. Tool name and arguments ride in the clear — they are
the session's own words, never owner data.

The slow road never touches your branch or your working tree: the request commit is
assembled with git plumbing in a temporary index and pushed straight to a ref. It
also polls the branch with `git fetch` rather than the Actions API, so it needs
neither the `gh` CLI (absent here) nor `actions:read`. Dispatching the workflow
directly needs `actions: write`, which a cloud session's GitHub App does not hold —
`actions_run_trigger` answers `Resource not accessible by integration`. Do not
retry that; the push path is the supported one.

Sessions typically cannot delete the throwaway `bridge/*` ref either. The script
says so and carries on. They are inert.

## Make it instant (one-time, owner)

The endpoint is `https://onetaskonly-app.web.app/mcp`, it is a real remote MCP
server (`MCP-Protocol-Version: 2025-11-25`), and **it is already reachable from the
cloud sandbox** — an unauthenticated call returns `401`, not a network error. The
only missing piece is the token.

1. In the Claude Code web environment settings, add an environment variable
   `MCP_READ_TOKEN` with the same value as the repo secret of that name.
2. That alone puts `ask.sh` on the fast road — nothing else to change.
3. Optionally also commit a `.mcp.json` at the repo root, and all twenty-one tools
   appear as native tools in every session, no script at all:

```json
{
  "mcpServers": {
    "shamash": {
      "type": "http",
      "url": "https://onetaskonly-app.web.app/mcp",
      "headers": { "Authorization": "Bearer ${MCP_READ_TOKEN}" }
    }
  }
}
```

Commit that file only together with step 1. Without the variable the server 401s in
every session, which reads like "the buglog is broken" and is worse than the script.

## The wider picture: what a cloud session can and cannot reach

Probed from this sandbox, 2026-08-04:

| Target | Result | What it means |
|---|---|---|
| `onetaskonly-app.web.app/mcp` | 401 | reachable, needs the bearer token |
| `firestore.googleapis.com/v1/…` | 403 | reachable, needs a Google OAuth token |
| `…-default-rtdb.firebaseio.com/.json` | 401 | reachable, needs auth |
| `onetaskonly-app.web.app` (hosting) | 200 | open |
| `api.github.com` | 200 | open (GitHub MCP tools are wired in) |
| `registry.npmjs.org` | 200 | open |

**The limiter is credentials, not the network.** Nothing is being blocked by the
environment's egress policy — every failure above is an auth failure. That reframes
the whole problem: this sandbox does not need a tunnel or a proxy, it needs one
secret, and the cheapest safe secret is the scoped MCP token above.

The token now carries write power, so treat it like a password: if it ever leaks,
rotate the `MCP_READ_TOKEN` repo secret and the matching environment variable
together, and the old one stops working immediately.

### Firebase options, honestly compared

| Option | Reach | Risk | Verdict |
|---|---|---|---|
| **`MCP_READ_TOKEN` env var** | Read anything in the project; write Firestore under `users/rabbidanziger/**`, RTDB outside the live relay paths | Moderate, and bounded by `mcp.js` — which is in this repo and reviewable | **Do this.** Since 4.114.19 it covers Firestore, RTDB, Storage and Auth lookups, not just the buglog |
| Admin service-account JSON in the env | Everything: Firestore, RTDB, Storage, Auth | High — any session, including a confused one, can wipe live data (see `HANDOFF.md` §9) | Only for a specific migration, added and removed around it |
| Workload Identity Federation | Same as admin | — | Not available: WIF needs the OIDC token of an Actions run, which a sandbox has no way to mint. This is why the deploy workflow can authenticate and a session cannot |
| A scoped Firebase user + rules | Whatever the rules allow | Medium; needs rules work | Worth it only if sessions start needing RTDB/Storage |

### What is still out of reach

Firestore, the Realtime Database, Cloud Storage and Auth lookups are all covered as
of 4.114.19. What is not, and stays PC-only on purpose: deleting whole trees,
Auth writes (creating, disabling or deleting users), anything in the RabbiMetrics
project, and credential or rules changes. Those need the admin key, which lives on
the owner's PC. If a session needs something new regularly, add a tool to
`apps/web/functions/mcp.js` — that file is the boundary, and every addition to it
is reviewable here.

### Connectors already present in a cloud session

GitHub (MCP tools, `mcp__github__*`), Gmail, Google Calendar, Google Drive. There
is no `gh` CLI, no `firebase` CLI, and no `gcloud`. Prefer the GitHub MCP tools;
note that `actions_list` returns very large payloads — the harness spills them to a
file and you parse that with `python3`, which is normal, not a failure.
