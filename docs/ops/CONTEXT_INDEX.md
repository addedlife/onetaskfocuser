# Context Index — superseded by docs/ops/MAP.md

This file's routing table had drifted out of sync with the tree and was actively costing
tokens: it pointed at `apps/web/backend/functions/*` (the backend is `apps/web/functions/`),
at `NerveCenterPanel.jsx` (deleted at 4.98.1, the file is `NerveCenter.jsx`), and it still
described Netlify as the release path. Sessions followed it, found nothing, and fell back
to expensive repo-wide grepping — the opposite of what an index is for.

Use **`docs/ops/MAP.md`**. It is verified against the tree and carries the grep recipes
that cannot go stale.
