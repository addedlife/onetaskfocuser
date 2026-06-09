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
export const APP_VERSION = "4.10.21";

// The "updated" stamp is taken from the real build time (injected by Vite's `define` in
// vite.config.js as __BUILD_TIME__), so every deploy — including multiple pushes in one
// day — auto-stamps its own date AND time, with no manual entry. Falls back to this ISO
// date if the build global isn't present (e.g. unit tests running the raw source).
export const APP_VERSION_DATE = "2026-06-09";
const BUILD_TIME = (typeof __BUILD_TIME__ !== "undefined" && __BUILD_TIME__) ? __BUILD_TIME__ : null;

// → e.g. "Jun 9, 2026 · 2:30 PM" in the viewer's local timezone.
export function formatVersionStamp() {
  const d = BUILD_TIME ? new Date(BUILD_TIME) : new Date(`${APP_VERSION_DATE}T00:00:00`);
  if (isNaN(d.getTime())) return APP_VERSION_DATE;
  const datePart = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  if (!BUILD_TIME) return datePart; // no real time available → date only
  const timePart = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}
