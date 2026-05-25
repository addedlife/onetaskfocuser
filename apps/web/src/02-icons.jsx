// === 02-icons.jsx ===
// Single icon language: every IC.* renders a Material Symbol, so the whole
// app shares one icon set (matching suiteIcon elsewhere). Call sites keep the
// same { s, c } API — s = pixel size, c = color (defaults to inherited color).

import React from 'react';

const ICON_STYLE = (s, c) => ({
  fontSize: s,
  color: c,
  lineHeight: 1,
  flexShrink: 0,
  display: "inline-flex",
  verticalAlign: "middle",
});

const glyph = (name) => ({ s = 16, c } = {}) => (
  <span className="material-symbols-rounded" aria-hidden="true" style={ICON_STYLE(s, c)}>{name}</span>
);

const IC = {
  Check:      glyph("check"),
  Plus:       glyph("add"),
  Trash:      glyph("delete"),
  Moon:       glyph("dark_mode"),
  Mic:        glyph("mic"),
  Sparkle:    glyph("auto_awesome"),
  List:       glyph("list"),
  Focus:      glyph("adjust"),
  Stack:      glyph("table_rows"),
  Bulb:       glyph("lightbulb"),
  Chart:      glyph("bar_chart"),
  Gear:       glyph("settings"),
  Chev:       ({ d = "down", s = 10, c } = {}) => {
    const name = d === "up" ? "expand_less"
      : d === "left" ? "chevron_left"
      : d === "right" ? "chevron_right"
      : "expand_more";
    return <span className="material-symbols-rounded" aria-hidden="true" style={ICON_STYLE(s, c)}>{name}</span>;
  },
  Grab:       glyph("drag_indicator"),
  MoveTop:    glyph("vertical_align_top"),
  PriC:       glyph("radio_button_checked"),
  Split:      glyph("account_tree"),
  Bulk:       glyph("grid_view"),
  Undo:       glyph("undo"),
  Clone:      glyph("content_copy"),
  Folder:     glyph("folder"),
  Download:   glyph("download"),
  Merge:      glyph("merge"),
  Clock:      glyph("schedule"),
  Pause:      glyph("pause"),
  Tag:        glyph("label"),
  Brain:      glyph("psychology"),
  Energy:     glyph("bolt"),
  Person:     glyph("person"),
  GoodEnough: glyph("thumb_up"),
  Timer:      glyph("timer"),
  Zen:        glyph("local_drink"),
};

export { IC };
