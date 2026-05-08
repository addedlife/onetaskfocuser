# 08 App Split Lab

This folder is a disconnected clone of the live `src/08-app.jsx` app shell.

The live app still imports `src/08-app.jsx` through `src/00-auth.jsx`.
Nothing in this folder affects production unless `src/00-auth.jsx` is
temporarily pointed at `./08-app-split/index.jsx` for a build or browser test.

## Promotion Rule

1. Keep the public export stable: `export { App }`.
2. Split one feature area at a time.
3. Run a temporary-link build before trusting each slice.
4. Only replace the live import after the split version is complete and tested.
