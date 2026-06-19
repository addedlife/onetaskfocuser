// ─── M3 Stylebook — the single master catalogue of every visible element ──────
//
// WHAT THIS IS (plain English): one place that defines the ONE correct way each
// kind of element should look — search fields, filter chips, list rows, buttons,
// cards, etc. — modelled on Google's Material 3 (M3) specs. Pages should pull the
// style FROM HERE instead of hand-writing their own, so we can never again have
// "two search bars in two styles."
//
// IMPORTANT: this is the M3 *spec* (shapes, sizes, density, the recipe for each
// element), NOT a copy of Google's component library. Colors come from the live
// theme (cleanTheme(T)) so adopting these recipes unifies STRUCTURE without
// throwing away the curated themes — the app keeps its own palette.
//
// Each recipe is `(C, opts) => styleObject`, where C = cleanTheme(theme).
// The structural baseline (M3_EXPECT) is theme-independent and is what the
// UI-drift logger (dev/ui-audit.js) compares live elements against.

import { cleanTheme, ELEV, NC_FONT_STACK, NC_TYPE, RADIUS, SP } from './ui-tokens.jsx';

// ─── M3 reference scales (for documentation + the auditor) ────────────────────
// M3 shape scale: none 0 · xs 4 · sm 8 · md 12 · lg 16 · xl 28 · full 999.
// M3 state layers: hover 8% · focus 10% · pressed 10% (applied as bg tint).
// Density here is "comfortable-compact" to match this app (40px controls, not M3's 56px).
export const M3_SHAPE = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 28, full: 999 };
export const M3_CONTROL_H = 40;   // buttons / search / text fields
export const M3_CHIP_H   = 32;    // filter & assist chips
export const M3_ROW_H    = 48;    // one-line list item

// ─── Canonical element recipes ────────────────────────────────────────────────

// Search field — M3 "search bar" is a full pill. ALL searches use this (thread
// list, in-conversation, contacts, tasks) so they finally match.
export const searchField = (theme, { focused = false } = {}) => {
  const C = cleanTheme(theme);
  return {
    height: M3_CONTROL_H,
    width: "100%",
    boxSizing: "border-box",
    borderRadius: RADIUS.pill,
    padding: "0 14px",
    fontSize: NC_TYPE.body,
    fontFamily: NC_FONT_STACK,
    border: `1px solid ${focused ? C.accent : C.divider}`,
    background: C.bgSoft,
    color: C.text,
    outline: "none",
  };
};

// Filter chip — M3 filter chip. ALL in/out/missed/all/unread toggles use this,
// so the message rail and call rail stop looking like two different apps.
export const filterChip = (theme, { active = false } = {}) => {
  const C = cleanTheme(theme);
  return {
    height: M3_CHIP_H,
    display: "inline-flex",
    alignItems: "center",
    gap: SP.xs,
    borderRadius: RADIUS.pill,
    padding: "0 12px",
    fontSize: NC_TYPE.meta,
    fontWeight: 500,
    fontFamily: NC_FONT_STACK,
    border: `1px solid ${active ? C.accent : C.divider}`,
    background: active ? C.hover : "transparent",
    color: active ? C.accent : C.muted,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
};

// List row — M3 one-line list item. Every rail row (calls, messages) uses this
// so line heights and dividers line up across rails.
export const listRow = (theme) => {
  const C = cleanTheme(theme);
  return {
    minHeight: M3_ROW_H,
    display: "flex",
    alignItems: "center",
    gap: SP.md,
    padding: "8px 12px",
    borderBottom: `1px solid ${C.divider}`,
    fontSize: NC_TYPE.body,
    fontFamily: NC_FONT_STACK,
    color: C.text,
  };
};

// Button — M3 buttons are full pills. variant: "filled" | "outlined" | "text".
export const button = (theme, { variant = "filled" } = {}) => {
  const C = cleanTheme(theme);
  const base = {
    height: M3_CONTROL_H,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: SP.sm,
    borderRadius: RADIUS.pill,
    padding: "0 16px",
    fontSize: NC_TYPE.body,
    fontWeight: 500,
    fontFamily: NC_FONT_STACK,
    cursor: "pointer",
    border: "1px solid transparent",
  };
  if (variant === "outlined") return { ...base, background: "transparent", color: C.accent, border: `1px solid ${C.divider}` };
  if (variant === "text")     return { ...base, background: "transparent", color: C.accent, padding: "0 12px" };
  return { ...base, background: C.accent, color: "#fff" }; // filled
};

// Card / panel — M3 medium shape.
export const card = (theme) => {
  const C = cleanTheme(theme);
  return {
    borderRadius: RADIUS.md,
    background: C.bg,
    border: `1px solid ${C.divider}`,
    boxShadow: ELEV[1],
  };
};

// ─── Structural baseline for the UI-drift logger (theme-independent px) ────────
// The logger reads computed styles off live elements and flags anything that
// doesn't match these. Colors are excluded (the theme owns those).
export const M3_EXPECT = {
  searchField: { borderRadius: M3_SHAPE.full, height: M3_CONTROL_H, fontSize: 14 },
  filterChip:  { borderRadius: M3_SHAPE.full, height: M3_CHIP_H,   fontSize: 12 },
  listRow:     { minHeight: M3_ROW_H },
  button:      { borderRadius: M3_SHAPE.full, height: M3_CONTROL_H },
};

// ─── M3_SPEC — the clearinghouse the runtime override reads ────────────────────
// One declarative entry per element kind, listing the STRUCTURAL values to force
// (radius / size / spacing / type). Theme-independent; colors stay with the live
// theme (overriding color at runtime risks white-on-white and the theme already
// centralizes it). The override engine (dev/ui-style-override.js) looks each
// element up here and forces these values — with NO edits to the page source.
// Numbers are px. Add a kind here and the override engine covers it automatically.
export const M3_SPEC = {
  searchField: { borderRadius: M3_SHAPE.full, height: 40,        fontSize: 14, padding: "0 16px" }, // pill — all searches match
  textField:   { borderRadius: M3_SHAPE.sm,   height: 40,        fontSize: 14, padding: "0 12px" }, // boxy input
  textarea:    { borderRadius: M3_SHAPE.md,                      fontSize: 14, padding: "10px 12px" },
  select:      { borderRadius: M3_SHAPE.sm,   height: 40,        fontSize: 14, padding: "0 12px" },
  button:      { borderRadius: M3_SHAPE.full, height: 40,        fontSize: 14, fontWeight: 500, padding: "0 16px" },
  iconButton:  { borderRadius: M3_SHAPE.full, width: 40, height: 40 },
  filterChip:  { borderRadius: M3_SHAPE.full, height: 32,        fontSize: 12, fontWeight: 500, padding: "0 12px" }, // in/out/missed/all match
  badge:       { borderRadius: M3_SHAPE.full, height: 20,        fontSize: 11, padding: "0 6px" },
  listRow:     { minHeight: 48,                                  fontSize: 14, padding: "8px 12px" }, // content rows line up
  card:        { borderRadius: M3_SHAPE.md },
  modal:       { borderRadius: M3_SHAPE.md },
  toggle:      { borderRadius: M3_SHAPE.full },
  navRailItem: { borderRadius: M3_SHAPE.full, height: 40,        fontSize: 12 },
  tab:         { borderRadius: M3_SHAPE.sm,   height: 40,        fontSize: 12 },
  avatar:      { borderRadius: M3_SHAPE.full },
};

export const M3 = { searchField, filterChip, listRow, button, card, M3_EXPECT, M3_SPEC, M3_SHAPE };
export default M3;
