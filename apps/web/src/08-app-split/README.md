# 08 App Split — Live Production App Shell

This folder is the official live application shell. All changes here directly affect production.

The app imports from `src/08-app-split/index.jsx` through `src/00-auth.jsx`. The old `src/08-app.jsx` has been deleted.

## Architecture

- `App.jsx` — main component (task/shaila/chief/phone navigation, modals, state management)
- `AppSuiteChrome.jsx` — left sidebar navigation chrome
- `components/` — feature-specific components (modals, screens, overlays)
- `hooks/` — custom React hooks (navigation, state management)
- `utils/` — utility functions
- `ui-tokens.jsx` — design tokens (colors, typography, icon helpers)
- `index.jsx` — exports App for auth wrapper
