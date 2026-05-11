# Security rollback audit - 2026-05-11

## Reason

Security hardening was merged into `main` too broadly and broke production behavior. The working decision is to return `main` to the last pre-security commit and re-apply security fixes later in small, verified slices.

## Pre-security anchor

- Last pre-security main commit: `34b09b330ce8ae4a45c45d8d5da79861f97f7190`
- First merged security commit: `ef760e0216d34ca0cb9205309aa99ce03e6bb48b`
- Follow-up partial revert: `772502712840c3da8469ded199866424604bc71c`
- Current preservation branch: `codex/security-rollback-log-20260511`

## Breakage found

- AI/search gateway auth was hardened before matching Netlify config existed.
  - Production env listed `GEMINI_API_KEY`, `SERPER_API_KEY`, and `CLAUDE_API_KEY`.
  - Production env did not list `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, or `FIREBASE_PRIVATE_KEY`.
  - Result: authenticated AI/search calls would fail at Firebase Admin token verification.
- Claude config name mismatch was present.
  - Code checked `ANTHROPIC_API_KEY`.
  - Production had `CLAUDE_API_KEY`.
  - A local compatibility patch was made on this branch only.
- Netlify deploy-preview origin support was removed from function CORS.
  - Earlier preview fix allowed `--onetaskfocuser.netlify.app`.
  - Security hardening narrowed origins to production and localhost only.
- MCP was changed from optionally open/read-token guarded to requiring `MCP_READ_TOKEN`.
  - This may be correct long term, but it is a breaking config dependency if the token is not provisioned and connector clients are not updated.
- Three user-facing regressions had already been reverted in `7725027`.
  - Google OAuth user-entered client ID was restored.
  - Shailos path was restored to `users/rabbidanziger/shailos`.
  - Shailos iframe framing was relaxed back to same-origin.

## Re-entry rule

Do not merge broad security sweeps again. Re-apply one security slice at a time, with its required config, client plumbing, local build, production-like function smoke, and visual/app smoke in the same commit.
