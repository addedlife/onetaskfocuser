# 08 App Split Lab

This folder is the active split app shell imported by `src/00-auth.jsx`.

The legacy `src/08-app.jsx` file remains in source control as a rollback
reference only. Keep security-sensitive behavior hardened in both places when
the edit is cheap, but validate production behavior through this split shell.

## Promotion Rule

1. Keep the public export stable: `export { App }`.
2. Split one feature area at a time.
3. Run a temporary-link build before trusting each slice.
4. Only replace the live import after the split version is complete and tested.
