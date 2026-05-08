import React from 'react';

export const suiteIcon = (name, size = 20) => (
  <span className="material-symbols-rounded" style={{ fontSize: size }}>{name}</span>
);

export const GV_CLEAN = {
  bg: "#FFFFFF",
  bgSoft: "#F8F9FA",
  hover: "#F1F3F4",
  divider: "#DADCE0",
  text: "#202124",
  muted: "#5F6368",
  faint: "#9AA0A6",
  accent: "#00796B",
  accentDark: "#00695C",
  success: "#1E8E3E",
  danger: "#D93025",
  warning: "#F9AB00",
};

export const cleanTheme = (theme = {}) => ({
  bg: theme.card || GV_CLEAN.bg,
  bgSoft: theme.bgW || GV_CLEAN.bgSoft,
  hover: theme.tonal || theme.bgW || GV_CLEAN.hover,
  divider: theme.brdS || theme.brd || GV_CLEAN.divider,
  text: theme.text || GV_CLEAN.text,
  muted: theme.tSoft || GV_CLEAN.muted,
  faint: theme.tFaint || GV_CLEAN.faint,
  accent: theme.primary || GV_CLEAN.accent,
  accentDark: theme.onTonal || theme.primary || GV_CLEAN.accentDark,
  success: theme.success || GV_CLEAN.success,
  danger: theme.danger || GV_CLEAN.danger,
  warning: theme.warning || GV_CLEAN.warning,
});

export const gvIconButton = (overrides = {}, C = GV_CLEAN) => ({
  width: 40,
  height: 40,
  borderRadius: 20,
  border: "none",
  background: "transparent",
  color: C.muted,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  ...overrides,
});

export const gvTextButton = (overrides = {}, C = GV_CLEAN) => ({
  height: 36,
  padding: "0 12px",
  borderRadius: 4,
  border: `1px solid ${C.divider}`,
  background: "transparent",
  color: C.muted,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "system-ui",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  ...overrides,
});

export function buildDeskPhoneThemeQuery(palette, theme = {}) {
  const qs = new URLSearchParams({ palette });
  const keys = ["bg", "bgW", "card", "text", "tSoft", "tFaint", "brd", "brdS", "primary", "onPrimary", "tonal", "onTonal"];
  keys.forEach(key => {
    const value = theme?.[key];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
      qs.set(key, value.trim());
    }
  });
  return qs.toString();
}

export function getInitialSuiteView() {
  try {
    const params = new URLSearchParams(window.location.search);
    const view = (params.get("suite") || params.get("view") || "").toLowerCase();
    if (view === "switchboard" || view === "nervecenter") return "nervecenter";
    if (view === "focus" || view === "shailos" || view === "deskphone" || view === "phone") return view === "phone" ? "deskphone" : view;
    return "nervecenter";
  } catch {
    return "nervecenter";
  }
}
