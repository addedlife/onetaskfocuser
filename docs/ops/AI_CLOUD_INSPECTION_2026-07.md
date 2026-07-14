# AI pipeline & cloud project inspection — 2026-07 (ticket 7/10)

Owner ask: *"need a good inspection and cleanup of all the ai pipelines and
cloud/firebase/netlify projects. should consolidate everything to one clear
account if possible with one clear ai call pipe, all as free or cheap as
humanly possible but effective and reliable."*

## Verdict up front

The consolidation is ~90% already done: **one Firebase project
(`onetaskonly-app`) is the only live cloud**, and **one gateway
(`/api/ai-proxy` → `functions/_ai-core.cjs`) is the only live AI pipe**.
What's left is deleting/retiring leftovers and fixing two config gaps
(one fixed in this pass).

## Live inventory (the keepers)

| Piece | Where | Cost |
|---|---|---|
| Hosting + Functions + Firestore + RTDB | Firebase project `onetaskonly-app`, deployed by `.github/workflows/deploy.yml` on push to `main` | Blaze pay-as-you-go; effectively pennies at this traffic |
| One AI gateway | `/api/ai-proxy` → `functions/ai-proxy.js` → `_ai-core.cjs` (all jobs: transcribe/parse/synopsis/research/summaries/chief) | free-tier Gemini keys |
| AI provider | Gemini only, two credentials (`GEMINI_API_KEY` primary + `GEMINI_OVERFLOW_01` overflow, auto-failover in `_ai-core.cjs`) | free tier ×2 |
| Web search | `/api/google-search` → Google CSE (100 queries/day free) **with new keyless Sefaria fallback** (this pass) | $0 |
| Phone relay | `/api/phone-relay` + Firestore `phone-relay/*` + RTDB | included above |
| MCP server | `/api/mcp` (`functions/mcp.js`) — task/shaila/bug tools | included above |

One Google Cloud/Firebase account owns all of it. GitHub (`addedlife/onetaskfocuser`)
holds the secrets and the deploy Action. That IS the "one clear account with
one clear AI call pipe" — no further consolidation available without losing
the free tiers.

## Leftovers found (the cleanup list)

1. **Netlify — deprecated, safe to delete the site.** Root `netlify.toml` is a
   stub; `apps/web/netlify.toml` is marked "⛔ DEPRECATED … rollback only";
   `apps/web/backend/functions/*` is a stale copy of the functions (including
   `serper-proxy.js` and `claude-proxy.js`, see below). Nothing deploys there.
   **Action for owner:** delete (or at least suspend) the Netlify site so no
   stale copy of the app can serve, and so nobody edits `backend/functions`
   expecting production effect. The repo copy can stay as rollback.
2. **Serper** (`backend/functions/serper-proxy.js`) — replaced by Google CSE.
   Netlify-only, dead. If a Serper account/key still exists, cancel it.
3. **`claude-proxy.js` / `gemini-proxy.js`** in `backend/functions` — old
   Netlify-era direct proxies, superseded by `_ai-core.cjs`. Dead code, no live
   route. If an Anthropic API key was ever configured for it, revoke it —
   nothing uses it.
4. **`apps/shailos`** — no longer ships (native port 4.43.132). Historical
   source only.
5. **CONFIG GAP (root cause of the "research says no results" ticket):** the
   deployed `googleSearch` function has **no `GOOGLE_SEARCH_API_KEY` /
   `GOOGLE_SEARCH_CSE_ID`** — the GitHub repo secrets are unset/blank, so the
   function returned 503 and the UI said "No search results found."
   **Fixed in code this pass** (Sefaria keyless fallback + honest error
   surfacing), but for full web coverage the owner should add the two GitHub
   secrets: create a free Programmable Search Engine (cse.google.com, "search
   the entire web"), an API key in the same Google account, then
   GitHub → repo → Settings → Secrets → Actions → add both → re-run deploy.
6. **Two Firebase functions dirs** (`apps/web/functions` live vs
   `apps/web/backend/functions` Netlify copy) — a known drift trap; past passes
   had to patch both. With Netlify retired, treat `backend/functions` as
   frozen rollback; never patch it for production fixes.

## Reliability posture of the one AI pipe

- Auth-gated (Firebase ID token), CORS-pinned to the app origins.
- Credential auto-failover primary → overflow on quota errors.
- JSON-repair retry pass for malformed model output (`repairJsonJob`).
- Model catalog pinned in `_ai-core.cjs` with per-task tiers (frontier/fast/
  budget) — cost control lives in one file.

Nothing in this report changes runtime behavior except the google-search
fallback documented above; items 1–4 need the owner's account access (Netlify
dashboard, key revocation), item 5 needs two GitHub secrets.
