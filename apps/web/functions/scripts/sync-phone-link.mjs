// Firebase only deploys the contents of functions/ (see firebase.json's
// functions.source) — a require()/import() reaching outside that directory
// works locally but is silently absent in the deployed bundle. phone-link.js
// is the ONE authored source of the arbitration scoring logic (scoreHostLink/
// chooseAutoHost) that the web app already uses and unit-tests; rather than
// hand-porting it a third time for Cloud Functions, this script mechanically
// copies that single file into the functions bundle before every deploy and
// local run. Never hand-edit the vendored copy — edit the source and re-run
// this script (or just deploy, since it's wired as a predeploy hook).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "..", "..", "src", "08-app-split", "phone-link.js");
const DEST_DIR = path.join(here, "..", "phone-relay-v2", "vendor");
const DEST = path.join(DEST_DIR, "phone-link.mjs");

const banner =
  "// AUTO-GENERATED — do not edit. Mechanically copied from\n" +
  "// apps/web/src/08-app-split/phone-link.js by functions/scripts/sync-phone-link.mjs\n" +
  "// so the Cloud Function reuses the exact same arbitration scoring code the\n" +
  "// web app ships and unit-tests, instead of a third hand-port.\n\n";

mkdirSync(DEST_DIR, { recursive: true });
const source = readFileSync(SOURCE, "utf8");
writeFileSync(DEST, banner + source);
console.log(`[sync-phone-link] copied ${SOURCE} -> ${DEST}`);
