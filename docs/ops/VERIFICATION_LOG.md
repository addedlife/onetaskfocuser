# Verification Log

## 2026-05-10

### `apps/web`

- `npm ci` passed.
- `npm run build` passed.
- `node scripts/copy-shailos-to-dist.cjs` passed and copied generated Shailos output into `dist/shailos`.
- Build warning: main web bundle is larger than 500 kB after minification. This is a performance cleanup target, not a migration failure.
- Dependency audit reported 20 vulnerabilities. This should be triaged before production cutover, but no automatic fix was applied in this migration pass.

### `apps/shailos`

- `npm ci` passed.
- `npm run build` passed.
- Build warning: Shailos bundle is larger than 500 kB after minification. This is a performance cleanup target, not a migration failure.
- Dependency audit reported 5 vulnerabilities, including 1 critical. This should be triaged before production cutover, but no automatic fix was applied in this migration pass.

### `apps/phone-host-windows`

- `dotnet build` passed.
- Existing warnings remain:
  - `InTheHand.Net.Bluetooth 4.1.0` resolves to `4.1.40`.
  - Several nullable/async warnings in existing DeskPhone source.
- No C# build errors.

### Current Conclusion

The clean Shamash Pro 4 workspace has enough source-grade files to build all three lanes independently. It is not ready for production cutover until runtime smoke tests, dependency/security triage, and deploy wiring are completed.

After verification, generated folders were removed again to keep the Pro 4 tree lean:

- `node_modules/`
- `dist/`
- `bin/`
- `obj/`

Current source-grade file count after cleanup: 162 files.

## 2026-05-10 Runtime Preview Pass

### Visible local preview

- Pro 4 production preview is running at `http://127.0.0.1:4305/?suite=nervecenter`.
- Shailos preview route is running at `http://127.0.0.1:4305/shailos/`.
- Phone host status is running at `http://127.0.0.1:8765/status`.

### Phone host API

- Launched the compiled Pro 4 `DeskPhone.exe` directly from `apps/phone-host-windows/bin/Debug/net8.0-windows10.0.19041.0`.
- `GET /status` passed.
- `GET /messages` passed.
- `GET /calls` passed.
- `GET /contacts` passed.
- Finding: `/messages` returned about 18.9 MB. It works, but this is a performance target before calling the Pro 4 phone path peak-efficient.

### Web preview

- `npm run build` passed.
- `node scripts/copy-shailos-to-dist.cjs` passed.
- `vite preview` is serving the built output on port `4305`.
- Main route returned HTTP 200.
- `/shailos/` returned HTTP 200.

### Backend functions

- Restored missed Netlify functions into `apps/web/backend/functions`.
- `node --check` passed for:
  - `ai-proxy.js`
  - `app-config.js`
  - `claude-proxy.js`
  - `gemini-proxy.js`
  - `mcp.mjs`
  - `serper-proxy.js`
  - `_ai-core.cjs`

### Remaining before go-live

- CEO visual pass in the browser.
- Netlify-function runtime test under a Netlify-like local server, not just syntax check.
- Dependency/security audit triage.
- Performance cleanup for large bundles and large phone `/messages` payload.
