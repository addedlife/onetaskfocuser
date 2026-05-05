# Token Savings Estimate

Last updated: 2026-05-05

Method A: reread the practical OneTask/NerveCenter source set each session.

- Counted set: main source/config/docs likely to be read for normal work, excluding `.git`, `node_modules`, `dist`, generated `shailos`, artifacts, Netlify local cache, snapshots, and docs backups.
- Files: 76
- Bytes: 5,108,181
- Approximate tokens: 1,277,045

Method B: read this briefing pack plus live git status/log/diff, then open only targeted files.

- Actual briefing-pack files: 6
- Actual briefing-pack bytes: 6,369
- Actual briefing-pack tokens: about 1,592 before git status/log output.
- Typical targeted follow-up: 8,000 to 40,000 tokens because `src/08-app.jsx` and `src/10-deskphone-web.jsx` are large.
- Practical session total: roughly 9,600 to 41,600 tokens for most focused work.

Estimated savings:

- Briefing-only startup: about 99.9% less reading than broad source scan.
- Typical focused session: about 96.7% to 99.2% less reading than broad source scan.
- In plain terms: this should turn startup from a giant codebase re-read into a short executive brief plus focused file inspection.
