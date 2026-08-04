# MAP — the only onboarding file

If you are starting a session in this repo, read **this file and nothing else** until you
know which files the task touches. Everything below is verified against the tree, not
against older docs. Regenerate the checks with `npm run map:check` in `apps/web`.

## The 30-second orientation

- Live app: <https://onetaskonly-app.firebaseapp.com> · repo `addedlife/onetaskfocuser` · push target `origin/main`.
- Push to `main` → `.github/workflows/deploy.yml` → `firebase deploy --only hosting,functions,firestore,database`. **Firebase is the only live target.** `netlify.toml` is a dead rollback artifact.
- Production source is exactly three trees: `apps/web`, `apps/shailos`, `apps/phone-host-windows`. Anything else is archive, tooling, or a secondary host.
- Gate before any push: `npm run build` **and** `npm run gm3` in `apps/web`.
- Standing owner rules (version bump, push-live, no phases, M3 components) live in `CLAUDE.md`, which loads automatically. Do not re-read it, and do not read `AGENTS.md` or `BRIEF.txt` — they are pointers to this file.

## Finding code — do this, do not read big files

`App.jsx` is 5240 lines, `NerveCenter.jsx` 5097, `10-deskphone-web.jsx` 6787. Never read
them whole. Two commands answer almost every "where is X":

```bash
rg -n "function \w+|^const \w+ =|^export " apps/web/src/08-app-split/App.jsx
```

```bash
rg -n --glob '!node_modules' -g '*.js*' "yourSymbol" apps/web/src apps/web/functions
```

Then `Read` with `offset`/`limit` around the hit. A grep plus a 60-line read costs a tenth
of a full-file read and cannot go stale the way an index does.

## Where things live

Paths are repo-relative and copy-pasteable, deliberately unabbreviated — `npm run map:check`
verifies every one of them exists, and shorthand would defeat that check.

| If the task is about… | Files |
|---|---|
| NerveCenter dashboard (the 5-card screen) | `apps/web/src/08-app-split/components/NerveCenter.jsx` — one surface, serves `nervecenter`/`chief`/`health` |
| Phone column inside NerveCenter | `apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx` |
| Focus / Queue / Insights, all app state | `apps/web/src/08-app-split/App.jsx` (the orchestrator) |
| Left rail, surface switcher | `apps/web/src/08-app-split/components/AppSuiteChrome.jsx` |
| Data layer, Firestore, AI calls, `Store` | `apps/web/src/01-core.js` |
| Design tokens, M3 bridge vars, palette | `apps/web/src/08-app-split/ui-tokens.jsx`, `apps/web/src/08-app-split/m3.jsx` |
| Shared widgets (task card, timers, PostIt) | `apps/web/src/04-components.jsx` |
| Auth | `apps/web/src/00-auth.jsx` · canonical origin is firebaseapp.com |
| Settings screen | `apps/web/src/07-settings.jsx` |
| Bug Log panel | `apps/web/src/08-app-split/components/BugLog.jsx` |
| Shailos | `apps/web/src/08-app-split/components/ShailosTracker.jsx`, `apps/web/src/08-app-split/shailos-ai.js`, app in `apps/shailos` |
| TaskRiver | `apps/web/src/08-app-split/components/TaskRiverPanel.jsx` |
| Voice capture / record→action parser | `apps/web/src/03-voice.jsx`, `apps/web/src/08-app-split/components/ConvCapture.jsx` |
| DeskPhone web surface | `apps/web/src/10-deskphone-web.jsx` |
| Phone host arbitration / auto-finder | `apps/web/src/08-app-split/phone-link.js`, `apps/web/src/08-app-split/phone-host-control.js`; ported to `apps/phone-host-windows/Services/RelayService.cs` and RelayClient.kt in `apps/phone-host-android` |
| Relay messaging, pending SMS | `apps/web/src/08-app-split/utils/relay-messaging.js`, `apps/web/src/08-app-split/utils/pending-sms.js` |
| Call audio | `apps/web/src/08-app-split/call-audio-feed.js`, `apps/phone-host-windows/Services/CallAudioBridgeService.cs` |
| AI throttle / circuit breaker / lanes | `apps/web/src/08-app-split/ai-call-throttle.js`, `apps/web/src/08-app-split/ai-lane-status.js`, `apps/web/functions/ai-proxy.js`, `apps/web/functions/_ai-core.cjs` |
| Gmail / Calendar / Google auth | `apps/web/functions/google-workspace.js`, `apps/web/functions/gmail-push.js`; client side in App.jsx (`refreshGoogleData`) |
| Search backends | `apps/web/functions/google-search.js`, `apps/web/functions/brave-search.js` |
| Cloud relay endpoint | `apps/web/functions/phone-relay.js`, `apps/web/functions/_relay-devices.cjs` |
| Security rules | `apps/web/firestore.rules`, `apps/web/database.rules.json`, `apps/web/storage.rules` |
| Transcription pen | `apps/web/src/09-transcription-pen.js` |
| Version stamp | `apps/web/src/version.js` |
| Native DeskPhone host | `apps/phone-host-windows` — build gate in `CLAUDE.md`, never bare `dotnet build` |
| Android host | `apps/phone-host-android` |

## Gates

| Tree | Command |
|---|---|
| `apps/web` | `npm run build`, `npm run gm3`, `npm run test:phone` (phone-link changes) |
| `apps/shailos` | `npm run build` |
| `apps/phone-host-windows` | `dotnet build -c Release -p:Platform=ARM64` — **needs a `changelog.json` entry first**, see `CLAUDE.md` |

## Open tickets — the two buglogs, in full, copy-paste ready

Two apps, two Firebase projects, two different addressing schemes. Both are below in
full so nobody has to go looking again. Firestore MCP defaults to the wrong project, so
always pass the **whole** resource name, starting at `projects/`.

**Shamash** — read the mirror doc, never the collection:

```
projects/onetaskonly-app/databases/(default)/documents/users/rabbidanziger/meta/openTickets
```

One small document holding every open ticket (`items[]`, each with `id`, `summary`,
`status`, `createdAtMs`). To write a note or resolve one, address the ticket itself:
`…/users/rabbidanziger/bugs/{id}`. **Never list or dump `users/rabbidanziger/bugs`** —
it is hundreds of documents. The mirror rebuilds only on app-side changes, so it can be
stale in both directions; compare `createdAtMs` against session start, and re-check it
before ending any session that did buglog work.

To audit **resolved** tickets (they are not in the mirror), one call — not the bridge,
not `firestore_query_collection`, which cannot take a path and defaults to the wrong
project:

```
firestore_list_documents
  parent:       projects/onetaskonly-app/databases/(default)/documents/users/rabbidanziger
  collectionId: bugs
  orderBy:      createdAtMs desc
  pageSize:     30
  mask:         status, summary, createdAtMs      (or notes, when auditing claims)
```

The mask is what makes this safe — it is the "never dump the collection" rule satisfied,
not broken. Without a mask this is hundreds of full documents; with one it is a page of
one-liners.

**RabbiMetrics** (separate repo, `C:\Users\ydanz\OneDrive\Documents\Rabbi Changelog`) —
no mirror doc exists, so list the collection directly with a field mask:

```
projects/rabbi-s-metrics/databases/(default)/documents/users/TDvjmJMtnShbi6IeA4XFDV9jPjK2/bugs
```

That path segment is a raw Firebase Auth uid, not an email prefix like Shamash's — it is
not guessable, which is why it is written out here. Use `firestore_list_documents` with
`mask: {fieldPaths: ["text","status","createdAtMs"]}` (`firestore_query_collection`
rejects the nested path). Open tickets are `status: "unresolved"`.

**Writing to either one:** `firestore_update_document` with `document` and `updateMask`
as separate parameters. `notes` is an array of maps (`{at, text}`) and is REPLACED, not
appended — re-send the existing notes alongside the new one, or they are gone.

## Deeper reading — only when the task actually needs it

| Need | File |
|---|---|
| Why a standing rule exists (the war stories) | `docs/ops/RULES_RATIONALE.md` |
| Feature-by-feature numbered map ("do 6.4") | `APP_FEATURE_MAP.md` |
| File-by-file function narrative | `APP_ATLAS.md` |
| What was verified when | `docs/ops/VERIFICATION_LOG.md` — **tail it, never read it** (209 KB) |
| Release history | `CHANGELOG.md` — grep, never read |
| Concurrent-session check, relay specs, dongle, migrations | other files in `docs/ops/` |

## Known stale-doc traps

- Paths of the form `apps/web/backend/functions/*` in older docs are **wrong**; the backend is `apps/web/functions/`.
- `NerveCenterPanel.jsx` does not exist and has not since 4.98.1; the file is `NerveCenter.jsx`.
- Any doc describing Netlify as building or serving is wrong.
