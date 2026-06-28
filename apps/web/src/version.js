// ── App version stamp ───────────────────────────────────────────────────────
// Shown in the left rail. BUMP APP_VERSION on every release (see CLAUDE.md "Release policy").
//
// Numbering scheme (reproducible from git history):
//   major = product generation — "Shamash Pro 4" → 4
//   minor = number of feature releases   (`feat:` commits)
//   patch = number of fixes/tweaks       (`fix:` + `style:` commits)
//
// To recompute after new commits:
//   minor: git log --pretty=%s | grep -cE '^feat'
//   patch: git log --pretty=%s | grep -cE '^(fix|style)'
export const APP_VERSION = "4.30.5";

// The "updated" stamp is taken from the real build time (injected by Vite's `define` in
// vite.config.js as __BUILD_TIME__), so every deploy — including multiple pushes in one
// day — auto-stamps its own date AND time, with no manual entry. Falls back to this ISO
// date if the build global isn't present (e.g. unit tests running the raw source).
export const APP_VERSION_DATE = "2026-06-28";
const BUILD_TIME = (typeof __BUILD_TIME__ !== "undefined" && __BUILD_TIME__) ? __BUILD_TIME__ : null;

function versionDate() {
  const d = BUILD_TIME ? new Date(BUILD_TIME) : new Date(`${APP_VERSION_DATE}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

// → e.g. "Jun 9, 2026 · 2:30 PM" in the viewer's local timezone (full, for the expanded rail).
export function formatVersionStamp() {
  const d = versionDate();
  if (!d) return APP_VERSION_DATE;
  const datePart = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  if (!BUILD_TIME) return datePart; // no real build time available → date only
  const timePart = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

// Compact two-liner for the collapsed (64px) rail: { date: "Jun 9", time: "2:30p" }.
export function versionStampShort() {
  const d = versionDate();
  if (!d) return { date: APP_VERSION_DATE, time: "" };
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (!BUILD_TIME) return { date, time: "" };
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s*AM$/i, "a").replace(/\s*PM$/i, "p");
  return { date, time };
}
