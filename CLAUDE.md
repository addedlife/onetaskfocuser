# CLAUDE.md — standing instructions for every session

Claude Code loads this file automatically at the start of every session in this repo.
It is the durable home for owner preferences, so they survive across sessions instead of
being promised in chat and forgotten. Read `BRIEF.txt` and `AGENTS.md` too.

## Release policy (STANDING — do not skip)

**Always push live after a verified good fix.** The owner has standing authorization for this.

- After a fix or change is made AND verified (at minimum `npm run build` passes in `apps/web`;
  smoke-test the affected surface when feasible), commit it and **push straight to `origin/main`**.
  Netlify auto-builds production from `apps/web` via the root `netlify.toml`. Then confirm the
  pushed commit shows up on the live site.
- Do NOT leave a verified web fix sitting on a feature branch waiting for separate approval, and
  do NOT ask "should I push this live?" for a normal fix — the answer is yes. Push it.
- Exceptions that still require an explicit heads-up first: storage/sync refactors (see
  `HANDOFF.md` §9 — these can wipe live data), schema migrations, secret/permission changes, or
  anything that could be destructive or hard to reverse.

## Versioning (STANDING)

The app version is the single constant in `apps/web/src/version.js`, shown in the left rail.
**Bump it on every release** and update `APP_VERSION_DATE` to the release date.

Scheme (reproducible from git history):
- **major** = product generation — "Shamash **Pro 4**" → `4`.
- **minor** = number of feature releases: `git log --pretty=%s | grep -cE '^feat'`
- **patch** = number of fixes/tweaks: `git log --pretty=%s | grep -cE '^(fix|style)'`

After committing a `feat:`-prefixed change, bump minor; after a `fix:`/`style:` change, bump patch;
then push live per the release policy above.
