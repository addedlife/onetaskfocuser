import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiParseCalendarEvent, BEFORE_SHAVUOS_PRIORITY_ID, gP, runAIJob, Store, textOnColor } from '../../01-core.js';
import { CAT_MAIL, CAT_PHONE, cleanTheme, ELEV, GOLD, GOLD_BRD, ICON, LINE, NC_FONT_STACK, NC_MONO_STACK, NC_TYPE, RADIUS, SP, suiteIcon, useViewportWidth, useWindowSizeClass } from '../ui-tokens.jsx';
import { ActionBtn, IconBtn, List, ListItem, OutlinedButton, CircularProgress, denseListVars, OutlinedSelect, SelectOption } from '../m3.jsx';
import { NerveCenterPhoneSurface, isMobilePhoneDevice } from './NerveCenterPhoneSurface.jsx';
import { isNerveTaskShailaWork } from '../utils/shailosQueue.js';
import { HealthPage } from './HealthPage.jsx';
import { shouldRunForContentAndClaim, publishContentResult } from '../ai-call-throttle.js';
import { gmailDeepLink } from '../utils/gmail-links.js';

// Owner ticket 7/15: the 5-min gate on dashboard.snapshot.v1 lived only in an
// in-memory ref, which reset to 0 (an immediate, uncapped call) every time this
// surface unmounted and remounted — which happens on every tab switch away from and
// back to NerveCenter. Two tabs open on NerveCenter at once each ran their own
// independent 5-min loop with no shared awareness either. Now backed by Firestore
// (ai-call-throttle.js), durable across remounts and shared across every tab/device.
const SNAPSHOT_THROTTLE_KEY = 'dashboard-snapshot';

function nerveSummarySource(item) {
  // Subtasks store the parent's name in parentTask and their own text in text —
  // show the subtask's own text so sibling steps don't all read as the parent.
  if (item?.parentTask && item?.text) return String(item.text).trim();
  return String(item?.parentTask || item?.shaila || item?.question || item?.text || "").trim();
}

function compactNerveSummary(text, fallback = "Open item") {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/^(research|researching|get back|get back about|follow up|todo|task)\s*[-:–—]\s*/i, "")
    .replace(/^i\s+(need|have|got|should|want)\s+to\s+/i, "")
    .replace(/^please\s+/i, "")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 96 ? `${cleaned.slice(0, 93).trim()}...` : cleaned;
}

function nerveDisplaySummary(item, fallback = "Open item") {
  const source = nerveSummarySource(item);
  const summary = item?.ncSummary || item?.frontSummary || item?.aiSummary || item?.summary || item?.synopsis || item?.answerSummary || "";
  return compactNerveSummary(summary || source, fallback);
}

function hexToRgb(color, fallback = [126, 176, 222]) {
  const value = String(color || "").replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(value)) return fallback;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function softBg(color, alpha) {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

function softBorder(color, alpha) {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

const MIN_COLLAPSED_TASKS = 5;
const TIMELINE_PX_HR = 60; // 60 px/hour in the daily timeline — Google Calendar day-view density

// ── "Calm rows" prototype — ?ncproto=1 to enable, ?ncproto=0 to disable ──────
// Opt-in declutter experiment (owner 7/21: cards read as "a sea of line items").
// Three techniques, all reversible and OFF by default so the live app is unchanged:
//   cap    — each card rests at an adaptive row count + a quiet "+N more" reveal
//   hero   — the first (most urgent) row per card renders one type step larger
//   dim    — routine/already-handled rows (read mail, routine calendar events)
//            drop to ~55% so the few real signals carry the card
// 2026-07-21: the `ncproto` flag is gone. It gated the GM3-correct feed — 48dp
// targets, 16sp rows, content-height cards — behind an off-by-default URL opt-in,
// so `4.96.0 "48dp targets, 16sp rows"` never reached anyone who didn't type
// ?ncproto=1, and three releases shipped on top of the non-compliant path. The
// compliant branch is now the only branch and the dead one has been deleted.
// See CLAUDE.md § "Done means done — no flag-gated completions".

// The guessed resting-row cap that used to live here went with the flag: it only
// fed the pre-GM3 branch. Cards size their own row count by measuring the
// container (useFitRows), which is what the GM3 feed layout calls for.

// Dim treatment for rows that carry no live signal (read mail, past events), so
// the few that do carry one read at a glance.
const NC_DIM_ROW = { opacity: 0.55 };
// Gmail metadata responses carry labelIds; fail open (full contrast) if absent.
const mailIsUnread = msg => Array.isArray(msg?.labelIds) ? msg.labelIds.includes("UNREAD") : true;

// ── M3 FEED LAYOUT (calm-rows v5) ───────────────────────────────────────────
// Research basis (m3.material.io): a dashboard of heterogeneous content is the
// "feed" canonical layout — a configurable grid of cards in a SCROLLING page,
// where each card is sized by its own content. The previous design forced five
// equal-height cards into one screen, which is why a card holding 45 tasks and a
// card holding 2 got identical space: two rows shown and a dead gap beneath.
// Feed mode removes fixed card heights entirely, so there is nothing to clip and
// nothing to waste — and no row-fitting arithmetic at all.
//
// M3 numbers applied here (not invented):
//   window size classes  compact <600 / medium 600-839 / expanded 840-1199
//                        → 1 column below 840dp, 2 columns at/above it
//   touch targets        48x48dp minimum, 8dp apart
//   list item text       16sp headline (body-large), 14sp supporting
//   list item height     56dp one-line / 76dp two-line
// v6 correction (owner, 7/21): a scrolling feed BREAKS this product. NerveCenter's
// whole premise is at-a-glance — all five categories on one screen, nothing pushed
// below a fold to be forgotten. So the page does NOT scroll. What was actually
// wrong was never the fixed screen; it was dividing that screen EQUALLY. A card
// holding 45 tasks and one holding 2 shailos got the same space.
// Now the fixed screen height is allocated PROPORTIONALLY to how much each
// category is carrying, every card still shows a live total in its header (so
// nothing is hidden or forgotten), and each card renders the whole rows that fit
// its allocation — no clipped row, no dead gap.
const NC_FEED_2COL = 840;      // M3 expanded breakpoint → second column
// ── v7: NEEDS-ACTION SELECTION ──────────────────────────────────────────────
// Every list here is permanently full (mail capped at ~20, tasks/shailos deep,
// calendar dense), so total counts and volume-weighted card heights carry no
// information — both are removed. The only lever that matters is SELECTION:
// which few items earn the visible rows. Each card now surfaces what is waiting
// on the owner, not what merely arrived last.
//   mail      unread first
//   phone     needs-callback / unread
//   tasks     highest-weight priorities first
//   shailos   waiting-to-reply first (someone is waiting on a reply)
//   calendar  by owner-assigned importance (see calendarRatingKey)
// Each selector degrades to plain recency when nothing is flagged, so a card is
// never emptier than it used to be.

// Stable key for the calendar importance pool: the recurring series id when
// present (so one rating covers every occurrence), else the normalized title.
function calendarRatingKey(evt) {
  const series = String(evt?.recurringEventId || "").trim();
  if (series) return `r:${series}`;
  const title = String(evt?.summary || "").toLowerCase().replace(/\s+/g, " ").trim();
  return title ? `t:${title}` : "";
}
const CAL_IMPORTANCE = {
  1: { icon: "priority_high", label: "High — must remember" },
  2: { icon: "drag_handle",   label: "Medium" },
  3: { icon: "low_priority",  label: "FYI only" },
};
function calendarRatingOf(evt, ratings) {
  const key = calendarRatingKey(evt);
  const raw = key ? Number(ratings?.[key]) : NaN;
  return (raw === 1 || raw === 2 || raw === 3) ? raw : 2; // unrated behaves as medium
}
// The injected !important stylesheet that used to sit here is gone. It lifted
// md-icon-button to 48dp and md-list-item to M3 metrics, but only inside
// [data-nc-feed] and only for md-icon-button — so the 25 ActionBtn instances on
// this surface stayed at 40dp, and every other surface in the app stayed
// non-compliant entirely. Both are now fixed at the source (IconBtn/ActionBtn
// clamp to M3_MIN_TARGET, denseListVars emits M3 row metrics), which makes the
// override redundant here and correct everywhere.

// useFitRows — measure a list container and report how many WHOLE rows fit in it.
// This is what actually stops a row bleeding over the card edge: a hardcoded cap
// can never be right across every card height, orientation and density, so the
// card measures itself and renders exactly the rows that fit, leaving equal
// padding top and bottom and no partial row.
// Safe against feedback loops: the observed container's height comes from the
// layout (grid cell / flex), never from its own content, so changing the row
// count cannot re-trigger the observer. The TALLEST child is used as the row
// unit, so a wrapped two-line row still can't overrun.
// `rowsRef` (optional): when the rows live inside a wrapper (e.g. an <md-list>),
// available height still comes from `ref` but the row unit is measured from
// rowsRef's children.
function useFitRows(ref, { pad = 12, min = 1, max = 60, enabled = true, watch = null, rowsRef = null } = {}) {
  const [fit, setFit] = useState(3);
  useEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const node = ref.current;
        if (!node) return;
        const avail = node.clientHeight - pad;
        const rowHost = rowsRef?.current || node;
        const heights = Array.from(rowHost.children)
          .map(k => k.getBoundingClientRect().height)
          .filter(h => h > 2);
        if (avail <= 0 || !heights.length) return;
        const rowH = Math.max(...heights);
        if (!(rowH > 0)) return;
        const next = Math.max(min, Math.min(max, Math.floor(avail / rowH)));
        setFit(p => (p === next ? p : next));
      });
    };
    recompute();
    const obs = new ResizeObserver(recompute);
    obs.observe(el);
    return () => { obs.disconnect(); cancelAnimationFrame(raf); };
  }, [ref, rowsRef, pad, min, max, enabled, watch]);
  return fit;
}

// fitSlice — given the full list and how many rows fit, return the rows to show
// and whether a "+N more" row is needed. The more-row occupies one row slot, so
// the total never exceeds what fits.
function fitSlice(items, fit, expanded = false) {
  if (expanded) return { shown: items, hidden: 0 };
  if (items.length <= fit) return { shown: items, hidden: 0 };
  // Only reserve a slot for the "+N more" terminator when there is actually room
  // for it. At fit <= 1 the old code showed 1 row PLUS a more-row in a one-row
  // space — which put the overflow straight back. There the card header's own
  // expand tap is the way in, so no terminator is drawn.
  if (fit <= 1) return { shown: items.slice(0, Math.max(1, fit)), hidden: 0 };
  const shown = items.slice(0, fit - 1);
  return { shown, hidden: items.length - shown.length };
}

// SweepBar — rAF-driven sweep indicator for clock faces.
// Runs at 60fps via requestAnimationFrame; no state updates, no CSS animation tricks.
// duration: full cycle in seconds. getOffset(): fractional seconds into the cycle (with ms).
// baseOpacity: peak opacity; bar fades to 0 in the last 3% of each cycle (no rewind).
function SweepBar({ duration, getOffset, baseOpacity = 0.36, style }) {
  const barRef = useRef(null);
  const getOffRef = useRef(getOffset);
  useEffect(() => { getOffRef.current = getOffset; }); // keep ref in sync without restarting rAF
  useEffect(() => {
    let raf;
    const tick = () => {
      if (barRef.current) {
        const frac = Math.min((getOffRef.current() % duration) / duration, 1);
        const fade = frac > 0.97 ? Math.max(0, (1 - frac) / 0.03) : 1;
        barRef.current.style.transform = `scaleX(${frac})`;
        barRef.current.style.opacity = String(baseOpacity * fade);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={barRef} style={{ ...style, transformOrigin: "left center", transform: "scaleX(0)", opacity: 0 }} />;
}

// TimelineFace — cascading time-scale sweep bars, ordered finest→coarsest
// (seconds → minute → hour → day → month → Hebrew year → English year).
// Shared by the desktop clock "timeline" face, the desktop "▼ timeline"
// expander, and the mobile time hero so all three stay identical.
// compact=true renders just the bar rows (no header/border/date line).
function TimelineFace({ nowDate, C, base = null, openMenu = null, compact = false }) {
  const roshH = [
    { y: 5785, d: new Date(2024, 9, 2) }, { y: 5786, d: new Date(2025, 8, 22) },
    { y: 5787, d: new Date(2026, 8, 11) }, { y: 5788, d: new Date(2027, 9, 1) },
    { y: 5789, d: new Date(2028, 8, 20) }, { y: 5790, d: new Date(2029, 8, 10) },
  ];
  let hYear = roshH[1].y, hYearFrac = 0;
  for (let i = 0; i < roshH.length - 1; i++) {
    if (nowDate >= roshH[i].d && nowDate < roshH[i + 1].d) {
      hYear = roshH[i].y; hYearFrac = (nowDate - roshH[i].d) / (roshH[i + 1].d - roshH[i].d); break;
    }
  }
  let hMonthName = String(hYear), hDay = "";
  try {
    const hParts = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'short' }).formatToParts(nowDate);
    hMonthName = hParts.find(p => p.type === 'month')?.value || hMonthName;
    hDay = hParts.find(p => p.type === 'day')?.value || "";
  } catch {}
  // Day-of-month within the current Hebrew month + that month's length (29 or 30
  // days). Lets the dedicated month row (e.g. "Sivan") show a real progress bar
  // for where we are inside the month, separate from the year row.
  const hDayNum = parseInt(hDay, 10) || 1;
  let hMonthLen = 30;
  try {
    const monthShortOf = d => new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'short' }).formatToParts(d).find(p => p.type === 'month')?.value;
    const probe = new Date(nowDate);
    probe.setDate(probe.getDate() - (hDayNum - 1) + 29); // the would-be 30th of this Hebrew month
    hMonthLen = monthShortOf(probe) === hMonthName ? 30 : 29;
  } catch {}
  const hTimeOfDayFrac = (nowDate.getHours() * 3600 + nowDate.getMinutes() * 60 + nowDate.getSeconds()) / 86400;
  const hMonthFrac = (hDayNum - 1 + hTimeOfDayFrac) / hMonthLen;
  const gregYrStart = new Date(nowDate.getFullYear(), 0, 1);
  const gregYrFrac = (nowDate - gregYrStart) / (new Date(nowDate.getFullYear() + 1, 0, 1) - gregYrStart);
  const daysInMo = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const dayFrac = (nowDate.getDate() - 1 + (nowDate.getHours() * 3600 + nowDate.getMinutes() * 60 + nowDate.getSeconds()) / 86400) / daysInMo;
  const tlSweepOff = () => { const n = new Date(); return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds() + n.getMilliseconds() / 1000; };
  const rows = [
    { lbl: `:${String(nowDate.getMinutes()).padStart(2, "0")}`,                        val: `${nowDate.getSeconds()}s`,                          frac: 0,         col: C.faint,  op: 0.50, dur: 60,    vw: 26 },
    { lbl: `${nowDate.getHours() % 12 || 12}${nowDate.getHours() < 12 ? "am" : "pm"}`, val: `${nowDate.getMinutes()}m`,                          frac: 0,         col: C.faint,  op: 0.82, dur: 3600,  vw: 26 },
    { lbl: nowDate.toLocaleDateString([], { weekday: "short" }),                       val: `${nowDate.getHours()}h`,                            frac: 0,         col: C.muted,  op: 0.60, dur: 86400, vw: 26 },
    { lbl: hMonthName,                                                                 val: `${hDayNum}/${hMonthLen}`,                           frac: hMonthFrac,col: C.accent, op: 0.74, dur: null,  vw: 26 },
    { lbl: String(hYear),                                                              val: hMonthName,                                          frac: hYearFrac, col: C.accent, op: 0.92, dur: null,  vw: 26 },
    { lbl: nowDate.toLocaleDateString([], { month: "short" }),                         val: `${nowDate.getDate()}/${daysInMo}`,                  frac: dayFrac,   col: C.muted,  op: 0.78, dur: null,  vw: 26 },
    { lbl: String(nowDate.getFullYear()),                                              val: nowDate.toLocaleDateString([], { month: "short" }),  frac: gregYrFrac,col: C.accent, op: 0.56, dur: null,  vw: 26 },
  ];
  const mb = compact ? 7 : 9;
  const bars = rows.map(({ lbl, val, frac, col, op, dur, vw }) => (
    <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: mb, minWidth: 0 }}>
      <span style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 0.3, fontFamily: NC_FONT_STACK, width: 38, textAlign: "right", flexShrink: 0, textTransform: "uppercase", lineHeight: 1 }}>{lbl}</span>
      <div style={{ flex: 1, height: 2, borderRadius: 1, background: C.hover, overflow: "hidden", position: "relative", minWidth: 0 }}>
        {dur ? (
          <SweepBar duration={dur} baseOpacity={op} getOffset={tlSweepOff}
            style={{ position: "absolute", inset: 0, borderRadius: 1, background: col }} />
        ) : (
          <div style={{ height: "100%", width: `${frac * 100}%`, borderRadius: 1, background: col, opacity: op, transition: "width 3s ease" }} />
        )}
      </div>
      <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, width: vw, flexShrink: 0, textAlign: "right", letterSpacing: 0.2, lineHeight: 1 }}>{val}</span>
    </div>
  ));
  if (compact) return <>{bars}</>;
  return (
    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "16px 10px 14px", alignItems: "stretch", gap: 0 }}>
      <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 14, textAlign: "center" }}>
        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
      </div>
      {bars}
    </div>
  );
}

// SvgSweepHand — rAF-driven rotating second hand for analog clock SVGs.
// Rotates an SVG <line> around (pivotX, pivotY); duration is full cycle in seconds.
function SvgSweepHand({ x1, y1, x2, y2, pivotX = 50, pivotY = 50, duration = 60, stroke, strokeWidth = 1, opacity = 0.15 }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const n = new Date();
        const secs = (n.getSeconds() + n.getMilliseconds() / 1000) % duration;
        el.setAttribute('transform', `rotate(${(secs / duration) * 360}, ${pivotX}, ${pivotY})`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, pivotX, pivotY]); // eslint-disable-line react-hooks/exhaustive-deps
  return <line ref={ref} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" opacity={opacity} />;
}

function decodeBase64UrlText(value) {
  if (!value) return "";
  try {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function htmlToText(html) {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
  } catch {
    return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function collectGmailBodyParts(part, acc = { plain: [], html: [] }) {
  if (!part) return acc;
  const mime = String(part.mimeType || "").toLowerCase();
  const decoded = decodeBase64UrlText(part.body?.data);
  if (decoded && mime.includes("text/plain")) acc.plain.push(decoded);
  if (decoded && mime.includes("text/html")) acc.html.push(htmlToText(decoded));
  (part.parts || []).forEach(child => collectGmailBodyParts(child, acc));
  return acc;
}

function gmailFullBody(message) {
  const parts = collectGmailBodyParts(message?.payload);
  return (parts.plain.join("\n\n") || parts.html.join("\n\n") || "").replace(/\n{3,}/g, "\n\n").trim();
}

const CHIEF_TIME_BUCKET_MS = 5 * 60 * 1000;  // 5-min buckets: data changes surface in the scan key sooner
const CHIEF_LEARNING_KEY = "ot_chief_learning_v1";
const CHIEF_CHAT_HEIGHT_KEY = "ot_chief_chat_height_v1";
const CHIEF_SCAN_CACHE_KEY = "ot_chief_scan_cache_v1";
const CHIEF_SCAN_LAST_RUN_KEY = "ot_chief_scan_last_ai_run_v1";
const CHIEF_SUGGESTIONS_CACHE_KEY = "ot_chief_task_suggestions_cache_v1";
const CHIEF_SUGGESTIONS_LAST_RUN_KEY = "ot_chief_task_suggestions_last_ai_run_v1";
const CHIEF_SCAN_CACHE_MS = 10 * 60 * 1000;      // industry standard: 10-min TTL for live dashboard AI briefs
const CHIEF_SCAN_MIN_AI_GAP_MS = 3 * 60 * 1000;  // min 3 min between AI calls (debounced, not per keystroke)
const CHIEF_SUGGESTIONS_CACHE_MS = 45 * 60 * 1000;
const CHIEF_SUGGESTIONS_MIN_AI_GAP_MS = 25 * 60 * 1000;
const NC_SUMMARY_CACHE_KEY = "ot_nc_summary_cache_v1";
const NC_SUMMARY_LAST_RUN_KEY = "ot_nc_summary_last_run_v1";
const NC_SUMMARY_CACHE_MS = 8 * 60 * 1000;
const NC_SUMMARY_MIN_GAP_MS = 90 * 1000;
const SNAPSHOT_CACHE_KEY = "ot_nc_snapshot_v1";
const SNAPSHOT_LAST_RUN_KEY = "ot_nc_snapshot_last_run_v1";
const SNAPSHOT_CACHE_MS = 20 * 60 * 1000;
const SNAPSHOT_MIN_GAP_MS = 8 * 60 * 1000;
const ROUTINE_CALENDAR_RE = /\b(shacharis|shacharit|mincha|maariv|arvit|daven(?:ing)?|daf yomi|mishna(?:h)? yomi|halacha yomi|parsha|selichos|slichos)\b/i;
const CHIEF_SEARCHING_BRIEF = { summary: "", nextAction: "", why: "", urgency: "watch", sources: [], focusArea: "operations", _isPlaceholder: true };
const CHIEF_QUIET_BRIEF = { summary: "", nextAction: "", why: "", urgency: "watch", sources: [], focusArea: "operations", _isPlaceholder: true };

function cleanOneLine(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function taskSuggestionKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, " ")
    .replace(/\b(the|a|an|to|for|about|with|and|or|on|in|at|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function taskSuggestionTokens(value) {
  return taskSuggestionKey(value).split(" ").filter(token => token.length > 2);
}

function tokenOverlapRatio(a, b) {
  const aTokens = new Set(taskSuggestionTokens(a));
  const bTokens = taskSuggestionTokens(b);
  if (!aTokens.size || !bTokens.length) return 0;
  const hits = bTokens.filter(token => aTokens.has(token)).length;
  return hits / Math.min(aTokens.size, bTokens.length);
}

function hashChiefValue(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function inferChiefActionType(text) {
  const value = String(text || "").toLowerCase();
  const tests = [
    ["reply", /\b(reply|respond|email back|get back|answer)\b/],
    ["call", /\b(call|phone|return call)\b/],
    ["confirm", /\b(confirm|verify|check with|make sure)\b/],
    ["prepare", /\b(prep|prepare|review|read|bring|print)\b/],
    ["schedule", /\b(schedule|book|set up|calendar|meet)\b/],
    ["send", /\b(send|forward|share)\b/],
    ["pay", /\b(pay|invoice|bill)\b/],
    ["register", /\b(register|sign up|submit form)\b/],
  ];
  return tests.find(([, re]) => re.test(value))?.[0] || "follow_up";
}

function emptyChiefLearning() {
  return { version: 1, events: [] };
}

function readChiefLearning() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHIEF_LEARNING_KEY) || "null");
    if (parsed && Array.isArray(parsed.events)) return { version: 1, events: parsed.events.slice(-200) };
  } catch {}
  return emptyChiefLearning();
}

function readStorageJson(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStorageJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function readStorageNumber(key) {
  try { return Number(localStorage.getItem(key) || 0) || 0; } catch { return 0; }
}

function writeStorageNumber(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
}

function removeStorageKey(key) {
  try { localStorage.removeItem(key); } catch {}
}

function writeChiefLearning(next) {
  try {
    localStorage.setItem(CHIEF_LEARNING_KEY, JSON.stringify({ version: 1, events: (next?.events || []).slice(-200) }));
  } catch {}
}

function readChiefChatHeight() {
  try {
    const value = Number(localStorage.getItem(CHIEF_CHAT_HEIGHT_KEY) || 112);
    return Number.isFinite(value) ? Math.max(56, Math.min(260, value)) : 112;
  } catch {
    return 112;
  }
}

function writeChiefChatHeight(value) {
  try { localStorage.setItem(CHIEF_CHAT_HEIGHT_KEY, String(Math.round(value))); } catch {}
}

function buildChiefLearningProfile(learning) {
  const profile = {
    acceptedActionTypes: {},
    rejectedActionTypes: {},
    acceptedPriorityByAction: {},
    quietedEvidenceCount: 0,
  };
  (learning?.events || []).forEach(event => {
    const action = event.actionType || "follow_up";
    if (event.decision === "accepted") {
      profile.acceptedActionTypes[action] = (profile.acceptedActionTypes[action] || 0) + 1;
      if (event.priorityId) {
        profile.acceptedPriorityByAction[action] = profile.acceptedPriorityByAction[action] || {};
        profile.acceptedPriorityByAction[action][event.priorityId] = (profile.acceptedPriorityByAction[action][event.priorityId] || 0) + 1;
      }
    }
    if (event.decision === "rejected" || event.decision === "completed") {
      profile.rejectedActionTypes[action] = (profile.rejectedActionTypes[action] || 0) + 1;
      profile.quietedEvidenceCount += 1;
    }
  });
  profile.recentlyRejected = (learning?.events || [])
    .filter(e => e.decision === "rejected" || e.decision === "completed")
    .slice(-10)
    .map(e => ({ textKey: e.textKey || "", actionType: e.actionType || "" }))
    .filter(e => e.textKey);
  return profile;
}

function profileNotesForPrompt(profile) {
  const notes = Array.isArray(profile?.notes) ? profile.notes : [];
  const manual = String(profile?.manualMarkdown || "").trim();
  return [
    ...notes.map(note => cleanOneLine(note.text, 240)).filter(Boolean),
    ...(manual ? manual.split(/\n+/).map(line => cleanOneLine(line.replace(/^[-*]\s*/, ""), 240)).filter(Boolean).slice(0, 8) : []),
  ].slice(-20);
}

function markdownFromChiefProfile(profile) {
  const notes = Array.isArray(profile?.notes) ? profile.notes : [];
  const manual = String(profile?.manualMarkdown || "").trim();
  return [
    "# Chief of Staff Profile",
    "",
    `Updated: ${profile?.updatedAt || "local draft"}`,
    "",
    "## Preferences",
    "",
    ...(notes.length ? notes.map(note => `- [${note.category || "preference"}] ${note.text || ""}`) : ["- No saved preferences yet."]),
    "",
    "## Manual Notes",
    "",
    manual || "",
  ].join("\n");
}

function findSuggestionEvidence(item, context) {
  const source = String(item?.source || "").toLowerCase();
  const titleKey = taskSuggestionKey(item?.sourceTitle || item?.text || "");
  const sourceRows = source.includes("mail") || source.includes("gmail")
    ? (context?.emails || [])
    : source.includes("calendar")
      ? (context?.calendar || [])
      : [...(context?.emails || []), ...(context?.calendar || [])];
  const directMatch = sourceRows.find(row => {
    const haystack = taskSuggestionKey(`${row.subject || row.summary || ""} ${row.summary || ""}`);
    return titleKey && haystack && (haystack.includes(titleKey) || titleKey.includes(haystack));
  });
  const bestMatch = sourceRows
    .map(row => ({ row, score: tokenOverlapRatio(titleKey, `${row.subject || row.summary || ""} ${row.summary || ""}`) }))
    .sort((a, b) => b.score - a.score)[0];
  const matched = directMatch || (bestMatch?.score >= 0.5 ? bestMatch.row : null);
  const stablePart = matched?.sourceKey || matched?.threadId || matched?.id || item?.sourceTitle || item?.source || "dashboard";
  const freshPart = matched?.freshnessKey || `${matched?.date || ""}|${matched?.start || ""}|${matched?.end || ""}|${matched?.summary || ""}|${matched?.subject || ""}`;
  return {
    sourceKey: hashChiefValue(`${item?.source || ""}|${stablePart}`),
    freshnessKey: hashChiefValue(`${item?.source || ""}|${stablePart}|${freshPart}`),
  };
}

function decorateTaskSuggestion(item, context) {
  const actionType = item.actionType || inferChiefActionType(item.text);
  const evidence = findSuggestionEvidence(item, context);
  const sourceKey = item.sourceKey || evidence.sourceKey;
  const freshnessKey = item.freshnessKey || evidence.freshnessKey;
  const textKey = item.textKey || taskSuggestionKey(item.text);
  const sourceTitleKey = item.sourceTitleKey || taskSuggestionKey(item.sourceTitle || item.reason || item.text);
  const sourceBucket = item.sourceBucket || taskSuggestionKey(item.source || "dashboard");
  const suppressionKey = item.suppressionKey || hashChiefValue(`${sourceBucket}|${sourceKey}|${actionType}|${sourceTitleKey || textKey}`);
  const issueKey = item.issueKey || hashChiefValue(`${item.source || ""}|${sourceKey}|${actionType}`);
  return {
    ...item,
    actionType,
    sourceKey,
    freshnessKey,
    sourceBucket,
    textKey,
    sourceTitleKey,
    suppressionKey,
    issueKey,
  };
}

function shouldHideTaskSuggestion(item, learning) {
  const events = learning?.events || [];
  return events.some(event => {
    if (event.decision !== "rejected" && event.decision !== "accepted" && event.decision !== "completed") return false;
    if (event.suppressionKey && event.suppressionKey === item.suppressionKey) return true;
    if (event.textKey && event.textKey === item.textKey) return true;
    if (event.issueKey && event.issueKey === item.issueKey) return true;
    if (event.sourceKey && event.sourceKey === item.sourceKey && event.actionType === item.actionType) return true;
    if (event.sourceTitleKey && tokenOverlapRatio(event.sourceTitleKey, item.sourceTitleKey || item.textKey) >= 0.7) return true;
    return false;
  });
}

function looksLikePreferenceUpdate(text) {
  return /\b(remember|profile|preference|don't remind|do not remind|dont remind|stop reminding|never remind|i don't really do|i do not really do|not useful|no more of those|focus on|prioritize|stop showing|stop suggesting|ignore this|always start|never start|i already handled|i took care|already done|skip this type|i prefer|going forward|you should know|my style|train you)\b/i.test(String(text || ""));
}

function looksLikeChiefRejection(text) {
  const t = String(text || "").trim();
  if (/^(no|nope)[.!?\s]*$/i.test(t)) return true;
  return /\b(not now|skip|next|bad advice|wrong|irrelevant|don't want that|do not want that|dont want that|stop that|not helpful|useless|sleep tasks?)\b/i.test(t);
}

function looksLikeDeleteConfirmation(text) {
  return /\b(delete it|delete that|remove it|remove that|cancel it|yes delete|yes remove|take it off calendar)\b/i.test(String(text || ""));
}

function findCalendarPreferenceTarget(text, calendar = []) {
  const source = taskSuggestionKey(text);
  const scored = (calendar || [])
    .filter(evt => evt?.id && evt?.summary && !evt.past)
    .map(evt => ({ evt, score: tokenOverlapRatio(source, evt.summary) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 0.25 ? scored[0].evt : (calendar || []).find(evt => evt?.special && !evt.past) || null;
}

function profileNoteFromChiefText(text, target) {
  const cleaned = cleanOneLine(text, 360);
  if (target?.summary) {
    return {
      category: "calendar_preference",
      text: `Avoid surfacing reminders for "${cleanOneLine(target.summary, 180)}" unless the user asks directly. User note: ${cleaned}`,
      source: "Chief chat",
      linkedSource: {
        type: "calendar",
        id: target.id,
        calendarId: target.calendarId || "primary",
        title: target.summary,
        start: target.start || "",
        end: target.end || "",
      },
    };
  }
  return {
    category: "preference",
    text: cleaned,
    source: "Chief chat",
  };
}

function parseEventMs(value) {
  const d = new Date(value || 0);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function calendarStartMs(evt) {
  return parseEventMs(evt?.start?.dateTime || evt?.start?.date);
}

function calendarEndMs(evt) {
  const end = parseEventMs(evt?.end?.dateTime || evt?.end?.date);
  return end || calendarStartMs(evt);
}

function isRoutineCalendarEvent(evt) {
  const title = String(evt?.summary || "").trim();
  if (!title) return false;
  return ROUTINE_CALENDAR_RE.test(title) || (evt?.recurringEventId && /\b(daily|regular|weekday)\b/i.test(title));
}

function isCalendarEventCurrent(evt, nowMs) {
  if (!evt?.start?.dateTime) return false;
  const start = calendarStartMs(evt);
  const end = calendarEndMs(evt);
  return start <= nowMs && end >= nowMs;
}

function isCalendarEventPast(evt, nowMs) {
  return calendarEndMs(evt) < nowMs;
}

function formatCalendarWindow(evt) {
  if (evt?.start?.date) return "All day";
  const start = new Date(evt?.start?.dateTime);
  const end = new Date(evt?.end?.dateTime);
  if (!Number.isFinite(start.getTime())) return "";
  const time = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!Number.isFinite(end.getTime())) return time;
  return `${time} - ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function hexToRgba(hex, a) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Google Calendar color palette — keyed by event.colorId (1–11)
const GCAL_COLORS = {
  "1": "#7986CB", "2": "#33B679", "3": "#8E24AA", "4": "#E67C73",
  "5": "#F6BF26", "6": "#F4511E", "7": "#039BE5", "8": "#616161",
  "9": "#3F51B5", "10": "#0B8043", "11": "#D50000",
};

// Ink color that stays legible on a solid GCal event color (yellow/light hues need dark text).
function onEvtColor(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return "#fff";
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? "#1F2933" : "#fff";
}

// Assigns non-overlapping column slots to overlapping timed calendar events.
// Returns rows with .col (0-based column index) and .colCount (total columns in the group).
function assignCalendarColumns(rows) {
  const sorted = [...rows].sort((a, b) => a.startMs - b.startMs);
  const colEnds = [];
  const withCols = sorted.map(row => {
    const endMs = calendarEndMs(row.evt);
    let col = 0;
    while (col < colEnds.length && colEnds[col] > row.startMs) col++;
    colEnds[col] = endMs;
    return { ...row, col, endMs };
  });
  return withCols.map(row => {
    const colCount = withCols
      .filter(o => o.startMs < row.endMs && o.endMs > row.startMs)
      .reduce((mx, o) => Math.max(mx, o.col + 1), 1);
    return { ...row, colCount };
  });
}

// Google-Calendar-style day timeline body: all-day chips + a scrollable 24h grid with
// absolutely-positioned event blocks (side-by-side columns for overlaps), faded past
// events, and an rAF-driven now-line. Shared by the full-panel calendar card AND the
// card-grid ("boxes") calendar box so the "live time" view is identical in both.
// The parent owns the refs: `scrollRef` is the scroll container (auto-centered on now)
// and `nowLineRef` is the now-line div whose `top` is driven by rAF each frame.
function CalendarTimeline({ calendarRows, nowDate, C, scrollRef, nowLineRef }) {
  const LABEL_W = 40;
  const PX_MIN = TIMELINE_PX_HR / 60;
  const TOTAL_H = 24 * TIMELINE_PX_HR;
  const nowLineColor = C.success || C.accent || "#1A9E78";
  const allDayRows = calendarRows.filter(r => !!r.evt?.start?.date && !r.evt?.start?.dateTime && !r.tomorrow);
  const timedRows = calendarRows.filter(r => !!r.evt?.start?.dateTime && r.startMs > 0 && !r.tomorrow);
  const timedWithCols = assignCalendarColumns(timedRows);
  const evtAccent = evt => GCAL_COLORS[evt?.colorId] || C.warning;
  const h24 = nowDate.getHours(), m24 = nowDate.getMinutes();
  const nowTimeLabel = `${h24 % 12 || 12}:${String(m24).padStart(2, "0")}${h24 >= 12 ? "p" : "a"}`;
  return (
    <>
      {allDayRows.length > 0 && (
        <div style={{ padding: `3px 4px 3px ${LABEL_W + 4}px`, borderBottom: `1px solid ${C.divider}`, flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 3 }}>
          {allDayRows.map(row => (
            <span key={row.evt.id || row.index} style={{ fontSize: NC_TYPE.small, fontWeight: 600, color: row.past ? C.faint : onEvtColor(evtAccent(row.evt)), background: row.past ? C.hover : evtAccent(row.evt), borderRadius: RADIUS.sm, padding: "1px 8px", opacity: row.past ? 0.7 : 1 }}>
              {row.evt.summary || "(no title)"}
            </span>
          ))}
        </div>
      )}
      <div ref={scrollRef} style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", scrollbarGutter: "stable" }}>
        <div style={{ position: "relative", height: TOTAL_H }}>
          {/* Event column — events positioned absolutely by time */}
          <div style={{ position: "absolute", left: LABEL_W, right: 0, top: 0, bottom: 0 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ position: "absolute", top: h * TIMELINE_PX_HR, left: 0, right: 0, height: 1, background: C.divider, opacity: h === 0 ? 0 : 0.5, pointerEvents: "none" }} />
            ))}
            {timedWithCols.map(row => {
              const s = new Date(row.evt.start.dateTime);
              const eDate = row.evt.end?.dateTime ? new Date(row.evt.end.dateTime) : s;
              const startMin = s.getHours() * 60 + s.getMinutes();
              const endMin = Math.max(startMin + 15, eDate.getHours() * 60 + eDate.getMinutes());
              // GM3 / Google Calendar mobile block: solid event-color fill, fully rounded
              // corners, 2px breathing gap on every side; past events fall back to a faded
              // tonal chip so the current/upcoming blocks carry the visual weight.
              const top = startMin * PX_MIN;
              const height = Math.max(22, (endMin - startMin) * PX_MIN);
              const color = evtAccent(row.evt);
              const ink = row.past ? C.faint : onEvtColor(color);
              return (
                <div key={row.evt.id || row.index}
                  title={`${row.evt.summary || "(no title)"}\n${row.label}`}
                  role={row.evt.htmlLink ? "link" : undefined}
                  tabIndex={row.evt.htmlLink ? 0 : undefined}
                  onClick={row.evt.htmlLink ? () => window.open(row.evt.htmlLink, "_blank") : undefined}
                  onKeyDown={row.evt.htmlLink ? e => { if (e.key === "Enter") window.open(row.evt.htmlLink, "_blank"); } : undefined}
                  style={{
                    position: "absolute", top: top + 1, height: Math.max(20, height - 2),
                    left: `calc(${(row.col / row.colCount) * 100}% + 1px)`,
                    width: `calc(${100 / row.colCount}% - 4px)`,
                    background: row.past ? softBg(color, 0.22) : color,
                    border: row.now ? `2px solid ${C.bg}` : "none",
                    boxShadow: row.now ? `0 0 0 2px ${color}` : "none",
                    borderRadius: RADIUS.sm,
                    overflow: "hidden", cursor: row.evt.htmlLink ? "pointer" : "default",
                    padding: height >= 34 ? "4px 8px" : "2px 8px", boxSizing: "border-box", opacity: row.past ? 0.6 : 1,
                  }}>
                  <div style={{ fontSize: NC_TYPE.small, fontWeight: row.now ? 700 : 600, color: ink, fontFamily: NC_FONT_STACK, lineHeight: 1.25, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {row.evt.summary || "(no title)"}
                  </div>
                  {height >= 34 && (
                    <div style={{ fontSize: NC_TYPE.small, color: ink, opacity: 0.8, fontFamily: NC_FONT_STACK, lineHeight: 1.25, marginTop: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {row.label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Hour labels */}
          {Array.from({ length: 24 }, (_, h) => h > 0 && (
            <span key={h} style={{ position: "absolute", top: h * TIMELINE_PX_HR, left: 0, width: LABEL_W - 4, textAlign: "right", transform: "translateY(-50%)", fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, lineHeight: 1, pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}>
              {h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
            </span>
          ))}
          {/* Now-line — style.top driven by rAF each frame; JSX top:0 never changes so React never resets it */}
          <div ref={nowLineRef} style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 3, pointerEvents: "none", display: "flex", alignItems: "center" }}>
            <span style={{ width: LABEL_W - 4, textAlign: "right", fontSize: NC_TYPE.small, color: nowLineColor, fontWeight: 700, fontFamily: NC_FONT_STACK, flexShrink: 0, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{nowTimeLabel}</span>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: nowLineColor, flexShrink: 0 }} />
            <div style={{ flex: 1, height: 2, background: nowLineColor, borderRadius: 1 }} />
          </div>
        </div>
      </div>
    </>
  );
}

// Callback ref for the agenda "Now" bar: scrolls the nearest [data-agenda-scroll]
// container so "now" lands in the top third of the viewport (same convention as the
// live timeline). Guarded to run once per container mount so it never fights the
// user's own scrolling on later re-renders.
const agendaNowBarRef = el => {
  if (!el) return;
  const sc = el.closest("[data-agenda-scroll]");
  if (!sc || sc.dataset.autoScrolled === "1") return;
  sc.dataset.autoScrolled = "1";
  requestAnimationFrame(() => {
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTop = Math.max(0, top - sc.clientHeight / 3);
  });
};

// Mobile "nerve center" accordion section. Hoisted to module scope (NOT defined inside
// NerveCenter) so its component identity stays stable across renders — otherwise the
// per-second clock re-render recreated the function, remounting every section and dropping
// in-flight taps/keystrokes. Sections collapse to a full-summary preview line; multiple may
// stay open. When expanded the content scrolls internally so the page stays bounded.
// `keepMounted` hides via display:none so embedded pollers (Phone) keep running while
// collapsed. State arrives via props (expandedIds/menuId + the on* callbacks).
function MobileSection({ id, icon, title, accentColor, count, primaryBtn, menuItems, preview, expandable = true, keepMounted = false, fullHeight = false, children, C, expandedIds, menuId, onExpand, onMenuToggle, onMenuClose, hero = null, dense = false }) {
  const expanded = !expandable || !!expandedIds?.has(id);
  const sectionScrollRef = useRef(null);
  const fitRows = useFitRows(sectionScrollRef, { enabled: true, watch: `${dense}|${expanded}` });
  const menuOpen = menuId === id;
  const chipBg = hexToRgba(accentColor, 0.16) || C.hover;
  const tint = hexToRgba(accentColor, 0.05);
  // fullHeight: fills its grid cell in the 5-column layout (flex:1, no maxHeight cap).
  // Normal: capped so stacked accordion sections don't grow the page unbounded.
  const scrollStyle = fullHeight
    ? { flex: "1 1 0", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }
    : { maxHeight: "min(52vh, 460px)", overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" };
  return (
    <div style={{ background: `color-mix(in srgb, ${C.bg} 94%, ${accentColor || C.accent} 6%)`, borderRadius: RADIUS.lg, overflow: "hidden",
      ...(fullHeight ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 10px", minHeight: 28 }}>
        <ListItem type="button"
          onClick={expandable ? () => onExpand(id) : undefined}
          aria-expanded={expandable ? expanded : undefined}
          style={{
            flex: 1, minWidth: 0, cursor: expandable ? "pointer" : "default",
            ...denseListVars({ dense: true }),
            '--md-list-item-one-line-container-height': '28px',
            '--md-list-item-leading-space': '0px', '--md-list-item-trailing-space': '0px',
            '--md-list-item-top-space': '0px', '--md-list-item-bottom-space': '0px',
          }}>
          <span slot="start" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, color: C.muted, flexShrink: 0 }}>{suiteIcon(icon, 16)}</span>
          <div slot="headline" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: NC_TYPE.body, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK, flexShrink: 0, letterSpacing: 0 }}>{title}</span>
            {count > 0 && <span style={{ fontSize: NC_TYPE.small, fontWeight: 500, color: C.faint, fontFamily: NC_MONO_STACK, background: C.hover, borderRadius: RADIUS.pill, padding: "1px 6px", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{count}</span>}
            {preview != null && preview !== "" && (
              // Small single-line caption next to the title — visible in every layout (incl. the
              // always-expanded mobile sections), kept to one line so it never pushes card
              // content (emails, events) down.
              <span style={{ fontSize: NC_TYPE.small, lineHeight: 1.2, color: C.muted, fontFamily: NC_FONT_STACK, minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontStyle: "normal" }}>{preview}</span>
            )}
          </div>
          {expandable && (
            <span slot="end" style={{ color: expanded ? C.muted : C.faint, display: "flex", flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>{suiteIcon("expand_more", 18)}</span>
          )}
        </ListItem>
        {primaryBtn}
        {menuItems?.length > 0 && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <IconBtn icon="more_vert" iconSize={15} color={C.faint} onClick={e => { e.stopPropagation(); onMenuToggle(id); }} aria-label={`${title} menu`} />

            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 9100 }} onClick={onMenuClose} />
                <div style={{ position: "absolute", right: 0, top: 28, zIndex: 9101, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, minWidth: 168, boxShadow: ELEV[3], overflow: "hidden" }}>
                  {menuItems.map((item, i) => (
                    <ListItem key={i} type="button" onClick={() => { onMenuClose(); item.run?.(); }}
                      style={{
                        width: "100%", borderBottom: i < menuItems.length - 1 ? `1px solid ${C.divider}` : "none",
                        color: C.text, fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK,
                        ...denseListVars({ dense: true }),
                      }}>
                      <span slot="start" style={{ display: "flex" }}>{suiteIcon(item.icon || "arrow_forward", 14)}</span>
                      <div slot="headline">{item.label}</div>
                    </ListItem>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* Preview shown inline in the header — no second body row needed. */}
      {/* Hero renders INSIDE the scrolling list as its emphasized first row — a
          pinned bar read as a frozen header and locked up scroll space (owner
          tickets tr60ibj2/xFD22e5T, 7/21). */}
      {keepMounted
        ? <div ref={sectionScrollRef} style={expanded ? { ...scrollStyle, ...({ paddingTop: 6, paddingBottom: 6 }) } : { display: "none" }}>{hero}{typeof children === "function" ? children(fitRows) : children}</div>
        : (expanded && <div ref={sectionScrollRef} style={{ ...scrollStyle, ...({ paddingTop: 6, paddingBottom: 6 }) }}>{hero}{typeof children === "function" ? children(fitRows) : children}</div>)}
    </div>
  );
}

// Mobile phone/tablet "box": borderless-ish surface tinted subtly toward the category color
// (so cards are differentiable without clashing). The top line is the card's identity AND
// its summary: a pinned [colored icon chip + chief summary] row. Once the card's content is
// scrolled, that summary line collapses away into just the icon to reclaim space; tapping
// the row opens the full surface. Hoisted to module scope for stable identity.
// stickyHeader=true: the icon+title+summary bar is always visible (not collapsed on scroll).
// Used for desktop boxes view where cards are tall enough that collapsing the header loses
// the per-category summary the user always wants to see.
// expanded/collapsed/onToggleExpand: card-level expand-to-page (mobile rows orientation).
// When onToggleExpand is provided the header tap toggles expand instead of opening the full
// surface; onOpen moves to a small trailing open_in_new button. collapsed=true renders the
// header only (content hidden via display:none so embedded pollers — Phone — keep running).
function MobileBox({ icon, title, accentColor, summary, children, C, onOpen, style, statusDot = null, stickyHeader = false, dense = false, expanded = false, collapsed = false, onToggleExpand = null, headerActions = null, hero = null, count = null, narrowActions = false }) {
  const scrollRef = useRef(null);
  const tint = hexToRgba(accentColor, 0.05);
  const chipBg = hexToRgba(accentColor, 0.16) || C.hover;
  // The scroll-away header (and the bottom "more content" fade gradient that sat
  // beside it) only ever rendered on the pre-GM3 path and went with it. M3's feed
  // layout keeps the card header always visible, and clips the list cleanly at the
  // padded container edge with the "+N more" row as the more-content affordance.
  // Removing them also removes a ResizeObserver and a per-scroll setState that had
  // no remaining consumer — the state was still being written on every scroll and
  // re-rendering the card to produce an identical tree.
  //
  // `stickyHeader` still selects between the two header layouts below (the
  // 5-column card grid passes it); what's gone is the scroll-driven COLLAPSE of
  // the non-sticky one, which was a pre-GM3 behaviour.

  // The card owns a fixed slice of the screen, so it renders exactly the whole
  // rows that fit that slice — no clipped row, no dead gap, and no page scroll.
  const fitRows = useFitRows(scrollRef, { enabled: !collapsed, watch: `${dense}|${expanded}|${count}` });

  return (
    // GM3 filled card: borderless plain surface on the deeper tonal page — depth
    // from tone, no outline, matching the full-panel view's card language.
    // Calm-rows v2: each card gets a whisper of its category color mixed into the
    // surface (M3 tonal container differentiation) so the five cards read as five
    // distinct surfaces without any harsh color.
    <div data-nc-feed="true"
      style={{ position: "relative", background: `color-mix(in srgb, ${C.bg} 94%, ${accentColor || C.accent} 6%)`, borderRadius: RADIUS.lg, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
        // Feed card: height comes from content. No fixed fifth, so no clipped row
        // and no dead gap under a short card.
        minHeight: 0, ...style }}>
      {stickyHeader ? (
        // Sticky header: never collapses. Shows icon chip + title label + summary on separate line.
        // With onToggleExpand (5-column card grid) the header tap expands this column and
        // squishes the rest; opening the full surface moves to a trailing open_in_new button.
        // Columns header: title row, then action buttons on their OWN row — a
        // ~240px column can't fit a title plus several 48dp buttons on one line
        // (the Calendar column title was crushed to nothing, owner 7/21).
        // Columns are tall; one extra header row is free, a crushed title is not.
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", flexShrink: 0, minWidth: 0, borderBottom: `1px solid ${C.divider}` }}>
          <ListItem type="button" onClick={onToggleExpand || onOpen} title={title} aria-label={title} aria-expanded={onToggleExpand ? expanded : undefined}
            style={{
              flex: 1, minWidth: 0, cursor: (onToggleExpand || onOpen) ? "pointer" : "default",
              ...denseListVars({ dense: true }),
              '--md-list-item-one-line-container-height': '40px',
              '--md-list-item-two-line-container-height': '52px',
              '--md-list-item-top-space': '6px', '--md-list-item-bottom-space': '5px',
              '--md-list-item-leading-space': '12px', '--md-list-item-trailing-space': '10px',
            }}>
            <span slot="start" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, color: accentColor || C.accent, flexShrink: 0 }}>{suiteIcon(icon, 20)}</span>
            <div slot="headline" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: NC_TYPE.title, fontWeight: 650, color: C.text, fontFamily: NC_FONT_STACK, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
              {onToggleExpand && <span style={{ display: "flex", color: C.faint, flexShrink: 0, marginLeft: "auto" }}>{suiteIcon(expanded ? "close_fullscreen" : "expand_content", 16)}</span>}
            </div>
            {summary && (
              <div slot="supporting-text" style={{ fontSize: NC_TYPE.small, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontStyle: "normal" }}>{summary}</div>
            )}
          </ListItem>
          {(headerActions || (onToggleExpand && onOpen)) && (
            <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2, padding: "0 4px 2px", minWidth: 0, overflow: "hidden" }}>
              {headerActions}
              {onToggleExpand && onOpen && (
                <IconBtn icon="open_in_new" iconSize={18} color={C.faint} onClick={onOpen} title={`Open ${title}`} aria-label={`Open ${title}`} />
              )}
            </span>
          )}
        </div>
      ) : (
        // Collapsing header: hides when the card content scrolls (mobile default).
        // dense = aggressively compact: a thin single-line header that reclaims vertical space.
        // Calm-rows: the header now always uses the thin metrics. Since the resting
        // list no longer overflows, the collapse-on-scroll never fires, so a 56px
        // comfortable header would permanently eat a third of a short card and leave
        // a one-row slat (owner, iPad). Thin + always visible beats fat + frozen.
        // Feed mode: a real M3 card header — 48dp tall, titled, tappable. The old
        // 22px sliver was both unreadable and an illegal touch target.
        // narrowActions (phone-width cards): action buttons wrap to their own row —
        // 48dp buttons inline with the title crushed it to a single letter.
        <div style={{ display: "flex", flexDirection: narrowActions && headerActions ? "column" : "row", alignItems: narrowActions && headerActions ? "stretch" : "center", width: "100%", flexShrink: 0, minWidth: 0, maxHeight: "none", overflow: "hidden", transition: "max-height 0.2s ease, opacity 0.15s ease" }}>
          <ListItem type="button" onClick={onToggleExpand || onOpen} title={title} aria-label={title} aria-expanded={onToggleExpand ? expanded : undefined}
            style={{
              flex: 1, minWidth: 0, cursor: (onToggleExpand || onOpen) ? "pointer" : "default",
              '--md-list-item-one-line-container-height': '48px',
              '--md-list-item-two-line-container-height': '56px',
              '--md-list-item-top-space': '6px', '--md-list-item-bottom-space': '6px',
              '--md-list-item-leading-space': '16px', '--md-list-item-trailing-space': '8px',
            }}>
            <span slot="start" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, color: accentColor || C.accent, flexShrink: 0 }}>{suiteIcon(icon, 22)}</span>
            {<>
                  <div slot="headline" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: NC_TYPE.title, fontWeight: 650, color: C.text, fontFamily: NC_FONT_STACK, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
                    {/* Live total — the guarantee that nothing is hidden or forgotten
                        even when only the first few rows fit on screen. */}
                    {count > 0 && (
                      <span style={{ flexShrink: 0, minWidth: 22, height: 20, padding: "0 7px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill, background: softBg(accentColor || C.accent, 0.18), color: accentColor || C.accent, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.meta, fontWeight: 700, lineHeight: 1 }}>{count}</span>
                    )}
                  </div>
                  {summary && <div slot="supporting-text" style={{ fontSize: NC_TYPE.body, color: C.muted, fontFamily: NC_FONT_STACK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontStyle: "normal" }}>{summary}</div>}
                </>}
            {onToggleExpand && <span slot="end" style={{ display: "flex", color: C.faint, flexShrink: 0 }}>{suiteIcon(expanded ? "close_fullscreen" : "expand_content", 12)}</span>}
          </ListItem>
          {narrowActions && headerActions ? (
            <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2, padding: "0 4px 2px" }}>
              {headerActions}
              {onToggleExpand && onOpen && (
                <IconBtn icon="open_in_new" iconSize={18} color={C.faint} onClick={onOpen} title={`Open ${title}`} aria-label={`Open ${title}`} />
              )}
            </span>
          ) : (<>
            {headerActions && (
              <span style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, marginRight: 2 }}>{headerActions}</span>
            )}
            {onToggleExpand && onOpen && (
              <IconBtn icon="open_in_new" iconSize={13} color={C.faint} onClick={onOpen} title={`Open ${title}`} aria-label={`Open ${title}`} style={{ marginRight: 4 }} />
            )}
          </>)}
        </div>
      )}
      {/* Hero renders INSIDE the scrolling list as its emphasized first row —
          a pinned bar read as a frozen header and locked up scroll space
          (owner tickets tr60ibj2/xFD22e5T, 7/21). */}
      <div ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflow: "hidden", paddingBottom: 4, ...(collapsed ? { display: "none" } : {}) }}>
        {hero}
        {typeof children === "function" ? children(fitRows) : children}
      </div>
      {/* No gradient scrim: M3 clips scrolling lists cleanly at the padded
          container edge, and the "+N more" row is the more-content affordance.
          The old fade overlay only ever rendered on the pre-GM3 path and went
          with it. */}
      {statusDot && <span style={{ position: "absolute", top: 7, right: onToggleExpand ? 36 : 7, width: 8, height: 8, borderRadius: RADIUS.pill, background: statusDot, boxShadow: `0 0 0 2px ${C.bg}`, pointerEvents: "none" }} />}
    </div>
  );
}

// Abbreviated relative time (5m · 2h · Tue · Jun 3) shared by the hero blocks.
function fmtRelShort(raw) {
  try {
    const d = new Date(raw); const diff = Date.now() - d.getTime();
    if (isNaN(d.getTime())) return "";
    if (diff >= 0 && diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m`;
    if (diff >= 0 && diff < 86400000) return `${Math.round(diff / 3600000)}h`;
    if (diff >= 0 && diff < 604800000) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}

// HeroItem — the card's most-important item, rendered as an EMPHASIZED FLUSH ROW
// (v3, owner 7/21: the rounded tinted pill read as a section header, not as
// content). Same left-dot metric and inset as every list row, a faint full-bleed
// accent wash, and bolder title text — so it reads as "the top row, highlighted",
// continuous with the rows below it, not a separate header block. Tapping opens.
function HeroItem({ title, meta, accent, C, onClick }) {
  if (!title) return null;
  const a = accent || C.accent;
  return (
    <div role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter") onClick(); } : undefined}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, flexShrink: 0,
        padding: "7px 12px",
        background: softBg(a, 0.07),
        boxShadow: `inset 3px 0 0 ${a}`,
        cursor: onClick ? "pointer" : "default",
      }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.body, fontWeight: 650, lineHeight: 1.3, color: C.text, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>{title}</div>
        {meta && <div style={{ marginTop: 1, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.small, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</div>}
      </div>
    </div>
  );
}

// MoreRow — the quiet "+N more" reveal under a capped list (calm-rows prototype).
// One full-width text button; expanding is always one tap, so no information is lost.
function MoreRow({ count, open = false, label = "more", onClick, C }) {
  return (
    <ActionBtn variant="text" icon={open ? "expand_less" : "expand_more"} iconSize={20}
      labelColor={C.accent} labelSize={15}
      height={48} onClick={onClick}
      title={open ? `Hide ${label}` : `Show ${count} ${label}`}
      aria-label={open ? `Hide ${label}` : `Show ${count} ${label}`}
      style={{ width: "100%" }}>
      {open ? `Show less` : `Show all ${count} ${label === "more" ? "" : label}`.trim()}
    </ActionBtn>
  );
}

function NerveCenter({ T, user = null, sections = [], tasks = [], shailos = [], priorities = [], aiOpts = null, aiConfigLoading = false, onRefreshAiConfig, onAddTask, onAddMrsWTask, onOpenQueue, onOpenShailos, onOpenShailaAdd, onOpenPhone, onOnlineChange, onRecordConversation, onRecordCall, onCompleteTask, onDeleteTask, onEditTask, onOpenZen, onOpenGoogleSettings, sidebarW = 0, topOffset = 0, actionsOpen = false, setActionsOpen, actionCategoryId = "tasks", setActionCategoryId, calendarEvents = null, gmailMessages = null, googleLoading = false, googleError = null, googleToken = null, googleClientId = null, googleAccounts = [], googleAccountFilter = "all", onSelectGoogleAccount, onConnectGoogle, onDisconnectGoogle, onLoadEmailDetail, onCreateCalendarEvent, onDeleteCalendarEvent, chiefProfile = null, chiefProfileLoading = false, onAppendChiefProfileNote, onRecordChiefLearning, onSaveChiefProfileMarkdown, googleWasConnected = false, onRefreshCalendar, paneWeights = { tasks: 1, shailos: 1, phone: 1 }, onPaneWeightsChange, onOpenChiefPage, googlePaneHeight = 244, onGooglePaneHeightChange, onPolishNerveItems, clockTime = null, chiefPage = false, onCloseChiefPage, healthPage = false, onOpenHealth, onCloseHealthPage, healthData = null, healthConfig = null, healthHistory = null, onSaveHealthData, onSyncHealth }) {
  const viewportW = useViewportWidth();
  // M3 window size class on both axes. Height is what drives row density (see
  // densityPref below); width still comes from `availableW` further down, which
  // subtracts the nav rail.
  const sizeClass = useWindowSizeClass();
  const [healthCardVisible, setHealthCardVisible] = useState(() => {
    try { return localStorage.getItem("nc_health_card_visible") !== "0"; } catch { return true; }
  });
  const [healthCardH, setHealthCardH] = useState(() => {
    try { return Math.max(56, Math.min(140, Number(localStorage.getItem("nc_health_card_h")) || 92)); } catch { return 92; }
  });
  const startHealthResize = e => {
    if (touchLayout) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = healthCardH;
    const move = ev => {
      const next = Math.max(56, Math.min(140, startH - (ev.clientY - startY)));
      setHealthCardH(next);
      try { localStorage.setItem("nc_health_card_h", String(Math.round(next))); } catch {}
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [clockStyle, setClockStyle] = useState(() => { try { return localStorage.getItem("nc_clock_style") || "digital"; } catch { return "digital"; } });
  const [clockMenuPos, setClockMenuPos] = useState(null);
  const [clockTimelineOpen, setClockTimelineOpen] = useState(() => { try { return localStorage.getItem("nc_clock_timeline") === "1"; } catch { return false; } });
  // Full/Focus view toggle removed per owner ticket 5ORgAKX — always Full now.
  const ncViewMode = "full";
  const [taskDraft, setTaskDraft] = useState("");
  const [taskPriority, setTaskPriority] = useState(priorities.find(p => p.id === "now")?.id || priorities[0]?.id || "now");
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [taskComposerMrsW, setTaskComposerMrsW] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editText, setEditText] = useState("");
  const [openTaskActionsId, setOpenTaskActionsId] = useState(null);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [autoTaskLimit, setAutoTaskLimit] = useState(MIN_COLLAPSED_TASKS);
  const [activeStackPanel, setActiveStackPanel] = useState(0);
  const taskGridRef = useRef(null);
  const taskHeaderRef = useRef(null);
  const taskListRef = useRef(null);
  const taskMoreButtonRef = useRef(null);
  const taskInputRef = useRef(null);
  const stackedTaskInputRef = useRef(null);
  const deskShailosRef = useRef(null);      // desktop Shailos pane list (measured)
  const deskMailRef = useRef(null);         // desktop Google Mail card body (available height)
  const deskMailListRef = useRef(null);     // its <md-list> (row unit)
  const calendarNowRef = useRef(null);     // timeline scroll container
  const calendarNowLineRef = useRef(null); // now-line div — top driven by rAF, not React
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [addEventText, setAddEventText] = useState('');
  const [addEventLoading, setAddEventLoading] = useState(false);
  const [addEventError, setAddEventError] = useState(null);
  const [hoverEmail, setHoverEmail] = useState(null);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [emailDetails, setEmailDetails] = useState({});
  const [emailDetailLoadingId, setEmailDetailLoadingId] = useState(null);
  const [emailDetailError, setEmailDetailError] = useState("");
  const hoverTimerRef = useRef(null);
  const [reconnectTimedOut, setReconnectTimedOut] = useState(false);
  const [chiefBrief, setChiefBrief] = useState(null);
  const [ncSummary, setNcSummary] = useState(null);
  const [ncSummaryLoading, setNcSummaryLoading] = useState(false);
  const [ncSummaryError, setNcSummaryError] = useState(false); // last summary attempt failed (gateway null/throw)
  const [ncSummaryRefreshNonce, setNcSummaryRefreshNonce] = useState(0);
  const ncInFlightRef = useRef(false); // a summary scan is in flight (survives effect re-runs)
  const ncFailStreakRef = useRef(0);   // consecutive failed scans → exponential retry backoff
  const forcedSnapshotRef = useRef(false); // set by retryNcSummary(); bypasses the Firestore throttle
  const pendingSnapshotRecheckRef = useRef(null);
  const lastSnapshotKeyRef = useRef(undefined); // undefined = not yet hydrated from the localStorage cache
  const [chiefLoading, setChiefLoading] = useState(false);
  const [chiefError, setChiefError] = useState("");
  const [chiefPrompt, setChiefPrompt] = useState("");
  const [chiefDialogue, setChiefDialogue] = useState([]);
  const [chiefDialogueLoading, setChiefDialogueLoading] = useState(false);
  const [chiefSmartSaving, setChiefSmartSaving] = useState("");
  const [chiefRefreshNonce, setChiefRefreshNonce] = useState(0);
  const [chiefChatHeight, setChiefChatHeight] = useState(() => readChiefChatHeight());
  const [taskSuggestions, setTaskSuggestions] = useState([]);
  const [taskSuggestionsLoading, setTaskSuggestionsLoading] = useState(false);
  const [chiefLearning, setChiefLearning] = useState(() => readChiefLearning());
  const [sessionSuppressed, setSessionSuppressed] = useState([]);
  const sessionSuppressedRef = useRef([]);
  useEffect(() => { sessionSuppressedRef.current = sessionSuppressed; }, [sessionSuppressed]);
  const [chiefProfileOpen, setChiefProfileOpen] = useState(false);
  const [chiefProfileDraft, setChiefProfileDraft] = useState("");
  const [chiefProfileSaving, setChiefProfileSaving] = useState(false);
  const [chiefTaskDraft, setChiefTaskDraft] = useState("");
  const [chiefTaskPriority, setChiefTaskPriority] = useState("");
  const [pendingChiefCalendarAction, setPendingChiefCalendarAction] = useState(null);
  const chiefPromptRef = useRef(null);
  const chiefRefreshHandledRef = useRef(chiefRefreshNonce);
  const chiefTaskDraftSourceRef = useRef("");
  useEffect(() => {
    if (chiefProfile?.learning?.events?.length) {
      const next = { version: 1, events: chiefProfile.learning.events.slice(-200) };
      setChiefLearning(next);
      writeChiefLearning(next);
    }
    setChiefProfileDraft(markdownFromChiefProfile(chiefProfile));
  }, [chiefProfile?.updatedAt]); // eslint-disable-line
  const [mobileMenuOpen, setMobileMenuOpen] = useState(null); // id of section whose ··· menu is open
  const [googleAcctMenuOpen, setGoogleAcctMenuOpen] = useState(false); // account-picker dropdown in calendar/mail card headers
  const [mobileExpanded, setMobileExpanded] = useState(() => new Set()); // ids of expanded accordion sections — all collapsed by default; multiple may stay open
  const [expandedBoxId, setExpandedBoxId] = useState(null); // boxes view: card expanded to page height (null = even 5-way split); ephemeral by design
  const [expandedRows, setExpandedRows] = useState(() => new Set()); // box-mode rows tapped open to reveal full text
  const toggleRow = key => setExpandedRows(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const [mobileTimelineOpen, setMobileTimelineOpen] = useState(false); // mobile hero timeline reveal
  // Card-grid ("boxes") calendar box: "agenda" (compact upcoming list) or "timeline" (the
  // Google-Calendar-style live-time day grid, same as the full-panel card). Persisted.
  // v7: the prototype defaults to Agenda — that is where the per-event importance
  // control lives and where importance ordering is visible. Timeline is one tap away.
  const [calCardView, setCalCardView] = useState(() => { try { return localStorage.getItem("nc_cal_card_view") || ("agenda"); } catch { return "agenda"; } });
  const toggleCalCardView = () => setCalCardView(prev => { const next = prev === "timeline" ? "agenda" : "timeline"; try { localStorage.setItem("nc_cal_card_view", next); } catch {} return next; });
  // Accordion mode is retired (owner: unused, extra). Mobile always gets the 5-card
  // grid; desktop is "full" (3-column) or "boxes". A persisted "accordion" pref from
  // an older build coerces to the nearest surviving layout.
  const [desktopLayout, setDesktopLayout] = useState(() => { try { const v = localStorage.getItem("nc_desktop_layout") || "full"; return v === "accordion" ? "full" : v; } catch { return "full"; } });
  const setDesktopLayoutPersist = val => { setDesktopLayout(val); try { localStorage.setItem("nc_desktop_layout", val); } catch {} };
  // Row density. Default is "auto", which follows the M3 HEIGHT window size class
  // rather than a stored preference:
  //
  //   expanded height (>=900dp, e.g. a large display in portrait)  -> comfortable
  //   medium / compact height (a laptop, or a tablet in landscape) -> compact
  //
  // This is what resolves the long-standing tension between the standing
  // "one screen, no page scroll" rule and GM3 row metrics. The constraint is
  // about HEIGHT, so density is now decided by height instead of by a manual
  // switch the owner has to remember to flip per device. Neither level goes below
  // the 48dp touch-target floor — compact is M3 density -2, not "smaller".
  //
  // "compact"/"comfortable" remain as explicit overrides that stick; the toggle
  // cycles auto -> compact -> comfortable -> auto.
  const [densityPref, setDensityPref] = useState(() => { try { return localStorage.getItem("nc_mobile_density") || "auto"; } catch { return "auto"; } });
  const toggleMobileDensity = () => setDensityPref(prev => {
    const next = prev === "auto" ? "compact" : prev === "compact" ? "comfortable" : "auto";
    try { localStorage.setItem("nc_mobile_density", next); } catch {}
    return next;
  });
  // Hoisted so EVERY layout (full panel, boxes, accordion) honors the same density.
  const dense = densityPref === "auto" ? !sizeClass.isExpandedHeight : densityPref === "compact";
  // The control shows what mode it is IN, and its tooltip says what is actually
  // being applied — "Auto" alone would leave the owner guessing which way it went.
  const densityIcon = densityPref === "auto" ? "auto_awesome_motion" : dense ? "density_small" : "density_medium";
  const densityLabel = densityPref === "auto"
    ? `Row density: auto — ${dense ? "compact" : "comfortable"} on this screen`
    : `Row density: ${densityPref}`;
  const [phoneActivitySummary, setPhoneActivitySummary] = useState({ online: false, status: "DeskPhone offline", unreadTexts: 0, missedCalls: 0, voicemailCount: 0, texts: [], calls: [] });
  const phoneActivitySigRef = useRef("");
  const [phoneStatusSummary, setPhoneStatusSummary] = useState({ online: false, tone: "offline", label: "DeskPhone offline", voicemailCount: 0 });
  const handlePhoneStatusSummary = useCallback((next) => {
    setPhoneStatusSummary(prev => (
      prev.online === next.online &&
      prev.tone === next.tone &&
      prev.label === next.label &&
      prev.voicemailCount === next.voicemailCount
    ) ? prev : next);
  }, []);
  const handlePhoneActivitySummary = useCallback((next) => {
    const sig = JSON.stringify(next || {});
    if (sig === phoneActivitySigRef.current) return;
    phoneActivitySigRef.current = sig;
    setPhoneActivitySummary(next || {});
  }, []);
  // Give silent reconnect 6 seconds; if still not connected, surface the button
  useEffect(() => {
    if (!googleWasConnected || googleToken) { setReconnectTimedOut(false); return; }
    const t = setTimeout(() => setReconnectTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [googleWasConnected, googleToken]);

  // Helpers needed by both the Google IIFE and handleAddEvent
  const gmailHeader = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || '';
  const fmtFrom = (raw) => { const m = raw?.match(/^"?([^"<]+)"?\s*<[^>]+>/); return m ? m[1].trim() : (raw || '').split('@')[0]; };
  const decodeSnippet = (s) => (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();

  async function handleEmailSelect(msg) {
    if (!msg?.id) return;
    setSelectedEmailId(msg.id);
    setHoverEmail(null);
    clearTimeout(hoverTimerRef.current);
    if (emailDetails[msg.id] || emailDetailLoadingId === msg.id) return;
    if (!googleToken && !onLoadEmailDetail) {
      setEmailDetailError("Reconnect Google to read the full message.");
      return;
    }
    setEmailDetailError("");
    setEmailDetailLoadingId(msg.id);
    try {
      const detail = onLoadEmailDetail
        ? await onLoadEmailDetail(msg.id, msg.sourceAccount)
        : await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
            headers: { Authorization: `Bearer ${googleToken}` },
          }).then(async r => {
            if (r.status === 401) throw new Error("Google session expired. Reconnect Google.");
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              throw new Error(d?.error?.message || `Gmail message failed (${r.status})`);
            }
            return r.json();
          });
      setEmailDetails(prev => ({ ...prev, [msg.id]: { ...detail, fullBody: gmailFullBody(detail) || decodeSnippet(detail.snippet || msg.snippet) } }));
    } catch (e) {
      setEmailDetailError(e.message || "Could not load the full message.");
    } finally {
      setEmailDetailLoadingId(null);
    }
  }

  async function handleAddEvent() {
    if (!addEventText.trim() || addEventLoading) return;
    setAddEventLoading(true); setAddEventError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const eventBody = await aiParseCalendarEvent(addEventText, aiOpts || {}, { today });
      if (onCreateCalendarEvent) {
        await onCreateCalendarEvent(eventBody);
      } else {
        const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error?.message || 'Failed to create event'); }
      }
      setShowAddEvent(false); setAddEventText('');
      if (onRefreshCalendar) onRefreshCalendar();
    } catch (e) {
      setAddEventError(e.message || 'Something went wrong');
    } finally {
      setAddEventLoading(false);
    }
  }

  const C = cleanTheme(T);
  const ncType = NC_TYPE;

  // One Google account picker, shared by EVERY layout's Calendar/Mail headers —
  // it used to exist only in the desktop card strip (owner ticket HwhngHW).
  const googleAcctMenuEl = googleToken && googleAccounts.length >= 1 ? (
    <div style={{ position: "relative" }}>
      <IconBtn icon="manage_accounts" iconSize={16}
        color={googleAcctMenuOpen ? C.accent : C.muted}
        title={`Account: ${googleAccountFilter === "all" ? "Both" : googleAccountFilter}`}
        onClick={() => setGoogleAcctMenuOpen(p => !p)} />
      {googleAcctMenuOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 9100 }} onClick={() => setGoogleAcctMenuOpen(false)} />
          <div style={{ position: "absolute", right: 0, top: 30, zIndex: 9101, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, minWidth: 200, boxShadow: ELEV[3], overflow: "hidden" }}>
            <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, padding: "8px 12px 4px" }}>Account</div>
            {[...googleAccounts.map(em => ({ key: em, label: em })), ...(googleAccounts.length > 1 ? [{ key: "all", label: "Both accounts" }] : [])].map(opt => {
              const active = opt.key === "all" ? googleAccountFilter === "all" : googleAccountFilter === opt.key;
              return (
                <ListItem key={opt.key} type="button" onClick={() => { onSelectGoogleAccount?.(opt.key); setGoogleAcctMenuOpen(false); }}
                  style={{
                    width: "100%", borderTop: `1px solid ${C.divider}`, background: active ? softBg(C.accent, 0.08) : "transparent",
                    color: active ? C.accent : C.text, fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, fontWeight: active ? 600 : 400,
                    ...denseListVars({ dense: true }),
                  }}>
                  <span slot="start" style={{ width: 14, flexShrink: 0, display: "inline-flex" }}>{active && suiteIcon("check", 13)}</span>
                  <div slot="headline" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</div>
                </ListItem>
              );
            })}
            <ListItem type="button" onClick={() => { onConnectGoogle?.(); setGoogleAcctMenuOpen(false); }}
              style={{ width: "100%", borderTop: `1px solid ${C.divider}`, color: C.muted, fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, ...denseListVars({ dense: true }) }}>
              <span slot="start" style={{ width: 14, flexShrink: 0, display: "inline-flex" }}>{suiteIcon("add", 13)}</span>
              <div slot="headline">Add account</div>
            </ListItem>
          </div>
        </>
      )}
    </div>
  ) : null;
  // Same choices as menu-row items, for the compact list layout's section menus.
  const googleAcctMenuItems = googleToken && googleAccounts.length >= 1 ? [
    ...googleAccounts.map(em => ({
      icon: googleAccountFilter === em ? "radio_button_checked" : "radio_button_unchecked",
      label: em,
      run: () => onSelectGoogleAccount?.(em),
    })),
    ...(googleAccounts.length > 1 ? [{
      icon: googleAccountFilter === "all" ? "radio_button_checked" : "radio_button_unchecked",
      label: "Both accounts",
      run: () => onSelectGoogleAccount?.("all"),
    }] : []),
    { icon: "person_add", label: "Add account", run: () => onConnectGoogle?.() },
  ] : [];
  const availableW = Math.max(0, viewportW - sidebarW);
  // A real phone/tablet (not just a narrow desktop window) — gets the 5-box grid.
  const isMobileDevice = useMemo(() => isMobilePhoneDevice(), []);
  const isStacked = availableW < 760;
  const isTablet = !isStacked && availableW < 1120;
  const touchLayout = isStacked || isTablet;
  // The adaptive resting cap that used to be computed here is gone: its only
  // consumer sat on the pre-GM3 branch. Cards now derive their row count by
  // measuring themselves (useFitRows), which is what the GM3 feed layout wants —
  // height comes from the container, not from a guessed constant.
  // Desktop panes measure themselves the same way the cards do, so their resting
  // lists also end on a whole row inside the padding.
  const deskShailosFit = useFitRows(deskShailosRef, { enabled: !isStacked, watch: `${dense}|${expandedRows.has("desk-shailos")}` });
  const deskMailFit = useFitRows(deskMailRef, { rowsRef: deskMailListRef, enabled: !isStacked, watch: `${dense}|${googlePaneHeight}|${expandedRows.has("desk-mail")}|${selectedEmailId || ""}` });
  const paneW = {
    tasks: Math.max(0.55, Number(paneWeights?.tasks || 1)),
    shailos: Math.max(0.55, Number(paneWeights?.shailos || 1)),
    phone: Math.max(0.55, Number(paneWeights?.phone || 1)),
  };
  // ui=next: 16px gutters between panes (M3 grid rhythm). The gutter column IS
  // the invisible col-resize handle, so spacing and the grab target are one.
  const gridColumns = isStacked ? "1fr" : isTablet ? "repeat(2,minmax(0,1fr))" : `minmax(240px,${paneW.tasks}fr) 16px minmax(240px,${paneW.shailos}fr) 16px minmax(240px,${paneW.phone}fr)`;
  const googleH = Math.max(150, Math.min(420, Number(googlePaneHeight || 244)));
  // ui=next re-skin: Google-style borderless card. The page (pageBg) is a
  // distinctly deeper tonal surface than the card (C.bg) so the borderless card
  // reads as sharp against the background but stays soft — no shadow, no outline.
  // Depth from tone, exactly like google.com's filled cards. The single-theme
  // failure mode (page ≈ card white) is fixed by mixing bgSoft ~12% toward text.
  const pageBg = `color-mix(in srgb, ${C.bgSoft} 88%, ${C.text} 12%)`;
  // GM3 (July 2026): filled cards share ONE neutral surface — the section's accent
  // lives only in its icon puck. The accent parameter is kept so call sites stay
  // stable, but it no longer tints the card background.
  const tintedPanel = (_accent = C.accent) => (
    // Calm-rows v2: a whisper of the section color in the surface (M3 tonal
    // container differentiation); pre-proto keeps the single neutral surface.
    { background: `color-mix(in srgb, ${C.bg} 95%, ${_accent || C.accent} 5%)`, borderRadius: RADIUS.lg, display: "flex", flexDirection: "column", minHeight: isTablet && !isStacked ? 420 : 0, overflow: "hidden", boxShadow: "none" }
  );
  const ncPanel = tintedPanel(C.accent); // default; overridden per-section below
  const ncScrollPane = { overflow: "auto", flex: "1 1 auto", minHeight: 0, overscrollBehavior: "contain", scrollbarGutter: "stable", ...(isStacked ? { touchAction: "pan-y" } : {}) };
  const ncTaskBody = { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", overscrollBehavior: "contain" };
  const ncTaskList = (isStacked || showAllTasks) ? ncScrollPane : { ...ncScrollPane, flex: "0 0 auto", overflow: "visible", maxHeight: "none" };
  const ncTasksPanel = showAllTasks ? ncPanel : { ...ncPanel, alignSelf: "start", width: "100%" };
  // ui=next M3 re-skin — elevate the shared header/title/icon system in place.
  // Material 3: no dividing lines (depth from space + tone), leadership-weight
  // title typography, and a tonal rounded icon "puck" carrying each section's
  // accent. This flows to every section header on the surface at once.
  const ncHeader = { minHeight: 44, padding: `${SP.md} ${SP.md} ${SP.sm}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: SP.sm };
  const ncTitle = { fontSize: NC_TYPE.title, fontWeight: 650, letterSpacing: "-0.01em", color: C.text, fontFamily: NC_FONT_STACK, lineHeight: LINE.tight };
  const ncSectionIcon = (accent = C.accent) => ({ width: 30, height: 30, borderRadius: RADIUS.md, background: hexToRgba(accent || C.accent, 0.16), color: accent || C.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
  const phoneStatusColor = phoneStatusSummary.tone === "incoming" ? C.success : phoneStatusSummary.tone === "call" ? C.warning : phoneStatusSummary.online ? C.success : C.faint;
  const rawNowDate = clockTime instanceof Date ? clockTime : new Date(clockTime || Date.now());
  const nowDate = Number.isFinite(rawNowDate.getTime()) ? rawNowDate : new Date();
  const nowMs = nowDate.getTime();
  const clockParts = {
    timeMain: nowDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    timeSec: String(nowDate.getSeconds()).padStart(2, "0"),
    date: nowDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }),
  };

  const isShailaWork = t => isNerveTaskShailaWork(t, priorities);
  const primaryTaskQueue = tasks.filter(t => !isShailaWork(t));
  useEffect(() => {
    if (showAllTasks || isStacked || !primaryTaskQueue.length || typeof ResizeObserver === "undefined") {
      setAutoTaskLimit(MIN_COLLAPSED_TASKS);
      return;
    }

    let frame = 0;
    const recompute = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const gridH = taskGridRef.current?.getBoundingClientRect().height || 0;
        if (!gridH) return;
        const headerH = taskHeaderRef.current?.getBoundingClientRect().height || 0;
        // 48 = the shared MoreRow's height (M3 touch floor). It used to be a 24px
        // sliver measured off a ref; standardizing on MoreRow made that ref dead, and
        // a stale 24 here under-reserved space and clipped the last task row.
        const moreH = primaryTaskQueue.length > MIN_COLLAPSED_TASKS ? 48 : 0;
        const rows = Array.from(taskListRef.current?.querySelectorAll("[data-nc-task-row='true']") || []);
        const measuredRows = rows.map(row => row.getBoundingClientRect().height).filter(h => h > 0);
        // Trust the real measured row height (dense rows run ~28 px) — clamping it
        // up to 56 halved the fill and left "+N more" floating over dead whitespace.
        const avgRowH = measuredRows.length
          ? Math.max(24, measuredRows.reduce((sum, h) => sum + h, 0) / measuredRows.length)
          : 56;
        const nextLimit = Math.max(
          MIN_COLLAPSED_TASKS,
          Math.floor(Math.max(0, gridH - headerH - moreH) / avgRowH)
        );
        setAutoTaskLimit(prev => {
          const bounded = Math.min(primaryTaskQueue.length, nextLimit);
          return prev === bounded ? prev : bounded;
        });
      });
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    [taskGridRef.current, taskHeaderRef.current, taskListRef.current].filter(Boolean).forEach(el => observer.observe(el));
    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [primaryTaskQueue.length, showAllTasks, taskComposerOpen, touchLayout]);
  const collapsedTaskLimit = Math.min(primaryTaskQueue.length, Math.max(MIN_COLLAPSED_TASKS, autoTaskLimit));
  // Calm-rows prototype: the tall desktop Tasks pane keeps its measured auto-fit
  // (fills the column, never clips — the pane is full height); the emphasized top
  // row is rendered separately and excluded from this list.
  const effectiveTaskLimit = collapsedTaskLimit;
  const hiddenTaskCount = Math.max(0, primaryTaskQueue.length - effectiveTaskLimit);
  const primaryTasks = (isStacked || showAllTasks) ? primaryTaskQueue : primaryTaskQueue.slice(0, effectiveTaskLimit);
  const visibleShailos = shailos.filter(Boolean);
  const timeBucket = Math.floor(nowMs / CHIEF_TIME_BUCKET_MS);
  const calendarMinuteKey = Math.floor(nowMs / 60000);
  const calendarRows = useMemo(() => {
    const nowForRows = calendarMinuteKey * 60000;
    const nowD = new Date(nowForRows);
    const pad = n => String(n).padStart(2, "0");
    const todayStr    = `${nowD.getFullYear()}-${pad(nowD.getMonth()+1)}-${pad(nowD.getDate())}`;
    const tomorrowD   = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() + 1);
    const tomorrowStr = `${tomorrowD.getFullYear()}-${pad(tomorrowD.getMonth()+1)}-${pad(tomorrowD.getDate())}`;
    const startOfTodayMs = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
    return (calendarEvents || [])
      // Drop events cancelled in Google Calendar — the API can still return them as
      // status:"cancelled" (e.g. a deleted instance of a recurring series), and stale
      // caches can hold a one-off after it's deleted. Either way it must not show.
      .filter(evt => evt && evt.status !== "cancelled")
      // Drop anything that finished before today — stale yesterday items were cluttering
      // the card. Multi-day / overnight events still running today survive the cut.
      // (all-day end dates are exclusive, so "ends at 00:00 today" = a yesterday event)
      .filter(evt => calendarEndMs(evt) > startOfTodayMs || calendarStartMs(evt) >= startOfTodayMs)
      .map((evt, index) => {
        const evtDateStr = (evt?.start?.dateTime || evt?.start?.date || "").slice(0, 10);
        const tomorrow = evtDateStr === tomorrowStr;
        const today    = evtDateStr === todayStr || (!tomorrow && !!evt?.start?.dateTime && evtDateStr < tomorrowStr);
        const routine  = isRoutineCalendarEvent(evt);
        const now      = !tomorrow && isCalendarEventCurrent(evt, nowForRows);
        const past     = !tomorrow && isCalendarEventPast(evt, nowForRows);
        const special  = !routine && !past;
        return {
          evt,
          index,
          routine,
          now,
          past,
          special,
          tomorrow,
          today,
          startMs: calendarStartMs(evt),
          label: formatCalendarWindow(evt),
        };
      });
  }, [calendarEvents, calendarMinuteKey]);
  const specialCalendarRows = calendarRows
    .filter(row => row.special)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 2);
  const calendarNowInsertIndex = useMemo(() => {
    if (!calendarRows.length) return 0;
    const nowForIndex = calendarMinuteKey * 60000;
    const nextIndex = calendarRows.findIndex(row => !row.past && row.startMs > nowForIndex);
    return nextIndex === -1 ? calendarRows.length : nextIndex;
  }, [calendarRows, calendarMinuteKey]);
  useEffect(() => {
    if (calendarEvents === null) return;
    const frame = requestAnimationFrame(() => {
      const el = calendarNowRef.current;
      if (!el) return;
      const n = new Date();
      const topPx = (n.getHours() * 60 + n.getMinutes()) * (TIMELINE_PX_HR / 60);
      // "Now" sits in the top third (calendar-app convention): the past gets one third,
      // the rest of the viewport shows what's coming.
      el.scrollTo({ top: Math.max(0, topPx - el.clientHeight / 3), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [calendarEvents, calCardView]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const PX_MIN = TIMELINE_PX_HR / 60;
    let raf;
    const tick = () => {
      if (calendarNowLineRef.current) {
        const n = new Date();
        calendarNowLineRef.current.style.top = `${(n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60) * PX_MIN}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ── Calendar importance pool (owner-assigned, persisted in Firestore) ──────
  const [calRatings, setCalRatings] = useState({});
  useEffect(() => {
    let cancelled = false;
    Store.loadCalendarRatings().then(r => { if (!cancelled) setCalRatings(r || {}); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);
  const rateCalendarEvent = useCallback((evt, rating) => {
    const key = calendarRatingKey(evt);
    if (!key) return;
    setCalRatings(prev => ({ ...prev, [key]: rating })); // optimistic
    Store.setCalendarRating(key, rating);
  }, []);
  // Cycle 1 → 2 → 3 → 1 on tap.
  const cycleCalendarRating = useCallback((evt) => {
    const next = (calendarRatingOf(evt, calRatings) % 3) + 1;
    rateCalendarEvent(evt, next);
  }, [calRatings, rateCalendarEvent]);

  // ── Needs-action ordering (v7) ─────────────────────────────────────────────
  // Stable sorts: flagged items rise, everything else keeps its natural order,
  // so a card never loses items — it just leads with what is waiting on you.
  const actionMail = useMemo(() => {
    const rows = [...(gmailMessages || [])];
    return rows.sort((a, b) => (mailIsUnread(b) ? 1 : 0) - (mailIsUnread(a) ? 1 : 0));
  }, [gmailMessages]);
  const actionTasks = useMemo(() => {
    const w = t => Number((priorities.find(p => p.id === t.priority) || {}).weight || 0);
    return [...primaryTaskQueue].sort((a, b) => w(b) - w(a));
  }, [primaryTaskQueue, priorities]);
  const actionShailos = useMemo(() => {
    const waiting = s => (s.status === "get_back" || s.isGetBackStep) ? 1 : 0;
    return [...visibleShailos].sort((a, b) => waiting(b) - waiting(a));
  }, [visibleShailos]);
  // Calendar keeps the REAL day (routine included) but leads with what the owner
  // rated as mattering; FYI-rated events sink rather than disappear.
  const actionCalendar = useMemo(() => {
    const rows = calendarRows.filter(r => !r.past);
    return [...rows].sort((a, b) => {
      if (a.now !== b.now) return a.now ? -1 : 1;
      const ra = calendarRatingOf(a.evt, calRatings), rb = calendarRatingOf(b.evt, calRatings);
      if (ra !== rb) return ra - rb;
      return a.startMs - b.startMs;
    });
  }, [calendarRows, calRatings]);

  // ── Calm-rows v2: auto-prioritized "most important item" per card ──────────
  // Each card leads with its hero (rendered by HeroItem); the list below excludes
  // it. Selection rules: Tasks = highest priority weight; Mail = newest unread,
  // else newest; Shailos = waiting-to-reply first (a person is waiting), else
  // oldest open; Calendar = happening now, else next upcoming, else tomorrow;
  // Phone = first unread text, else a missed call.
  const priWeightOf = id => Number((priorities.find(p => p.id === id) || {}).weight || 0);
  const heroTask = primaryTaskQueue.length
    ? primaryTaskQueue.reduce((best, t) => priWeightOf(t.priority) > priWeightOf(best.priority) ? t : best, primaryTaskQueue[0])
    : null;
  const heroMail = (gmailMessages || []).length
    ? ((gmailMessages || []).find(mailIsUnread) || gmailMessages[0])
    : null;
  const heroShaila = visibleShailos.length
    ? (visibleShailos.find(s => s.status === "get_back" || s.isGetBackStep) || visibleShailos[0])
    : null;
  const heroCalRow = calendarRows.find(r => r.now)
      || [...calendarRows.filter(r => !r.past && !r.tomorrow)].sort((a, b) => a.startMs - b.startMs)[0]
      || calendarRows.find(r => r.tomorrow)
      || null;
  const heroPhone = (() => {
    const t = (phoneActivitySummary.texts || [])[0];
    if (Number(phoneActivitySummary.unreadTexts || 0) > 0 && t) {
      return { title: t.preview || t.name || "New text", meta: [t.name, t.time].filter(Boolean).join(" · ") };
    }
    const missed = (phoneActivitySummary.calls || []).find(c => /miss/i.test(String(c.kind || "")));
    if (missed) return { title: `Missed call — ${missed.name || "unknown"}`, meta: missed.time || "" };
    return null;
  })();

  const chiefProfileNotes = useMemo(() => profileNotesForPrompt(chiefProfile), [chiefProfile?.updatedAt]);
  const chiefContext = useMemo(() => {
    const bucketDate = new Date(timeBucket * CHIEF_TIME_BUCKET_MS);
    const priById = new Map((priorities || []).map(p => [p.id, p.label || p.id]));
    const header = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || "";
    return {
      currentTime: bucketDate.toISOString(),
      localeTime: bucketDate.toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      // sourceKey hashes the RAW text, never the AI-polished `ncSummary`. The scan key
      // below strips `text` and keeps this instead — same trick already used for
      // emails — so a polish result landing on a task can't masquerade as a content
      // change and fire another snapshot (owner tickets umG220dj / 9f6eubMl, 7/21).
      tasks: primaryTaskQueue.slice(0, 18).map(task => ({
        text: nerveDisplaySummary(task, task.text || "Task"),
        sourceKey: hashChiefValue(`task|${task.id || ""}|${task.text || ""}`),
        priority: priById.get(task.priority) || task.priority || "",
        ageHours: task.createdAt ? Math.max(0, Math.round((timeBucket * CHIEF_TIME_BUCKET_MS - Number(task.createdAt || 0)) / 3600000)) : null,
      })),
      shailos: visibleShailos.slice(0, 12).map(item => ({
        text: nerveDisplaySummary(item, item.text || "Shaila"),
        sourceKey: hashChiefValue(`shaila|${item.shailaId || item.id || ""}|${item.parentTask || item.text || ""}`),
        status: item.status === "get_back" || item.isGetBackStep ? "waiting to reply" : "pending answer",
      })),
      calendar: calendarRows.filter(r => !r.past).slice(0, 24).map(row => ({
        id: cleanOneLine(row.evt?.id || "", 120),
        calendarId: cleanOneLine(row.evt?.calendarId || "primary", 180),
        sourceKey: hashChiefValue(`calendar|${row.evt?.id || row.evt?.summary || ""}`),
        freshnessKey: hashChiefValue(`calendar|${row.evt?.id || row.evt?.summary || ""}|${row.evt?.updated || ""}|${row.evt?.start?.dateTime || row.evt?.start?.date || ""}|${row.evt?.end?.dateTime || row.evt?.end?.date || ""}`),
        summary: cleanOneLine(row.evt?.summary || "(no title)", 220),
        start: row.evt?.start?.dateTime || row.evt?.start?.date || "",
        end: row.evt?.end?.dateTime || row.evt?.end?.date || "",
        label: row.label,
        now: row.now,
        past: row.past,
        special: row.special,
        routine: row.routine,
      })),
      emails: (gmailMessages || []).slice(0, 12).map(msg => ({
        id: cleanOneLine(msg.id || "", 120),
        threadId: cleanOneLine(msg.threadId || "", 120),
        sourceKey: hashChiefValue(`mail|${msg.threadId || msg.id || header(msg, "Subject") || ""}`),
        freshnessKey: hashChiefValue(`mail|${msg.threadId || msg.id || header(msg, "Subject") || ""}|${msg.internalDate || header(msg, "Date") || ""}|${msg.snippet || ""}`),
        from: fmtFrom(header(msg, "From")),
        subject: cleanOneLine(header(msg, "Subject") || "(no subject)", 220),
        summary: cleanOneLine(msg.aiSummary || decodeSnippet(msg.snippet || ""), 280),
        date: header(msg, "Date"),
      })),
      phone: phoneActivitySummary,
      profile: { notes: chiefProfileNotes },
    };
  }, [timeBucket, priorities, primaryTaskQueue, visibleShailos, calendarRows, gmailMessages, phoneActivitySummary, chiefProfileNotes]);
  const chiefLearningProfile = useMemo(() => buildChiefLearningProfile(chiefLearning), [chiefLearning]);
  const chiefScanContext = useMemo(() => ({
    ...chiefContext,
    learning: chiefLearningProfile,
    sessionSuppressed: sessionSuppressed.slice(-8).map(s => s.text),
  }), [chiefContext, chiefLearningProfile, sessionSuppressed]);
  const chiefScanKey = useMemo(() => JSON.stringify(chiefScanContext), [chiefScanContext]);
  const chiefFallback = null;
  // Content-only scan key: strips the fields derived from the 5-min timeBucket clock
  // (currentTime/localeTime/ageHours) so the snapshot effect refires only when real data
  // changes — new email, call, task, etc. With the clock included, every bucket rollover
  // changed the key and fired a dashboard-snapshot AI call like a 5-minute metronome
  // (owner ticket jYozknRO, flagged by the leak detector).
  // Owner ticket gufdsEDT (7/19, flagged by the leak detector at 97 calls/day vs ~32):
  // two more volatile fields were still churning this key after the clock strip above.
  // emails[].summary prefers msg.aiSummary, which lands ASYNCHRONOUSLY after the polish
  // job — every Gmail-push arrival changed the key once for the snippet and again when
  // its AI summary landed (and Gmail push, 4.87.0, delivers mail one message at a time
  // where polling used to batch it). calendar[].now/past are clock-derived and flip at
  // every event boundary. Identity + freshness of each item are already fully covered by
  // sourceKey/freshnessKey, so dropping these fields loses no real change detection.
  // Third clock found 7/19 (leak detector: ~5-min metronome at 641 calls/day): the
  // phone block. texts[].time / calls[].time are RELATIVE ("12m", "3h") and the offline
  // status line embeds "last seen Xm ago" — every relay refresh rewrote those strings
  // and re-fired the snapshot. Identity/freshness of phone activity is captured by
  // name+preview/kind+unread, so dropping time/status loses no real change detection.
  const ncSummaryScanKey = useMemo(() => JSON.stringify({
    ...chiefContext,
    currentTime: undefined,
    localeTime: undefined,
    // `text` drops out for the same reason `summary` does on emails: it prefers the
    // AI-polished ncSummary, which lands asynchronously AFTER the polish job, so
    // every polish rewrote this key and fired a fresh snapshot — a feedback loop
    // between two AI jobs (owner tickets umG220dj / 9f6eubMl / EsLx8PYS, 7/21).
    // sourceKey, hashed off the raw text, still catches a genuine edit.
    tasks: (chiefContext.tasks || []).map(({ ageHours, text, ...rest }) => rest),
    shailos: (chiefContext.shailos || []).map(({ text, ...rest }) => rest),
    emails: (chiefContext.emails || []).map(({ summary, ...rest }) => rest),
    calendar: (chiefContext.calendar || []).map(({ now, past, ...rest }) => rest),
    phone: chiefContext.phone ? {
      ...chiefContext.phone,
      // online flips with relay liveness (a flapping relay toggled it every poll and
      // re-fired the snapshot — owner buglog 7/19); connectivity isn't content.
      online: undefined,
      status: undefined,
      stale: undefined,
      texts: (chiefContext.phone.texts || []).map(({ time, ...rest }) => rest),
      calls: (chiefContext.phone.calls || []).map(({ time, ...rest }) => rest),
    } : chiefContext.phone,
  }), [chiefContext]);
  const taskSuggestionPriorities = useMemo(() =>
    [...(priorities || [])]
      .filter(p => !p.deleted && !p.isShaila && p.id !== "shaila")
      .sort((a, b) => b.weight - a.weight),
  [priorities]);
  const defaultSuggestionPriorityId = taskSuggestionPriorities.find(p => p.id === "today")?.id || taskSuggestionPriorities[0]?.id || priorities[0]?.id || "today";
  const taskSuggestionScanKey = useMemo(() => JSON.stringify({
    calendar: chiefContext.calendar,
    emails: chiefContext.emails,
    tasks: primaryTaskQueue.slice(0, 60).map(task => nerveDisplaySummary(task, task.text || "")),
    priorities: taskSuggestionPriorities.map(p => `${p.id}:${p.label}:${p.weight}`),
    learning: chiefLearningProfile,
  }), [chiefContext.calendar, chiefContext.emails, primaryTaskQueue, taskSuggestionPriorities, chiefLearningProfile]);
  const needsNervePolish = item => {
    const source = nerveSummarySource(item);
    const summary = String(item?.ncSummary || "").trim();
    const failedRecently = item?.ncSummaryFailedSource === source && Date.now() - Number(item?.ncSummaryFailedAt || 0) < 10 * 60 * 1000;
    return item.id && source && !item.ncSummaryPending && !failedRecently && !(summary && item.ncSummarySource === source);
  };
  const polishQueueKey = [...primaryTasks, ...visibleShailos]
    .map(item => {
      const source = nerveSummarySource(item);
      if (!needsNervePolish(item)) return "";
      return `${item.id}:${source}`;
    })
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    if (!onPolishNerveItems || !polishQueueKey) return;
    const items = [...primaryTasks, ...visibleShailos]
      .filter(needsNervePolish)
      .map(item => ({ id: item.id, kind: isShailaWork(item) ? "shaila" : "task", source: nerveSummarySource(item) }))
      .slice(0, 8);
    if (items.length) onPolishNerveItems(items);
  }, [polishQueueKey]); // eslint-disable-line

  // Chief of Staff is beta — AI fires ONLY when user explicitly clicks the "Brief me" pill.
  // Passive context changes (chiefScanKey) no longer auto-trigger a call.
  useEffect(() => {
    const now = Date.now();
    const ncLayoutActive = !isMobileDevice && desktopLayout !== "full";
    if (!chiefPage && !isMobileDevice && !ncLayoutActive) {
      setChiefBrief(null); setChiefLoading(false); setChiefError(""); return undefined;
    }
    const force = chiefRefreshNonce !== chiefRefreshHandledRef.current;
    chiefRefreshHandledRef.current = chiefRefreshNonce;
    if (!force) {
      // Passive mount/layout change: show cache if fresh, otherwise show empty (pill handles the rest).
      const cached = readStorageJson(CHIEF_SCAN_CACHE_KEY);
      if (cached?.brief && now - Number(cached.ts || 0) < CHIEF_SCAN_CACHE_MS) {
        setChiefBrief(cached.brief);
      } else {
        setChiefBrief(null);
      }
      setChiefLoading(false); setChiefError(""); return undefined;
    }
    // User explicitly triggered (pill click incremented chiefRefreshNonce) — run the AI call.
    setChiefBrief(null); setChiefError("");
    if (!aiOpts) { setChiefLoading(false); return undefined; }
    setChiefLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      writeStorageNumber(CHIEF_SCAN_LAST_RUN_KEY, Date.now());
      runAIJob("dashboard.chief_of_staff.v1", { context: chiefScanContext }, aiOpts, { genConfig: { temperature: 0.1, maxOutputTokens: 900 } })
        .then(job => {
          if (cancelled) return;
          const output = job?.output;
          if (output?.summary && output?.nextAction) {
            const actionKey = taskSuggestionKey(output.nextAction);
            const isDuplicate = sessionSuppressedRef.current.some(s => {
              const sk = taskSuggestionKey(s.text || "");
              return sk && actionKey && tokenOverlapRatio(sk, actionKey) >= 0.6;
            });
            if (isDuplicate) {
              setChiefBrief(CHIEF_QUIET_BRIEF); setChiefError("");
            } else {
              setChiefBrief(output);
              writeStorageJson(CHIEF_SCAN_CACHE_KEY, { scanKey: chiefScanKey, ts: Date.now(), brief: output });
            }
          } else {
            setChiefBrief(null);
            setChiefError(output ? "No recommendation available." : `AI returned no output — check gateway. Job: ${JSON.stringify(output).slice(0, 120)}`);
          }
        })
        .catch(e => {
          if (cancelled) return;
          setChiefBrief(null);
          setChiefError(`Brief failed: ${e?.message || "unknown error"}`);
        })
        .finally(() => { if (!cancelled) setChiefLoading(false); });
    }, 50);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [chiefRefreshNonce, chiefPage, desktopLayout, isMobileDevice]); // eslint-disable-line
  // dashboard.snapshot.v1: single consolidated call replacing separate nervecenter_summary + task_suggestions calls.
  // One flash-lite slot on page load instead of three.
  useEffect(() => {
    if (ncInFlightRef.current) return undefined;
    // Wait for AI config before scanning; show spinner while it's still loading.
    if (!aiOpts) { if (aiConfigLoading) setNcSummaryLoading(true); return undefined; }

    // 15 min (was 5): with content churning all evening (texts + emails), the
    // 5-min gap still allowed ~12 snapshot calls/hour — the bulk of the AI
    // live-log noise the owner flagged 7/19. Manual rescan bypasses the gap.
    const SESSION_GAP_MS = 15 * 60 * 1000;
    const isForced = forcedSnapshotRef.current;
    forcedSnapshotRef.current = false;
    // Hydrate the last-run key from the persisted cache once per mount, and restore the
    // cached result when the data hasn't changed — so a reload/remount costs zero AI calls.
    if (lastSnapshotKeyRef.current === undefined) {
      const cached = readStorageJson(SNAPSHOT_CACHE_KEY);
      lastSnapshotKeyRef.current = cached?.scanKey ?? null;
      if (cached?.result && cached.scanKey === ncSummaryScanKey) {
        setNcSummary({ supercrunch: cached.result.supercrunch, signals: cached.result.signals || [] });
        setTaskSuggestions(cached.result.taskSuggestions || []);
      }
    }
    // Nothing new since the last successful snapshot → no call at all (ticket jYozknRO:
    // "if for an hour nothing happened, shouldn't fire even once"). Manual rescan bypasses.
    if (!isForced && ncSummaryScanKey === lastSnapshotKeyRef.current) return undefined;
    let cancelled = false;
    shouldRunForContentAndClaim(SNAPSHOT_THROTTLE_KEY, isForced ? '' : ncSummaryScanKey, isForced ? 0 : SESSION_GAP_MS).then(({ run, cachedResult }) => {
      if (cancelled) return;
      if (!run) {
        // Another surface already scanned this exact content — adopt its result
        // instead of spending a second call on the identical question (owner ticket
        // WEmQ43Ks: open tabs must not multiply AI calls).
        if (cachedResult) {
          setNcSummary({ supercrunch: cachedResult.supercrunch, signals: cachedResult.signals || [] });
          setTaskSuggestions(cachedResult.taskSuggestions || []);
          setNcSummaryLoading(false);
          setTaskSuggestionsLoading(false);
          lastSnapshotKeyRef.current = ncSummaryScanKey;
          writeStorageJson(SNAPSHOT_CACHE_KEY, { scanKey: ncSummaryScanKey, ts: Date.now(), result: cachedResult });
          return;
        }
        // Silently deferred — no spinner, current result stays visible. Recheck
        // shortly rather than computing the exact remaining wait, since the claim is
        // now shared across tabs/devices and could be won by any of them first. The
        // guard above ends this loop once the pending change has been scanned.
        pendingSnapshotRecheckRef.current = window.setTimeout(() => setNcSummaryRefreshNonce(n => n + 1), 30000);
        return;
      }
      ncInFlightRef.current = true;
      setNcSummaryLoading(true);
      setNcSummaryError(false);
      setTaskSuggestionsLoading(true);
      const scanKeyAtStart = ncSummaryScanKey;
      const existingKeys = new Set(
        primaryTaskQueue
          .map(task => taskSuggestionKey(`${task.text || ""} ${nerveDisplaySummary(task, "")}`))
          .filter(Boolean)
      );
      const validPriorityIds = new Set(taskSuggestionPriorities.map(p => p.id));
      runAIJob("dashboard.snapshot.v1", {
        context: chiefContext,
        priorityOptions: taskSuggestionPriorities.map((p, index) => ({ id: p.id, label: p.label || p.id, rank: index + 1 })),
        existingTasks: primaryTaskQueue.slice(0, 80).map(task => ({ text: nerveDisplaySummary(task, task.text || "") })),
        learningProfile: chiefLearningProfile,
      }, aiOpts || {}, { genConfig: { temperature: 0.1, maxOutputTokens: 1600 } })
        .then(job => {
          const out = job?.output;
          if (!out || !out.supercrunch) {
            ncFailStreakRef.current += 1;
            setNcSummary(null);
            setNcSummaryError(true);
            console.warn("[Snapshot] No output. Raw job:", JSON.stringify(job).slice(0, 400));
            return;
          }
          ncFailStreakRef.current = 0;
          const summaryPart = { supercrunch: out.supercrunch, signals: out.signals || [] };
          setNcSummary(summaryPart);
          setNcSummaryError(false);
          const seen = new Set();
          const rows = (out.taskSuggestions || [])
            .map((item, index) => {
              const text = cleanOneLine(item.text, 260);
              const key = taskSuggestionKey(`${item.source || ""} ${item.sourceTitle || ""} ${text}`);
              return {
                id: key || `suggestion-${index}`,
                key,
                text,
                priorityId: validPriorityIds.has(item.priorityId) ? item.priorityId : defaultSuggestionPriorityId,
                source: cleanOneLine(item.source || "Dashboard", 40),
                sourceKey: cleanOneLine(item.sourceKey || "", 80),
                freshnessKey: cleanOneLine(item.freshnessKey || "", 80),
                sourceTitle: cleanOneLine(item.sourceTitle || "", 160),
                reason: cleanOneLine(item.reason || "", 160),
                actionType: cleanOneLine(item.actionType || "", 40),
              };
            })
            .map(item => decorateTaskSuggestion(item, chiefContext))
            .filter(item => item.text && item.key && !shouldHideTaskSuggestion(item, chiefLearning))
            .filter(item => {
              const bare = taskSuggestionKey(item.text);
              if (!bare || existingKeys.has(bare) || seen.has(item.key) || seen.has(item.suppressionKey) || seen.has(item.textKey)) return false;
              seen.add(item.key); seen.add(item.suppressionKey); seen.add(item.textKey);
              return true;
            })
            .slice(0, 3);
          setTaskSuggestions(rows);
          writeStorageJson(CHIEF_SUGGESTIONS_CACHE_KEY, { scanKey: ncSummaryScanKey, ts: Date.now(), rows });
          writeStorageJson(SNAPSHOT_CACHE_KEY, { scanKey: scanKeyAtStart, ts: Date.now(), result: { ...summaryPart, taskSuggestions: rows } });
          // Share this answer with every other open surface so none of them spends a
          // second call on the same content (owner ticket WEmQ43Ks).
          publishContentResult(SNAPSHOT_THROTTLE_KEY, scanKeyAtStart, { ...summaryPart, taskSuggestions: rows });
          lastSnapshotKeyRef.current = scanKeyAtStart;
        })
        .catch(e => {
          ncFailStreakRef.current += 1;
          setNcSummary(null);
          setNcSummaryError(true);
          setTaskSuggestions([]);
          console.warn("[Snapshot] Error:", e?.message || String(e));
        })
        .finally(() => {
          ncInFlightRef.current = false;
          setNcSummaryLoading(false);
          setTaskSuggestionsLoading(false);
        });
    });

    return () => {
      cancelled = true;
      if (pendingSnapshotRecheckRef.current) { window.clearTimeout(pendingSnapshotRecheckRef.current); pendingSnapshotRecheckRef.current = null; }
    };
  }, [ncSummaryScanKey, aiOpts, ncSummaryRefreshNonce]); // eslint-disable-line

  async function submitChiefPrompt(questionOverride = null) {
    const question = String(questionOverride ?? chiefPrompt).trim();
    if (!question || chiefDialogueLoading) return;
    const nextHistory = [...chiefDialogue, { role: "user", text: question }].slice(-6);
    setChiefDialogue(nextHistory);
    if (questionOverride == null) setChiefPrompt("");
    if (pendingChiefCalendarAction && looksLikeDeleteConfirmation(question)) {
      setChiefDialogueLoading(true);
      try {
        await onDeleteCalendarEvent?.(pendingChiefCalendarAction);
        setChiefDialogue([...nextHistory, { role: "assistant", text: `Deleted "${pendingChiefCalendarAction.summary}" from Calendar. I kept the preference in your Chief profile.` }].slice(-6));
        setPendingChiefCalendarAction(null);
        onRefreshCalendar?.();
      } catch (error) {
        setChiefDialogue([...nextHistory, { role: "assistant", text: error?.message || "I could not delete that calendar event. Reconnect Google and try again." }].slice(-6));
      } finally {
        setChiefDialogueLoading(false);
      }
      return;
    }
    if (looksLikePreferenceUpdate(question)) {
      const target = findCalendarPreferenceTarget(question, chiefContext.calendar);
      const note = profileNoteFromChiefText(question, target);
      setChiefDialogueLoading(true);
      try {
        await onAppendChiefProfileNote?.(note);
        if (target?.id) setPendingChiefCalendarAction(target);
        const answer = target?.summary
          ? `Updated your Chief profile: I will stop surfacing reminders for "${target.summary}" unless you ask. Should I delete it from Calendar too? Reply "delete it" if yes.`
          : "Updated your Chief profile with that preference.";
        removeStorageKey(CHIEF_SCAN_CACHE_KEY);
        removeStorageKey(CHIEF_SUGGESTIONS_CACHE_KEY);
        setChiefRefreshNonce(n => n + 1);
        setChiefDialogue([...nextHistory, { role: "assistant", text: answer }].slice(-6));
      } catch {
        setChiefDialogue([...nextHistory, { role: "assistant", text: "I understood the preference, but could not save it to the cloud profile yet." }].slice(-6));
      } finally {
        setChiefDialogueLoading(false);
      }
      return;
    }
    if (looksLikeChiefRejection(question)) {
      const rejectedBrief = chiefBrief;
      recordChiefSmartLearning(/(?:next|skip)/i.test(question) ? "next" : "not_now", rejectedBrief);
      const suppressText = cleanOneLine(rejectedBrief.nextAction || "", 260);
      if (suppressText) setSessionSuppressed(prev => [...prev, { text: suppressText, sources: chiefBrief?.sources || [], focusArea: chiefBrief?.focusArea || "" }].slice(-10));
      setChiefBrief(CHIEF_SEARCHING_BRIEF);
      setChiefError("");
      setChiefDialogue([...nextHistory, { role: "assistant", text: `Got it. I am dropping "${cleanOneLine(rejectedBrief.nextAction, 140)}" and rescanning for a better next move.` }].slice(-6));
      setChiefRefreshNonce(n => n + 1);
      return;
    }
    if (!aiOpts) {
      setChiefDialogue([...nextHistory, { role: "assistant", text: `${chiefBrief?.nextAction || ""} ${chiefBrief?.why || ""}` }].slice(-6));
      return;
    }
    setChiefDialogueLoading(true);
    try {
      const historyText = nextHistory.map(row => `${row.role}: ${row.text}`).join("\n");
      const job = await runAIJob("dashboard.chief_dialogue.v1", {
        context: chiefContext,
        brief: chiefBrief,
        history: historyText,
        question,
      }, aiOpts, { genConfig: { temperature: 0.2, maxOutputTokens: 1100 } });
      const answer = String(job?.output || job?.text || "").trim() || `${chiefBrief?.nextAction || ""} ${chiefBrief?.why || ""}`;
      setChiefDialogue([...nextHistory, { role: "assistant", text: answer }].slice(-6));
    } catch {
      setChiefDialogue([...nextHistory, { role: "assistant", text: `${chiefBrief?.nextAction || ""} ${chiefBrief?.why || ""}` }].slice(-6));
    } finally {
      setChiefDialogueLoading(false);
    }
  }

  function chiefSmartResponseNote(choice, label, brief) {
    const nextAction = cleanOneLine(brief?.nextAction || "", 240);
    const summary = cleanOneLine(brief?.summary || "", 180);
    const meaning = {
      done: "User marked the Chief recommendation as handled.",
      not_now: "User deferred the Chief recommendation.",
      next: "User asked Chief to move on to the next recommendation.",
      other: "User wanted a different direction than the prepared smart replies.",
    }[choice] || `User chose ${label}.`;
    return {
      category: `smart_response_${choice}`,
      text: `${meaning} Recommendation: ${nextAction}. Snapshot: ${summary}`,
      source: "Chief smart response",
    };
  }

  function recordChiefSmartLearning(choice, brief) {
    if (choice !== "done" && choice !== "not_now" && choice !== "next") return;
    const actionText = cleanOneLine(brief?.nextAction || "", 240);
    const eventRow = {
      ts: Date.now(),
      decision: choice === "not_now" ? "rejected" : choice === "done" ? "completed" : "accepted",
      issueKey: hashChiefValue(`chief|${brief?.focusArea || "dashboard"}|${actionText}`),
      freshnessKey: hashChiefValue(`chief|${brief?.focusArea || "dashboard"}|${brief?.summary || ""}|${actionText}`),
      suppressionKey: hashChiefValue(`chief|${choice}|${brief?.focusArea || "dashboard"}|${actionText}`),
      textKey: taskSuggestionKey(actionText),
      sourceTitleKey: taskSuggestionKey(brief?.summary || actionText),
      sourceBucket: "chief",
      source: "Chief",
      actionType: choice === "next" ? "next_move" : inferChiefActionType(actionText),
      priorityId: brief?.urgency || defaultSuggestionPriorityId,
    };
    setChiefLearning(prev => {
      const next = { version: 1, events: [...(prev?.events || []), eventRow].slice(-200) };
      writeChiefLearning(next);
      return next;
    });
    onRecordChiefLearning?.(eventRow);
    removeStorageKey(CHIEF_SCAN_CACHE_KEY);
    removeStorageKey(CHIEF_SUGGESTIONS_CACHE_KEY);
    return eventRow;
  }

  async function handleChiefSmartResponse(choice) {
    const brief = chiefBrief;
    const labels = { done: "Done", not_now: "Not now", next: "Next", other: "Other" };
    const label = labels[choice] || "Response";
    if (choice === "other") {
      setChiefSmartSaving("other");
      try { await onAppendChiefProfileNote?.(chiefSmartResponseNote(choice, label, brief)); } catch {}
      setChiefDialogue(rows => [...rows, { role: "assistant", text: "Tell me the direction you want instead." }].slice(-6));
      setChiefPrompt("");
      window.setTimeout(() => chiefPromptRef.current?.focus(), 0);
      setChiefSmartSaving("");
      return;
    }
    if (chiefSmartSaving || chiefDialogueLoading) return;
    setChiefSmartSaving(choice);
    const answer = choice === "done"
      ? "Logged as handled. I will treat this recommendation as closed."
      : choice === "not_now"
        ? "Logged as not now. I will down-rank similar nudges unless they become clearly urgent."
        : "Logged. I will look for the next clean move.";
    try {
      recordChiefSmartLearning(choice, brief);
      const suppressText = cleanOneLine(brief.nextAction || "", 260);
      if (suppressText) setSessionSuppressed(prev => [...prev, { text: suppressText, sources: brief.sources || [], focusArea: brief.focusArea || "" }].slice(-10));
      setChiefBrief(CHIEF_SEARCHING_BRIEF);
      setChiefError("");
      let cloudSaved = true;
      try {
        await onAppendChiefProfileNote?.(chiefSmartResponseNote(choice, label, brief));
      } catch {
        cloudSaved = false;
      }
      if (choice === "next") {
        setChiefDialogue(rows => [...rows, { role: "user", text: label }, { role: "assistant", text: cloudSaved ? "Dropping that recommendation and rescanning for the next clean move." : "Dropping that recommendation locally and rescanning for the next clean move. Cloud profile sync can catch up after reconnect." }].slice(-6));
      } else {
        setChiefDialogue(rows => [...rows, { role: "user", text: label }, { role: "assistant", text: cloudSaved ? answer : `${answer} Saved locally; cloud profile sync can catch up after reconnect.` }].slice(-6));
      }
      setChiefRefreshNonce(n => n + 1);
    } catch {
      setChiefDialogue(rows => [...rows, { role: "assistant", text: "I took the signal locally, but could not save it to the cloud profile yet." }].slice(-6));
    } finally {
      setChiefSmartSaving("");
    }
  }

  function updateTaskSuggestion(id, patch) {
    setTaskSuggestions(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  function recordTaskSuggestionDecision(row, decision) {
    const decorated = decorateTaskSuggestion(row, chiefContext);
    const eventRow = {
      ts: Date.now(),
      decision,
      issueKey: decorated.issueKey,
      freshnessKey: decorated.freshnessKey,
      sourceKey: decorated.sourceKey,
      suppressionKey: decorated.suppressionKey,
      textKey: decorated.textKey,
      sourceTitleKey: decorated.sourceTitleKey,
      sourceBucket: decorated.sourceBucket,
      source: decorated.source || "Dashboard",
      actionType: decorated.actionType || inferChiefActionType(decorated.text),
      priorityId: decorated.priorityId || defaultSuggestionPriorityId,
    };
    setChiefLearning(prev => {
      const next = {
        version: 1,
        events: [
          ...(prev?.events || []),
          eventRow,
        ].slice(-200),
      };
      writeChiefLearning(next);
      return next;
    });
    onRecordChiefLearning?.(eventRow);
  }

  function dismissTaskSuggestion(row) {
    recordTaskSuggestionDecision(row, "rejected");
    setTaskSuggestions(rows => {
      const next = rows.filter(item => item.id !== row.id);
      if (next.length === 0) removeStorageKey(CHIEF_SUGGESTIONS_LAST_RUN_KEY);
      return next;
    });
  }

  function createTaskSuggestion(row) {
    const text = String(row?.text || "").trim();
    if (!text) return;
    onAddTask?.(text, row.priorityId || defaultSuggestionPriorityId);
    recordTaskSuggestionDecision(row, "accepted");
    setTaskSuggestions(rows => {
      const next = rows.filter(item => item.id !== row.id);
      if (next.length === 0) removeStorageKey(CHIEF_SUGGESTIONS_LAST_RUN_KEY);
      return next;
    });
  }

  function createChiefNextTask() {
    const text = String(chiefTaskDraft || "").trim();
    if (!text) return;
    const priorityId = chiefTaskPriority || defaultSuggestionPriorityId;
    onAddTask?.(text, priorityId);
    recordChiefSmartLearning("done", chiefBrief);
    setChiefDialogue(rows => [...rows, { role: "assistant", text: "Added that next move to Tasks." }].slice(-6));
    setChiefTaskDraft("");
    chiefTaskDraftSourceRef.current = "";
  }

  async function saveChiefProfileDraft() {
    if (!onSaveChiefProfileMarkdown || chiefProfileSaving) return;
    setChiefProfileSaving(true);
    try {
      await onSaveChiefProfileMarkdown(chiefProfileDraft);
    } finally {
      setChiefProfileSaving(false);
    }
  }

  // Keep tab indicator in sync with native scroll position in stacked carousel
  useEffect(() => {
    if (!isStacked || !taskGridRef.current) return;
    const el = taskGridRef.current;
    let raf = null;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        setActiveStackPanel(prev => prev === idx ? prev : idx);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [isStacked]);

  const goToPanel = (idx) => {
    setActiveStackPanel(idx);
    if (isStacked && taskGridRef.current) {
      taskGridRef.current.scrollTo({ left: idx * taskGridRef.current.clientWidth, behavior: "smooth" });
    }
  };

  const startPaneResize = (leftKey, rightKey, e) => {
    if (touchLayout || !onPaneWeightsChange) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = { ...paneW };
    const pairTotal = start[leftKey] + start[rightKey];
    const pxPerUnit = Math.max(180, availableW / 8);
    const move = ev => {
      const delta = (ev.clientX - startX) / pxPerUnit;
      let nextLeft = Math.max(0.55, Math.min(pairTotal - 0.55, start[leftKey] + delta));
      const equalLeft = pairTotal / 2;
      if (Math.abs(nextLeft - equalLeft) < 0.08) nextLeft = equalLeft;
      const next = { ...start, [leftKey]: nextLeft, [rightKey]: pairTotal - nextLeft };
      if (["tasks", "shailos", "phone"].every(key => Math.abs(next[key] - 1) < 0.08)) {
        onPaneWeightsChange({ tasks: 1, shailos: 1, phone: 1 });
      } else {
        onPaneWeightsChange(next);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const paneResizeHandle = (leftKey, rightKey) => (
    <button type="button" aria-label="Resize panes" title="Drag to resize panes. Double-click to equalize." onPointerDown={e => startPaneResize(leftKey, rightKey, e)} onDoubleClick={() => onPaneWeightsChange?.({ tasks: 1, shailos: 1, phone: 1 })}
      style={{ display: touchLayout ? "none" : "flex", alignItems: "center", justifyContent: "center", minWidth: 16, width: 16, border: "none", padding: 0, cursor: "col-resize", background: "transparent", touchAction: "none" }}>
      <span style={{ width: 1, height: 48, borderRadius: 2, background: C.divider }} />
    </button>
  );
  const startGoogleResize = e => {
    if (touchLayout || !onGooglePaneHeightChange) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = googleH;
    const move = ev => {
      let nextH = Math.max(150, Math.min(420, startH - (ev.clientY - startY)));
      if (Math.abs(nextH - 244) < 12) nextH = 244;
      onGooglePaneHeightChange(nextH);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const googleResizeHandle = !touchLayout && (
    <button type="button" aria-label="Resize Google pane" title="Drag to resize calendar and mail. Double-click to reset." onPointerDown={startGoogleResize} onDoubleClick={() => onGooglePaneHeightChange?.(244)}
      style={{ height: 8, minHeight: 8, width: "100%", border: "none", padding: 0, cursor: "row-resize", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" }}>
      <span style={{ width: 62, height: 2, borderRadius: 2, background: C.divider }} />
    </button>
  );
  const startChiefChatResize = e => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = chiefChatHeight;
    let latestH = startH;
    const move = ev => {
      const nextH = Math.max(56, Math.min(260, startH + (ev.clientY - startY)));
      latestH = nextH;
      setChiefChatHeight(nextH);
    };
    const up = () => {
      writeChiefChatHeight(latestH);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const NC_LABEL = { now: "1", today: "2", eventually: "3" };
  const ncCorePills = [BEFORE_SHAVUOS_PRIORITY_ID, "now", "today", "eventually"]
    .map(id => { const p = priorities.find(x => x.id === id && !x.deleted); return p ? { ...p, ncLabel: NC_LABEL[id] || p.label } : null; })
    .filter(Boolean);
  const activePri = gP(priorities, taskPriority);
  const activePriColor = activePri?.color || C.accent || "#7EB0DE";
  // Owner-requested (bug log): add buttons are bare colored checkmarks — no pill
  // container. Active (composer open for that priority) gets a soft tint ring.
  // (Now expressed directly via IconBtn's active/activeBg props at each call site.)

  // "More Actions" drawer retired (owner ticket 7/13). The sections prop and the
  // actionsOpen/actionCategoryId plumbing are now inert — they were kept for the
  // old ?ui=legacy panel, which is gone as of 7/21. Safe to strip separately.

  const addDraft = (priorityOverride = taskPriority, opts = {}) => {
    const text = taskDraft.trim();
    if (!text) return;
    if (opts.mrsW && onAddMrsWTask) onAddMrsWTask(text, priorityOverride);
    else onAddTask?.(text, priorityOverride);
    setTaskDraft("");
    setTaskComposerOpen(false);
    setTaskComposerMrsW(false);
    if (taskInputRef.current) { taskInputRef.current.style.height = "36px"; }
  };
  const openTaskComposer = (priorityId, opts = {}) => {
    setTaskPriority(priorityId);
    setTaskComposerMrsW(!!opts.mrsW);
    setTaskComposerOpen(true);
    setTimeout(() => taskInputRef.current?.focus(), 0);
  };

  const activeChiefBrief = chiefBrief;
  const activeChiefTone = activeChiefBrief?.urgency === "now" ? C.danger : activeChiefBrief?.urgency === "today" ? C.accent : C.muted;
  const activeChiefSources = (activeChiefBrief?.sources || []).slice(0, 5);
  const activeChiefTaskText = cleanOneLine(activeChiefBrief?.nextAction || "", 260);
  // Concise complete summary of everything across all sources (the chief's overview line),
  // shown as the top card above the category grid. Distinct from the do-this-next action below.
  const chiefSummaryText = cleanOneLine(activeChiefBrief?.summary || "", 220);

  // Streamed "do this next" line above the page: the single most urgent+effective move across
  // all categories (the chief's nextAction), no explanation — revealed with a typewriter so it
  // reads as it streams in. Restarts only when the underlying action changes (not on clock tick).
  const [streamNext, setStreamNext] = useState("");
  const streamRef = useRef({ text: null, timer: null });
  useEffect(() => {
    if (streamRef.current.text === activeChiefTaskText) return undefined;
    streamRef.current.text = activeChiefTaskText;
    if (streamRef.current.timer) { clearInterval(streamRef.current.timer); streamRef.current.timer = null; }
    setStreamNext("");
    if (!activeChiefTaskText) return undefined;
    let i = 0;
    const timerId = window.setInterval(() => {
      i += 1;
      setStreamNext(activeChiefTaskText.slice(0, i));
      if (i >= activeChiefTaskText.length) { clearInterval(timerId); streamRef.current.timer = null; }
    }, 18);
    streamRef.current.timer = timerId;
    // Capture timerId so the cleanup doesn't depend on the mutable ref value after unmount.
    return () => { clearInterval(timerId); streamRef.current.timer = null; };
  }, [activeChiefTaskText]);
  // Global snapshot line — locally computed, always current, covers every category.
  // This is separate from the AI suggestion so they don't echo the same single item.
  const globalSnapshotParts = useMemo(() => {
    const parts = [];
    const taskNow = primaryTaskQueue.filter(t => /now/i.test(t.priority)).length;
    if (primaryTaskQueue.length > 0)
      parts.push(taskNow > 0 ? `${taskNow} Now, ${primaryTaskQueue.length} tasks` : `${primaryTaskQueue.length} task${primaryTaskQueue.length === 1 ? "" : "s"}`);
    const calRows = (calendarEvents || []).filter(e => !e.past);
    if (calRows.length > 0) {
      const now = calRows.find(e => e.now);
      const next = calRows.find(e => e.special && !e.past) || calRows[0];
      parts.push(now ? `In: ${compactNerveSummary(now.summary, "event")}` : (next ? `Next: ${compactNerveSummary(next.summary, "event")}` : `${calRows.length} upcoming`));
    }
    if ((gmailMessages || []).length > 0) parts.push(`${gmailMessages.length} email${gmailMessages.length === 1 ? "" : "s"}`);
    if (visibleShailos.length > 0) parts.push(`${visibleShailos.length} shaila${visibleShailos.length === 1 ? "" : "s"}`);
    const ph = phoneActivitySummary;
    const phoneParts = [];
    if (ph.missedCalls > 0) phoneParts.push(`${ph.missedCalls} missed`);
    if (ph.unreadTexts > 0) phoneParts.push(`${ph.unreadTexts} unread text${ph.unreadTexts === 1 ? "" : "s"}`);
    if (phoneParts.length > 0) parts.push(phoneParts.join(", "));
    return parts.join(" · ");
  }, [primaryTaskQueue, calendarEvents, gmailMessages, visibleShailos, phoneActivitySummary]);

  // Live status for the AI summaries, surfaced on every area so a stuck/failed summary is
  // visible instead of a silent blank:
  //   updating    – a summary scan is in flight (or AI config is still resolving)
  //   unavailable – AI is off / no provider key (config settled, no aiOpts)
  //   error       – the gateway failed or timed out on the last attempt
  //   ok          – we have a result (may be legitimately empty/quiet)
  const ncSummaryStatus =
      ncSummaryLoading ? "updating"
    : (aiConfigLoading && !ncSummary && !ncSummaryError) ? "updating"
    : ncSummaryError ? "error"
    : ncSummary ? "ok"
    : "idle";
  const NC_STATUS_LABEL = { updating: "Updating…", error: "Summary unavailable" };
  const nerveStatusLabel = NC_STATUS_LABEL[ncSummaryStatus] || "";
  const ncSummaryRetryable = ncSummaryStatus === "error";
  // Retry must stay self-contained: clear the summary cache and re-run the summary job ONLY.
  // It must NOT touch Gmail/Calendar — re-fetching app-config here re-triggered the Google
  // load and discarded already-computed email summaries (a wasted, visible AI re-run).
  const retryNcSummary = () => {
    forcedSnapshotRef.current = true; // bypass the throttle for a manual rescan
    ncFailStreakRef.current = 0;
    setNcSummaryError(false);
    onRefreshCalendar?.();
    setNcSummaryRefreshNonce(n => n + 1);
  };
  const nerveSupercrunch = cleanOneLine(
    ncSummaryStatus === "ok" ? (ncSummary?.supercrunch || "") : nerveStatusLabel, 240);
  const nerveSignalNote = area => {
    if (ncSummaryStatus === "ok") {
      return (ncSummary?.signals || []).find(s => (s.area || "").toLowerCase() === area.toLowerCase())?.note || "";
    }
    return nerveStatusLabel;
  };
  const nerveSummaryStrip = (style = {}) => (
    <div style={{ flexShrink: 0, padding: "3px 10px", borderRadius: RADIUS.sm, background: C.bgSoft, fontSize: NC_TYPE.meta, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.22, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}>
      {nerveSupercrunch}
      {ncSummaryLoading && !ncSummary?.supercrunch && <span style={{ opacity: 0.55 }}>...</span>}
    </div>
  );

  // Small live-status pill (spinner while updating, warning dot + Retry when failed/unavailable).
  const ncStatusDotColor = ncSummaryStatus === "error" ? (C.warning || C.danger || "#C98A1B") : C.faint;
  const ncSummaryStatusPill = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
      {ncSummaryStatus === "updating" ? (
        <span style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${C.faint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
      ) : (
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: ncStatusDotColor }} />
      )}
      <span style={{ fontSize: NC_TYPE.small, color: ncStatusDotColor, fontFamily: NC_FONT_STACK }}>
        {ncSummaryStatus === "updating" ? "Updating" : "Unavailable"}
      </span>
      {ncSummaryRetryable && (
        <ActionBtn variant="outlined" outlineColor={C.accent} labelColor={C.accent} height={20} labelSize={NC_TYPE.small}
          onClick={retryNcSummary} title="Try the summary again" aria-label="Retry summary">Try again</ActionBtn>
      )}
    </span>
  );

  const nextActionBar = (ncSummary?.supercrunch || ncSummaryLoading || activeChiefTaskText || ncSummaryRetryable) ? (
    <div style={{ flexShrink: 0, minWidth: 0, marginBottom: 4, borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, overflow: "hidden" }}>
      {/* Row 1: super-crunched item summary + status/refresh */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "6px 6px 6px 10px", background: C.bgSoft }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: NC_TYPE.control, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.35, wordBreak: "break-word" }}>
          {ncSummaryStatus === "ok"
            ? (ncSummary?.supercrunch || "")
            : ncSummaryStatusPill}
        </span>
        <IconBtn icon="autorenew" iconSize={13} color={C.faint}
          onClick={retryNcSummary} disabled={ncSummaryLoading}
          title="Refresh summary" aria-label="Refresh summary"
          style={{ flexShrink: 0, opacity: ncSummaryLoading ? 0.4 : 1, ...(ncSummaryLoading ? { animation: "ot-spin 0.8s linear infinite" } : {}) }} />
      </div>
      {/* Row 2: single most important next action + resuggest */}
      {activeChiefTaskText && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 10px", background: hexToRgba(C.accent, 0.055) || C.bgSoft, borderTop: `1px solid ${C.divider}` }}>
          <span style={{ display: "flex", color: C.accent, flexShrink: 0 }}>{suiteIcon("bolt", 15)}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: NC_TYPE.body, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.3, wordBreak: "break-word" }}>
            <span style={{ fontSize: NC_TYPE.small, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.accent, marginRight: 6 }}>{chiefRefreshNonce > 0 ? "Re-suggested:" : "Suggested now:"}</span>
            {streamNext}{streamNext.length < activeChiefTaskText.length && <span style={{ opacity: 0.45 }}>▋</span>}
          </span>
          <IconBtn icon="autorenew" iconSize={14} color={chiefLoading ? C.faint : C.accent}
            onClick={() => setChiefRefreshNonce(n => n + 1)} disabled={chiefLoading}
            title="Suggest something else" aria-label="Suggest something else"
            style={{ flexShrink: 0, opacity: chiefLoading ? 0.4 : 1, ...(chiefLoading ? { animation: "ot-spin 0.8s linear infinite" } : {}) }} />
        </div>
      )}
    </div>
  ) : null;
  useEffect(() => {
    if (!chiefPage || !activeChiefTaskText || activeChiefBrief?._isPlaceholder) return;
    setChiefTaskDraft(prev => {
      if (prev && prev !== chiefTaskDraftSourceRef.current) return prev;
      chiefTaskDraftSourceRef.current = activeChiefTaskText;
      return activeChiefTaskText;
    });
    setChiefTaskPriority(prev => prev || defaultSuggestionPriorityId);
  }, [chiefPage, activeChiefTaskText, defaultSuggestionPriorityId]);
  const chiefSmartButtons = (large = false) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: large ? 8 : 6 }} aria-label="Chief smart responses">
      {[
        ["done", "Done", "task_alt"],
        ["not_now", "Not now", "schedule"],
        ["next", "Next", "arrow_forward"],
        ["other", "Other", "edit"],
      ].map(([id, label, icon]) => {
        const active = chiefSmartSaving === id;
        const disabled = !!chiefSmartSaving || chiefDialogueLoading || !!activeChiefBrief?._isPlaceholder;
        return (
          <ActionBtn key={id} variant="tonal" icon={active ? "hourglass_top" : icon} iconSize={large ? 15 : 13}
            containerColor={active ? softBg(C.accent, 0.16) : C.bgSoft}
            labelColor={disabled && !active ? C.faint : C.text}
            height={large ? 38 : 27} labelSize={large ? NC_TYPE.control : NC_TYPE.small}
            onClick={() => handleChiefSmartResponse(id)} disabled={disabled}
            title={`${label} - save this signal to the Chief profile`} aria-label={`${label} smart response`}
            style={{
              border: `1px solid ${id === "not_now" ? softBorder(C.warning || C.accent, 0.3) : softBorder(C.accent, 0.26)}`,
              opacity: disabled && !active ? 0.62 : 1,
            }}>
            {label}
          </ActionBtn>
        );
      })}
    </div>
  );

  if (healthPage) {
    return (
      <HealthPage
        T={T}
        C={C}
        healthData={healthData}
        healthConfig={healthConfig}
        healthHistory={healthHistory}
        onClose={onCloseHealthPage}
        onSaveHealthData={onSaveHealthData}
        onSyncNow={onSyncHealth}
        topOffset={topOffset}
        sidebarW={sidebarW}
        userId={user?.uid}
        getAuthToken={() => user?.getIdToken?.()}
        healthCardVisible={healthCardVisible}
        onSetHealthCardVisible={v => {
          setHealthCardVisible(v);
          try { localStorage.setItem("nc_health_card_visible", v ? "1" : "0"); } catch {}
        }}
      />
    );
  }

  if (chiefPage) {
    const pageLabel = { fontSize: NC_TYPE.small, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0, fontFamily: NC_FONT_STACK };
    const pagePanel = { border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, background: C.bg, minWidth: 0, overflow: "hidden" };
    const pagePad = isStacked ? 14 : 18;
    const dueSignals = {
      calendar: calendarRows.filter(row => !row.past && row.special).length,
      tasks: primaryTaskQueue.length,
      shailos: visibleShailos.length,
      mail: Array.isArray(gmailMessages) ? gmailMessages.length : 0,
      phone: Number(phoneActivitySummary?.unreadTexts || 0) + Number(phoneActivitySummary?.missedCalls || 0) + Number(phoneActivitySummary?.voicemailCount || 0),
    };
    const snapshotTiles = [
      ["Calendar", dueSignals.calendar ? `${dueSignals.calendar} special` : "steady", "calendar_today", dueSignals.calendar ? C.accent : C.muted],
      ["Tasks", `${dueSignals.tasks} open`, "rule", dueSignals.tasks ? C.text : C.muted],
      ["Shailos", `${dueSignals.shailos} open`, "question_mark", dueSignals.shailos ? C.warning || C.accent : C.muted],
      ["Mail", dueSignals.mail ? `${dueSignals.mail} visible` : "clear", "mail", dueSignals.mail ? C.text : C.muted],
      ["Phone", dueSignals.phone ? `${dueSignals.phone} signal${dueSignals.phone === 1 ? "" : "s"}` : (phoneActivitySummary?.online ? "quiet" : "not connected"), "smartphone", dueSignals.phone ? C.danger : (phoneActivitySummary?.online ? C.muted : C.faint)],
    ];
    const chiefPri = gP(taskSuggestionPriorities, chiefTaskPriority || defaultSuggestionPriorityId);
    return (
      <div style={{ position: "fixed", inset: `${topOffset}px 0 0 ${sidebarW}px`, zIndex: 7600, background: C.bg, overflow: "auto", overscrollBehavior: "contain", borderLeft: `1px solid ${C.divider}` }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: isStacked ? "18px 14px 32px" : "28px 24px 40px", display: "grid", gap:12, boxSizing: "border-box" }}>
          <header style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: activeChiefTone, fontSize: NC_TYPE.label, fontWeight: 700, fontFamily: NC_FONT_STACK, marginBottom: 6 }}>
                {suiteIcon("psychology", 18)}
                Chief of Staff
              </div>
              <h1 style={{ margin: 0, fontSize: isStacked ? 24 : 30, lineHeight: 1.12, fontWeight: 650, color: C.text, fontFamily: NC_FONT_STACK }}>Today command</h1>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {chiefLoading && <div title="Scanning" style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${activeChiefTone}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />}
              <IconBtn icon="refresh" iconSize={17} color={C.text} onClick={() => setChiefRefreshNonce(n => n + 1)} title="Refresh Chief scan" aria-label="Refresh Chief scan" />
              <IconBtn icon="close" iconSize={17} color={C.muted} onClick={onCloseChiefPage} title="Back to NerveCenter" aria-label="Back to NerveCenter" />
            </div>
          </header>

          {activeChiefBrief?._isPlaceholder ? (
            <section style={{ ...pagePanel, padding: pagePad, display: "flex", alignItems: "center", gap: 12, minHeight: 56 }}>

            </section>
          ) : activeChiefBrief && (activeChiefBrief.brief || activeChiefBrief.signals?.length > 0) ? (
            <section style={{ ...pagePanel, padding: pagePad }}>
              {activeChiefBrief.brief && (
                <div style={{ fontSize: isStacked ? 14 : 15, lineHeight: 1.65, color: C.text, fontFamily: NC_FONT_STACK, marginBottom: activeChiefBrief.signals?.length > 0 ? 14 : 0 }}>
                  {activeChiefBrief.brief}
                </div>
              )}
              {activeChiefBrief.signals?.length > 0 && (
                <div style={{ display: "grid", gap:8, borderTop: activeChiefBrief.brief ? `1px solid ${C.divider}` : "none", paddingTop: activeChiefBrief.brief ? 12 : 0 }}>
                  {activeChiefBrief.signals.map((sig, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "80px minmax(0,1fr)", gap: 10, fontSize: NC_TYPE.title, fontFamily: NC_FONT_STACK, lineHeight: 1.45 }}>
                      <span style={{ color: C.faint, fontWeight: 700, fontSize: NC_TYPE.meta, textTransform: "uppercase", letterSpacing: "0.04em", paddingTop: 2 }}>{sig.area}</span>
                      <span style={{ color: C.muted }}>{sig.note}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <section style={{ display: "grid", gridTemplateColumns: isStacked ? "repeat(2,minmax(0,1fr))" : "repeat(5,minmax(0,1fr))", gap: 8 }}>
            {snapshotTiles.map(([label, value, icon, color]) => (
              <ListItem key={label} type="button" onClick={onCloseChiefPage} title={`View ${label} in NerveCenter`}
                style={{
                  border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, background: C.bgSoft, minWidth: 0,
                  ...denseListVars({ dense: true }),
                  '--md-list-item-two-line-container-height': '54px',
                  '--md-list-item-top-space': '10px', '--md-list-item-bottom-space': '10px',
                  '--md-list-item-leading-space': '11px', '--md-list-item-trailing-space': '11px',
                }}>
                <div slot="headline" style={{ display: "flex", alignItems: "center", gap:8, color, fontSize: NC_TYPE.small, fontWeight: 700, fontFamily: NC_FONT_STACK }}>
                  {suiteIcon(icon, 14)}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                </div>
                <div slot="supporting-text" style={{ color: C.text, fontSize: NC_TYPE.control, fontWeight: 650, lineHeight: 1.25, fontFamily: NC_FONT_STACK }}>{value}</div>
              </ListItem>
            ))}
          </section>

          <section style={{ ...pagePanel, display: "grid", gridTemplateColumns: isStacked ? "1fr" : "minmax(0,1.34fr) minmax(300px,0.66fr)" }}>
            <div style={{ padding: pagePad, borderRight: isStacked ? "none" : `1px solid ${C.divider}`, borderBottom: isStacked ? `1px solid ${C.divider}` : "none", display: "grid", gap:12 }}>
              <div style={{ display: "grid", gap:8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={pageLabel}>Next move</span>
                  {chiefLoading && (
                    <span style={{ color: C.faint, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK, display: "inline-flex", alignItems: "center", gap:6 }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${C.faint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                      Rescanning
                    </span>
                  )}
                </div>
                {!activeChiefBrief && !chiefLoading && (
                  <div style={{ display: "flex", alignItems: "center", paddingTop: 4, paddingBottom: 4 }}>
                    <ActionBtn variant="outlined" outlineColor={C.accent} labelColor={C.accent} height={38} labelSize={NC_TYPE.base}
                      onClick={() => setChiefRefreshNonce(n => n + 1)} title="Run a Chief brief" aria-label="Run a Chief brief">
                      ✦ Brief me <span style={{ fontSize: NC_TYPE.small, fontWeight: 400, opacity: 0.6 }}>beta</span>
                    </ActionBtn>
                  </div>
                )}
                <div style={{ borderLeft: `4px solid ${chiefLoading ? C.divider : activeChiefTone}`, paddingLeft: 14, display: "grid", gap: 8, opacity: chiefLoading ? 0.55 : 1, transition: "opacity 0.25s" }}>
                  <div style={{ fontSize: isStacked ? 19 : 24, lineHeight: 1.2, color: C.text, fontWeight: 650, fontFamily: NC_FONT_STACK }}>{activeChiefBrief?.summary}</div>
                  <div style={{ fontSize: isStacked ? 15 : 17, lineHeight: 1.38, color: C.muted, fontFamily: NC_FONT_STACK }}>
                    <span style={{ color: activeChiefTone, fontWeight: 700 }}>Do: </span>{activeChiefBrief?.nextAction}
                  </div>
                  {(activeChiefBrief?.why || chiefError) && (
                    <div style={{ fontSize: NC_TYPE.control, lineHeight: 1.45, color: C.faint, fontFamily: NC_FONT_STACK }}>{activeChiefBrief?.why || chiefError}</div>
                  )}
                </div>
              </div>
              {chiefSmartButtons(true)}
            </div>

            <div style={{ padding: pagePad, display: "grid", gap: 12, alignContent: "start" }}>
              <span style={pageLabel}>Capture</span>
              <input value={chiefTaskDraft} onChange={e => setChiefTaskDraft(e.target.value)} placeholder="Task text"
                style={{ minWidth: 0, width: "100%", boxSizing: "border-box", height: 38, borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: "0 10px", fontSize: NC_TYPE.control, lineHeight: 1.35, fontFamily: NC_FONT_STACK, outline: "none" }} />
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <OutlinedSelect value={chiefTaskPriority || defaultSuggestionPriorityId} onChange={e => setChiefTaskPriority(e.target.value)}
                  aria-label="Task priority"
                  style={{ minWidth: 0, "--md-outlined-select-text-field-container-shape": RADIUS.sm,
                    "--md-outlined-field-top-space": "6px", "--md-outlined-field-bottom-space": "6px",
                    "--md-outlined-select-text-field-label-text-size": NC_TYPE.control, "--md-outlined-select-text-field-input-text-size": NC_TYPE.control }}>
                  {taskSuggestionPriorities.map(p => (
                    <SelectOption key={p.id} value={p.id} selected={p.id === (chiefTaskPriority || defaultSuggestionPriorityId)}>
                      <div slot="headline">{p.label}</div>
                    </SelectOption>
                  ))}
                </OutlinedSelect>
                <IconBtn variant="filled" icon="add" iconSize={16}
                  color={chiefTaskDraft.trim() ? "#fff" : C.faint}
                  containerColor={chiefTaskDraft.trim() ? (chiefPri.color || C.accent) : "transparent"}
                  onClick={createChiefNextTask} disabled={!chiefTaskDraft.trim()} title="Create task" aria-label="Create task"
                  style={{ "--md-filled-icon-button-container-shape": RADIUS.sm }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isStacked ? "1fr" : "repeat(3,minmax(0,1fr))", gap: 8 }}>
                {[
                  ["Focus", activeChiefBrief?.focusArea || "operations", C.text],
                  ["Timing", activeChiefBrief?.urgency || "watch", activeChiefTone],
                  ["Evidence", (activeChiefSources.length ? activeChiefSources : ["Dashboard"]).join(", "), C.text],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, padding:8, background: C.bgSoft, minWidth: 0 }}>
                    <div style={pageLabel}>{label}</div>
                    <div style={{ marginTop: 5, color, fontSize: NC_TYPE.small, fontWeight: 650, fontFamily: NC_FONT_STACK, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {(taskSuggestions.length > 0 || taskSuggestionsLoading) && (
            <section style={{ ...pagePanel }}>
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${C.divider}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: C.text, fontSize: NC_TYPE.label, fontWeight: 700, fontFamily: NC_FONT_STACK }}>{suiteIcon("playlist_add", 15)} Taskable signals</span>
                {taskSuggestionsLoading && <span style={{ color: C.faint, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK }}>Scanning</span>}
              </div>
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: isStacked ? "1fr" : "repeat(2,minmax(0,1fr))", gap: 10 }}>
                {taskSuggestionsLoading && taskSuggestions.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.faint, fontSize: NC_TYPE.control, fontFamily: NC_FONT_STACK }}>
                    <div style={{ width: 11, height: 11, borderRadius: "50%", border: `1.5px solid ${C.faint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                    Reading calendar and mail
                  </div>
                )}
                {taskSuggestions.map(row => {
                  const pri = gP(taskSuggestionPriorities, row.priorityId || defaultSuggestionPriorityId);
                  return (
                    <div key={row.id} style={{ border: `1px solid ${softBorder(pri.color || C.accent, 0.28)}`, background: softBg(pri.color || C.accent, 0.07), borderRadius: RADIUS.sm, padding: 10, display: "grid", gap: 8, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ minWidth: 0, color: C.text, fontSize: NC_TYPE.control, fontWeight: 650, fontFamily: NC_FONT_STACK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Create task</span>
                        <span style={{ color: C.faint, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK, whiteSpace: "nowrap" }}>{row.source}</span>
                      </div>
                      <input value={row.text} onChange={e => updateTaskSuggestion(row.id, { text: e.target.value })}
                        style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, background: C.bg, color: C.text, padding: "7px 8px", fontSize: NC_TYPE.control, fontFamily: NC_FONT_STACK, outline: "none" }} />
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 6, alignItems: "center" }}>
                        <OutlinedSelect value={row.priorityId || defaultSuggestionPriorityId} onChange={e => updateTaskSuggestion(row.id, { priorityId: e.target.value })}
                          aria-label="Suggestion priority"
                          style={{ minWidth: 0, "--md-outlined-select-text-field-container-shape": RADIUS.sm,
                            "--md-outlined-field-top-space": "4px", "--md-outlined-field-bottom-space": "4px",
                            "--md-outlined-select-text-field-input-text-size": NC_TYPE.small }}>
                          {taskSuggestionPriorities.map(p => (
                            <SelectOption key={p.id} value={p.id} selected={p.id === (row.priorityId || defaultSuggestionPriorityId)}>
                              <div slot="headline">{p.label}</div>
                            </SelectOption>
                          ))}
                        </OutlinedSelect>
                        <IconBtn icon="close" iconSize={13} color={C.faint}
                          onClick={() => dismissTaskSuggestion(row)} title="Dismiss suggestion" aria-label="Dismiss suggestion" />
                        <IconBtn variant="filled" icon="add" iconSize={14}
                          color={row.text.trim() ? "#fff" : C.faint}
                          containerColor={row.text.trim() ? (pri.color || C.accent) : "transparent"}
                          onClick={() => createTaskSuggestion(row)} disabled={!row.text.trim()} title="Create task" aria-label="Create task" />
                      </div>
                      {(row.reason || row.sourceTitle) && (
                        <div style={{ color: C.faint, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{row.reason || row.sourceTitle}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section style={{ ...pagePanel }}>
            <div style={{ padding: "13px 14px", borderBottom: `1px solid ${C.divider}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: C.text, fontSize: NC_TYPE.label, fontWeight: 700, fontFamily: NC_FONT_STACK }}>{suiteIcon("forum", 15)} Discuss</span>
              {chiefDialogueLoading && <span style={{ color: C.faint, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK }}>Thinking</span>}
            </div>
            <div role="status" aria-live="polite" aria-atomic="false" style={{ padding: 14, minHeight: 130, maxHeight: 320, overflow: "auto", display: "grid", alignContent: "start", gap: 8 }}>
              {chiefDialogue.length === 0 && !chiefDialogueLoading && (
                <div style={{ color: C.faint, fontSize: NC_TYPE.control, lineHeight: 1.45, fontFamily: NC_FONT_STACK }}>What can wait? What should I clear first? Stop showing sleep tasks.</div>
              )}
              {[...chiefDialogue.slice(-8), ...(chiefDialogueLoading ? [{ role: "assistant", text: "Thinking through the next move...", pending: true }] : [])].map((row, idx) => (
                <div key={`${row.role}-${idx}`} style={{ justifySelf: row.role === "user" ? "end" : "start", maxWidth: "92%", border: `1px solid ${row.role === "user" ? softBorder(C.accent, 0.24) : C.divider}`, background: row.role === "user" ? softBg(C.accent, 0.08) : C.bgSoft, color: C.text, borderRadius: RADIUS.sm, padding: "8px 10px", fontSize: NC_TYPE.control, lineHeight: 1.42, fontFamily: NC_FONT_STACK }}>
                  <span style={row.pending ? { color: C.muted } : null}>{row.text}</span>
                </div>
              ))}
            </div>
            <form onSubmit={e => { e.preventDefault(); submitChiefPrompt(); }} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 40px", gap: 8, padding: 12, borderTop: `1px solid ${C.divider}` }}>
              <textarea ref={chiefPromptRef} value={chiefPrompt} rows={2} onChange={e => setChiefPrompt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitChiefPrompt(); } }} placeholder="Respond, correct, or ask for the next move"
                style={{ minWidth: 0, minHeight: 46, maxHeight: 140, borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: "9px 10px", fontSize: NC_TYPE.control, lineHeight: 1.35, fontFamily: NC_FONT_STACK, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
              <IconBtn variant="filled" type="submit" icon={chiefDialogueLoading ? "hourglass_top" : "send"} iconSize={16}
                color={chiefPrompt.trim() && !chiefDialogueLoading ? "#fff" : C.faint}
                containerColor={chiefPrompt.trim() && !chiefDialogueLoading ? C.accent : "transparent"}
                disabled={!chiefPrompt.trim() || chiefDialogueLoading} title="Ask Chief" aria-label="Ask Chief"
                style={{ "--md-filled-icon-button-container-shape": RADIUS.sm }} />
            </form>
          </section>

          <section style={{ ...pagePanel }}>
            <ListItem type="button" onClick={() => setChiefProfileOpen(open => !open)}
              style={{
                width: "100%", color: C.text, fontSize: NC_TYPE.label, fontWeight: 700, fontFamily: NC_FONT_STACK,
                ...denseListVars({ dense: true }),
                '--md-list-item-one-line-container-height': '44px', '--md-list-item-leading-space': '14px', '--md-list-item-trailing-space': '14px',
              }}>
              <span slot="start" style={{ display: "inline-flex" }}>{suiteIcon("tune", 15)}</span>
              <div slot="headline">Profile</div>
              <span slot="end" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.faint, fontSize: NC_TYPE.small, fontWeight: 500 }}>
                {chiefProfileLoading ? "Loading" : "Netlify Blobs"}
                {suiteIcon(chiefProfileOpen ? "expand_less" : "expand_more", 17)}
              </span>
            </ListItem>
            {chiefProfileOpen && (
              <div style={{ borderTop: `1px solid ${C.divider}`, padding: 14, display: "grid", gap: 8 }}>
                <textarea value={chiefProfileDraft} onChange={e => setChiefProfileDraft(e.target.value)} rows={7}
                  style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, background: C.bgSoft, color: C.text, padding: "9px 10px", fontSize: NC_TYPE.control, lineHeight: 1.4, fontFamily: NC_FONT_STACK, resize: "vertical", outline: "none" }} />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <IconBtn icon="undo" iconSize={14} color={C.faint}
                    onClick={() => setChiefProfileDraft(markdownFromChiefProfile(chiefProfile))} title="Reset profile draft" aria-label="Reset profile draft" />
                  <IconBtn variant="filled" icon={chiefProfileSaving ? "hourglass_top" : "save"} iconSize={15}
                    color={!chiefProfileSaving ? "#fff" : C.faint}
                    containerColor={!chiefProfileSaving ? C.accent : "transparent"}
                    onClick={saveChiefProfileDraft} disabled={!onSaveChiefProfileMarkdown || chiefProfileSaving} title="Save Chief profile" aria-label="Save Chief profile" />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  // ── Phone / tablet — five equal scrollable boxes (portrait & landscape) ──────
  // Gate on the actual device (not window width): a phone in landscape is wide
  // enough to skip the width-based accordion and fall through to the desktop layout,
  // which overran. This catches BOTH orientations. Boxes: Mail · Phone · Tasks ·
  // Shailos · Calendar, each scrolling internally so nothing overflows the screen.
  if ((isMobileDevice || desktopLayout === "boxes") && !healthPage && !chiefPage) {
    const menuToggle = id => setMobileMenuOpen(prev => prev === id ? null : id);
    const menuClose  = () => setMobileMenuOpen(null);
    // >= 1000 px: 5 vertical columns side by side (each card full height, 1/5 width).
    // <  1000 px: stacked rows / 2-col grid (below).
    // Both orientations show all 5 cards simultaneously — no carousel, no scrolling between cards.
    // Owner 7/21: the 1500 px threshold pushed most desktops (Surface Laptop 7 at
    // 150% DPI ≈ 1444 px available) into stacked frozen-header row cards. Real
    // columns are the desktop view — restore them at ~200 px/column.
    const boxesFiveCol = availableW >= 1000;
    const boxCtx = { C, menuId: mobileMenuOpen, onMenuToggle: menuToggle, onMenuClose: menuClose, stickyHeader: boxesFiveCol, narrowActions: availableW < 480 };
    // Rows-mode cards (iPad portrait: five cards sharing the screen height) are far
    // too short to spend ~40px on a fixed hero — it left a single-row slat. The hero
    // is a tall-card affordance only; short cards give every pixel to real rows.
    const heroOk = boxesFiveCol;
    const showHero = node => (heroOk ? node : null);
    // Card-level expand: both orientations. Rows: tapping a header gives that card the
    // whole page and the rest shrink to header strips. Columns (wide screens): the
    // expanded card takes most of the width and the other columns squish to slim
    // still-live strips — same gesture, same escape (tap again to restore the even split).
    const BOX_ORDER = ["mail", "phone", "tasks", "shailos", "calendar"];
    const boxProps = id => ({
      expanded: expandedBoxId === id,
      // Feed mode never hides a sibling card — the page scrolls, so every card
      // stays readable and "expanded" simply means this card shows all its items.
      collapsed: false,
      onToggleExpand: () => setExpandedBoxId(prev => prev === id ? null : id),
    });
    // v7: no volume weighting and no total-count chips. Every list here is always
    // full, so both were constant noise. Cards get an equal share and earn their
    // rows through SELECTION instead.
    const feedCounts = { mail: 0, phone: 0, tasks: 0, shailos: 0, calendar: 0 };
    const feedWeights = Object.fromEntries(BOX_ORDER.map(id => [id, 1]));
    const boxRows = expandedBoxId
      ? BOX_ORDER.map(id => id === expandedBoxId ? "minmax(0,1fr)" : "min-content").join(" ")
      : "repeat(5, minmax(0,1fr))";
    const boxCols = expandedBoxId
      ? BOX_ORDER.map(id => id === expandedBoxId ? "minmax(0,1fr)" : "minmax(120px,0.28fr)").join(" ")
      : "repeat(5, minmax(0,1fr))";

    const fmtTimeM = (raw) => { try { const d = new Date(raw); const now = new Date(); return d.toDateString()===now.toDateString() ? d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}) : d.toLocaleDateString([],{month:"short",day:"numeric"}); } catch { return ""; } };
    // Abbreviated relative time (5m · 2h · Tue · Jun 3) — denser than a full timestamp.
    const fmtRelM = (raw) => { try { const d = new Date(raw); const diff = Date.now() - d.getTime(); if (isNaN(d.getTime())) return ""; if (diff >= 0 && diff < 3600000) return `${Math.max(1, Math.round(diff/60000))}m`; if (diff >= 0 && diff < 86400000) return `${Math.round(diff/3600000)}h`; if (diff >= 0 && diff < 604800000) return d.toLocaleDateString([], { weekday:"short" }); return d.toLocaleDateString([], { month:"short", day:"numeric" }); } catch { return ""; } };
    const gmailHdr = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || "";
    const fmtFromM = (raw) => { const m = raw?.match(/^"?([^"<]+)"?\s*<[^>]+>/); return m ? m[1].trim() : (raw || "").split("@")[0]; };
    const decodeSnipM = s => (s || "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").trim();
    const upcomingCal = (calendarRows || []).filter(r => !r.past);

    const cardStyle = { minWidth: 0 }; // grid handles all sizing in both orientations
    const emptyMsg = txt => <div style={{ padding:"12px 14px", fontSize:ncType.meta, color:C.faint, fontFamily:NC_FONT_STACK }}>{txt}</div>;
    // Density (compact vs comfortable) is hoisted to the component top as `dense`.
    // Expanded = comfortable. Compact = roughly twice the density: minimal padding, tight
    // line-height, and one step smaller type, so a card fits about double the rows.
    const padY = dense ? 1 : 4;
    const rowMinH = dense ? 14 : 22;
    const bodyF = dense ? ncType.meta : ncType.body;   // 12 vs 14
    const metaF = ncType.meta;  // 12px floor even when dense (M3 minimum type)
    const lineH = dense ? 1.05 : 1.3;

    // Each card's top line is the AI per-category summary, or "Updating…" while loading.
    const signalNote = nerveSignalNote;
    // Phone link state as a single dot color: green = live, accent = active call/incoming,
    // gray = offline/stale. Shown in the Phone card's corner so status reads at a glance.
    const phoneDotColor = phoneStatusSummary?.online
      ? ((phoneStatusSummary.tone === "incoming" || phoneStatusSummary.tone === "call") ? C.accent : C.success)
      : C.faint;

    // Apple-notification style summaries: name as many items as possible (the card header
    // shows 2 lines via WebkitLineClamp so the CSS handles overflow). Trailing "+N" for the
    // remainder. trunc keeps individual item length manageable so more fit per line.
    const trunc = (s, n) => s && s.length > n ? s.slice(0, n - 1) + "…" : (s || "");
    const joinTop = (items, rest) => items.join(" · ") + (rest > 0 ? ` +${rest}` : "");

    const cardSummary = area => signalNote(area);

    return (
      // bottom:0 anchoring (not a 100dvh height calc) — the calc drifted past the
      // real viewport bottom on the tablet, cutting the last card at the taskbar.
      <div style={{ position:"fixed", top:topOffset, left:sidebarW, right:0, bottom:0, zIndex:7600, background:pageBg, display:"flex", flexDirection:"column", overflow:"hidden", borderLeft:`1px solid ${C.divider}`, boxSizing:"border-box", padding:"6px 10px calc(10px + env(safe-area-inset-bottom,0px))" }}>

        {/* ── One-row chrome: clock left, one-touch display controls right — reclaims the
            old dedicated selector row while keeping every control a single tap ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 2px 2px", flexShrink:0, minWidth:0 }}>
          <span style={{ fontSize:19, fontWeight:400, color:C.text, fontFamily:NC_MONO_STACK, fontVariantNumeric:"tabular-nums", letterSpacing:0 }}>{clockParts.timeMain}</span>
          <span style={{ fontSize:NC_TYPE.small, color:C.faint, fontFamily:NC_FONT_STACK, whiteSpace:"nowrap" }}>{nowDate.toLocaleDateString([], { weekday:"short", month:"short", day:"numeric" })}</span>
          <span style={{ flex:1, minWidth:0 }} />
          <IconBtn icon={densityIcon} iconSize={16} color={C.muted} onClick={toggleMobileDensity} title={densityLabel} aria-label={densityLabel} />
          {!isMobileDevice && (
            <IconBtn icon="grid_view" iconSize={16} color={C.muted} onClick={() => setDesktopLayoutPersist("full")} title="Full panels" aria-label="Full panels" />
          )}
          {/* Owner ticket UFgySrCag: email + contacts icons on every layout (this is the card-grid chrome). */}
          <IconBtn icon="mail" iconSize={16}
            color={googleToken ? C.muted : C.accent}
            onClick={googleToken ? () => window.open("https://mail.google.com/mail/u/0/#inbox", "_blank") : onConnectGoogle}
            title={googleToken ? "Open Gmail" : "Connect Google Mail & Calendar"}
            aria-label={googleToken ? "Open Gmail" : "Connect Google Mail and Calendar"} />
          <IconBtn icon="contacts" iconSize={16} color={C.muted} onClick={onOpenPhone} title="Contacts — open phone view" aria-label="Contacts" />
        </div>

        {nextActionBar}

        {/* >= 1000 px: 5 columns side by side, each full height.
            <  1000 px: 5 rows stacked, each 1/5 height — all cards always visible. */}
        {/* GM3 grid rhythm: real gutters between cards (tighter when dense, but still
            breathing) — tone + space do the separation, matching the full-panel view. */}
        <div style={{
            // One screen, no page scroll: all five categories always visible.
            // Wide (>= 1000 px): five REAL full-height columns side by side — the
            // desktop columns view (owner 7/21: the stacked frozen-header row
            // cards on desktop were a regression; columns are the wide layout).
            // Narrow: rows weighted by content so a busy card gets more of the
            // screen than a quiet one — the equal fifths were the real bug.
            flex: 1, minHeight: 0, overflow: "hidden",
            display: "grid", gap: 10, marginTop: 8,
            ...(boxesFiveCol ? {
              gridTemplateColumns: boxCols,
              gridTemplateRows: "1fr",
            } : expandedBoxId ? {
              // Expanded card always gets the single-column treatment — predictable
              // in both widths (in 2-col the expanded card can't cleanly span).
              gridTemplateColumns: "1fr",
              gridTemplateRows: BOX_ORDER.map(id => id === expandedBoxId ? "minmax(0,4fr)" : "min-content").join(" "),
            } : availableW >= NC_FEED_2COL ? {
              // 2-col (tablet portrait): 5 cards auto-place into 3 rows — defining 5
              // weighted rows here left rows 4-5 EMPTY, wasting ~40% of the screen
              // (owner's iPad). Calendar spans the full bottom row.
              gridTemplateColumns: "repeat(2, minmax(0,1fr))",
              gridTemplateRows: "repeat(3, minmax(0,1fr))",
            } : {
              gridTemplateColumns: "1fr",
              gridTemplateRows: BOX_ORDER.map(id => `minmax(0, ${feedWeights[id]}fr)`).join(" "),
            }),
            paddingBottom: "calc(6px + env(safe-area-inset-bottom,0px))",
          }}>

          {/* Mail */}
          <MobileBox {...boxCtx} {...boxProps("mail")} icon="mail" title="Mail" accentColor={CAT_MAIL} count={feedCounts.mail} summary={cardSummary("Mail")} style={cardStyle} dense={dense}
            onOpen={() => window.open("https://mail.google.com/mail/u/0/#inbox","_blank")}
            /* Account picker + refresh ride the card's own header row instead of a second
               toolbar row underneath it (owner ticket 7/14: "two rows when they need only
               one" — was its own <div> above the list, doubling the header height). */
            headerActions={<>
              {googleAcctMenuEl}
              <IconBtn icon="refresh" iconSize={14} color={C.muted} onClick={onRefreshCalendar || onConnectGoogle} title="Refresh mail" aria-label="Refresh mail" />
            </>}
            hero={heroMail ? showHero(
              <HeroItem C={C} accent={CAT_MAIL}
                title={heroMail.aiSummary || decodeSnipM(heroMail.snippet) || gmailHdr(heroMail,"Subject") || "(no subject)"}
                meta={[fmtFromM(gmailHdr(heroMail,"From")), fmtRelM(gmailHdr(heroMail,"Date"))].filter(Boolean).join(" · ")}
                onClick={() => setExpandedBoxId(prev => prev === "mail" ? null : "mail")} />
            ) : null}>
            {fitRows => {
            const mailSrc = actionMail;
            const mailRest = heroOk ? mailSrc.filter(m => m.id !== heroMail?.id) : mailSrc;
            const mailCut = fitSlice(mailRest, fitRows, expandedBoxId === "mail");
            return (<>
            {(!gmailMessages || gmailMessages.length===0) ? emptyMsg("Inbox clear.") : mailCut.shown.map((msg,i) => {
              const subj = gmailHdr(msg,"Subject")||"(no subject)";
              const from = fmtFromM(gmailHdr(msg,"From"));
              const date = fmtRelM(gmailHdr(msg,"Date"));
              const snip = msg.aiSummary||decodeSnipM(msg.snippet)||subj;
              const rk = `mail-${msg.id||i}`;
              const exp = expandedRows.has(rk);
              // Calm-rows: read mail whispers; unread carries the color.
              const rowVars = !mailIsUnread(msg) && !exp ? NC_DIM_ROW : {};
              return (
                <ListItem key={msg.id||i} type="button" onClick={()=>toggleRow(rk)} style={{ borderRadius: RADIUS.sm, ...rowVars }}>
                  {/* Uniform leading: same 7px dot metric as every other card's rows. */}
                  {<span slot="start" style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: mailIsUnread(msg) ? CAT_MAIL : "transparent", flexShrink: 0 }} />}
                  {/* Body summary is the read target (full headline size); sender rides the
                      smaller supporting line — buglog "need a magnifier" ticket. */}
                  <span slot="headline" style={{ color:C.text, fontWeight:450, whiteSpace:"normal", wordBreak:"break-word", ...(exp ? {} : { display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }) }}>{snip}</span>
                  <span slot="supporting-text" style={{ color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{exp && subj && subj !== snip ? `${from} — ${subj}` : from}</span>
                  <span slot="trailing-supporting-text" style={{ color:C.faint, whiteSpace:"nowrap" }}>{date}</span>
                  <span slot="end"><IconBtn icon="open_in_new" iconSize={14} color={C.faint} title="Open in Gmail" href={gmailDeepLink(msg)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} /></span>
                </ListItem>
              );
            })}
            {mailCut.hidden > 0 && (
              <MoreRow C={C} count={mailCut.hidden} onClick={() => setExpandedBoxId("mail")} />
            )}
            </>);
            }}
          </MobileBox>

          {/* Phone */}
          <MobileBox {...boxCtx} {...boxProps("phone")} icon="phone_in_talk" title="Phone" accentColor={CAT_PHONE} count={feedCounts.phone} summary={cardSummary("Phone")} style={cardStyle} dense={dense}
            statusDot={phoneDotColor} onOpen={onOpenPhone}
            hero={heroPhone ? showHero(
              <HeroItem C={C} accent={CAT_PHONE} title={heroPhone.title} meta={heroPhone.meta}
                onClick={() => setExpandedBoxId(prev => prev === "phone" ? null : "phone")} />
            ) : null}>
            {/* Flex column with a real height so the phone surface's flex:1 activity feed
                gets space. A plain block wrapper collapsed the feed to zero height → blank. */}
            <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0, padding: "0 8px 6px", boxSizing:"border-box" }}>
              <NerveCenterPhoneSurface T={T} user={user} onOnlineChange={onOnlineChange} onStatusSummary={handlePhoneStatusSummary} onActivitySnapshot={handlePhoneActivitySummary} compact dense={dense} onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
            </div>
          </MobileBox>

          {/* Tasks */}
          <MobileBox {...boxCtx} {...boxProps("tasks")} icon="rule" title="Tasks" accentColor={C.accent} count={feedCounts.tasks} summary={cardSummary("Tasks")} style={cardStyle} dense={dense}
            onOpen={onOpenQueue}
            hero={heroTask ? showHero(
              <HeroItem C={C} accent={gP(priorities, heroTask.priority)?.color || C.accent}
                title={nerveDisplaySummary(heroTask, "Untitled task")}
                meta={gP(priorities, heroTask.priority)?.label || ""}
                onClick={() => setExpandedBoxId(prev => prev === "tasks" ? null : "tasks")} />
            ) : null}>
            {fitRows => {
            const taskSrc = actionTasks;
            const taskRest = heroOk ? taskSrc.filter(t => t.id !== heroTask?.id) : taskSrc;
            const taskCut = fitSlice(taskRest, fitRows, expandedBoxId === "tasks");
            return (<>
            {taskComposerOpen && (
              <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.divider}` }}>
                <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 32px 32px", gap:6, alignItems:"start" }}>
                  <textarea ref={stackedTaskInputRef} value={taskDraft} rows={1} autoFocus
                    onChange={e => { setTaskDraft(e.target.value); e.target.style.height="34px"; e.target.style.height=Math.min(e.target.scrollHeight,88)+"px"; }}
                    onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addDraft(taskPriority,{mrsW:taskComposerMrsW});} if(e.key==="Escape"){setTaskComposerOpen(false);setTaskDraft("");} }}
                    placeholder="New task"
                    style={{ width:"100%", minWidth:0, height:34, maxHeight:88, boxSizing:"border-box", borderRadius:RADIUS.sm, border:`1px solid ${activePriColor}`, background:C.bgSoft, color:C.text, padding:"7px 10px", fontSize:ncType.body, fontFamily:NC_FONT_STACK, outline:"none", resize:"none", overflowY:"hidden" }} />
                  <IconBtn variant="filled" icon="check" iconSize={15} containerColor={activePriColor} color="#fff" disabled={!taskDraft.trim()} onClick={() => addDraft(taskPriority,{mrsW:taskComposerMrsW})} title="Save task" aria-label="Save task" />
                  <IconBtn icon="close" iconSize={14} color={C.muted} onClick={() => {setTaskComposerOpen(false);setTaskDraft("");}} title="Cancel" aria-label="Cancel" />
                </div>
              </div>
            )}
            {primaryTaskQueue.length === 0 && !taskComposerOpen ? emptyMsg("No open tasks.") : taskCut.shown.map((t, ti) => {
              const pri = gP(priorities, t.priority);
              const priColor = pri?.color || C.accent || "#7EB0DE";
              const isEditing = editingTaskId === t.id;
              if (isEditing) {
                return (
                  <div key={t.id} style={{ display:"grid", gridTemplateColumns: dense ? "12px minmax(0,1fr)" : "16px minmax(0,1fr)", alignItems:"start", padding:`${padY}px 10px ${padY}px 0`, gap: dense?6:8 }}>
                    <span style={{ width: dense?6:8, height: dense?6:8, borderRadius:RADIUS.pill, background:priColor, flexShrink:0, marginLeft: dense?6:0, marginTop:6 }} />
                    <textarea value={editText} autoFocus rows={2}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(editText.trim())onEditTask?.(t.id,editText.trim());setEditingTaskId(null);} if(e.key==="Escape")setEditingTaskId(null); }}
                      onBlur={() => { if(editText.trim()&&editText!==t.text)onEditTask?.(t.id,editText.trim());setEditingTaskId(null); }}
                      style={{ width:"100%", boxSizing:"border-box", borderRadius:RADIUS.sm, border:`1px solid ${priColor}`, background:C.bgSoft, color:C.text, padding:"6px 8px", fontSize:ncType.body, fontFamily:NC_FONT_STACK, lineHeight:ncType.line, resize:"none", outline:"none" }} />
                  </div>
                );
              }
              return (
                <ListItem key={t.id} type="button" title="Click to edit" onClick={() => { setEditingTaskId(t.id); setEditText(t.text); }} style={{ borderRadius: RADIUS.sm }}>
                  <span slot="start" style={{ width: 7, height: 7, borderRadius:RADIUS.pill, background:priColor }} />
                  <span slot="headline" style={{ color:C.text, fontWeight:500, wordBreak:"break-word" }}>{nerveDisplaySummary(t,"Untitled task")}</span>
                  <span slot="end" style={{ display:"flex", gap: 4 }}>
                    <IconBtn icon="check" size={48} iconSize={22} color={C.success} title="Done" aria-label="Mark done" onClick={e => { e.stopPropagation(); onCompleteTask?.(t.id); }} />
                    <IconBtn icon="close" size={48} iconSize={20} color={C.danger} title="Delete" aria-label="Delete task" onClick={e => { e.stopPropagation(); onDeleteTask?.(t.id); }} />
                  </span>
                </ListItem>
              );
            })}
            {taskCut.hidden > 0 && (
              <MoreRow C={C} count={taskCut.hidden} onClick={() => setExpandedBoxId("tasks")} />
            )}
            </>);
            }}
          </MobileBox>

          {/* Shailos */}
          <MobileBox {...boxCtx} {...boxProps("shailos")} icon="question_mark" title="Shailos" accentColor={GOLD} count={feedCounts.shailos} summary={cardSummary("Shailos")} style={cardStyle} dense={dense}
            onOpen={onOpenShailos}
            hero={heroShaila ? showHero(
              <HeroItem C={C} accent={GOLD}
                title={nerveDisplaySummary(heroShaila, "Open shaila")}
                meta={(heroShaila.status === "get_back" || heroShaila.isGetBackStep) ? "waiting to reply" : "pending answer"}
                onClick={() => setExpandedBoxId(prev => prev === "shailos" ? null : "shailos")} />
            ) : null}>
            {fitRows => {
            const shailaSrc = actionShailos;
            const shailaRest = heroOk ? shailaSrc.filter(s => s.id !== heroShaila?.id) : shailaSrc;
            const shailaCut = fitSlice(shailaRest, fitRows, expandedBoxId === "shailos");
            return (<>
            {visibleShailos.length === 0 ? emptyMsg("No pending shailos.") : shailaCut.shown.map((s, si) => {
              const text = nerveDisplaySummary(s,"Open shaila");
              const isGetBack = s.status==="get_back"||!!s.isGetBackStep;
              return (
                <ListItem key={s.id} type="button" onClick={onOpenShailos} style={{ borderRadius: RADIUS.sm }}>
                  <span slot="start" style={{ width: 7, height: 7, borderRadius:RADIUS.pill, background:GOLD }} />
                  <span slot="headline" style={{ color:C.text, fontWeight:500, wordBreak:"break-word" }}>{text}</span>
                  {!dense && <span slot="supporting-text" style={{ color:GOLD, fontWeight:500 }}>{isGetBack?"waiting to reply":"pending answer"}</span>}
                </ListItem>
              );
            })}
            {shailaCut.hidden > 0 && (
              <MoreRow C={C} count={shailaCut.hidden} onClick={() => setExpandedBoxId("shailos")} />
            )}
            </>);
            }}
          </MobileBox>

          {/* Calendar */}
          <MobileBox {...boxCtx} {...boxProps("calendar")} icon="calendar_today" title="Calendar" accentColor={C.warning} count={feedCounts.calendar} summary={cardSummary("Calendar")}
            style={!boxesFiveCol && !expandedBoxId && availableW >= NC_FEED_2COL ? { ...cardStyle, gridColumn: "1 / -1" } : cardStyle} dense={dense}
            onOpen={() => window.open("https://calendar.google.com/calendar/r","_blank")}
            /* Account picker + refresh + Agenda/Live-time toggle ride the card's own header
               row instead of a second toolbar row underneath it (owner ticket 7/14: "two
               rows when they need only one"). */
            headerActions={<>
              {googleAcctMenuEl}
              <IconBtn icon="refresh" iconSize={14} color={C.muted} onClick={onRefreshCalendar || onConnectGoogle} title="Refresh calendar" aria-label="Refresh calendar" />
              <IconBtn icon="schedule" iconSize={14} color={calCardView==="timeline"?C.text:C.muted} active={calCardView==="timeline"} activeBg={C.hover} onClick={()=>setCalCardView("timeline")} title="Live time" aria-label="Live time view" />
              <IconBtn icon="view_agenda" iconSize={14} color={calCardView==="agenda"?C.text:C.muted} active={calCardView==="agenda"} activeBg={C.hover} onClick={()=>setCalCardView("agenda")} title="Agenda" aria-label="Agenda view" />
            </>}
            hero={heroCalRow ? showHero(
              <HeroItem C={C} accent={GCAL_COLORS[heroCalRow.evt?.colorId] || C.warning}
                title={heroCalRow.evt?.summary || "(no title)"}
                meta={heroCalRow.now ? `Now · ${heroCalRow.label}` : heroCalRow.tomorrow ? `Tomorrow · ${heroCalRow.label}` : heroCalRow.label}
                onClick={() => setExpandedBoxId(prev => prev === "calendar" ? null : "calendar")} />
            ) : null}>
            {/* Fill the box as a flex column so the timeline's internal scroll bounds correctly. */}
            <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0 }}>
              {showAddEvent && (
                <div style={{ padding:"10px 12px", borderBottom:`1px solid ${C.divider}`, flexShrink:0 }}>
                  <textarea autoFocus value={addEventText} onChange={e=>setAddEventText(e.target.value)} rows={2} placeholder='e.g. "Call David Mon at 3pm"'
                    onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();handleAddEvent();}}}
                    style={{ width:"100%", boxSizing:"border-box", borderRadius:RADIUS.sm, border:`1px solid ${C.divider}`, background:C.bgSoft, color:C.text, fontSize:ncType.body, padding:"7px 10px", resize:"none", fontFamily:NC_FONT_STACK, outline:"none" }} />
                  {addEventError && <div style={{ fontSize:ncType.meta, color:C.danger, marginTop:4 }}>{addEventError}</div>}
                  <div style={{ display:"flex", gap:6, marginTop:6, justifyContent:"flex-end" }}>
                    <ActionBtn variant="text" labelColor={C.muted} onClick={()=>{setShowAddEvent(false);setAddEventText("");setAddEventError(null);}}>Cancel</ActionBtn>
                    <ActionBtn variant="filled" containerColor={C.accent} labelColor="#fff" disabled={addEventLoading||!addEventText.trim()} onClick={handleAddEvent}>{addEventLoading?"Adding…":"Add"}</ActionBtn>
                  </div>
                </div>
              )}
              {!calendarEvents ? (
                <div style={{ flex:1, minHeight:0, display:"flex", alignItems:"center" }}>{emptyMsg("Loading…")}</div>
              ) : calCardView === "timeline" ? (
                <CalendarTimeline calendarRows={calendarRows} nowDate={nowDate} C={C} scrollRef={calendarNowRef} nowLineRef={calendarNowLineRef} />
              ) : (
                <div data-agenda-scroll="true" style={{ flex:1, minHeight:0, overflowY:"auto", overflowX:"hidden" }}>
                  {calendarRows.filter(r => !r.tomorrow).length === 0 && calendarRows.filter(r => r.tomorrow).length === 0 ? emptyMsg("No events today.") : (() => {
                    const cardListStyle = { ...denseListVars({ dense: true, primary: C.text, secondary: C.muted, hover: C.text }), padding: 0, background: "transparent" };
                    const pastRows     = calendarRows.filter(r => r.past && !r.tomorrow);
                    // v7: importance-ordered (owner ratings) instead of clock order.
                    const upRows       = actionCalendar.filter(r => !r.tomorrow);
                    const tomorrowRows = calendarRows.filter(r => r.tomorrow);
                    const nlc = C.success || C.accent || "#1A9E78";
                    const NowBar = (
                      <div ref={agendaNowBarRef} style={{ display:"grid", gridTemplateColumns:"44px minmax(0,1fr)", gap:8, alignItems:"center", padding:"4px 0", margin:"0 2px" }}>
                        <span style={{ color:nlc, fontSize:NC_TYPE.small, fontWeight:700, textAlign:"right", fontFamily:NC_FONT_STACK, whiteSpace:"nowrap" }}>Now</span>
                        <span style={{ height:2, borderRadius:2, background:nlc, boxShadow:`0 0 0 1px ${softBorder(nlc,0.18)}` }} />
                      </div>
                    );
                    const TomorrowBar = (
                      <div style={{ display:"grid", gridTemplateColumns:"44px minmax(0,1fr)", gap:8, alignItems:"center", padding:"4px 0", margin:"0 2px" }}>
                        <span style={{ color:C.muted, fontSize:NC_TYPE.small, fontWeight:700, textAlign:"right", fontFamily:NC_FONT_STACK, whiteSpace:"nowrap" }}>Tmrw</span>
                        <span style={{ height:1, borderRadius:1, background:C.divider }} />
                      </div>
                    );
                    const mkItem = (row) => {
                      const timeLabel = row.evt?.start?.date ? "All day" : new Date(row.evt?.start?.dateTime).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
                      const barColor = GCAL_COLORS[row.evt?.colorId] || C.warning;
                      const rating = calendarRatingOf(row.evt, calRatings);
                      const rateBtn = <IconBtn slot="end" icon={CAL_IMPORTANCE[rating].icon} size={48} iconSize={20}
                          color={rating === 1 ? C.danger : rating === 3 ? C.faint : C.muted}
                          title={`Importance: ${CAL_IMPORTANCE[rating].label} — tap to change`}
                          aria-label={`Importance ${rating}, ${CAL_IMPORTANCE[rating].label}. Tap to change.`}
                          onClick={e => { e.stopPropagation(); e.preventDefault(); cycleCalendarRating(row.evt); }} />;
                      const item = (
                        <>
                          {/* v2 uniform leading: same 7px dot metric as every card; the
                              pre-proto look keeps the GCal-style vertical bar. */}
                          <span slot="start" style={{ width:7, height:7, borderRadius:RADIUS.pill, background:barColor, opacity:row.past?0.4:1 }} />
                          <span slot="headline" style={{ color:row.now?C.text:row.past?C.faint:C.muted, fontWeight:row.now?600:500, wordBreak:"break-word" }}>{row.evt?.summary||"(no title)"}</span>
                          <span slot="trailing-supporting-text" style={{ color:row.now?C.accent:C.faint, fontWeight:row.now?700:500, whiteSpace:"nowrap" }}>{row.now?"Now":timeLabel}</span>
                          {rateBtn}
                        </>
                      );
                      // v7: the real day still shows (routine included); FYI-rated
                      // events recede instead of being hidden.
                      const rowOpacity = row.past ? 0.65 : (rating === 3 ? 0.5 : 1);
                      return row.evt?.htmlLink
                        ? <ListItem key={row.evt?.id||row.index} type="link" href={row.evt.htmlLink} target="_blank" style={{ borderRadius:RADIUS.sm, opacity:rowOpacity }}>{item}</ListItem>
                        : <ListItem key={row.evt?.id||row.index} type="text" style={{ borderRadius:RADIUS.sm, opacity:rowOpacity }}>{item}</ListItem>;
                    };
                    return (
                      <>
                        {/* Calm-rows: the morning's finished events collapse to one line. */}
                        {pastRows.length > 0 && (!expandedRows.has("cal-past")
                          ? <MoreRow C={C} count={pastRows.length} label="earlier" onClick={() => toggleRow("cal-past")} />
                          : <>
                              {<MoreRow C={C} open label="earlier" count={pastRows.length} onClick={() => toggleRow("cal-past")} />}
                              <List style={cardListStyle}>{pastRows.map(mkItem)}</List>
                            </>)}
                        {NowBar}
                        {upRows.length > 0 && <List style={cardListStyle}>{upRows.map(mkItem)}</List>}
                        {tomorrowRows.length > 0 && <>{TomorrowBar}<List style={cardListStyle}>{tomorrowRows.map(mkItem)}</List></>}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </MobileBox>
        </div>

      </div>
    );
  }

  // ── Mobile "nerve center" — all sections on one screen ──────────────────────
  if (isStacked && !healthPage && !chiefPage) {
    const mobileMenuToggle = id => setMobileMenuOpen(prev => prev === id ? null : id);
    const mobileMenuClose  = () => setMobileMenuOpen(null);
    const mobileExpandToggle = id => setMobileExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

    // Shared props for the module-level <MobileSection>. The component is hoisted out
    // of this render (see top of file) so it is NOT recreated on every clock tick —
    // that per-second remount was tearing down and rebuilding each section mid-gesture,
    // which dropped taps on the ··· menu and reset focus in the task composer. With a
    // stable component type React now just re-renders with fresh props.
    // >= 1500 px: 5 vertical columns side by side (each section full height, 1/5 width).
    // <  1500 px: 5 horizontal rows stacked (each section full width, 1/5 height).
    // Both orientations show all 5 sections simultaneously — always expanded, always fullHeight.
    // 1500 px = 5 cols × 300 px minimum comfortable reading width per column.
    const accWide = availableW >= 1500;
    // Same rule as the card grid: narrow stacked sections are too short for a
    // fixed hero row; give the height to real rows instead.
    const heroOk = accWide;
    const showHero = node => (heroOk ? node : null);
    // Accordion mode is retired — narrow-stacked sections are always expanded.
    const isAccordion = false;
    const sectionCtx = { C, expandedIds: mobileExpanded, menuId: mobileMenuOpen, onExpand: mobileExpandToggle, onMenuToggle: mobileMenuToggle, onMenuClose: mobileMenuClose, expandable: isAccordion, fullHeight: !isAccordion, dense };

    const signalNote = nerveSignalNote;

    const fmtTimeM = (raw) => { try { const d = new Date(raw); const now = new Date(); return d.toDateString()===now.toDateString() ? d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}) : d.toLocaleDateString([],{month:"short",day:"numeric"}); } catch { return ""; } };
    const gmailHdr = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || "";
    const fmtFromM = (raw) => { const m = raw?.match(/^"?([^"<]+)"?\s*<[^>]+>/); return m ? m[1].trim() : (raw || "").split("@")[0]; };
    const decodeSnipM = s => (s || "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").trim();

    const hd = healthData || {};
    const fmtStepsM  = v => v != null ? Math.round(v).toLocaleString() : "—";
    const fmtSleepM  = v => { if (v == null) return "—"; const h = Math.floor(v); const m = Math.round((v%1)*60); return `${h}h${m>0?(m<10?"0":"")+m:""}`; };

    // Expanded sections scroll internally now, so show the full lists rather than a teaser.
    const taskMax = 50;
    const topTasks = primaryTaskQueue.slice(0, taskMax);
    const tasksPreview = signalNote("Tasks");

    return (
      // Fixed panel: flex-column so chrome stays pinned and sections fill the rest.
      <div style={{ position: "fixed", top: topOffset, left: sidebarW, right: 0, height: `calc(100dvh - ${topOffset}px)`, zIndex: 7600, background: pageBg, overflow: "hidden", display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.divider}` }}>

        {/* ── Chrome: layout selector, summary, clock — never scrolls ── */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 5, padding: "5px 10px 0" }}>

          {nextActionBar}

          {/* One-row chrome: time strip (tap for timeline) + one-touch display controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 2px 2px" }}>
            <ListItem type="button" onClick={() => setMobileTimelineOpen(o => !o)} aria-expanded={mobileTimelineOpen} title="Show timeline"
              style={{
                minWidth: 0, ...denseListVars({ dense: true }),
                '--md-list-item-one-line-container-height': '24px',
                '--md-list-item-leading-space': '0px', '--md-list-item-trailing-space': '0px',
                '--md-list-item-top-space': '0px', '--md-list-item-bottom-space': '0px',
              }}>
              <div slot="headline" style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 22, fontWeight: 400, color: C.text, fontFamily: NC_MONO_STACK, fontVariantNumeric: "tabular-nums", letterSpacing: 0 }}>{clockParts.timeMain}</span>
                <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK }}>{nowDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
              </div>
              <span slot="end" style={{ alignSelf: "center", color: C.faint, display: "flex", transform: mobileTimelineOpen ? "rotate(90deg)" : "none", transition: "transform 0.18s" }}>{suiteIcon("chevron_right", 14)}</span>
            </ListItem>
            <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
              {/* Card-grid icon tracks its real orientation: columns wide, rows narrow. */}
              {!isMobileDevice && [{ id:"boxes", icon: availableW >= 1000 ? "view_column" : "table_rows", label:"Card grid" }, { id:"full", icon:"grid_view", label:"Full panel" }].map(({ id, icon, label }) => (
                <IconBtn key={id} icon={icon} iconSize={16} color={desktopLayout === id ? C.text : C.muted} active={desktopLayout === id} activeBg={C.hover} onClick={() => setDesktopLayoutPersist(id)} title={label} aria-label={label} />
              ))}
              <IconBtn icon={densityIcon} iconSize={16} color={C.muted} onClick={toggleMobileDensity} title={densityLabel} aria-label={densityLabel} />
              {/* Owner ticket UFgySrCag ("tablet display must have a connect to email
                  and contacts icon — ALL nc formats, not just one"): these sit in the
                  one-row chrome, which every layout renders — accordion, stacked,
                  card grid and full panel alike. Mail is state-aware: accent-colored
                  "connect" while Google isn't linked, quiet "open Gmail" once it is. */}
              <IconBtn icon="mail" iconSize={16}
                color={googleToken ? C.muted : C.accent}
                onClick={googleToken ? () => window.open("https://mail.google.com/mail/u/0/#inbox", "_blank") : onConnectGoogle}
                title={googleToken ? "Open Gmail" : "Connect Google Mail & Calendar"}
                aria-label={googleToken ? "Open Gmail" : "Connect Google Mail and Calendar"} />
              <IconBtn icon="contacts" iconSize={16} color={C.muted} onClick={onOpenPhone} title="Contacts — open phone view" aria-label="Contacts" />
            </div>
          </div>
          {mobileTimelineOpen && (
            <div style={{ padding: "10px 12px 5px", background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm }}>
              <TimelineFace nowDate={nowDate} C={C} compact />
            </div>
          )}
        </div>

        {/* ── Sections ── accordion: a scrollable column of collapsible summary lines.
             Non-accordion stacked: 5 columns when wide, 5 rows when narrow, all expanded. ── */}
        <div style={{ ...denseListVars({ dense, primary: C.text, secondary: C.muted, hover: C.text }), ...(isAccordion
          ? { flex: 1, minHeight: 0, gap: dense ? 8 : 12, display: "flex", flexDirection: "column",
              overflowY: "auto", overflowX: "hidden",
              padding: "6px 10px calc(10px + env(safe-area-inset-bottom, 0px))" }
          : { flex: 1, minHeight: 0, gap: dense ? 8 : 12, display: "grid", overflow: "hidden",
              padding: "6px 10px calc(10px + env(safe-area-inset-bottom, 0px))",
              gridTemplateColumns: accWide ? "repeat(5, minmax(0,1fr))" : "1fr",
              gridTemplateRows:    accWide ? "1fr" : "repeat(5, minmax(0,1fr))" }) }}>

          {/* Tasks — collapsible; open the section when the composer is invoked so it shows. */}
          <MobileSection {...sectionCtx} id="tasks" icon="rule" title="Tasks" accentColor={C.accent} count={primaryTaskQueue.length} preview={tasksPreview}
            primaryBtn={<IconBtn icon="add" iconSize={14} color={C.muted} onClick={() => { setMobileExpanded(prev => new Set(prev).add("tasks")); openTaskComposer(taskPriority); }} title="Add task" aria-label="Add task" />}
            menuItems={[
              { icon: "list_alt",    label: "Open full queue", run: onOpenQueue },
              { icon: "local_drink", label: "Zen mode",        run: onOpenZen },
              ...(onAddMrsWTask ? [{ icon: "person", label: "Add Mrs W task", run: () => { setMobileExpanded(prev => new Set(prev).add("tasks")); openTaskComposer(taskPriority, { mrsW: true }); } }] : []),
            ]}
            hero={heroTask ? showHero(
              <HeroItem C={C} accent={gP(priorities, heroTask.priority)?.color || C.accent}
                title={nerveDisplaySummary(heroTask, "Untitled task")}
                meta={gP(priorities, heroTask.priority)?.label || ""}
                onClick={() => toggleRow("sec-tasks")} />
            ) : null}
          >
            {fitRows => {
            const secTaskRest = heroOk ? topTasks.filter(t => t.id !== heroTask?.id) : topTasks;
            const secTaskCut = fitSlice(secTaskRest, fitRows, expandedRows.has("sec-tasks"));
            return (<>
            {taskComposerOpen && (
              <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.divider}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 32px 32px", gap: 6, alignItems: "start" }}>
                  <textarea ref={stackedTaskInputRef} value={taskDraft} rows={1} autoFocus
                    onChange={e => { setTaskDraft(e.target.value); e.target.style.height="34px"; e.target.style.height=Math.min(e.target.scrollHeight,88)+"px"; }}
                    onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addDraft(taskPriority,{mrsW:taskComposerMrsW});} if(e.key==="Escape"){setTaskComposerOpen(false);setTaskDraft("");} }}
                    placeholder="New task"
                    style={{ width:"100%",minWidth:0,height:34,maxHeight:88,boxSizing:"border-box",borderRadius:RADIUS.sm,border:`1px solid ${activePriColor}`,background:C.bgSoft,color:C.text,padding:"7px 10px",fontSize:ncType.body,fontFamily:NC_FONT_STACK,outline:"none",resize:"none",overflowY:"hidden" }} />
                  <IconBtn variant="filled" icon="check" iconSize={15} containerColor={activePriColor} color="#fff" disabled={!taskDraft.trim()} onClick={() => addDraft(taskPriority,{mrsW:taskComposerMrsW})} title="Save task" aria-label="Save task" />
                  <IconBtn icon="close" iconSize={14} color={C.muted} onClick={() => {setTaskComposerOpen(false);setTaskDraft("");}} title="Cancel" aria-label="Cancel" />
                </div>
              </div>
            )}
            {topTasks.length === 0 && !taskComposerOpen && <div style={{ padding:"7px 12px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK }}>No open tasks.</div>}
            {secTaskCut.shown.map((t, ti) => {
              const pri = gP(priorities, t.priority);
              const priColor = pri?.color || C.accent || "#7EB0DE";
              const isEditing = editingTaskId === t.id;
              if (isEditing) {
                return (
                  <div key={t.id} data-nc-task-row="true" style={{ display:"grid",gridTemplateColumns:"16px minmax(0,1fr)",alignItems:"start",padding:"4px 12px 4px 0",gap:8 }}>
                    <span style={{ width: dense?6:8,height: dense?6:8,borderRadius:RADIUS.pill,background:priColor,flexShrink:0,marginLeft: dense?5:0,marginTop:6 }} />
                    <textarea value={editText} autoFocus rows={2}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(editText.trim())onEditTask?.(t.id,editText.trim());setEditingTaskId(null);} if(e.key==="Escape")setEditingTaskId(null); }}
                      onBlur={() => { if(editText.trim()&&editText!==t.text)onEditTask?.(t.id,editText.trim());setEditingTaskId(null); }}
                      style={{ width:"100%",boxSizing:"border-box",borderRadius:RADIUS.sm,border:`1px solid ${priColor}`,background:C.bgSoft,color:C.text,padding:"6px 8px",fontSize:ncType.body,fontFamily:NC_FONT_STACK,lineHeight:ncType.line,resize:"none",outline:"none" }} />
                  </div>
                );
              }
              return (
                <ListItem key={t.id} data-nc-task-row="true" type="button" title="Click to edit" onClick={() => { setEditingTaskId(t.id); setEditText(t.text); }} style={{ borderRadius: RADIUS.sm }}>
                  <span slot="start" style={{ width: 7,height: 7,borderRadius:RADIUS.pill,background:priColor }} />
                  <span slot="headline" style={{ color:C.text, fontWeight:500, wordBreak:"break-word" }}>{nerveDisplaySummary(t,"Untitled task")}</span>
                  <span slot="end" style={{ display:"flex", gap:2 }}>
                    <IconBtn icon="check" size={dense?26:32} iconSize={dense?13:15} color={C.success} title="Done" aria-label="Mark done" onClick={e => { e.stopPropagation(); onCompleteTask?.(t.id); }} />
                    <IconBtn icon="close" size={dense?26:32} iconSize={dense?12:14} color={C.danger} title="Delete" aria-label="Delete task" onClick={e => { e.stopPropagation(); onDeleteTask?.(t.id); }} />
                  </span>
                </ListItem>
              );
            })}
            {secTaskCut.hidden > 0 && (
              <MoreRow C={C} open={expandedRows.has("sec-tasks")} count={secTaskCut.hidden} onClick={() => toggleRow("sec-tasks")} />
            )}
            </>);
            }}
          </MobileSection>

          {/* Calendar */}
          {(googleToken || calendarEvents !== null) && (
            <MobileSection {...sectionCtx} id="cal" icon="calendar_today" title="Calendar" accentColor={C.warning}
              preview={signalNote("Calendar")}
              menuItems={[
                { icon: "add",         label: "Add event",            run: () => { setMobileExpanded(prev => new Set(prev).add("cal")); setShowAddEvent(true); } },
                { icon: "refresh",     label: "Refresh",              run: onRefreshCalendar || onConnectGoogle },
                { icon: "open_in_new", label: "Open Google Calendar", run: () => window.open("https://calendar.google.com/calendar/r","_blank") },
                ...googleAcctMenuItems,
                { icon: "link_off",    label: "Disconnect",           run: onDisconnectGoogle },
              ]}
              hero={heroCalRow ? showHero(
                <HeroItem C={C} accent={GCAL_COLORS[heroCalRow.evt?.colorId] || C.warning}
                  title={heroCalRow.evt?.summary || "(no title)"}
                  meta={heroCalRow.now ? `Now · ${heroCalRow.label}` : heroCalRow.tomorrow ? `Tomorrow · ${heroCalRow.label}` : heroCalRow.label}
                  onClick={() => toggleRow("sec-cal")} />
              ) : null}
            >
              {fitRows => {
              const secCalRest = (calendarRows.filter(r=>!r.past) || []).filter(r => !(heroOk) || r !== heroCalRow);
              const secCalCut = fitSlice(secCalRest, fitRows, expandedRows.has("sec-cal"));
              return (<>
              {!calendarEvents ? (
                <div style={{ padding:"7px 12px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,display:"flex",gap:8,alignItems:"center",borderTop:`1px solid ${C.divider}` }}>
                  <div style={{width:10,height:10,borderRadius:"50%",border:`2px solid ${C.faint}`,borderTopColor:"transparent",animation:"ot-spin 0.8s linear infinite"}} /> Loading…
                </div>
              ) : calendarRows.filter(r=>!r.past).length === 0 ? (
                <div style={{ padding:"7px 12px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,borderTop:`1px solid ${C.divider}` }}>Nothing upcoming today.</div>
              ) : secCalCut.shown.map(row => {
                const timeLabel = row.evt?.start?.date ? "All day" : new Date(row.evt?.start?.dateTime).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
                const lifted = row.now || row.special;
                // Calm-rows: routine events (davening etc.) whisper so specials stand out.
                const rowOpacity = row.routine && !row.now ? 0.55 : 1;
                const item = (
                  <>
                    {<span slot="start" style={{ width:7, height:7, borderRadius:RADIUS.pill, background:GCAL_COLORS[row.evt?.colorId] || C.warning, flexShrink:0 }} />}
                    <span slot="headline" style={{ color: lifted?C.text:C.muted, fontWeight:lifted?600:500, wordBreak:"break-word" }}>{row.evt?.summary||"(no title)"}</span>
                    <span slot="trailing-supporting-text" style={{ color:row.now?C.accent:C.faint, fontWeight:row.now?700:500, whiteSpace:"nowrap" }}>{row.now?"Now":timeLabel}</span>
                  </>
                );
                return row.evt?.htmlLink
                  ? <ListItem key={row.evt?.id||row.index} type="link" href={row.evt.htmlLink} target="_blank" style={{ borderRadius: RADIUS.sm, opacity: rowOpacity }}>{item}</ListItem>
                  : <ListItem key={row.evt?.id||row.index} type="text" style={{ borderRadius: RADIUS.sm, opacity: rowOpacity }}>{item}</ListItem>;
              })}
              {secCalCut.hidden > 0 && (
                <MoreRow C={C} open={expandedRows.has("sec-cal")} count={secCalCut.hidden} onClick={() => toggleRow("sec-cal")} />
              )}
              {showAddEvent && (
                <div style={{ padding:"10px 12px",borderTop:`1px solid ${C.divider}` }}>
                  <textarea autoFocus value={addEventText} onChange={e=>setAddEventText(e.target.value)} rows={2} placeholder='e.g. "Call David Mon at 3pm"'
                    onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();handleAddEvent();}}}
                    style={{width:"100%",boxSizing:"border-box",borderRadius:RADIUS.sm,border:`1px solid ${C.divider}`,background:C.bgSoft,color:C.text,fontSize:ncType.body,padding:"7px 10px",resize:"none",fontFamily:NC_FONT_STACK,outline:"none"}} />
                  {addEventError && <div style={{fontSize:ncType.meta,color:C.danger,marginTop:4}}>{addEventError}</div>}
                  <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
                    <ActionBtn variant="text" labelColor={C.muted} onClick={()=>{setShowAddEvent(false);setAddEventText("");setAddEventError(null);}}>Cancel</ActionBtn>
                    <ActionBtn variant="filled" containerColor={C.accent} labelColor="#fff" disabled={addEventLoading||!addEventText.trim()} onClick={handleAddEvent}>{addEventLoading?"Adding…":"Add"}</ActionBtn>
                  </div>
                </div>
              )}
              </>);
              }}
            </MobileSection>
          )}

          {/* Gmail */}
          {(googleToken || gmailMessages !== null) && (
            <MobileSection {...sectionCtx} id="mail" icon="mail" title="Mail" accentColor={CAT_MAIL} count={(gmailMessages||[]).length}
              preview={signalNote("Mail")}
              menuItems={[
                { icon: "refresh",     label: "Refresh",    run: onRefreshCalendar || onConnectGoogle },
                { icon: "open_in_new", label: "Open Gmail", run: () => window.open("https://mail.google.com/mail/u/0/#inbox","_blank") },
                ...googleAcctMenuItems,
              ]}
              hero={heroMail ? showHero(
                <HeroItem C={C} accent={CAT_MAIL}
                  title={heroMail.aiSummary || decodeSnipM(heroMail.snippet) || gmailHdr(heroMail,"Subject") || "(no subject)"}
                  meta={[fmtFromM(gmailHdr(heroMail,"From")), fmtRelShort(gmailHdr(heroMail,"Date"))].filter(Boolean).join(" · ")}
                  onClick={() => window.open(gmailDeepLink(heroMail), "_blank")} />
              ) : null}
            >
              {fitRows => {
              const secMailRest = heroOk ? (gmailMessages || []).filter(m => m.id !== heroMail?.id) : (gmailMessages || []).slice(0,40);
              const secMailCut = fitSlice(secMailRest, fitRows, expandedRows.has("sec-mail"));
              return (<>
              {!gmailMessages || gmailMessages.length === 0 ? (
                <div style={{ padding:"7px 12px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,borderTop:`1px solid ${C.divider}` }}>Inbox clear.</div>
              ) : secMailCut.shown.map((msg,i) => {
                const subj = gmailHdr(msg,"Subject")||"(no subject)";
                const from = fmtFromM(gmailHdr(msg,"From"));
                const date = fmtTimeM(gmailHdr(msg,"Date"));
                const url  = gmailDeepLink(msg);
                const rowVars = !mailIsUnread(msg) ? NC_DIM_ROW : {};
                return (
                  <ListItem key={msg.id||i} type="link" href={url} target="_blank" style={{ borderRadius: RADIUS.sm, ...rowVars }}>
                    {<span slot="start" style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: mailIsUnread(msg) ? CAT_MAIL : "transparent", flexShrink: 0 }} />}
                    {/* Body summary headlines; sender rides the smaller supporting line. */}
                    <span slot="headline" style={{ color:C.text, fontWeight:450, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden", whiteSpace:"normal", wordBreak:"break-word" }}>{msg.aiSummary||decodeSnipM(msg.snippet)||subj}</span>
                    <span slot="supporting-text" style={{ color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{from}</span>
                    <span slot="trailing-supporting-text" style={{ color:C.faint, whiteSpace:"nowrap" }}>{date}</span>
                  </ListItem>
                );
              })}
              {secMailCut.hidden > 0 && (
                <MoreRow C={C} open={expandedRows.has("sec-mail")} count={secMailCut.hidden} onClick={() => toggleRow("sec-mail")} />
              )}
              </>);
              }}
            </MobileSection>
          )}

          {/* Shailos */}
          <MobileSection {...sectionCtx} id="shailos" icon="question_mark" title="Shailos" accentColor={GOLD} count={visibleShailos.length}
            preview={signalNote("Shailos")}
            primaryBtn={<IconBtn icon="add" iconSize={14} color={GOLD} onClick={onOpenShailaAdd} title="Add shaila" aria-label="Add shaila" />}
            menuItems={[{ icon: "open_in_full", label: "Open Shailos", run: onOpenShailos }]}
            hero={heroShaila ? showHero(
              <HeroItem C={C} accent={GOLD}
                title={nerveDisplaySummary(heroShaila, "Open shaila")}
                meta={(heroShaila.status === "get_back" || heroShaila.isGetBackStep) ? "waiting to reply" : "pending answer"}
                onClick={onOpenShailos} />
            ) : null}
          >
            {fitRows => {
            const secShailaRest = heroOk ? visibleShailos.filter(s => s.id !== heroShaila?.id) : visibleShailos.slice(0,40);
            const secShailaCut = fitSlice(secShailaRest, fitRows, expandedRows.has("sec-shailos"));
            return (<>
            {visibleShailos.length === 0 ? (
              <div style={{ padding:"7px 12px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,borderTop:`1px solid ${C.divider}` }}>No pending shailos.</div>
            ) : secShailaCut.shown.map((s, si) => {
              const text = nerveDisplaySummary(s,"Open shaila");
              const isGetBack = s.status==="get_back"||!!s.isGetBackStep;
              return (
                <ListItem key={s.id} type="button" onClick={onOpenShailos} style={{ borderRadius: RADIUS.sm }}>
                  <span slot="start" style={{ width: 7, height: 7, borderRadius:RADIUS.pill, background:GOLD }} />
                  <span slot="headline" style={{ color:C.text, fontWeight:500, wordBreak:"break-word" }}>{text}</span>
                  {!dense && <span slot="supporting-text" style={{ color:GOLD, fontWeight:500 }}>{isGetBack?"waiting to reply":"pending answer"}</span>}
                </ListItem>
              );
            })}
            {secShailaCut.hidden > 0 && (
              <MoreRow C={C} open={expandedRows.has("sec-shailos")} count={secShailaCut.hidden} onClick={() => toggleRow("sec-shailos")} />
            )}
            </>);
            }}
          </MobileSection>

          {/* Phone — keepMounted so the DeskPhone poller keeps running while collapsed */}
          <MobileSection {...sectionCtx} id="phone" icon="phone_in_talk" title="Phone" accentColor={CAT_PHONE} keepMounted
            preview={signalNote("Phone")}
            menuItems={[{ icon: "open_in_full", label: "Open phone view", run: onOpenPhone }]}
            hero={heroPhone ? showHero(
              <HeroItem C={C} accent={CAT_PHONE} title={heroPhone.title} meta={heroPhone.meta} onClick={onOpenPhone} />
            ) : null}
          >
            {/* Real height so the phone surface's flex:1 activity feed (texts + calls) gets
                space — a plain block wrapper collapsed it to zero, so calls never showed. */}
            <div style={{ padding: dense?"2px 12px 8px":"4px 12px 10px", borderTop: `1px solid ${C.divider}`, height: 380, boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
              <NerveCenterPhoneSurface T={T} user={user} onOnlineChange={onOnlineChange} onStatusSummary={handlePhoneStatusSummary} onActivitySnapshot={handlePhoneActivitySummary} compact dense={dense} onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
            </div>
          </MobileSection>

          {/* Connect Google prompt (no token yet) */}
          {googleClientId && !googleToken && !googleLoading && calendarEvents === null && gmailMessages === null && (
            <div style={{ display:"flex", justifyContent:"center", padding:"4px 0" }}>
              <ActionBtn variant="outlined" icon="add_link" outlineColor={C.divider} labelColor={C.muted} onClick={onConnectGoogle}>Connect Google Calendar &amp; Gmail</ActionBtn>
            </div>
          )}

        </div>

      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: `${topOffset}px 0 0 ${sidebarW}px`, zIndex: 7600, background: pageBg, overflow: isStacked ? "hidden" : touchLayout ? "auto" : "hidden", overscrollBehavior: "contain", borderLeft: `1px solid ${C.divider}` }}>
      <div style={isStacked ? { height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" } : { minHeight: "100%", height: touchLayout ? "auto" : "100%", maxWidth: 1520, margin: "0 auto", padding: touchLayout ? "clamp(16px,2.4vw,28px)" : "clamp(20px,2.4vw,32px)", paddingTop: 38, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: touchLayout ? 14 : 16 }}>

        {/* ── Layout + view mode toggles — floated into the page's top-right margin
             (absolute against the fixed root) so they stay one-touch without costing
             a content row; the inner container's paddingTop reserves their lane. ── */}
        {!isStacked && (
          <div style={{ position: "absolute", top: 5, right: 14, zIndex: 5, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
            {/* Layout: Boxes / Accordion / Full (desktop-only alternatives to the 3-column view) */}
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              {[
                // Card-grid icon tracks its real orientation (columns ≥1000 px, rows below);
                // the two icons were reversed relative to what each layout actually renders.
                { id: "boxes", icon: availableW >= 1000 ? "view_column" : "table_rows", title: "Card grid view" },
                { id: "full",  icon: "grid_view", title: "Full panel view" },
              ].map(({ id, icon, title }) => (
                <IconBtn key={id} icon={icon} iconSize={15} onClick={() => setDesktopLayoutPersist(id)} title={title} aria-label={title}
                  color={desktopLayout === id ? C.muted : C.faint} active={desktopLayout === id} activeBg={softBorder(C.divider, 0.55)} />
              ))}
            </div>
            <span style={{ width: 1, height: 14, background: C.divider, flexShrink: 0 }} />
            {/* Density: compact (aggressively tight rows) vs comfortable */}
            <IconBtn icon={densityIcon} iconSize={15} onClick={toggleMobileDensity} title={densityLabel} aria-label={densityLabel}
              color={dense ? C.muted : C.faint} active={dense} activeBg={softBorder(C.divider, 0.55)} />
            <span style={{ width: 1, height: 14, background: C.divider, flexShrink: 0 }} />
            {/* Owner ticket UFgySrCag: email + contacts icons on every layout (this is the full-panel chrome). */}
            <IconBtn icon="mail" iconSize={15}
              color={googleToken ? C.faint : C.accent}
              onClick={googleToken ? () => window.open("https://mail.google.com/mail/u/0/#inbox", "_blank") : onConnectGoogle}
              title={googleToken ? "Open Gmail" : "Connect Google Mail & Calendar"}
              aria-label={googleToken ? "Open Gmail" : "Connect Google Mail and Calendar"} />
            <IconBtn icon="contacts" iconSize={15} color={C.faint} onClick={onOpenPhone} title="Contacts — open phone view" aria-label="Contacts" />
          </div>
        )}

        {/* Panel tab bar — mobile/stacked only */}
        {isStacked && (
          <div style={{ display: "flex", background: C.bg, borderBottom: `1px solid ${C.divider}`, flexShrink: 0 }}>
            {[["Tasks", "rule", 0], ["Shailos", "question_mark", 1], ["Phone", "phone_in_talk", 2]].map(([lbl, ico, idx]) => (
              <ActionBtn key={idx} variant="text" icon={ico} iconSize={13}
                labelColor={idx === activeStackPanel ? C.text : C.muted} labelSize={ncType.label}
                onClick={() => goToPanel(idx)}
                style={{ flex: 1, height: 42, borderBottom: `2px solid ${idx === activeStackPanel ? C.accent : "transparent"}`, transition: "color 0.15s" }}>
                {lbl}
              </ActionBtn>
            ))}
          </div>
        )}

        {/* Three-panel grid — fills all remaining height; CSS scroll-snap carousel when stacked */}

        <div ref={taskGridRef} data-nc-task-grid="true" style={isStacked ? { display: "flex", overflowX: "auto", overflowY: "hidden", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none", flex: "1 1 0", minHeight: 0 } : { display: "grid", gridTemplateColumns: gridColumns, gap: touchLayout ? 16 : 0, flex: touchLayout ? "0 0 auto" : "1 1 0", minHeight: 0, alignItems: "stretch" }}>

          {/* ── Tasks ── */}
          <section style={isStacked ? { ...tintedPanel(C.accent), flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", height: "100%", touchAction: "pan-y" } : (primaryTaskQueue.length > MIN_COLLAPSED_TASKS ? tintedPanel(C.accent) : { ...tintedPanel(C.accent), alignSelf: "start", width: "100%" })}>
            {!isStacked && (
            <div ref={taskHeaderRef} style={{ ...ncHeader, display: taskComposerOpen ? "block" : "flex", ...(taskComposerOpen ? { padding: "7px 12px" } : {}) }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, ...(taskComposerOpen ? { marginBottom: 7 } : {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap:8 }}>
                  <span style={ncSectionIcon()}>{suiteIcon("rule", 16)}</span>
                  <span style={ncTitle}>Tasks</span>
                </div>
                <div style={{ display: "flex", gap:4, alignItems: "center" }}>
                  {ncCorePills.map(p => {
                    const active = taskPriority === p.id;
                    return (
                      <IconBtn key={p.id} icon="check" iconSize={16} color={p.color}
                        active={active && taskComposerOpen && !taskComposerMrsW} activeBg={softBg(p.color, 0.2)}
                        onClick={() => openTaskComposer(p.id)}
                        title={`Add ${p.ncLabel} task`} aria-label={`Add ${p.ncLabel} task`} aria-expanded={taskComposerOpen && active && !taskComposerMrsW}
                        style={{ opacity: (active && taskComposerOpen && !taskComposerMrsW) ? 1 : 0.9 }} />
                    );
                  })}
                  {onAddMrsWTask && (
                    <IconBtn icon="check" iconSize={16} color="#4F9B6B"
                      active={taskComposerOpen && taskComposerMrsW} activeBg={softBg("#4F9B6B", 0.2)}
                      onClick={() => openTaskComposer(taskPriority, { mrsW: true })}
                      title="Add Mrs W task" aria-label="Add Mrs W task" aria-expanded={taskComposerOpen && taskComposerMrsW}
                      style={{ opacity: (taskComposerOpen && taskComposerMrsW) ? 1 : 0.9 }} />
                  )}
                  <span style={{ width: 1, height: 13, background: C.divider, margin: "0 3px", flexShrink: 0 }} />
                  {onOpenZen && <IconBtn icon="local_drink" iconSize={14} color={C.muted} onClick={onOpenZen} title="Zen mode" aria-label="Zen mode" />}
                  <IconBtn icon="list_alt" iconSize={14} color={C.muted} onClick={onOpenQueue} title="Open full task queue" aria-label="Open full task queue" />
                </div>
              </div>
              {taskComposerOpen && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 30px 30px", gap: 6, alignItems: "start" }}>
                  <textarea ref={taskInputRef} value={taskDraft} rows={1}
                    onChange={e => { setTaskDraft(e.target.value); e.target.style.height = "34px"; e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px"; }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addDraft(taskPriority, { mrsW: taskComposerMrsW }); } if (e.key === "Escape") { setTaskComposerOpen(false); setTaskDraft(""); setTaskComposerMrsW(false); } }}
                    placeholder={taskComposerMrsW ? "Mrs W task" : `${priorities.find(p => p.id === taskPriority)?.ncLabel || "Task"} task`}
                    style={{ width: "100%", minWidth: 0, height: 34, maxHeight: 88, boxSizing: "border-box", borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: "7px 10px", fontSize: ncType.meta, fontWeight: 400, fontFamily: NC_FONT_STACK, outline: "none", resize: "none", overflowY: "hidden", lineHeight: ncType.line }} />
                  <IconBtn variant="filled" icon="check" iconSize={15} containerColor={taskComposerMrsW ? "#A8D8B9" : activePriColor} color={taskComposerMrsW ? "#123D25" : textOnColor(activePriColor)} disabled={!taskDraft.trim()} onClick={() => addDraft(taskPriority, { mrsW: taskComposerMrsW })} title="Save task" aria-label="Save task" />
                  <IconBtn icon="close" iconSize={14} color={C.muted} onClick={() => { setTaskComposerOpen(false); setTaskDraft(""); setTaskComposerMrsW(false); }} title="Cancel" aria-label="Cancel task entry" />
                </div>
              )}
            </div>
            )}
            <div style={ncTaskBody}>
              {isStacked && (taskComposerOpen ? (
                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.divider}`, flexShrink: 0 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 32px 32px", gap: 6, alignItems: "start" }}>
                    <textarea ref={stackedTaskInputRef} value={taskDraft} rows={1} autoFocus
                      onChange={e => { setTaskDraft(e.target.value); e.target.style.height = "34px"; e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px"; }}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addDraft(taskPriority, { mrsW: taskComposerMrsW }); } if (e.key === "Escape") { setTaskComposerOpen(false); setTaskDraft(""); setTaskComposerMrsW(false); } }}
                      placeholder={`${priorities.find(p => p.id === taskPriority)?.ncLabel || "Task"} task`}
                      style={{ width: "100%", minWidth: 0, height: 34, maxHeight: 88, boxSizing: "border-box", borderRadius: RADIUS.sm, border: `1px solid ${activePriColor}`, background: C.bgSoft, color: C.text, padding: "7px 10px", fontSize: ncType.body, fontFamily: NC_FONT_STACK, outline: "none", resize: "none", overflowY: "hidden", lineHeight: ncType.line }} />
                    <IconBtn variant="filled" icon="check" iconSize={15} containerColor={activePriColor} color={textOnColor(activePriColor)} disabled={!taskDraft.trim()} onClick={() => addDraft(taskPriority, { mrsW: taskComposerMrsW })} title="Save" aria-label="Save task" />
                    <IconBtn icon="close" iconSize={14} color={C.muted} onClick={() => { setTaskComposerOpen(false); setTaskDraft(""); setTaskComposerMrsW(false); }} title="Cancel" aria-label="Cancel" />
                  </div>
                </div>
              ) : (
                <ActionBtn variant="text" icon="add" iconSize={17} labelColor={C.faint} labelSize={ncType.body}
                  onClick={() => openTaskComposer(taskPriority)}
                  style={{ width: "100%", borderBottom: `1px solid ${C.divider}`, flexShrink: 0, touchAction: "manipulation" }}>
                  New task
                </ActionBtn>
              ))}
              <div ref={taskListRef} style={{ ...ncTaskList, ...denseListVars({ dense, primary: C.text, secondary: C.muted, hover: C.text }) }}>
              {/* Hero task scrolls with the list as its emphasized first row —
                  the pinned bar read as a frozen header (owner ticket tr60ibj2). */}
              {!isStacked && heroTask && (
                <HeroItem C={C} accent={gP(priorities, heroTask.priority)?.color || C.accent}
                  title={nerveDisplaySummary(heroTask, "Untitled task")}
                  meta={gP(priorities, heroTask.priority)?.label || ""}
                  onClick={() => setShowAllTasks(v => !v)} />
              )}
              {primaryTasks.length ? primaryTasks.filter(t => isStacked || t.id !== heroTask?.id).map((t, ti) => {
                const pri = gP(priorities, t.priority);
                const priColor = pri?.color || C.accent || "#7EB0DE";
                const isEditing = editingTaskId === t.id;
                const actionsOpen = openTaskActionsId === t.id;
                const displayText = nerveDisplaySummary(t, "Untitled task");
                // Editing → inline textarea (unchanged behavior). Otherwise a genuine
                // md-list-item; hover Done/Delete stay a light-DOM sibling inside the
                // position:relative .nc-action-row wrapper (avoids shadow-DOM slotting).
                if (isEditing) {
                  return (
                    <div key={t.id} data-nc-task-row="true" style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr)", alignItems: "start", padding: "7px 16px 7px 0", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: RADIUS.pill, background: priColor, flexShrink: 0, marginTop: 7 }} />
                      <textarea value={editText} autoFocus rows={2}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (editText.trim()) onEditTask?.(t.id, editText.trim()); setEditingTaskId(null); } if (e.key === "Escape") setEditingTaskId(null); }}
                        onBlur={() => { if (editText.trim() && editText !== t.text) onEditTask?.(t.id, editText.trim()); setEditingTaskId(null); }}
                        style={{ width: "100%", boxSizing: "border-box", borderRadius: RADIUS.sm, border: `1px solid ${priColor}`, background: C.bgSoft, color: C.text, padding: "6px 8px", fontSize: ncType.body, fontWeight: 400, fontFamily: NC_FONT_STACK, resize: "none", outline: "none", lineHeight: ncType.line }} />
                    </div>
                  );
                }
                return (
                  <div key={t.id} data-nc-task-row="true" className="nc-action-row">
                    <ListItem type="button" title="Click to edit" onClick={() => { setEditingTaskId(t.id); setEditText(t.text); }} style={{ borderRadius: RADIUS.sm }}>
                      <span slot="start" style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: priColor }} />
                      <span slot="headline" style={{ color: C.text, fontWeight: 500, wordBreak: "break-word" }}>{displayText}</span>
                      {touchLayout && (
                        <span slot="end"><IconBtn icon="more_horiz" size={dense?30:36} iconSize={dense?16:18} color={C.muted} title={actionsOpen ? "Hide actions" : "Show actions"} active={actionsOpen} activeBg={C.hover} onClick={e => { e.stopPropagation(); setOpenTaskActionsId(actionsOpen ? null : t.id); }} /></span>
                      )}
                    </ListItem>
                    {!touchLayout && (
                      <div className="nc-hover-actions" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 2, display: "flex", gap: 4, background: C.bg, borderRadius: RADIUS.sm, boxShadow: ELEV[1], padding: 4 }}>
                        <ActionBtn variant="tonal" icon="check" iconSize={17} height={34} labelSize={NC_TYPE.small} containerColor={C.bgSoft} labelColor={C.success} onClick={() => { setOpenTaskActionsId(null); onCompleteTask?.(t.id); }} title="Mark done" aria-label="Mark done">Done</ActionBtn>
                        <ActionBtn variant="tonal" icon="close" iconSize={15} height={34} labelSize={NC_TYPE.small} containerColor={C.bgSoft} labelColor={C.danger} onClick={() => { setOpenTaskActionsId(null); onDeleteTask?.(t.id); }} title="Delete task" aria-label="Delete task">Delete</ActionBtn>
                      </div>
                    )}
                    {touchLayout && actionsOpen && (
                      <div style={{ display: "flex", gap: 4, padding: "0 16px 6px 24px" }}>
                        <ActionBtn variant="tonal" icon="check" iconSize={17} height={34} labelSize={NC_TYPE.small} containerColor={C.bgSoft} labelColor={C.success} onClick={() => { setOpenTaskActionsId(null); onCompleteTask?.(t.id); }} title="Mark done" aria-label="Mark done">Done</ActionBtn>
                        <ActionBtn variant="tonal" icon="close" iconSize={15} height={34} labelSize={NC_TYPE.small} containerColor={C.bgSoft} labelColor={C.danger} onClick={() => { setOpenTaskActionsId(null); onDeleteTask?.(t.id); }} title="Delete task" aria-label="Delete task">Delete</ActionBtn>
                      </div>
                    )}
                  </div>
                );
              }) : <div style={{ padding: "18px 20px", fontSize: ncType.meta, lineHeight: ncType.line, color: C.faint }}>No open tasks.</div>}
              </div>
              {/* Same MoreRow every other card uses (owner ticket WusnfkOE, 7/21: the
                  reveal control was a different shape, size and wording on each card —
                  this one was a 24px 11px-label sliver, below the M3 touch floor). */}
              {!isStacked && (showAllTasks || hiddenTaskCount > 0) && (
                <MoreRow C={C} open={showAllTasks} count={hiddenTaskCount} label="tasks"
                  onClick={() => setShowAllTasks(v => !v)} />
              )}

            </div>
          </section>
          {paneResizeHandle("tasks", "shailos")}

          {/* ── Shailos ── */}
          <section style={isStacked ? { ...tintedPanel(GOLD), flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", height: "100%", touchAction: "pan-y" } : tintedPanel(GOLD)}>
            <div style={{ ...ncHeader, display: isStacked ? "none" : "flex" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={ncSectionIcon(GOLD)}>{suiteIcon("question_mark", 16)}</span>
                <span style={ncTitle}>Shailos</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <ActionBtn variant="filled" icon="add" iconSize={15} containerColor={GOLD} labelColor="#fff" onClick={onOpenShailaAdd}>Add</ActionBtn>
                <ActionBtn variant="text" icon="open_in_full" iconSize={15} labelColor={GOLD} onClick={onOpenShailos}>Open</ActionBtn>
              </div>
            </div>
            <div ref={deskShailosRef} style={{ ...ncScrollPane, ...denseListVars({ dense, primary: C.text, secondary: GOLD, hover: GOLD }), ...({ paddingTop: 6, paddingBottom: 6 }) }}>
              {/* Hero shaila scrolls with the list as its emphasized first row (owner ticket tr60ibj2). */}
              {!isStacked && heroShaila && (
                <HeroItem C={C} accent={GOLD}
                  title={nerveDisplaySummary(heroShaila, "Open shaila")}
                  meta={(heroShaila.status === "get_back" || heroShaila.isGetBackStep) ? "waiting to reply" : "pending answer"}
                  onClick={onOpenShailos} />
              )}
              {/* Active shailos — open + pending get-back. Calm-rows v3: the hero row
                  above carries the top item; the list shows exactly the rows that fit. */}
              {visibleShailos.length ? (fitSlice(visibleShailos.filter(s => s.id !== heroShaila?.id), deskShailosFit, expandedRows.has("desk-shailos")).shown).map((s, idx) => {
                const text = nerveDisplaySummary(s, "Open shaila");
                const isGetBack = s.status === "get_back" || !!s.isGetBackStep;
                const chipLabel = isGetBack ? "Get back" : "Answer";
                const chipBg = isGetBack ? "rgba(201,146,60,0.22)" : "rgba(201,146,60,0.10)";
                return (
                  <ListItem key={s.id} type="button" onClick={onOpenShailos} style={{ borderRadius: RADIUS.sm }}>
                    <span slot="start" style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: GOLD }} />
                    <span slot="headline" style={{ color: C.text, fontWeight: 500, wordBreak: "break-word" }}>{text}</span>
                    {!dense && <span slot="supporting-text" style={{ color: GOLD, display: "inline-flex", alignItems: "center", gap: 4 }}>{suiteIcon(isGetBack ? "schedule" : "search", 12)} {isGetBack ? "waiting to reply" : "pending answer"}</span>}
                    <span slot="trailing-supporting-text" style={{ fontSize: ncType.small, fontWeight: 500, color: GOLD, background: chipBg, border: `1px solid ${GOLD_BRD}`, borderRadius: RADIUS.pill, padding: "2px 7px", whiteSpace: "nowrap" }}>{chipLabel}</span>
                  </ListItem>
                );
              }) : <div style={{ padding: "18px 20px", fontSize: ncType.meta, lineHeight: ncType.line, color: C.faint }}>No pending shailos.</div>}
              {(() => {
                const cut = fitSlice(visibleShailos.filter(s => s.id !== heroShaila?.id), deskShailosFit, expandedRows.has("desk-shailos"));
                const open = expandedRows.has("desk-shailos");
                return (cut.hidden > 0 || open) ? (
                  <MoreRow C={C} open={open} count={cut.hidden} onClick={() => toggleRow("desk-shailos")} />
                ) : null;
              })()}

              {/* The "Recently resolved" block is GONE from this card (owner tickets
                  PWbASPpx / XPrGq77h / EczjwFRB / V37NEU7I, 7/21–7/22). Five struck-through
                  answered shailos were eating ~90% of the card's height and pushing the
                  shailos actually waiting on the owner off screen. Resolved history lives
                  on the Shailos page, which is one tap away via Open. */}
            </div>
          </section>
          {paneResizeHandle("shailos", "phone")}

          {/* ── Phone ── */}
          <section style={isStacked ? { ...tintedPanel(CAT_PHONE), flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", height: "100%", touchAction: "pan-y" } : tintedPanel(CAT_PHONE)}>
            <div style={{ ...ncHeader, display: isStacked ? "none" : "flex" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={ncSectionIcon(CAT_PHONE)}>{suiteIcon("phone_in_talk", 16)}</span>
                <span style={ncTitle}>Phone</span>
                <span title={phoneStatusSummary.label} style={{ display: "inline-flex", alignItems: "center", gap:6, minWidth: 0, color: phoneStatusColor, fontSize: NC_TYPE.meta, fontWeight: 500 }}>
                  <span style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: phoneStatusColor, flexShrink: 0 }} />
                  {(phoneStatusSummary.tone === "incoming" || phoneStatusSummary.tone === "call") && (
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{phoneStatusSummary.label}</span>
                  )}
                  {phoneStatusSummary.voicemailCount > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap:4, color: C.danger }}>{suiteIcon("voicemail", 12)} {phoneStatusSummary.voicemailCount}</span>
                  )}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <ActionBtn variant="text" icon="open_in_full" iconSize={15} onClick={onOpenPhone}>Open</ActionBtn>
              </div>
            </div>
            <div style={{ overflow: "hidden", flex: "1 1 auto", minHeight: 0, padding: dense ? "3px 12px 8px" : "10px 14px 14px", display: "flex", flexDirection: "column" }}>
              <NerveCenterPhoneSurface T={T} user={user} onOnlineChange={onOnlineChange} onStatusSummary={handlePhoneStatusSummary} onActivitySnapshot={handlePhoneActivitySummary} compact dense={dense} onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
            </div>
          </section>
        </div>

        {googleResizeHandle}

        {/* ── Google Calendar + Gmail strip ── resizable height, cards scroll internally */}
        {(() => {
          const accentBlue = C.accent;
          if (isStacked) return null;

          const googleConfigured = !!googleClientId;
          const notConnected = googleConfigured && !googleToken && !googleLoading && calendarEvents === null && gmailMessages === null;
          const fmtTime = (raw) => {
            try {
              const d = new Date(raw); const now = new Date();
              if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            } catch { return ''; }
          };
          const fmtEvtTime = (evt) => {
            if (evt.start?.date) return 'All day';
            const s = new Date(evt.start?.dateTime);
            const e = new Date(evt.end?.dateTime);
            return `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
          };
          const isNow = (evt) => {
            if (!evt.start?.dateTime) return false;
            const now = Date.now();
            return new Date(evt.start.dateTime).getTime() <= now && new Date(evt.end.dateTime).getTime() >= now;
          };

          // Each card: header (fixed) + content (scrollable)
          // isFocus: focus mode softens further for a cleaner at-a-glance read.
          // No outline — visual grouping via one shared neutral surface (GM3: accent
          // stays in the icon puck, never the card background).
          const isFocus = ncViewMode === "focus";
          const tintedCard = (_accent) => (
            // Calm-rows v2: same whisper-tint language as the three main panels.
            { background: `color-mix(in srgb, ${C.bgSoft} 95%, ${_accent || C.accent} 5%)`, borderRadius: isFocus ? RADIUS.xs : RADIUS.md, flex: isStacked ? "1 1 0" : 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }
          );
          const cardWrap = tintedCard(CAT_MAIL); // overridden per-card inline
          // Unified card header — same language as the Tasks/Shailos/Phone panels
          // (ncSectionIcon + ncTitle) with genuine M3 icon-button actions, replacing the
          // old 8px watermark so Calendar/Mail read as the same family as the panels.
          // Hidden in focus mode for a cleaner at-a-glance read.
          const Spinner = ({ size = 15, color }) => (
            <CircularProgress indeterminate aria-label="Loading" style={{ "--md-circular-progress-size": `${size}px`, "--md-circular-progress-active-indicator-color": color || C.muted, width: size, height: size, display: "inline-block", verticalAlign: "middle" }} />
          );
          const CardAction = ({ icon, iconSize = 18, ...rest }) => <IconBtn icon={icon} iconSize={iconSize} color={C.muted} {...rest} />;
          const cardHeader = (icon, title, accent, actions) => isFocus ? null : (
            <div style={{ ...ncHeader, gap: 6 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={ncSectionIcon(accent)}>{suiteIcon(icon, 16)}</span>
                <span style={ncTitle}>{title}</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 }}>{actions}</span>
            </div>
          );
          // List rows handle their own inset (leading-space token); keep body padding tight.
          const cardBody = { flex: "1 1 0", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: isStacked ? "2px 6px 6px" : (isFocus ? "4px 8px 8px" : "2px 6px 8px"), overscrollBehavior: "contain", scrollbarGutter: "stable" };
          const cardListStyle = { ...denseListVars({ dense, primary: C.text, secondary: C.muted, hover: C.text }), padding: 0, background: "transparent" };
          const selectedEmail = selectedEmailId ? (gmailMessages || []).find(msg => msg.id === selectedEmailId) : null;
          const selectedEmailDetail = selectedEmailId ? emailDetails[selectedEmailId] : null;
          const selectedEmailSource = selectedEmailDetail || selectedEmail;
          const selectedEmailBody = selectedEmailDetail?.fullBody || decodeSnippet(selectedEmail?.snippet || "");
          const lowerGridStyle = {
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 172px minmax(0,1fr)",
            gap: 16,
            flex: `0 0 ${googleH}px`,
            minHeight: 0,
          };
          const nowLineColor = C.success || C.accent || "#1A9E78";
          const hasCurrentCalendarEvent = calendarRows.some(row => row.now);
          const calendarNowLine = (key = "now") => (
            <div key={key} ref={calendarNowRef} aria-label="Current time" style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", gap: 8, alignItems: "center", padding: "5px 0", scrollMarginBlock: "50%" }}>
              <span style={{ color: nowLineColor, fontSize: NC_TYPE.small, fontWeight: 700, textAlign: "right", fontFamily: NC_FONT_STACK, whiteSpace: "nowrap" }}>Now</span>
              <span style={{ height: 2, borderRadius: 2, background: nowLineColor, boxShadow: `0 0 0 1px ${softBorder(nowLineColor, 0.18)}` }} />
            </div>
          );

          return (
            <React.Fragment>
            <div style={{ display: "flex", flexDirection: "column", flex: "0 0 auto", gap: 6, minHeight: 0 }}>
              <div style={lowerGridStyle}>

              {!googleConfigured && (
                <ActionBtn variant="outlined" icon="add_link" iconSize={16} outlineColor={C.divider} labelColor={C.muted}
                  labelSize={NC_TYPE.control} onClick={onOpenGoogleSettings}
                  style={{ ...cardWrap, borderStyle: "dashed", '--md-outlined-button-label-text-weight': '500' }}
                  onMouseEnter={e => { e.currentTarget.style.setProperty('--md-outlined-button-outline-color', accentBlue); e.currentTarget.style.setProperty('--md-outlined-button-label-text-color', accentBlue); e.currentTarget.style.setProperty('--md-outlined-button-icon-color', accentBlue); }}
                  onMouseLeave={e => { e.currentTarget.style.setProperty('--md-outlined-button-outline-color', C.divider); e.currentTarget.style.setProperty('--md-outlined-button-label-text-color', C.muted); e.currentTarget.style.setProperty('--md-outlined-button-icon-color', C.muted); }}>
                  Set up Google
                </ActionBtn>
              )}

              {/* Not connected — never been connected: show connect button */}
              {notConnected && !googleError && !googleWasConnected && (
                <OutlinedButton onClick={onConnectGoogle}
                  style={{ flex: 1, '--md-outlined-button-outline-color': C.divider, '--md-outlined-button-outline-width': '1px', '--md-outlined-button-label-text-color': C.muted, '--md-outlined-button-label-text-size': `${NC_TYPE.control}px`, '--md-outlined-button-label-text-weight': '500', borderStyle: 'dashed', transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.setProperty('--md-outlined-button-outline-color', accentBlue); e.currentTarget.style.setProperty('--md-outlined-button-label-text-color', accentBlue); }}
                  onMouseLeave={e => { e.currentTarget.style.setProperty('--md-outlined-button-outline-color', C.divider); e.currentTarget.style.setProperty('--md-outlined-button-label-text-color', C.muted); }}>
                  <svg slot="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <span>Connect Google Calendar &amp; Gmail</span>
                </OutlinedButton>
              )}
              {/* Was connected before — spinner until timeout, then show reconnect button */}
              {notConnected && !googleError && googleWasConnected && !reconnectTimedOut && (
                <div style={{ flex: 1, borderRadius: RADIUS.pill, border: `1px solid ${C.divider}`, background: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: C.faint, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.meta }}>
                  <div style={{ width: 11, height: 11, borderRadius: "50%", border: `2px solid ${C.muted}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                  Reconnecting…
                </div>
              )}
              {notConnected && !googleError && googleWasConnected && reconnectTimedOut && (
                <OutlinedButton onClick={onConnectGoogle}
                  style={{ flex: 1, '--md-outlined-button-outline-color': C.divider, '--md-outlined-button-outline-width': '1px', '--md-outlined-button-label-text-color': C.muted, '--md-outlined-button-label-text-size': `${NC_TYPE.control}px`, '--md-outlined-button-label-text-weight': '500', borderStyle: 'dashed', transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.setProperty('--md-outlined-button-outline-color', accentBlue); e.currentTarget.style.setProperty('--md-outlined-button-label-text-color', accentBlue); }}
                  onMouseLeave={e => { e.currentTarget.style.setProperty('--md-outlined-button-outline-color', C.divider); e.currentTarget.style.setProperty('--md-outlined-button-label-text-color', C.muted); }}>
                  <svg slot="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                  <span>Reconnect Google</span>
                </OutlinedButton>
              )}

              {/* Error banner */}
              {googleError && (
                <div style={{ ...cardWrap, borderColor: C.warning, flexDirection: "row", alignItems: "center", padding: "0 14px", gap: 10 }}>
                  <span style={{ fontSize: NC_TYPE.meta, color: C.warning, fontFamily: NC_FONT_STACK, flex: 1 }}>{googleError}</span>
                  <ActionBtn variant="outlined" outlineColor={accentBlue} labelColor={accentBlue} labelSize={NC_TYPE.meta}
                    onClick={onConnectGoogle} style={{ flexShrink: 0 }}>Retry</ActionBtn>
                  <IconBtn icon="close" iconSize={ICON.sm} color={C.muted} onClick={onDisconnectGoogle} title="Disconnect" aria-label="Disconnect" />
                </div>
              )}

              {/* Loading (before any data) */}
              {googleLoading && !calendarEvents && !gmailMessages && !googleError && (
                <div style={{ ...cardWrap, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <div style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${C.muted}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>Loading…</span>
                </div>
              )}

              {/* ── Calendar card — Google Calendar-style daily timeline ── */}
              {(calendarEvents !== null || (googleLoading && googleToken)) && (() => {
                const acctMenu = googleAcctMenuEl;
                return (
                  <div className="nc-card-group" style={tintedCard(C.warning)}>
                    {cardHeader("calendar_today", "Today", C.warning, <>
                      {googleLoading && <Spinner size={13} color={C.faint} />}
                      {acctMenu}
                      <CardAction icon="add" title="Add event" onClick={() => setShowAddEvent(true)} />
                      <CardAction icon="open_in_new" title="Open Google Calendar" href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer" />
                      <CardAction icon="refresh" title="Refresh" onClick={onRefreshCalendar || onConnectGoogle} />
                      <CardAction icon="link_off" title="Disconnect Google" onClick={onDisconnectGoogle} />
                    </>)}
                    {!calendarEvents ? (
                      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Spinner size={16} />
                        <span style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>Loading calendar…</span>
                      </div>
                    ) : (
                      <>
                        {/* ── Live timeline (2/3) + compact agenda (1/3) — side by side ── */}
                        <div style={{ flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
                        {/* ── Live timeline — Google Calendar day view ── */}
                        <div style={{ flex: "2 1 0", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                          <CalendarTimeline calendarRows={calendarRows} nowDate={nowDate} C={C} scrollRef={calendarNowRef} nowLineRef={calendarNowLineRef} />
                        </div>
                        {/* ── Compact agenda — its own inset tonal panel so it reads as a
                             distinct surface from the live timeline, not a continuation ── */}
                        {(() => {
                          const pastRows     = calendarRows.filter(r => r.past && !r.tomorrow);
                          const upcomingRows = calendarRows.filter(r => !r.past && !r.tomorrow);
                          const tomorrowRows = calendarRows.filter(r => r.tomorrow);
                          const agendaListVars = { ...denseListVars({ dense: true, primary: C.text, secondary: C.muted, hover: C.text }), padding: 0, background: "transparent" };
                          const mkAgendaItem = (row) => {
                            const timeLabel = row.evt?.start?.date ? "All day" : new Date(row.evt?.start?.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                            const barColor = GCAL_COLORS[row.evt?.colorId] || C.warning;
                            const content = (
                              <>
                                {/* v2 uniform leading: same 7px dot metric as every card;
                                    pre-proto keeps the GCal-style vertical bar. */}
                                <span slot="start" style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: barColor, opacity: row.past ? 0.4 : 1 }} />
                                <span slot="headline" style={{ color: row.now ? C.text : row.past ? C.faint : C.muted, fontWeight: row.now ? 600 : 400, opacity: row.past ? 0.65 : 1 }}>{row.evt?.summary || "(no title)"}</span>
                                <span slot="trailing-supporting-text" style={{ color: row.now ? nowLineColor : C.faint, fontWeight: row.now ? 700 : 400, whiteSpace: "nowrap" }}>{row.now ? "Now" : timeLabel}</span>
                              </>
                            );
                            // Calm-rows: routine events (davening etc.) whisper so specials stand out.
                            const rowOpacity = row.past ? 0.7 : (row.routine && !row.now ? 0.55 : 1);
                            return row.evt?.htmlLink
                              ? <ListItem key={row.evt?.id || row.index} type="link" href={row.evt.htmlLink} target="_blank" style={{ borderRadius: RADIUS.xs, opacity: rowOpacity }}>{content}</ListItem>
                              : <ListItem key={row.evt?.id || row.index} type="text" style={{ borderRadius: RADIUS.xs, opacity: rowOpacity }}>{content}</ListItem>;
                          };
                          const NowBar = (
                            <div ref={agendaNowBarRef} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", gap: 8, alignItems: "center", padding: "4px 0", margin: "0 2px" }}>
                              <span style={{ color: nowLineColor, fontSize: NC_TYPE.small, fontWeight: 700, textAlign: "right", fontFamily: NC_FONT_STACK, whiteSpace: "nowrap" }}>Now</span>
                              <span style={{ height: 2, borderRadius: 2, background: nowLineColor, boxShadow: `0 0 0 1px ${softBorder(nowLineColor, 0.18)}` }} />
                            </div>
                          );
                          const TomorrowBar = (
                            <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", gap: 8, alignItems: "center", padding: "4px 0", margin: "0 2px" }}>
                              <span style={{ color: C.muted, fontSize: NC_TYPE.small, fontWeight: 700, textAlign: "right", fontFamily: NC_FONT_STACK, whiteSpace: "nowrap" }}>Tmrw</span>
                              <span style={{ height: 1, borderRadius: 1, background: C.divider }} />
                            </div>
                          );
                          const todayRows = [...pastRows, ...upcomingRows];
                          return (
                            <div style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", margin: "6px 8px 8px 8px", borderRadius: RADIUS.md, background: C.bg, overflow: "hidden" }}>
                              <div style={{ flexShrink: 0, padding: "6px 12px 2px", fontSize: NC_TYPE.small, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.faint, fontFamily: NC_FONT_STACK }}>Agenda</div>
                              <div data-agenda-scroll="true" style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", scrollbarGutter: "stable" }}>
                                {todayRows.length === 0 && tomorrowRows.length === 0 ? (
                                  <div style={{ padding: "8px 12px", fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK, textAlign: "center" }}>No events today</div>
                                ) : (
                                  <>
                                    {/* Calm-rows: the morning's finished events collapse to one line. */}
                                    {pastRows.length > 0 && (!expandedRows.has("desk-cal-past")
                                      ? <MoreRow C={C} count={pastRows.length} label="earlier" onClick={() => toggleRow("desk-cal-past")} />
                                      : <>
                                          {<MoreRow C={C} open label="earlier" count={pastRows.length} onClick={() => toggleRow("desk-cal-past")} />}
                                          <List style={agendaListVars}>{pastRows.map(mkAgendaItem)}</List>
                                        </>)}
                                    {NowBar}
                                    {upcomingRows.length > 0 && <List style={agendaListVars}>{upcomingRows.map(mkAgendaItem)}</List>}
                                    {tomorrowRows.length > 0 && <>{TomorrowBar}<List style={agendaListVars}>{tomorrowRows.map(mkAgendaItem)}</List></>}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                        </div>{/* end row wrapper */}
                      </>
                    )}
                  </div>
                );
              })()}


              {/* ── Clock card — right-click to change style ── */}
              {(() => {
                const ampmMatch = clockParts.timeMain.match(/\s?(AM|PM)$/i);
                const timeDigits = ampmMatch ? clockParts.timeMain.slice(0, -ampmMatch[0].length) : clockParts.timeMain;
                const timePeriod = ampmMatch ? ampmMatch[1] : "";
                const clockFF = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
                const base = { borderRadius: RADIUS.md, minHeight: 0, overflow: "hidden", fontFamily: clockFF, fontVariantNumeric: "tabular-nums", userSelect: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" };
                const openMenu = e => { e.preventDefault(); setClockMenuPos({ x: e.clientX, y: e.clientY }); };
                const hp = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]; };
                const hrA = ((nowDate.getHours() % 12) / 12) * 360 + (nowDate.getMinutes() / 60) * 30;
                const minA = (nowDate.getMinutes() / 60) * 360 + (nowDate.getSeconds() / 60) * 6;
                // 60-second fill bar — replaces numeric seconds in all digital faces
                const secFrac = nowDate.getSeconds() / 60;
                // rAF-driven sweep bar — perfectly smooth at 60fps, no state nudging.
                const secBar = (
                  <div style={{ width: "100%", height: 2, borderRadius: 1, background: "transparent", overflow: "hidden", marginTop: 10 }}>
                    <SweepBar duration={60}
                      getOffset={() => { const n = new Date(); return n.getSeconds() + n.getMilliseconds() / 1000; }}
                      baseOpacity={0.36}
                      style={{ height: "100%", width: "100%", borderRadius: 1, background: C.faint }} />
                  </div>
                );
                // Word clock
                const wNums = ["TWELVE","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN","ELEVEN","TWELVE"];
                const wH = nowDate.getHours() % 12, wM = nowDate.getMinutes();
                const wNext = (wH + 1) % 12;
                let wL1 = "", wL2 = "";
                if (wM < 5)       { wL1 = wNums[wH];           wL2 = "O'CLOCK"; }
                else if (wM < 10) { wL1 = "FIVE PAST";          wL2 = wNums[wH]; }
                else if (wM < 15) { wL1 = "TEN PAST";           wL2 = wNums[wH]; }
                else if (wM < 20) { wL1 = "QUARTER PAST";       wL2 = wNums[wH]; }
                else if (wM < 25) { wL1 = "TWENTY PAST";        wL2 = wNums[wH]; }
                else if (wM < 30) { wL1 = "TWENTY FIVE";        wL2 = `PAST ${wNums[wH]}`; }
                else if (wM < 35) { wL1 = "HALF PAST";          wL2 = wNums[wH]; }
                else if (wM < 40) { wL1 = "TWENTY FIVE";        wL2 = `TO ${wNums[wNext]}`; }
                else if (wM < 45) { wL1 = "TWENTY TO";          wL2 = wNums[wNext]; }
                else if (wM < 50) { wL1 = "QUARTER TO";         wL2 = wNums[wNext]; }
                else if (wM < 55) { wL1 = "TEN TO";             wL2 = wNums[wNext]; }
                else              { wL1 = "FIVE TO";             wL2 = wNums[wNext]; }
                const faces = {
                  digital: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, borderTop: `2px solid ${C.accent}`, background: C.bg, padding: "18px 8px 10px" }}>
                      <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 14 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5, lineHeight: 1 }}>
                        <span style={{ fontSize: 38, fontWeight: 300, color: C.text, letterSpacing: -1 }}>{timeDigits}</span>
                        {timePeriod && <span style={{ fontSize: NC_TYPE.body, fontWeight: 600, color: C.muted, letterSpacing: 0.5 }}>{timePeriod}</span>}
                      </div>
                      {secBar}
                    </div>
                  ),
                  minimal: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "16px 8px 10px" }}>
                      <div style={{ fontSize: 36, fontWeight: 300, lineHeight: 1, color: C.text, letterSpacing: -0.5, textAlign: "center", maxWidth: "100%", fontFamily: NC_MONO_STACK, fontVariantNumeric: "tabular-nums" }}>{clockParts.timeMain}</div>
                      {secBar}
                    </div>
                  ),
                  analog: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "10px 8px 12px", gap: 4 }}>
                      <svg width="120" height="120" viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
                        <circle cx="50" cy="50" r="48" fill="none" stroke={C.divider} strokeWidth="1.5" />
                        {[...Array(12)].map((_, i) => {
                          const [x1, y1] = hp((i / 12) * 360, i % 3 === 0 ? 37 : 41);
                          const [x2, y2] = hp((i / 12) * 360, 46);
                          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 3 === 0 ? C.muted : C.faint} strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round" />;
                        })}
                        <line x1="50" y1="50" x2={hp(hrA, 26)[0]} y2={hp(hrA, 26)[1]} stroke={C.text} strokeWidth="3.5" strokeLinecap="round" />
                        <line x1="50" y1="50" x2={hp(minA, 36)[0]} y2={hp(minA, 36)[1]} stroke={C.text} strokeWidth="2.5" strokeLinecap="round" />
                        <SvgSweepHand x1="50" y1="14" x2="50" y2="58" pivotX={50} pivotY={50} duration={60} stroke={C.faint} strokeWidth={0.8} opacity={0.18} />
                        <circle cx="50" cy="50" r="3" fill={C.accent} />
                      </svg>
                      <div style={{ fontSize: NC_TYPE.title, fontWeight: 300, color: C.text, letterSpacing: -0.5, lineHeight: 1, fontVariantNumeric: "tabular-nums", fontFamily: clockFF }}>
                        {clockParts.timeMain}
                      </div>
                      <div style={{ fontSize: NC_TYPE.small, fontWeight: 600, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginTop: 2 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                    </div>
                  ),
                  tiles: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "16px 8px 10px", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {timeDigits.split("").map((ch, i) => (
                          ch === ":"
                            ? <span key={i} style={{ fontSize: 24, fontWeight: 300, color: C.faint, lineHeight: 1, paddingBottom: 6 }}>:</span>
                            : <span key={i} style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: C.text, background: C.hover, borderRadius: RADIUS.sm, padding: "8px 6px", minWidth: 34, textAlign: "center", display: "inline-flex", justifyContent: "center" }}>{ch}</span>
                        ))}
                        {timePeriod && <span style={{ fontSize: NC_TYPE.meta, fontWeight: 600, color: C.muted, marginLeft: 2, alignSelf: "flex-end", paddingBottom: 8 }}>{timePeriod}</span>}
                      </div>
                      {secBar}
                    </div>
                  ),
                  verbose: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, borderLeft: `3px solid ${C.accent}`, background: C.bg, padding: "14px 10px 10px", alignItems: "flex-start" }}>
                      <div style={{ fontSize: NC_TYPE.meta, fontWeight: 700, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1, marginBottom: 3 }}>
                        {nowDate.toLocaleDateString([], { weekday: "long" })}
                      </div>
                      <div style={{ fontSize: NC_TYPE.small, fontWeight: 400, color: C.faint, fontFamily: NC_FONT_STACK, marginBottom: 10 }}>
                        {nowDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, lineHeight: 1, marginBottom: 4 }}>
                        <span style={{ fontSize: 34, fontWeight: 300, color: C.text, letterSpacing: -0.5 }}>{timeDigits}</span>
                        {timePeriod && <span style={{ fontSize: NC_TYPE.body, fontWeight: 600, color: C.muted }}>{timePeriod}</span>}
                      </div>
                      {secBar}
                    </div>
                  ),
                  word: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "18px 10px 10px", gap: 0 }}>
                      <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 2, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 10 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: 1.5, textTransform: "uppercase", lineHeight: 1.25, textAlign: "center", fontFamily: NC_FONT_STACK }}>{wL1}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: C.accent, letterSpacing: 1.5, textTransform: "uppercase", lineHeight: 1.25, textAlign: "center", fontFamily: NC_FONT_STACK, marginBottom: 2 }}>{wL2}</div>
                      {secBar}
                    </div>
                  ),
                  arc: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "10px 8px 10px" }}>
                      <svg width="120" height="120" viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
                        {(() => {
                          const hrFrac = ((nowDate.getHours() % 12) + nowDate.getMinutes() / 60) / 12;
                          const minFrac = (nowDate.getMinutes() + nowDate.getSeconds() / 60) / 60;
                          const arc = (cx, cy, r, frac) => {
                            if (frac <= 0) return null;
                            if (frac >= 1) return <circle cx={cx} cy={cy} r={r} fill="none" />;
                            const angle = frac * 360 - 90;
                            const rad = angle * Math.PI / 180;
                            const x = cx + r * Math.cos(rad), y = cy + r * Math.sin(rad);
                            return `M ${cx} ${cy - r} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x} ${y}`;
                          };
                          const hrPath = arc(50, 50, 42, hrFrac);
                          const minPath = arc(50, 50, 30, minFrac);
                          return (<>
                            <circle cx="50" cy="50" r="42" fill="none" stroke={C.divider} strokeWidth="7" />
                            <circle cx="50" cy="50" r="30" fill="none" stroke={C.divider} strokeWidth="5" />
                            {hrPath && typeof hrPath === "string" && <path d={hrPath} fill="none" stroke={C.text} strokeWidth="7" strokeLinecap="round" />}
                            {hrFrac >= 1 && <circle cx="50" cy="50" r="42" fill="none" stroke={C.text} strokeWidth="7" />}
                            {minPath && typeof minPath === "string" && <path d={minPath} fill="none" stroke={C.accent} strokeWidth="5" strokeLinecap="round" />}
                            {minFrac >= 1 && <circle cx="50" cy="50" r="30" fill="none" stroke={C.accent} strokeWidth="5" />}
                            <text x="50" y="55" textAnchor="middle" fontSize="13" fontWeight="600" fill={C.text} fontFamily="system-ui,sans-serif">{timeDigits}{timePeriod ? ` ${timePeriod}` : ""}</text>
                          </>);
                        })()}
                      </svg>
                      <div style={{ fontSize: NC_TYPE.small, fontWeight: 600, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginTop: 2 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                    </div>
                  ),
                  neon: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "16px 8px 10px", gap: 4 }}>
                      <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 10 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, lineHeight: 1 }}>
                        <span style={{ fontSize: 40, fontWeight: 700, color: C.accent, letterSpacing: -1, textShadow: `0 0 14px ${C.accent}70, 0 0 30px ${C.accent}38` }}>{timeDigits}</span>
                        {timePeriod && <span style={{ fontSize: NC_TYPE.body, fontWeight: 700, color: C.accent, opacity: 0.72, textShadow: `0 0 10px ${C.accent}55` }}>{timePeriod}</span>}
                      </div>
                      {secBar}
                    </div>
                  ),
                  timeline: <TimelineFace nowDate={nowDate} C={C} base={base} openMenu={openMenu} />,
                };
                const face = faces[clockStyle] || faces.digital;
                const toggleTimeline = () => { const next = !clockTimelineOpen; setClockTimelineOpen(next); try { localStorage.setItem("nc_clock_timeline", next ? "1" : "0"); } catch {} };
                return (
                  <div className="nc-action-row" style={{ position: "relative" }}>
                    {face}
                    {clockTimelineOpen && (
                      <div style={{ padding: "10px 10px 3px", borderTop: `1px solid ${C.divider}` }}>
                        <TimelineFace nowDate={nowDate} C={C} compact />
                      </div>
                    )}
                    <ActionBtn variant="text" labelColor={clockTimelineOpen ? C.muted : C.faint} labelSize={8}
                      onClick={toggleTimeline} style={{ width: "100%", '--md-text-button-label-text-weight': '700' }}>
                      {clockTimelineOpen ? "▲ timeline" : "▼ timeline"}
                    </ActionBtn>
                    <IconBtn className="nc-hover-actions" onClick={e => { e.stopPropagation(); setClockMenuPos({ x: e.clientX, y: e.clientY }); }}
                      title="Change clock style" iconSize={NC_TYPE.body} color={C.faint}
                      style={{ position: "absolute", top: 5, right: 5, borderRadius: RADIUS.xs }}>
                      ···
                    </IconBtn>
                  </div>
                );
              })()}

              {/* ── Gmail card ── */}
              {(gmailMessages !== null || (googleLoading && googleToken)) && (
                <div className="nc-card-group" style={tintedCard(CAT_MAIL)}>
                  {cardHeader("mail", "Mail", CAT_MAIL, <>
                    {googleLoading && <Spinner size={13} color={C.faint} />}
                    {googleAcctMenuEl}
                    <CardAction icon="open_in_new" title="Open Gmail" href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" />
                    <CardAction icon="refresh" title="Refresh mail and calendar" onClick={onRefreshCalendar || onConnectGoogle} />
                  </>)}
                  {/* Hero + its tap-to-read body sit OUTSIDE the scrolling list so the
                      whole-rows measurement below is exact. */}
                  {gmailMessages?.length > 0 && heroMail && (
                    <HeroItem C={C} accent={CAT_MAIL}
                      title={heroMail.aiSummary || decodeSnippet(heroMail.snippet) || gmailHeader(heroMail, 'Subject') || "(no subject)"}
                      meta={[fmtFrom(gmailHeader(heroMail, 'From')), fmtRelShort(gmailHeader(heroMail, 'Date'))].filter(Boolean).join(" · ")}
                      onClick={() => selectedEmailId === heroMail.id ? setSelectedEmailId(null) : handleEmailSelect(heroMail)} />
                  )}
                  <div ref={deskMailRef} style={cardBody}>
                    {!gmailMessages ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap:8 }}>
                        <Spinner size={16} />
                        <span style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>Loading mail…</span>
                      </div>
                    ) : gmailMessages.length === 0 ? (
                      <p style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK, margin: "12px 0", textAlign: "center" }}>Inbox zero 🎉</p>
                    ) : (
                      <>
                      {heroMail && selectedEmailId === heroMail.id && (
                        <div style={{ margin: "0 12px 8px", padding: "8px 10px", borderRadius: RADIUS.sm, background: C.bg, fontSize: NC_TYPE.meta, lineHeight: 1.5, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto", fontFamily: NC_FONT_STACK, flexShrink: 0 }}>
                          {emailDetailLoadingId === heroMail.id ? "Loading…" : (emailDetails[heroMail.id]?.fullBody || decodeSnippet(heroMail.snippet || "") || "No message body available.")}
                        </div>
                      )}
                      <List ref={deskMailListRef} style={cardListStyle}>
                      {(fitSlice(gmailMessages.filter(m => m.id !== heroMail?.id), deskMailFit, expandedRows.has("desk-mail")).shown).map((msg, i) => {
                      const subject = gmailHeader(msg, 'Subject') || '(no subject)';
                      const from = fmtFrom(gmailHeader(msg, 'From'));
                      const date = fmtTime(gmailHeader(msg, 'Date'));
                      const url = gmailDeepLink(msg);
                      const selected = selectedEmailId === msg.id;
                      // Calm-rows: read mail whispers (dim), the newest row is the hero.
                      const rowVars = !mailIsUnread(msg) && !selected ? NC_DIM_ROW : {};
                      return (
                        <React.Fragment key={msg.id || i}>
                        <ListItem type="button" onClick={() => handleEmailSelect(msg)}
                          style={{ borderRadius: RADIUS.sm, ...rowVars }}
                          onMouseEnter={e => {
                            clearTimeout(hoverTimerRef.current);
                            const host = e.currentTarget;
                            hoverTimerRef.current = setTimeout(() => {
                              const rect = host.getBoundingClientRect();
                              setHoverEmail({ id: msg.id, top: rect.bottom + 6, left: rect.left, from: gmailHeader(msg, 'From'), subject, snippet: msg.snippet || '' });
                            }, 400);
                          }}
                          onMouseLeave={() => { clearTimeout(hoverTimerRef.current); setHoverEmail(null); }}
                        >
                          {selected && <div slot="container" style={{ background: C.bgSoft, borderRadius: RADIUS.sm }} />}
                          {/* Uniform leading: same 7px dot metric as every other card's rows. */}
                          {<span slot="start" style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: mailIsUnread(msg) ? CAT_MAIL : "transparent", flexShrink: 0 }} />}
                          <span slot="headline" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text, fontWeight: 600 }}>{from}</span>
                          <span slot="supporting-text" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "normal", wordBreak: "break-word", color: C.muted }}>{msg.aiSummary || decodeSnippet(msg.snippet) || subject}</span>
                          <span slot="trailing-supporting-text" style={{ color: C.faint, whiteSpace: "nowrap" }}>{date}</span>
                        </ListItem>
                        {selected && selectedEmailSource && (
                          <div style={{ margin: "0 2px 8px", padding: "10px 12px 12px", borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, fontFamily: NC_FONT_STACK }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: NC_TYPE.control, fontWeight: 600, color: C.text, lineHeight: 1.3, whiteSpace: "normal", wordBreak: "break-word" }}>{gmailHeader(selectedEmailSource, 'Subject') || '(no subject)'}</div>
                                <div style={{ fontSize: NC_TYPE.meta, color: C.muted, whiteSpace: "normal", wordBreak: "break-word", marginTop: 2 }}>{fmtFrom(gmailHeader(selectedEmailSource, 'From'))}</div>
                              </div>
                              <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                                <CardAction icon="open_in_new" title="Open in Gmail" href={url} target="_blank" rel="noopener noreferrer" />
                                <CardAction icon="close" title="Close message" onClick={() => { setSelectedEmailId(null); setEmailDetailError(""); }} />
                              </span>
                            </div>
                            {emailDetailLoadingId === selectedEmailId ? (
                              <div style={{ display: "flex", alignItems: "center", gap:8, fontSize: NC_TYPE.meta, color: C.muted }}>
                                <Spinner size={13} /> Loading full message…
                              </div>
                            ) : emailDetailError ? (
                              <div style={{ fontSize: NC_TYPE.meta, color: C.danger }}>{emailDetailError}</div>
                            ) : (
                              <div style={{ fontSize: NC_TYPE.meta, lineHeight: 1.55, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isStacked ? 150 : 200, overflowY: "auto", paddingRight: 2 }}>
                                {selectedEmailBody || "No message body available."}
                              </div>
                            )}
                          </div>
                        )}
                        </React.Fragment>
                      );
                    })}
                    </List>
                    {(() => {
                      const cut = fitSlice(gmailMessages.filter(m => m.id !== heroMail?.id), deskMailFit, expandedRows.has("desk-mail"));
                      const open = expandedRows.has("desk-mail");
                      return (cut.hidden > 0 || open) ? (
                        <MoreRow C={C} open={open} count={cut.hidden} onClick={() => toggleRow("desk-mail")} />
                      ) : null;
                    })()}
                    </>
                    )}
                  </div>
                </div>
              )}
              </div>{/* end cards row */}
            </div>

            {/* ── Gmail hover tooltip ── */}
            {hoverEmail && (
              <div style={{ position: "fixed", top: hoverEmail.top, left: hoverEmail.left, zIndex: 9999, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: "10px 14px", maxWidth: 320, boxShadow: ELEV[3], fontFamily: NC_FONT_STACK, pointerEvents: "none" }}>
                <div style={{ fontSize: NC_TYPE.meta, fontWeight: 500, color: C.muted, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtFrom(hoverEmail.from)}</div>
                <div style={{ fontSize: NC_TYPE.control, color: C.text, fontWeight: 500, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hoverEmail.subject}</div>
                {hoverEmail.snippet && <div style={{ fontSize: NC_TYPE.meta, color: C.faint, lineHeight: LINE.body }}>{hoverEmail.snippet}</div>}
              </div>
            )}

            {/* ── Add Event modal ── */}
            {showAddEvent && (
              <div style={{ position: "fixed", inset: 0, zIndex: 9990, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }} onClick={() => { setShowAddEvent(false); setAddEventText(''); setAddEventError(null); }}>
                <div style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: "24px 22px 18px", width: "min(460px,92vw)", boxShadow: ELEV[4], fontFamily: NC_FONT_STACK }} onClick={e => e.stopPropagation()}>
                  <div style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text, marginBottom: 12 }}>Add Event</div>
                  <textarea autoFocus rows={4}
                    placeholder='e.g. "Speech at BYHSI on Thu May 14 at 12:55pm – 2pm, remind me 30 mins and 1 hr before"'
                    value={addEventText}
                    onChange={e => setAddEventText(e.target.value)}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleAddEvent(); } }}
                    style={{ width: "100%", boxSizing: "border-box", borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, fontSize: NC_TYPE.control, padding: "12px 14px", resize: "none", fontFamily: NC_FONT_STACK, outline: "none", lineHeight: NC_TYPE.line }}
                  />
                  {addEventError && <div style={{ fontSize: NC_TYPE.meta, color: C.warning, marginTop: 6 }}>{addEventError}</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                    <ActionBtn variant="text" labelColor={C.muted} onClick={() => { setShowAddEvent(false); setAddEventText(''); setAddEventError(null); }}>Cancel</ActionBtn>
                    <ActionBtn variant="filled" containerColor={accentBlue} labelColor="#fff" disabled={addEventLoading || !addEventText.trim()} onClick={handleAddEvent}>{addEventLoading ? "Adding…" : "Add Event"}</ActionBtn>
                  </div>
                  <div style={{ fontSize: NC_TYPE.small, color: C.faint, marginTop: 8, textAlign: "right" }}>Cmd/Ctrl+Enter to submit</div>
                </div>
              </div>
            )}
            {/* Clock style picker — opened by right-click on the clock card */}
            {clockMenuPos && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 9090 }} onClick={() => setClockMenuPos(null)} />
                <div onMouseDown={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(clockMenuPos.x, window.innerWidth - 212), top: Math.min(clockMenuPos.y, window.innerHeight - 460), zIndex: 9091, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: 6, minWidth: 200, maxHeight: "min(455px, 85vh)", overflowY: "auto", boxShadow: ELEV[3], display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, padding: "6px 8px 4px" }}>Clock Style</div>
                  {[
                    { id: "digital", label: "Digital",  desc: "Date + time + seconds bar"  },
                    { id: "minimal", label: "Minimal",  desc: "Time only, ultra clean"      },
                    { id: "analog",  label: "Analog",   desc: "Classic face + digital below" },
                    { id: "tiles",   label: "Tiles",    desc: "Block digit cards"            },
                    { id: "verbose", label: "Verbose",  desc: "Full date & time"             },
                    { id: "word",    label: "Word",     desc: "Natural language time"        },
                    { id: "arc",     label: "Arc",      desc: "Concentric progress rings"    },
                    { id: "neon",     label: "Neon",     desc: "Glowing accent digits"        },
                    { id: "timeline", label: "Timeline", desc: "Sweeping time-scale bars"      },
                  ].map(opt => {
                    const active = clockStyle === opt.id;
                    return (
                      <ListItem key={opt.id} type="button" onClick={() => { setClockStyle(opt.id); try { localStorage.setItem("nc_clock_style", opt.id); } catch {} setClockMenuPos(null); }}
                        style={{
                          width: "100%", borderRadius: RADIUS.sm, background: active ? C.hover : "transparent",
                          ...denseListVars({ dense: true }),
                        }}>
                        <div slot="headline" style={{ fontSize: NC_TYPE.control, fontWeight: active ? 600 : 400, color: active ? C.text : C.muted, fontFamily: NC_FONT_STACK }}>{opt.label}</div>
                        <div slot="supporting-text" style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK }}>{opt.desc}</div>
                      </ListItem>
                    );
                  })}
                </div>
              </>
            )}
            </React.Fragment>
          );
        })()}

        {/* Health card removed from the default dashboard — health stays reachable via the
            Health page (actions menu / onOpenHealth). */}

      </div>
    </div>
  );
}

export { nerveSummarySource, compactNerveSummary, nerveDisplaySummary, NerveCenter };
