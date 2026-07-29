# Agent instructions — Shamash Pro 4

Two files, in this order, and nothing else up front:

1. **`CLAUDE.md`** — standing rules (release, gates, UI standard, how work is delivered).
   Claude Code loads it automatically; other agents should read it once.
2. **`docs/ops/MAP.md`** — the routing table. Task → the exact files that task touches,
   plus the grep recipes for finding code without opening 5000-line files.

Reasoning and incident history behind the rules: `docs/ops/RULES_RATIONALE.md`, by section,
only when the task touches that area.

Production source is `apps/web`, `apps/shailos`, `apps/phone-host-windows`. Push target is
`origin/main`; Firebase Hosting is the only live deploy target.

This file used to duplicate all of the above. It no longer does — the duplication is what
made every session pay for the same rules three times.
