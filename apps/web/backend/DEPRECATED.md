# ⛔ DEPRECATED — paused Netlify deployment (NOT live)

This `backend/` tree is the **old Netlify deployment** of the OneTask/Shamash backend. It is
**not deployed and not in the release path.** It is kept only as a rollback artifact in case the
project ever moves back to Netlify.

## What's live instead

| Concern | LIVE (edit this) | DEAD (this folder) |
|---|---|---|
| Cloud functions source | `apps/web/functions/` | `apps/web/backend/functions/` |
| Hosting/deploy config | `apps/web/firebase.json` + root `.github/workflows/deploy.yml` | `apps/web/netlify.toml` |
| Function routes | `/api/*` (Firebase rewrites in `firebase.json`) | `/.netlify/functions/*` |

Production deploys run on every push to `main` via `.github/workflows/deploy.yml`, which builds
`apps/web` and runs `firebase deploy --only hosting,functions` (source = `apps/web/functions`).
**Netlify is not triggered by anything.**

## Rules

- **Do NOT edit files here expecting a production effect** — nothing in `backend/` ships.
- Fix production bugs in `apps/web/functions/`. If you want the change mirrored here for an
  eventual Netlify fallback, copy it over deliberately — but that is optional and never urgent.
- Do not delete this folder without owner sign-off; it is the documented Netlify rollback path.

_Reference: `BRIEF.txt`, `AGENTS.md` ("Deploy topology"), and the project memory note
`project_deploy_topology.md`._
