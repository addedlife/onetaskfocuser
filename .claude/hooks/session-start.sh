#!/bin/bash
# SessionStart hook (synchronous). Two jobs:
#  1) Activate the tracked git hooks so the pre-push version-bump guard is live
#     in this session (git won't use .githooks/ unless core.hooksPath points to it).
#  2) Ensure apps/web dependencies are present so `npm run build` works in-session.
set -uo pipefail

# 1) Point git at the tracked hooks dir and make sure the hook is executable.
#    Runs everywhere (local + web) so the version-bump push guard is always active.
git config core.hooksPath .githooks 2>/dev/null || true
chmod +x .githooks/* 2>/dev/null || true

# 2) Install web deps — only in the remote/web container (idempotent; the container
#    caches the result). Skipped locally so it doesn't disrupt the owner's machine.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -d apps/web ]; then
  ( cd apps/web && npm install --no-audit --no-fund ) || true
fi

echo "session-start: git push guard active (core.hooksPath=.githooks); apps/web deps ready"
