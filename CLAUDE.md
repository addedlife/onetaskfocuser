# CLAUDE.md — standing rules

This file is loaded into **every** session, so it stays short. It contains only what you
cannot infer from the code. Reasoning, incidents and detail live in
`docs/ops/RULES_RATIONALE.md`; read a section there only when the task touches it.

**Where to start: `docs/ops/MAP.md`.** It routes any task to its files in one read. Do not
read `BRIEF.txt`, `AGENTS.md`, or `docs/ops/CONTEXT_INDEX.md` — they are pointers to MAP.

## Context budget (read this like a rule, not a suggestion)

- **Grep, then read a slice.** `App.jsx` is 5240 lines, `NerveCenter.jsx` 5097,
  `10-deskphone-web.jsx` 6787. Locate with `rg -n`, then `Read` with `offset`/`limit`.
  Never open one of those files whole.
- **Never read** `docs/ops/VERIFICATION_LOG.md` (209 KB), `CHANGELOG.md` (75 KB),
  `APP_ATLAS.md`, or `APP_FEATURE_MAP.md` in full. Tail or grep them.
- **Batch independent reads** into one parallel tool call. Never re-read a file already in
  context.
- **Fan-out research goes to a subagent** — a broad "where does X happen across the repo"
  sweep costs a separate context window and returns a summary. Do this only when the
  question is genuinely broad; a single `rg` is cheaper than an agent.
- **Buglog, from anywhere, one command — do not go looking for a Firebase key, there
  isn't one:**
  `tools/firestore-bridge/ask.sh list_bugs '{"status":"unresolved","limit":50}'`
  Same script writes: `add_bug_note` / `set_bug_status` (`resolved` requires a note).
  It picks the fast or slow road by itself. `docs/ops/CLOUD_ACCESS.md` is the whole
  story — read it only if the command fails.
  On the owner's PC the admin key is right there; use it directly and skip the script.
- Never dump `users/rabbidanziger/bugs` — it is hundreds of documents. `list_bugs` is
  already the safe read. Re-check open tickets before ending any session that did
  buglog work; the owner files bugs live.
- Keep explanations tight. No filler, no restating the request, no re-deriving settled facts.

## How work is delivered

**No phases, no gates.** Produce one ordered worklist, hardest-blocking first, and work it
top to bottom without stopping to check in. Anything that prevents regression (lint, tests,
enforcement tooling) goes near the front, or later items silently undo earlier ones.

- Never end a turn asking "should I continue?" — if you are asking, the answer is yes.
- Ambiguity is not a reason to stop. Pick the best reading, state the assumption, keep going.
- Blocked on one item ≠ blocked. Skip it, finish the rest, say plainly what you skipped.
- The only legitimate stops: something destructive and irreversible you were not clearly
  authorized to do, a genuine credential wall, or a product tradeoff only the owner can
  decide — and that question is asked **once, up front**, never as a mid-stream gate.
- **A fix behind an off-by-default flag is not shipped**, and a commit message must never
  imply otherwise. Fix the shared token or helper at its source, not one call site.
  See `RULES_RATIONALE.md` § "Why done cannot mean flag-gated".

## Release

**Push live after every verified fix — standing authorization, do not ask.**

- Gate: `npm run build` **and** `npm run gm3` in `apps/web`, plus a smoke of the affected
  surface when feasible. `npm run test:phone` for phone-link changes.
- Bump `apps/web/src/version.js` (`APP_VERSION` + `APP_VERSION_DATE`) on every release.
  `feat:` → minor+1, patch 0. `fix:`/`style:` → patch+1. Bump from the current value; do
  not recompute from git log.
- Commit and push to `origin/main`. That triggers `.github/workflows/deploy.yml` →
  `firebase deploy --only hosting,functions,firestore,database --project onetaskonly-app`.
  **Firebase Hosting is the only live target.** Netlify is fully decommissioned — the
  `netlify.toml` files are a labeled rollback artifact and build nothing. Never describe
  Netlify as live.
- **A push is not a release until the run is green.** After every push,
  `gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`.
  If it fails, fix the cause and re-push in the same turn — never end a turn on a red run,
  and never call anything "live" or "shipped" without having seen it pass. Costs ~300 tokens
  and ~2 min. See `RULES_RATIONALE.md` § "Why pushed is not shipped".
- Push at every logical package point, not once at the end. A 12-item worklist is 4–5 pushes.
- If the harness put you on a `claude/...` branch, that is a workspace, not a destination —
  the commits still end up on `origin/main`.
- Heads-up required first, and only for these: storage/sync refactors (`HANDOFF.md` §9 —
  they can wipe live data), schema migrations, secret or permission changes.
- Before pushing, `git status`. Uncommitted changes to files you did not touch mean another
  session is live — leave them alone and flag it. See `RULES_RATIONALE.md` §
  "concurrent-session protocol".

## Native DeskPhone gate

Any change under `apps/phone-host-windows/**` is not done until the build has run. It is
fully scriptable here — do not defer it to the owner and do not ask first.

1. Add a `changelog.json` entry for the upcoming build number (`build.num`), with real
   `notes` and `devNotes`. `deploy.ps1` hard-fails without them.
2. `dotnet build -c Release -p:Platform=ARM64` from `apps/phone-host-windows`, building
   `DeskPhone.csproj` explicitly — never a bare `dotnet build`.
3. Push the `release(b<N>)` commit deploy.ps1 creates, like any other fix.

Detail in `RULES_RATIONALE.md` § "DeskPhone build gate".

## UI standard

**Material Design 3, exclusively** — no mixing in HIG/Fluent. Every element that has a real
`@material/web` component must use it; never hand-code a lookalike. When none exists, build
it from `ui-tokens.jsx` values only (`RADIUS`, `NC_TYPE`, `NC_FONT_STACK`, `SP`, `ELEV`,
`TRANSITION`) — no magic numbers.

`npm run gm3` is a ratchet: violations may fall, never rise, and the deploy enforces it.
Any commit that removes violations must include `npm run gm3:update` in the same commit.

Component map, mandatory shadow-DOM bridge tokens, and the layout constraints that keep
getting re-broken (no hero row, 1500px column threshold, no trailing control under 420px)
are all in `RULES_RATIONALE.md`. **Read that section before writing UI.**

## Voice

Plain English, warm and direct, for an intelligent non-programmer. Name a programming term
when it comes up naturally and define it in one line, once. Never condescending.

Narration is terse: one line per real phase boundary — starting a piece of work, finishing
it, building, committing, pushing — and silence in between. No progress theater. End with
one short plain-English paragraph: what was broken, what you did, what the owner will see.
Detailed reasoning belongs in the commit message and the ticket note. Questions, plans and
genuine decisions get a proper answer — terseness governs narration, not substance.
