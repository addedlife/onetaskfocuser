import React from 'react';
import { suiteIcon, NC_FONT_STACK, SP, ELEV, RADIUS, TRANSITION } from '../../08-app-split/ui-tokens.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// 09-next design kit — the shared Material 3 (Expressive) visual language for the
// reimagined UI. Pure presentation: every colour arrives from the caller's theme
// object `C` (= cleanTheme(T)), so all eight app themes work for free. No magic
// numbers — spacing/shape/elevation come from the ui-tokens.jsx token scale.
//
// M3-Expressive choices baked in here: large 20–24px card corners, tonal icon
// pucks, generous breathing room, a single elevation step, and calm motion. The
// primitives below (Card, SectionHeader, CountPill, EmptyState, QuickBar) are the
// only building blocks a surface should reach for; drop them onto any pipe.
// ─────────────────────────────────────────────────────────────────────────────

// Expressive shape scale (slightly rounder than the base tokens for the hero
// dashboard cards). Kept as CSS var references so a theme could still override.
export const NEXT_RADIUS = {
  card: '24px',
  inner: '16px',
  puck: '14px',
};

export const FONT = NC_FONT_STACK;

// tonal(): a translucent tint of any theme colour, for icon pucks / soft fills.
export function tonal(color, alpha = 0.14) {
  const v = String(color || '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(v)) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// IconPuck — a rounded tonal square holding a Material Symbol. The Expressive
// "container-forward" accent that heads every section.
export function IconPuck({ icon, color, size = 34, iconSize = 19 }) {
  return (
    <span
      style={{
        width: size, height: size, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: NEXT_RADIUS.puck,
        background: tonal(color, 0.16), color,
      }}
    >
      {suiteIcon(icon, iconSize)}
    </span>
  );
}

// CountPill — a compact rounded count/label chip for section headers.
export function CountPill({ children, color, C, tone = 'soft' }) {
  const solid = tone === 'solid';
  return (
    <span
      style={{
        minWidth: 20, height: 20, padding: '0 7px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: RADIUS.pill,
        fontFamily: FONT, fontSize: 11.5, fontWeight: 700, lineHeight: 1,
        background: solid ? (color || C.accent) : tonal(color || C.muted, 0.16),
        color: solid ? '#fff' : (color || C.muted),
      }}
    >
      {children}
    </span>
  );
}

// Card — the hero dashboard surface. Header (puck + title + count + actions) and
// a body slot. `accent` tints the puck; defaults to the theme accent.
export function Card({
  icon, title, count, accent, actions, children, C,
  bodyStyle, style, headerRight, pad = true,
}) {
  const a = accent || C.accent;
  return (
    <section
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
        background: C.bg,
        border: `1px solid ${C.divider}`,
        borderRadius: NEXT_RADIUS.card,
        boxShadow: ELEV[1],
        transition: TRANSITION,
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || actions || headerRight) && (
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: SP.sm,
            padding: `${SP.md} ${SP.md} ${SP.sm}`, flexShrink: 0,
          }}
        >
          {icon && <IconPuck icon={icon} color={a} size={28} iconSize={17} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, minWidth: 0, flex: 1 }}>
            {title && (
              <h2 style={{
                margin: 0, fontFamily: FONT, fontSize: 15, fontWeight: 650,
                letterSpacing: '-0.01em', color: C.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{title}</h2>
            )}
            {count != null && <CountPill color={a} C={C}>{count}</CountPill>}
            {headerRight}
          </div>
          {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>{actions}</div>}
        </header>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: pad ? `0 ${SP.md} ${SP.md}` : 0, ...bodyStyle }}>
        {children}
      </div>
    </section>
  );
}

// EmptyState — calm centred placeholder for an empty list.
export function EmptyState({ icon = 'inbox', text, C }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: SP.sm, padding: SP.xl,
      color: C.faint, textAlign: 'center', minHeight: 88,
    }}>
      <span style={{ opacity: 0.7 }}>{suiteIcon(icon, 26)}</span>
      <span style={{ fontFamily: FONT, fontSize: 12.5 }}>{text}</span>
    </div>
  );
}

// QuickBar — a horizontal, wrap-friendly row of footer actions inside a card.
export function QuickBar({ children }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
      paddingTop: SP.sm, marginTop: 'auto',
    }}>
      {children}
    </div>
  );
}
