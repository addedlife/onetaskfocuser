// ─── m3-stylebook.jsx — SUPERSEDED ────────────────────────────────────────────
//
// This file no longer defines UI specs. Every UI element in apps/web/src/ must
// use the REAL @material/web npm component (installed at v2.4.1), wrapped with
// @lit/react createComponent(). Never hand-code a lookalike.
//
// Pattern (follow AppSuiteChrome.jsx):
//
//   import { createComponent } from '@lit/react';
//   import { MdFilledButton } from '@material/web/button/filled-button.js';
//   const FilledButton = createComponent({ react: React, tagName: 'md-filled-button', elementClass: MdFilledButton });
//   // → <FilledButton onClick={...}>Label</FilledButton>
//
// If @material/web has no equivalent (navigation rail, toast, priority circles,
// PostIt stack, task card hero) → hand-code using ui-tokens.jsx values only:
//   RADIUS · NC_TYPE · NC_FONT_STACK · SP · ELEV · TRANSITION
//
// Full component map → CLAUDE.md § "M3 component rule"
