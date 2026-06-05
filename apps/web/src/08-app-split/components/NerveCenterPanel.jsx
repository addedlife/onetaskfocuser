import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiParseCalendarEvent, BEFORE_SHAVUOS_PRIORITY_ID, gP, runAIJob, textOnColor } from '../../01-core.js';
import { cleanTheme, cleanToolbarButton, gvIconButton, gvTextButton, NC_FONT_STACK, NC_TYPE, suiteIcon, useViewportWidth } from '../ui-tokens.jsx';
import { NerveCenterPhoneSurface, isMobilePhoneDevice } from './NerveCenterPhoneSurface.jsx';
import { isNerveTaskShailaWork } from '../utils/shailosQueue.js';
import { HealthCard } from './HealthCard.jsx';
import { HealthPage } from './HealthPage.jsx';

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
      <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, letterSpacing: 0.3, fontFamily: NC_FONT_STACK, width: 38, textAlign: "right", flexShrink: 0, textTransform: "uppercase", lineHeight: 1 }}>{lbl}</span>
      <div style={{ flex: 1, height: 2, borderRadius: 1, background: C.hover, overflow: "hidden", position: "relative", minWidth: 0 }}>
        {dur ? (
          <SweepBar duration={dur} baseOpacity={op} getOffset={tlSweepOff}
            style={{ position: "absolute", inset: 0, borderRadius: 1, background: col }} />
        ) : (
          <div style={{ height: "100%", width: `${frac * 100}%`, borderRadius: 1, background: col, opacity: op, transition: "width 3s ease" }} />
        )}
      </div>
      <span style={{ fontSize: 9, color: C.faint, fontFamily: NC_FONT_STACK, width: vw, flexShrink: 0, textAlign: "right", letterSpacing: 0.2, lineHeight: 1 }}>{val}</span>
    </div>
  ));
  if (compact) return <>{bars}</>;
  return (
    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "16px 10px 14px", alignItems: "stretch", gap: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 14, textAlign: "center" }}>
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

const CHIEF_TIME_BUCKET_MS = 15 * 60 * 1000;
const CHIEF_LEARNING_KEY = "ot_chief_learning_v1";
const CHIEF_CHAT_HEIGHT_KEY = "ot_chief_chat_height_v1";
const CHIEF_SCAN_CACHE_KEY = "ot_chief_scan_cache_v1";
const CHIEF_SCAN_LAST_RUN_KEY = "ot_chief_scan_last_ai_run_v1";
const CHIEF_SUGGESTIONS_CACHE_KEY = "ot_chief_task_suggestions_cache_v1";
const CHIEF_SUGGESTIONS_LAST_RUN_KEY = "ot_chief_task_suggestions_last_ai_run_v1";
const CHIEF_SCAN_CACHE_MS = 30 * 60 * 1000;
const CHIEF_SCAN_MIN_AI_GAP_MS = 20 * 60 * 1000;
const CHIEF_SUGGESTIONS_CACHE_MS = 45 * 60 * 1000;
const CHIEF_SUGGESTIONS_MIN_AI_GAP_MS = 25 * 60 * 1000;
const ROUTINE_CALENDAR_RE = /\b(shacharis|shacharit|mincha|maariv|arvit|daven(?:ing)?|daf yomi|mishna(?:h)? yomi|halacha yomi|parsha|selichos|slichos)\b/i;
const CHIEF_SEARCHING_BRIEF = { summary: "Scanning NerveCenter for the next move...", nextAction: "Hold on — looking for the next best action.", why: "", urgency: "watch", sources: [], focusArea: "operations", _isPlaceholder: true };
const CHIEF_QUIET_BRIEF = { summary: "You handled the top item.", nextAction: "Nothing more pressing right now — check back when context changes.", why: "The remaining signals don’t require immediate action.", urgency: "watch", sources: [], focusArea: "operations", _isPlaceholder: true };

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

function buildChiefFallbackBrief(context = {}, suppressed = []) {
  const notSuppressed = (text) => {
    if (!suppressed.length || !text) return true;
    return !suppressed.some(s => tokenOverlapRatio(String(text), String(s.text || "")) >= 0.35);
  };
  const currentEvent = (context.calendar || []).find(evt => evt.now && notSuppressed(evt.summary));
  const specialEvent = (context.calendar || []).find(evt => evt.special && !evt.past && notSuppressed(evt.summary));
  const nowTask = (context.tasks || []).find(task => /now/i.test(task.priority) && notSuppressed(task.text))
    || (context.tasks || []).find(task => notSuppressed(task.text));
  const shaila = (context.shailos || []).find(s => notSuppressed(s.text));
  const email = (context.emails || []).find(e => notSuppressed(e.subject || e.summary));
  const phone = context.phone || {};
  const phoneNeeds = (phone.unreadTexts || 0) + (phone.missedCalls || 0) + (phone.voicemailCount || 0);
  const nowCount = (context.tasks || []).filter(t => /now/i.test(t.priority)).length;

  // Build per-area signals (factual status lines)
  const signals = [];
  if (currentEvent) signals.push({ area: "Calendar", note: `In progress: ${currentEvent.summary}` });
  else if (specialEvent) signals.push({ area: "Calendar", note: `Up next: ${specialEvent.summary}${specialEvent.label ? ` — ${specialEvent.label}` : ""}` });
  if (phoneNeeds > 0) {
    const phoneParts = [
      phone.missedCalls > 0 ? `${phone.missedCalls} missed call${phone.missedCalls > 1 ? "s" : ""}` : "",
      phone.unreadTexts > 0 ? `${phone.unreadTexts} unread text${phone.unreadTexts > 1 ? "s" : ""}` : "",
      phone.voicemailCount > 0 ? `${phone.voicemailCount} voicemail${phone.voicemailCount > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    signals.push({ area: "Phone", note: phoneParts.join(", ") });
  }
  if ((context.shailos || []).length > 0) signals.push({ area: "Shailos", note: `${context.shailos.length} open — ${shaila?.text || context.shailos[0]?.text || "pending"}` });
  if (email) signals.push({ area: "Mail", note: `${email.from ? `From ${email.from}: ` : ""}${email.summary || email.subject}` });
  if ((context.tasks || []).length > 0) signals.push({ area: "Tasks", note: `${nowCount > 0 ? `${nowCount} Now` : `${context.tasks.length} total`}${nowTask ? ` — top: ${nowTask.text}` : ""}` });

  // Build natural language brief covering all sources
  const briefParts = [];
  if (currentEvent) briefParts.push(`You are currently in ${currentEvent.summary}.`);
  if (specialEvent && !currentEvent) briefParts.push(`${specialEvent.summary} is the next calendar commitment.`);
  if (phoneNeeds > 0) {
    const phoneParts = [
      phone.missedCalls > 0 ? `${phone.missedCalls} missed call${phone.missedCalls > 1 ? "s" : ""}` : "",
      phone.unreadTexts > 0 ? `${phone.unreadTexts} unread text${phone.unreadTexts > 1 ? "s" : ""}` : "",
      phone.voicemailCount > 0 ? `${phone.voicemailCount} voicemail${phone.voicemailCount > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    briefParts.push(`Phone has ${phoneParts.join(", ")} waiting.`);
  }
  if ((context.shailos || []).length > 0) briefParts.push(`${context.shailos.length} open shaila${context.shailos.length > 1 ? "s" : ""} in the queue.`);
  if (email) briefParts.push(`${email.from ? `${email.from} sent` : "Mail has"} a message worth reviewing.`);
  if (nowCount > 0) briefParts.push(`Task queue has ${nowCount} Now item${nowCount > 1 ? "s" : ""}.`);
  const brief = briefParts.length > 0 ? briefParts.join(" ") : "No urgent signals visible in the current snapshot.";

  if (currentEvent) {
    return {
      brief, signals,
      summary: `Right now is blocked by ${currentEvent.summary}.`,
      nextAction: nowTask ? `Keep ${nowTask.text} queued for the next open slot.` : "Protect the current calendar block and avoid adding a new commitment.",
      why: currentEvent.label || "Calendar is the active constraint.",
      focusArea: "calendar", urgency: "now", sources: ["Calendar", "Tasks"],
    };
  }
  if (specialEvent) {
    return {
      brief, signals,
      summary: `${specialEvent.summary} is the next non-routine calendar item on the board.`,
      nextAction: `Prep for ${specialEvent.summary} before clearing routine work.`,
      why: specialEvent.label || "Special calendar item is the clearest upcoming constraint.",
      focusArea: "calendar", urgency: "today", sources: ["Calendar"],
    };
  }
  if (phoneNeeds > 0) {
    return {
      brief, signals,
      summary: `Phone activity needs review: ${phoneNeeds} recent call/text/voicemail signal${phoneNeeds === 1 ? "" : "s"}.`,
      nextAction: "Open the Phone pane and clear the newest missed or unread item.",
      why: "Recent communications can hide time-sensitive follow-up.",
      focusArea: "phone", urgency: "today", sources: ["Phone"],
    };
  }
  if (shaila) {
    return {
      brief, signals,
      summary: `Your Shailos lane has ${context.shailos.length} open item${context.shailos.length === 1 ? "" : "s"}.`,
      nextAction: `Move the next shaila forward: ${shaila.text}.`,
      why: shaila.status || "Open shaila work is still pending.",
      focusArea: "shailos", urgency: "today", sources: ["Shailos"],
    };
  }
  if (email) {
    return {
      brief, signals,
      summary: `Mail has a live item from ${email.from || "your inbox"}.`,
      nextAction: `Review "${email.summary || email.subject}" and decide whether it needs a reply.`,
      why: "Inbox scan found the clearest current communication.",
      focusArea: "mail", urgency: "watch", sources: ["Mail"],
    };
  }
  return {
    brief, signals,
    summary: nowTask ? "The cleanest next move is already in the task queue." : "No urgent signal is visible in the current dashboard snapshot.",
    nextAction: nowTask ? nowTask.text : "Add or choose one concrete next task.",
    why: nowTask ? `Priority: ${nowTask.priority || "active"}.` : "The dashboard has no current calendar, mail, phone, or shaila pressure.",
    focusArea: "tasks", urgency: nowTask ? "today" : "watch", sources: ["Tasks"],
  };
}

// Mobile "nerve center" accordion section. Hoisted to module scope (NOT defined inside
// NerveCenterPanel) so its component identity stays stable across renders — otherwise the
// per-second clock re-render recreated the function, remounting every section and dropping
// in-flight taps/keystrokes. `expandable` sections collapse to a one-line preview; tapping
// the header opens one at a time. `keepMounted` hides via display:none so embedded pollers
// (Phone) keep running while collapsed. State arrives via props (expandedId/menuId + the
// on* callbacks) so React re-renders instead of remounting.
function MobileSection({ id, icon, title, accentColor, count, primaryBtn, menuItems, preview, expandable = true, keepMounted = false, children, C, expandedId, menuId, onExpand, onMenuToggle, onMenuClose }) {
  const expanded = !expandable || expandedId === id;
  const menuOpen = menuId === id;
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, overflow: "visible" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px 7px 12px", minHeight: 34 }}>
        <button
          onClick={expandable ? () => onExpand(id) : undefined}
          style={{ all: "unset", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, cursor: expandable ? "pointer" : "default" }}
          aria-expanded={expandable ? expanded : undefined}
        >
          <span style={{ color: accentColor || C.muted, display: "flex", flexShrink: 0 }}>{suiteIcon(icon, 13)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: NC_FONT_STACK, flexShrink: 0, letterSpacing: 0.1 }}>{title}</span>
          {count > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, fontFamily: NC_FONT_STACK, background: C.hover, borderRadius: 99, padding: "1px 5px", flexShrink: 0 }}>{count}</span>}
          {expandable && !expanded && preview != null && (
            <span style={{ fontSize: 11, color: C.faint, fontFamily: NC_FONT_STACK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>{preview}</span>
          )}
          {expandable && (
            <span style={{ marginLeft: "auto", color: C.faint, display: "flex", flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>{suiteIcon("expand_more", 16)}</span>
          )}
        </button>
        {primaryBtn}
        {menuItems?.length > 0 && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button onClick={e => { e.stopPropagation(); onMenuToggle(id); }} style={gvIconButton({ width: 26, height: 26, color: C.faint }, C)} aria-label={`${title} menu`}>
              {suiteIcon("more_vert", 13)}
            </button>
            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 9100 }} onClick={onMenuClose} />
                <div style={{ position: "absolute", right: 0, top: 28, zIndex: 9101, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, minWidth: 168, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", overflow: "hidden" }}>
                  {menuItems.map((item, i) => (
                    <button key={i} onClick={() => { onMenuClose(); item.run?.(); }}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", border: "none", borderBottom: i < menuItems.length - 1 ? `1px solid ${C.divider}` : "none", background: "transparent", color: C.text, cursor: "pointer", fontSize: 13, fontFamily: NC_FONT_STACK, textAlign: "left" }}>
                      {suiteIcon(item.icon || "arrow_forward", 14)} {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {keepMounted ? <div style={{ display: expanded ? "block" : "none" }}>{children}</div> : (expanded && children)}
    </div>
  );
}

// Mobile phone/tablet "box": an always-open card with a sticky header and an
// internally scrolling body. Used by the 5-box grid so each section (Mail · Phone ·
// Tasks · Shailos · Calendar) gets an equal slice of the screen and scrolls on its own
// instead of overrunning. Hoisted to module scope for stable identity (see MobileSection).
function MobileBox({ icon, title, accentColor, count, primaryBtn, menuItems, children, C, menuId, menuKey, onMenuToggle, onMenuClose, style }) {
  const menuOpen = menuId === menuKey;
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 6px 6px 10px", minHeight: 30, flexShrink: 0, borderBottom: `1px solid ${C.divider}` }}>
        <span style={{ color: accentColor || C.muted, display: "flex", flexShrink: 0 }}>{suiteIcon(icon, 13)}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: NC_FONT_STACK, flexShrink: 0, letterSpacing: 0.1 }}>{title}</span>
        {count > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, fontFamily: NC_FONT_STACK, background: C.hover, borderRadius: 99, padding: "1px 5px", flexShrink: 0 }}>{count}</span>}
        <span style={{ flex: 1 }} />
        {primaryBtn}
        {menuItems?.length > 0 && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button onClick={e => { e.stopPropagation(); onMenuToggle(menuKey); }} style={gvIconButton({ width: 26, height: 26, color: C.faint }, C)} aria-label={`${title} menu`}>
              {suiteIcon("more_vert", 13)}
            </button>
            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 9100 }} onClick={onMenuClose} />
                <div style={{ position: "absolute", right: 0, top: 28, zIndex: 9101, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, minWidth: 168, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", overflow: "hidden" }}>
                  {menuItems.map((item, i) => (
                    <button key={i} onClick={() => { onMenuClose(); item.run?.(); }}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", border: "none", borderBottom: i < menuItems.length - 1 ? `1px solid ${C.divider}` : "none", background: "transparent", color: C.text, cursor: "pointer", fontSize: 13, fontFamily: NC_FONT_STACK, textAlign: "left" }}>
                      {suiteIcon(item.icon || "arrow_forward", 14)} {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        {children}
      </div>
    </div>
  );
}

function NerveCenterPanel({ T, user = null, sections = [], tasks = [], shailos = [], shailosCompleted = [], priorities = [], aiOpts = null, onAddTask, onAddMrsWTask, onOpenQueue, onOpenShailos, onOpenShailaAdd, onOpenPhone, onOnlineChange, onRecordConversation, onRecordCall, onCompleteTask, onDeleteTask, onEditTask, onOpenZen, onOpenGoogleSettings, sidebarW = 0, topOffset = 0, actionsOpen = false, setActionsOpen, actionCategoryId = "tasks", setActionCategoryId, calendarEvents = null, gmailMessages = null, googleLoading = false, googleError = null, googleToken = null, googleClientId = null, onConnectGoogle, onDisconnectGoogle, onLoadEmailDetail, onCreateCalendarEvent, onDeleteCalendarEvent, chiefProfile = null, chiefProfileLoading = false, onAppendChiefProfileNote, onRecordChiefLearning, onSaveChiefProfileMarkdown, googleWasConnected = false, onRefreshCalendar, paneWeights = { tasks: 1, shailos: 1, phone: 1 }, onPaneWeightsChange, onOpenChiefPage, googlePaneHeight = 244, onGooglePaneHeightChange, onPolishNerveItems, clockTime = null, chiefPage = false, onCloseChiefPage, healthPage = false, onOpenHealth, onCloseHealthPage, healthData = null, healthConfig = null, healthHistory = null, onSaveHealthData, onSyncHealth }) {
  const viewportW = useViewportWidth();
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
  const [ncViewMode, setNcViewMode] = useState(() => { try { return localStorage.getItem("nc_view_mode") || "full"; } catch { return "full"; } });
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
  const calendarNowRef = useRef(null);
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
  const [mobileExpanded, setMobileExpanded] = useState(null); // id of the single expanded accordion section (Tasks is always open)
  const [mobileTimelineOpen, setMobileTimelineOpen] = useState(false); // mobile hero timeline reveal
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
        ? await onLoadEmailDetail(msg.id)
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

  const GOLD = "#C9923C";
  const GOLD_BG = "rgba(201,146,60,0.055)";
  const GOLD_BRD = "rgba(201,146,60,0.16)";
  const C = cleanTheme(T);
  const ncType = NC_TYPE;
  const availableW = Math.max(0, viewportW - sidebarW);
  // A real phone/tablet (not just a narrow desktop window) — gets the 5-box grid.
  const isMobileDevice = useMemo(() => isMobilePhoneDevice(), []);
  const isStacked = availableW < 760;
  const isTablet = !isStacked && availableW < 1120;
  const touchLayout = isStacked || isTablet;
  const paneW = {
    tasks: Math.max(0.55, Number(paneWeights?.tasks || 1)),
    shailos: Math.max(0.55, Number(paneWeights?.shailos || 1)),
    phone: Math.max(0.55, Number(paneWeights?.phone || 1)),
  };
  const gridColumns = isStacked ? "1fr" : isTablet ? "repeat(2,minmax(0,1fr))" : `minmax(240px,${paneW.tasks}fr) 6px minmax(240px,${paneW.shailos}fr) 6px minmax(240px,${paneW.phone}fr)`;
  const googleH = Math.max(150, Math.min(420, Number(googlePaneHeight || 244)));
  const ncPanel = { background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, display: "flex", flexDirection: "column", minHeight: isTablet && !isStacked ? 420 : 0, overflow: "hidden", boxShadow: "none" };
  const ncScrollPane = { overflow: "auto", flex: "1 1 auto", minHeight: 0, overscrollBehavior: "contain", scrollbarGutter: "stable", ...(isStacked ? { touchAction: "pan-y" } : {}) };
  const ncTaskBody = { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", overscrollBehavior: "contain" };
  const ncTaskList = (isStacked || showAllTasks) ? ncScrollPane : { ...ncScrollPane, flex: "0 0 auto", overflow: "visible", maxHeight: "none" };
  const ncTasksPanel = showAllTasks ? ncPanel : { ...ncPanel, alignSelf: "start", width: "100%" };
  const ncHeader = { minHeight: 36, padding: "4px 12px", borderBottom: `1px solid ${C.divider}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
  const ncTitle = { fontSize: ncType.title, fontWeight: "var(--nc-font-weight-strong, 500)", color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.35 };
  const ncSectionIcon = (accent = C.accent) => ({ width: 26, height: 26, borderRadius:12, background: "transparent", color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
  const ncSmallIconButton = (active = false, accent = C.muted) => gvIconButton({ width: 26, height: 26, background: active ? C.hover : "transparent", color: active ? accent : C.muted }, C);
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
        const moreH = primaryTaskQueue.length > MIN_COLLAPSED_TASKS ? (taskMoreButtonRef.current?.getBoundingClientRect().height || 24) : 0;
        const rows = Array.from(taskListRef.current?.querySelectorAll("[data-nc-task-row='true']") || []);
        const measuredRows = rows.map(row => row.getBoundingClientRect().height).filter(h => h > 0);
        const avgRowH = Math.max(56, measuredRows.length ? measuredRows.reduce((sum, h) => sum + h, 0) / measuredRows.length : 56);
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
    [taskGridRef.current, taskHeaderRef.current, taskListRef.current, taskMoreButtonRef.current].filter(Boolean).forEach(el => observer.observe(el));
    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [primaryTaskQueue.length, showAllTasks, taskComposerOpen, touchLayout]);
  const collapsedTaskLimit = Math.min(primaryTaskQueue.length, Math.max(MIN_COLLAPSED_TASKS, autoTaskLimit));
  const hiddenTaskCount = Math.max(0, primaryTaskQueue.length - collapsedTaskLimit);
  const primaryTasks = (isStacked || showAllTasks) ? primaryTaskQueue : primaryTaskQueue.slice(0, collapsedTaskLimit);
  const visibleShailos = shailos.filter(Boolean);
  const timeBucket = Math.floor(nowMs / CHIEF_TIME_BUCKET_MS);
  const calendarRows = useMemo(() => (calendarEvents || []).map((evt, index) => {
    const routine = isRoutineCalendarEvent(evt);
    const now = isCalendarEventCurrent(evt, nowMs);
    const past = isCalendarEventPast(evt, nowMs);
    const special = !routine && !past;
    return {
      evt,
      index,
      routine,
      now,
      past,
      special,
      startMs: calendarStartMs(evt),
      label: formatCalendarWindow(evt),
    };
  }), [calendarEvents, nowMs]);
  const specialCalendarRows = calendarRows
    .filter(row => row.special)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 2);
  const calendarNowInsertIndex = useMemo(() => {
    if (!calendarRows.length) return 0;
    const nextIndex = calendarRows.findIndex(row => !row.past && row.startMs > nowMs);
    return nextIndex === -1 ? calendarRows.length : nextIndex;
  }, [calendarRows, nowMs]);
  const calendarMinuteKey = Math.floor(nowMs / 60000);
  useEffect(() => {
    if (!calendarNowRef.current || calendarEvents === null) return undefined;
    const frame = window.requestAnimationFrame(() => {
      calendarNowRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendarMinuteKey, calendarEvents, calendarRows.length]);
  const chiefProfileNotes = useMemo(() => profileNotesForPrompt(chiefProfile), [chiefProfile?.updatedAt]);
  const chiefContext = useMemo(() => {
    const bucketDate = new Date(timeBucket * CHIEF_TIME_BUCKET_MS);
    const priById = new Map((priorities || []).map(p => [p.id, p.label || p.id]));
    const header = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || "";
    return {
      currentTime: bucketDate.toISOString(),
      localeTime: bucketDate.toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      tasks: primaryTaskQueue.slice(0, 18).map(task => ({
        text: nerveDisplaySummary(task, task.text || "Task"),
        priority: priById.get(task.priority) || task.priority || "",
        ageHours: task.createdAt ? Math.max(0, Math.round((nowMs - Number(task.createdAt || 0)) / 3600000)) : null,
      })),
      shailos: visibleShailos.slice(0, 12).map(item => ({
        text: nerveDisplaySummary(item, item.text || "Shaila"),
        status: item.status === "get_back" || item.isGetBackStep ? "waiting to reply" : "pending answer",
      })),
      calendar: calendarRows.slice(0, 24).map(row => ({
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
  }, [timeBucket, priorities, primaryTaskQueue, visibleShailos, calendarRows, gmailMessages, phoneActivitySummary, nowMs, chiefProfileNotes]);
  const chiefLearningProfile = useMemo(() => buildChiefLearningProfile(chiefLearning), [chiefLearning]);
  const chiefScanContext = useMemo(() => ({
    ...chiefContext,
    learning: chiefLearningProfile,
    sessionSuppressed: sessionSuppressed.slice(-8).map(s => s.text),
  }), [chiefContext, chiefLearningProfile, sessionSuppressed]);
  const chiefScanKey = useMemo(() => JSON.stringify(chiefScanContext), [chiefScanContext]);
  const chiefFallback = useMemo(() => buildChiefFallbackBrief(chiefContext, sessionSuppressed), [chiefContext, sessionSuppressed]);
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

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    if (!chiefPage) {
      setChiefLoading(false);
      setChiefError("");
      return undefined;
    }
    const force = chiefRefreshNonce !== chiefRefreshHandledRef.current;
    chiefRefreshHandledRef.current = chiefRefreshNonce;
    setChiefBrief(prev => prev || chiefFallback);
    setChiefError("");
    if (!aiOpts) {
      setChiefBrief(chiefFallback);
      setChiefLoading(false);
      return undefined;
    }
    const cached = readStorageJson(CHIEF_SCAN_CACHE_KEY);
    if (!force && cached?.scanKey === chiefScanKey && cached?.brief && now - Number(cached.ts || 0) < CHIEF_SCAN_CACHE_MS) {
      setChiefBrief(cached.brief);
      setChiefLoading(false);
      return undefined;
    }
    if (!force && now - readStorageNumber(CHIEF_SCAN_LAST_RUN_KEY) < CHIEF_SCAN_MIN_AI_GAP_MS) {
      setChiefBrief(cached?.brief || chiefFallback);
      setChiefError(cached?.brief ? "Using cached scan." : "Using local scan.");
      setChiefLoading(false);
      return undefined;
    }
      setChiefLoading(true);
    const delay = force ? 50 : 900;
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
              setChiefBrief(CHIEF_QUIET_BRIEF);
              setChiefError("");
            } else {
              setChiefBrief(output);
              writeStorageJson(CHIEF_SCAN_CACHE_KEY, { scanKey: chiefScanKey, ts: Date.now(), brief: output });
            }
          } else {
            setChiefBrief(chiefFallback);
            setChiefError("Using local scan.");
          }
        })
        .catch(() => {
          if (cancelled) return;
          setChiefBrief(chiefFallback);
          setChiefError("Using local scan.");
        })
        .finally(() => {
          if (!cancelled) setChiefLoading(false);
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chiefPage, chiefScanKey, chiefRefreshNonce]); // eslint-disable-line

  useEffect(() => {
    if (!chiefPage || !aiOpts || (!calendarRows.length && !(gmailMessages || []).length) || !taskSuggestionPriorities.length) {
      setTaskSuggestions([]);
      setTaskSuggestionsLoading(false);
      return undefined;
    }
    let cancelled = false;
    const now = Date.now();
    const cached = readStorageJson(CHIEF_SUGGESTIONS_CACHE_KEY);
    if (cached?.scanKey === taskSuggestionScanKey && Array.isArray(cached.rows) && now - Number(cached.ts || 0) < CHIEF_SUGGESTIONS_CACHE_MS) {
      setTaskSuggestions(cached.rows);
      setTaskSuggestionsLoading(false);
      return undefined;
    }
    if (now - readStorageNumber(CHIEF_SUGGESTIONS_LAST_RUN_KEY) < CHIEF_SUGGESTIONS_MIN_AI_GAP_MS) {
      setTaskSuggestions(Array.isArray(cached?.rows) ? cached.rows : []);
      setTaskSuggestionsLoading(false);
      return undefined;
    }
    setTaskSuggestionsLoading(true);
    const existingKeys = new Set(
      primaryTaskQueue
        .map(task => taskSuggestionKey(`${task.text || ""} ${nerveDisplaySummary(task, "")}`))
        .filter(Boolean)
    );
    const validPriorityIds = new Set(taskSuggestionPriorities.map(p => p.id));
    const timer = window.setTimeout(() => {
      writeStorageNumber(CHIEF_SUGGESTIONS_LAST_RUN_KEY, Date.now());
      runAIJob("dashboard.task_suggestions.v1", {
        context: chiefContext,
        priorityOptions: taskSuggestionPriorities.map((p, index) => ({ id: p.id, label: p.label || p.id, rank: index + 1 })),
        existingTasks: primaryTaskQueue.slice(0, 80).map(task => ({ text: nerveDisplaySummary(task, task.text || "") })),
        learningProfile: chiefLearningProfile,
      }, aiOpts, { genConfig: { temperature: 0.1, maxOutputTokens: 900 } })
        .then(job => {
          if (cancelled) return;
          const seen = new Set();
          const rows = (job?.output?.suggestions || [])
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
              seen.add(item.key);
              seen.add(item.suppressionKey);
              seen.add(item.textKey);
              return true;
            })
            .slice(0, 3);
          setTaskSuggestions(rows);
          writeStorageJson(CHIEF_SUGGESTIONS_CACHE_KEY, { scanKey: taskSuggestionScanKey, ts: Date.now(), rows });
        })
        .catch(() => {
          if (!cancelled) setTaskSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setTaskSuggestionsLoading(false);
        });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chiefPage, taskSuggestionScanKey]); // eslint-disable-line

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
      const rejectedBrief = chiefBrief || chiefFallback;
      recordChiefSmartLearning(/(?:next|skip)/i.test(question) ? "next" : "not_now", rejectedBrief);
      const suppressText = cleanOneLine(rejectedBrief.nextAction || "", 260);
      if (suppressText) setSessionSuppressed(prev => [...prev, { text: suppressText, sources: (chiefBrief || chiefFallback).sources || [], focusArea: (chiefBrief || chiefFallback).focusArea || "" }].slice(-10));
      setChiefBrief(CHIEF_SEARCHING_BRIEF);
      setChiefError("");
      setChiefDialogue([...nextHistory, { role: "assistant", text: `Got it. I am dropping "${cleanOneLine(rejectedBrief.nextAction, 140)}" and rescanning for a better next move.` }].slice(-6));
      setChiefRefreshNonce(n => n + 1);
      return;
    }
    if (!aiOpts) {
      setChiefDialogue([...nextHistory, { role: "assistant", text: `${chiefBrief?.nextAction || chiefFallback.nextAction} ${chiefBrief?.why || chiefFallback.why}` }].slice(-6));
      return;
    }
    setChiefDialogueLoading(true);
    try {
      const historyText = nextHistory.map(row => `${row.role}: ${row.text}`).join("\n");
      const job = await runAIJob("dashboard.chief_dialogue.v1", {
        context: chiefContext,
        brief: chiefBrief || chiefFallback,
        history: historyText,
        question,
      }, aiOpts, { genConfig: { temperature: 0.2, maxOutputTokens: 1100 } });
      const answer = String(job?.output || job?.text || "").trim() || `${chiefBrief?.nextAction || chiefFallback.nextAction} ${chiefBrief?.why || chiefFallback.why}`;
      setChiefDialogue([...nextHistory, { role: "assistant", text: answer }].slice(-6));
    } catch {
      setChiefDialogue([...nextHistory, { role: "assistant", text: `${chiefBrief?.nextAction || chiefFallback.nextAction} ${chiefBrief?.why || chiefFallback.why}` }].slice(-6));
    } finally {
      setChiefDialogueLoading(false);
    }
  }

  function chiefSmartResponseNote(choice, label, brief) {
    const nextAction = cleanOneLine(brief?.nextAction || chiefFallback.nextAction, 240);
    const summary = cleanOneLine(brief?.summary || chiefFallback.summary, 180);
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
    const actionText = cleanOneLine(brief?.nextAction || chiefFallback.nextAction, 240);
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
    const brief = chiefBrief || chiefFallback;
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
    recordChiefSmartLearning("done", chiefBrief || chiefFallback);
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
      style={{ display: touchLayout ? "none" : "flex", alignItems: "center", justifyContent: "center", minWidth: 6, width: 6, border: "none", padding: 0, cursor: "col-resize", background: "transparent", touchAction: "none" }}>
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

  const NC_LABEL = { now: "Now", today: "Soon", eventually: "Long" };
  const ncCorePills = [BEFORE_SHAVUOS_PRIORITY_ID, "now", "today", "eventually"]
    .map(id => { const p = priorities.find(x => x.id === id && !x.deleted); return p ? { ...p, ncLabel: NC_LABEL[id] || p.label } : null; })
    .filter(Boolean);
  const activePri = gP(priorities, taskPriority);
  const activePriColor = activePri?.color || T.primary || "#7EB0DE";
  const compactAddDot = (color, active = false) => ({
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: 99,
    border: active ? `1px solid ${color}` : `1px solid ${softBorder(color, 0.34)}`,
    background: softBg(color, active ? 0.22 : 0.13),
    color,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: active ? 1 : 0.86,
  });

  const bySection = Object.fromEntries(sections.map(s => [s.id, s]));
  const collectActions = (...ids) => ids.flatMap(id => bySection[id]?.actions || []);
  const actionCategories = [
    { id: "tasks",   title: "Tasks",   icon: "task_alt",     actions: collectActions("priority", "focus") },
    { id: "health",  title: "Health",  icon: "monitor_heart",actions: collectActions("health") },
    { id: "shailos", title: "Shailos", icon: "rule",         actions: [...collectActions("shaila"), ...(bySection.record?.actions || []).filter(a => a.id === "record-shaila")] },
    { id: "phone",   title: "Phone",   icon: "phone_in_talk",actions: [...collectActions("phone"), ...(bySection.record?.actions || []).filter(a => a.id === "record-call")] },
    { id: "setup",   title: "Setup",   icon: "settings",     actions: [...(bySection.record?.actions || []).filter(a => !["record-shaila","record-call"].includes(a.id)), ...collectActions("system")] },
  ].filter(c => c.actions.length);
  const activeActionCategory = actionCategories.find(c => c.id === actionCategoryId) || actionCategories[0];

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

  const activeChiefBrief = chiefBrief || chiefFallback;
  const activeChiefTone = activeChiefBrief?.urgency === "now" ? C.danger : activeChiefBrief?.urgency === "today" ? C.accent : C.muted;
  const activeChiefSources = (activeChiefBrief?.sources || []).slice(0, 5);
  const activeChiefTaskText = cleanOneLine(activeChiefBrief?.nextAction || "", 260);
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
          <button key={id} type="button" onClick={() => handleChiefSmartResponse(id)} disabled={disabled}
            title={`${label} - save this signal to the Chief profile`} aria-label={`${label} smart response`}
            style={{
              minHeight: large ? 38 : 27,
              borderRadius: large ? 8 : 999,
              border: `1px solid ${id === "not_now" ? softBorder(C.warning || C.accent, 0.3) : softBorder(C.accent, 0.26)}`,
              background: active ? softBg(C.accent, 0.16) : C.bgSoft,
              color: disabled && !active ? C.faint : C.text,
              padding: large ? "7px 11px" : "3px 8px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: disabled ? "default" : "pointer",
              fontSize: large ? NC_TYPE.control : NC_TYPE.small,
              fontWeight: 600,
              fontFamily: NC_FONT_STACK,
              lineHeight: 1,
              whiteSpace: "nowrap",
              opacity: disabled && !active ? 0.62 : 1,
            }}>
            {suiteIcon(active ? "hourglass_top" : icon, large ? 15 : 13)}
            <span>{label}</span>
          </button>
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
    const pagePanel = { border: `1px solid ${C.divider}`, borderRadius: 8, background: C.bg, minWidth: 0, overflow: "hidden" };
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
      ["Tasks", `${dueSignals.tasks} open`, "task_alt", dueSignals.tasks ? C.text : C.muted],
      ["Shailos", `${dueSignals.shailos} open`, "rule", dueSignals.shailos ? C.warning || C.accent : C.muted],
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
              <button type="button" onClick={() => setChiefRefreshNonce(n => n + 1)} title="Refresh Chief scan" aria-label="Refresh Chief scan"
                style={gvIconButton({ width: 38, height: 38, color: C.text, background: C.bg }, C)}>{suiteIcon("refresh", 17)}</button>
              <button type="button" onClick={onCloseChiefPage} title="Back to NerveCenter" aria-label="Back to NerveCenter"
                style={gvIconButton({ width: 38, height: 38, color: C.muted, background: C.bg }, C)}>{suiteIcon("close", 17)}</button>
            </div>
          </header>

          {activeChiefBrief._isPlaceholder ? (
            <section style={{ ...pagePanel, padding: pagePad, display: "flex", alignItems: "center", gap: 12, minHeight: 56 }}>
              {chiefLoading && <div style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${C.faint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite", flexShrink: 0 }} />}
              <span style={{ color: C.muted, fontSize: isStacked ? 14 : 15, lineHeight: 1.5, fontFamily: NC_FONT_STACK }}>{activeChiefBrief.summary}</span>
            </section>
          ) : (activeChiefBrief.brief || activeChiefBrief.signals?.length > 0) ? (
            <section style={{ ...pagePanel, padding: pagePad }}>
              {activeChiefBrief.brief && (
                <div style={{ fontSize: isStacked ? 14 : 15, lineHeight: 1.65, color: C.text, fontFamily: NC_FONT_STACK, marginBottom: activeChiefBrief.signals?.length > 0 ? 14 : 0 }}>
                  {activeChiefBrief.brief}
                </div>
              )}
              {activeChiefBrief.signals?.length > 0 && (
                <div style={{ display: "grid", gap:8, borderTop: activeChiefBrief.brief ? `1px solid ${C.divider}` : "none", paddingTop: activeChiefBrief.brief ? 12 : 0 }}>
                  {activeChiefBrief.signals.map((sig, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "80px minmax(0,1fr)", gap: 10, fontSize: NC_TYPE.control, fontFamily: NC_FONT_STACK, lineHeight: 1.45 }}>
                      <span style={{ color: C.faint, fontWeight: 700, fontSize: NC_TYPE.small, textTransform: "uppercase", letterSpacing: "0.04em", paddingTop: 2 }}>{sig.area}</span>
                      <span style={{ color: C.muted }}>{sig.note}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <section style={{ display: "grid", gridTemplateColumns: isStacked ? "repeat(2,minmax(0,1fr))" : "repeat(5,minmax(0,1fr))", gap: 8 }}>
            {snapshotTiles.map(([label, value, icon, color]) => (
              <button key={label} type="button" onClick={onCloseChiefPage} title={`View ${label} in NerveCenter`}
                style={{ border: `1px solid ${C.divider}`, borderRadius: 8, background: C.bgSoft, padding: "10px 11px", minWidth: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap:8, color, fontSize: NC_TYPE.small, fontWeight: 700, fontFamily: NC_FONT_STACK }}>
                  {suiteIcon(icon, 14)}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                </div>
                <div style={{ marginTop: 6, color: C.text, fontSize: NC_TYPE.control, fontWeight: 650, lineHeight: 1.25, fontFamily: NC_FONT_STACK }}>{value}</div>
              </button>
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
                <div style={{ borderLeft: `4px solid ${chiefLoading ? C.divider : activeChiefTone}`, paddingLeft: 14, display: "grid", gap: 8, opacity: chiefLoading ? 0.55 : 1, transition: "opacity 0.25s" }}>
                  <div style={{ fontSize: isStacked ? 19 : 24, lineHeight: 1.2, color: C.text, fontWeight: 650, fontFamily: NC_FONT_STACK }}>{activeChiefBrief.summary}</div>
                  <div style={{ fontSize: isStacked ? 15 : 17, lineHeight: 1.38, color: C.muted, fontFamily: NC_FONT_STACK }}>
                    <span style={{ color: activeChiefTone, fontWeight: 700 }}>Do: </span>{activeChiefBrief.nextAction}
                  </div>
                  {(activeChiefBrief.why || chiefError) && (
                    <div style={{ fontSize: NC_TYPE.control, lineHeight: 1.45, color: C.faint, fontFamily: NC_FONT_STACK }}>{activeChiefBrief.why || chiefError}</div>
                  )}
                </div>
              </div>
              {chiefSmartButtons(true)}
            </div>

            <div style={{ padding: pagePad, display: "grid", gap: 12, alignContent: "start" }}>
              <span style={pageLabel}>Capture</span>
              <input value={chiefTaskDraft} onChange={e => setChiefTaskDraft(e.target.value)} placeholder="Task text"
                style={{ minWidth: 0, width: "100%", boxSizing: "border-box", height: 38, borderRadius: 8, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: "0 10px", fontSize: NC_TYPE.control, lineHeight: 1.35, fontFamily: NC_FONT_STACK, outline: "none" }} />
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <select value={chiefTaskPriority || defaultSuggestionPriorityId} onChange={e => setChiefTaskPriority(e.target.value)}
                  style={{ minWidth: 0, height: 36, border: `1px solid ${C.divider}`, borderRadius: 8, background: C.bgSoft, color: C.text, fontSize: NC_TYPE.control, fontFamily: NC_FONT_STACK, padding: "0 8px" }}>
                  {taskSuggestionPriorities.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button type="button" onClick={createChiefNextTask} disabled={!chiefTaskDraft.trim()} title="Create task" aria-label="Create task"
                  style={gvIconButton({ width: 38, height: 36, borderRadius: 8, color: chiefTaskDraft.trim() ? "#fff" : C.faint, background: chiefTaskDraft.trim() ? (chiefPri.color || C.accent) : "transparent" }, C)}>{suiteIcon("add", 16)}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isStacked ? "1fr" : "repeat(3,minmax(0,1fr))", gap: 8 }}>
                {[
                  ["Focus", activeChiefBrief.focusArea || "operations", C.text],
                  ["Urgency", activeChiefBrief.urgency || "watch", activeChiefTone],
                  ["Evidence", (activeChiefSources.length ? activeChiefSources : ["Dashboard"]).join(", "), C.text],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ border: `1px solid ${C.divider}`, borderRadius: 8, padding:8, background: C.bgSoft, minWidth: 0 }}>
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
                    <div key={row.id} style={{ border: `1px solid ${softBorder(pri.color || C.accent, 0.28)}`, background: softBg(pri.color || C.accent, 0.07), borderRadius: 8, padding: 10, display: "grid", gap: 8, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ minWidth: 0, color: C.text, fontSize: NC_TYPE.control, fontWeight: 650, fontFamily: NC_FONT_STACK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Create task</span>
                        <span style={{ color: C.faint, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK, whiteSpace: "nowrap" }}>{row.source}</span>
                      </div>
                      <input value={row.text} onChange={e => updateTaskSuggestion(row.id, { text: e.target.value })}
                        style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.divider}`, borderRadius: 7, background: C.bg, color: C.text, padding: "7px 8px", fontSize: NC_TYPE.control, fontFamily: NC_FONT_STACK, outline: "none" }} />
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 6, alignItems: "center" }}>
                        <select value={row.priorityId || defaultSuggestionPriorityId} onChange={e => updateTaskSuggestion(row.id, { priorityId: e.target.value })}
                          style={{ minWidth: 0, height: 30, border: `1px solid ${C.divider}`, borderRadius: 7, background: C.bg, color: C.text, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK, padding: "0 6px" }}>
                          {taskSuggestionPriorities.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        <button type="button" onClick={() => dismissTaskSuggestion(row)} title="Dismiss suggestion" aria-label="Dismiss suggestion"
                          style={gvIconButton({ width: 30, height: 30, color: C.faint, background: "transparent" }, C)}>{suiteIcon("close", 13)}</button>
                        <button type="button" onClick={() => createTaskSuggestion(row)} disabled={!row.text.trim()} title="Create task" aria-label="Create task"
                          style={gvIconButton({ width: 30, height: 30, color: row.text.trim() ? "#fff" : C.faint, background: row.text.trim() ? (pri.color || C.accent) : "transparent" }, C)}>{suiteIcon("add", 14)}</button>
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
                <div key={`${row.role}-${idx}`} style={{ justifySelf: row.role === "user" ? "end" : "start", maxWidth: "92%", border: `1px solid ${row.role === "user" ? softBorder(C.accent, 0.24) : C.divider}`, background: row.role === "user" ? softBg(C.accent, 0.08) : C.bgSoft, color: C.text, borderRadius: 8, padding: "8px 10px", fontSize: NC_TYPE.control, lineHeight: 1.42, fontFamily: NC_FONT_STACK }}>
                  <span style={row.pending ? { color: C.muted } : null}>{row.text}</span>
                </div>
              ))}
            </div>
            <form onSubmit={e => { e.preventDefault(); submitChiefPrompt(); }} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 40px", gap: 8, padding: 12, borderTop: `1px solid ${C.divider}` }}>
              <textarea ref={chiefPromptRef} value={chiefPrompt} rows={2} onChange={e => setChiefPrompt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitChiefPrompt(); } }} placeholder="Respond, correct, or ask for the next move"
                style={{ minWidth: 0, minHeight: 46, maxHeight: 140, borderRadius: 8, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: "9px 10px", fontSize: NC_TYPE.control, lineHeight: 1.35, fontFamily: NC_FONT_STACK, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
              <button type="submit" disabled={!chiefPrompt.trim() || chiefDialogueLoading} title="Ask Chief" aria-label="Ask Chief"
                style={gvIconButton({ width: 40, height: 46, borderRadius: 8, color: chiefPrompt.trim() && !chiefDialogueLoading ? "#fff" : C.faint, background: chiefPrompt.trim() && !chiefDialogueLoading ? C.accent : "transparent" }, C)}>
                {suiteIcon(chiefDialogueLoading ? "hourglass_top" : "send", 16)}
              </button>
            </form>
          </section>

          <section style={{ ...pagePanel }}>
            <button type="button" onClick={() => setChiefProfileOpen(open => !open)}
              style={{ width: "100%", minHeight: 44, border: "none", background: "transparent", color: C.text, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 14px", cursor: "pointer", fontSize: NC_TYPE.label, fontWeight: 700, fontFamily: NC_FONT_STACK }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap:8 }}>{suiteIcon("tune", 15)} Profile</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.faint, fontSize: NC_TYPE.small, fontWeight: 500 }}>
                {chiefProfileLoading ? "Loading" : "Netlify Blobs"}
                {suiteIcon(chiefProfileOpen ? "expand_less" : "expand_more", 17)}
              </span>
            </button>
            {chiefProfileOpen && (
              <div style={{ borderTop: `1px solid ${C.divider}`, padding: 14, display: "grid", gap: 8 }}>
                <textarea value={chiefProfileDraft} onChange={e => setChiefProfileDraft(e.target.value)} rows={7}
                  style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.divider}`, borderRadius: 8, background: C.bgSoft, color: C.text, padding: "9px 10px", fontSize: NC_TYPE.control, lineHeight: 1.4, fontFamily: NC_FONT_STACK, resize: "vertical", outline: "none" }} />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setChiefProfileDraft(markdownFromChiefProfile(chiefProfile))} title="Reset profile draft" aria-label="Reset profile draft"
                    style={gvIconButton({ width: 34, height: 34, color: C.faint, background: "transparent" }, C)}>{suiteIcon("undo", 14)}</button>
                  <button type="button" onClick={saveChiefProfileDraft} disabled={!onSaveChiefProfileMarkdown || chiefProfileSaving} title="Save Chief profile" aria-label="Save Chief profile"
                    style={gvIconButton({ width: 34, height: 34, color: !chiefProfileSaving ? "#fff" : C.faint, background: !chiefProfileSaving ? C.accent : "transparent" }, C)}>{suiteIcon(chiefProfileSaving ? "hourglass_top" : "save", 15)}</button>
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
  if (isMobileDevice && !healthPage && !chiefPage) {
    const menuToggle = id => setMobileMenuOpen(prev => prev === id ? null : id);
    const menuClose  = () => setMobileMenuOpen(null);
    const boxCtx = { C, menuId: mobileMenuOpen, onMenuToggle: menuToggle, onMenuClose: menuClose };

    const fmtTimeM = (raw) => { try { const d = new Date(raw); const now = new Date(); return d.toDateString()===now.toDateString() ? d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}) : d.toLocaleDateString([],{month:"short",day:"numeric"}); } catch { return ""; } };
    const gmailHdr = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || "";
    const fmtFromM = (raw) => { const m = raw?.match(/^"?([^"<]+)"?\s*<[^>]+>/); return m ? m[1].trim() : (raw || "").split("@")[0]; };
    const decodeSnipM = s => (s || "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").trim();
    const upcomingCal = (calendarRows || []).filter(r => !r.past);

    // Portrait: 5 stacked equal rows. Landscape: 3 boxes on top (each 2 of 6 cols),
    // 2 on the bottom (each 3 of 6) — fills the screen evenly with no empty cell.
    const isPortrait = typeof window === "undefined" || window.innerHeight >= window.innerWidth;
    const span = idx => isPortrait ? undefined : (idx < 3 ? "span 2" : "span 3");
    const emptyMsg = txt => <div style={{ padding:"12px 14px", fontSize:ncType.meta, color:C.faint, fontFamily:NC_FONT_STACK }}>{txt}</div>;

    return (
      <div style={{ position:"fixed", top:topOffset, left:sidebarW, right:0, height:`calc(100dvh - ${topOffset}px)`, zIndex:7600, background:C.bg, display:"flex", flexDirection:"column", borderLeft:`1px solid ${C.divider}`, boxSizing:"border-box", padding:"8px 8px calc(8px + env(safe-area-inset-bottom,0px))" }}>

        {/* slim time + actions bar */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 2px 6px", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:8, minWidth:0 }}>
            <span style={{ fontSize:20, fontWeight:300, color:C.text, fontFamily:NC_FONT_STACK, letterSpacing:-0.5 }}>{clockParts.timeMain}</span>
            <span style={{ fontSize:11, color:C.faint, fontFamily:NC_FONT_STACK, whiteSpace:"nowrap" }}>{nowDate.toLocaleDateString([], { weekday:"short", month:"short", day:"numeric" })}</span>
          </div>
          <button onClick={() => { setActionCategoryId("tasks"); setActionsOpen(true); }} title="More actions" style={gvIconButton({ width:32, height:32 }, C)}>{suiteIcon("apps", 16)}</button>
        </div>

        {/* 5-box grid */}
        <div style={{ flex:1, minHeight:0, display:"grid", gap:7,
          gridTemplateColumns: isPortrait ? "1fr" : "repeat(6, 1fr)",
          gridTemplateRows: isPortrait ? "repeat(5, minmax(0,1fr))" : "repeat(2, minmax(0,1fr))" }}>

          {/* Mail */}
          <MobileBox {...boxCtx} menuKey="mail" icon="mail" title="Mail" count={(gmailMessages||[]).length} style={{ gridColumn: span(0) }}
            menuItems={[{ icon:"refresh", label:"Refresh", run: onRefreshCalendar || onConnectGoogle }, { icon:"open_in_new", label:"Open Gmail", run: () => window.open("https://mail.google.com/mail/u/0/#inbox","_blank") }]}>
            {(!gmailMessages || gmailMessages.length===0) ? emptyMsg("Inbox clear.") : gmailMessages.map((msg,i) => {
              const subj = gmailHdr(msg,"Subject")||"(no subject)";
              const from = fmtFromM(gmailHdr(msg,"From"));
              const date = fmtTimeM(gmailHdr(msg,"Date"));
              return (
                <a key={msg.id||i} href={`https://mail.google.com/mail/u/0/#inbox/${msg.id}`} target="_blank" rel="noopener noreferrer"
                  style={{ display:"block", padding:"9px 12px", borderBottom:`1px solid ${C.divider}`, textDecoration:"none", color:"inherit" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:6, marginBottom:2 }}>
                    <span style={{ fontSize:ncType.body, fontWeight:600, color:C.text, fontFamily:NC_FONT_STACK, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{from}</span>
                    <span style={{ fontSize:ncType.meta, color:C.faint, fontFamily:NC_FONT_STACK, flexShrink:0 }}>{date}</span>
                  </div>
                  <span style={{ fontSize:ncType.meta, color:C.muted, fontFamily:NC_FONT_STACK, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{msg.aiSummary||decodeSnipM(msg.snippet)||subj}</span>
                </a>
              );
            })}
          </MobileBox>

          {/* Phone */}
          <MobileBox {...boxCtx} menuKey="phone" icon="phone_in_talk" title="Phone" style={{ gridColumn: span(1) }}
            menuItems={[{ icon:"open_in_full", label:"Open phone view", run: onOpenPhone }]}>
            {/* Flex column with a real height so the phone surface's flex:1 activity feed
                gets space. A plain block wrapper collapsed the feed to zero height → blank. */}
            <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0, padding:"4px 10px 8px", boxSizing:"border-box" }}>
              <NerveCenterPhoneSurface T={T} user={user} onOnlineChange={onOnlineChange} onStatusSummary={handlePhoneStatusSummary} onActivitySnapshot={handlePhoneActivitySummary} compact onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
            </div>
          </MobileBox>

          {/* Tasks */}
          <MobileBox {...boxCtx} menuKey="tasks" icon="task_alt" title="Tasks" count={primaryTaskQueue.length} style={{ gridColumn: span(2) }}
            primaryBtn={<button onClick={() => openTaskComposer(taskPriority)} style={gvIconButton({ width:26, height:26, color:C.muted }, C)} title="Add task">{suiteIcon("add",14)}</button>}
            menuItems={[{ icon:"list_alt", label:"Open full queue", run: onOpenQueue }, { icon:"local_drink", label:"Zen mode", run: onOpenZen }]}>
            {taskComposerOpen && (
              <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.divider}` }}>
                <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 32px 32px", gap:6, alignItems:"start" }}>
                  <textarea ref={stackedTaskInputRef} value={taskDraft} rows={1} autoFocus
                    onChange={e => { setTaskDraft(e.target.value); e.target.style.height="34px"; e.target.style.height=Math.min(e.target.scrollHeight,88)+"px"; }}
                    onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addDraft(taskPriority,{mrsW:taskComposerMrsW});} if(e.key==="Escape"){setTaskComposerOpen(false);setTaskDraft("");} }}
                    placeholder="New task"
                    style={{ width:"100%", minWidth:0, height:34, maxHeight:88, boxSizing:"border-box", borderRadius:7, border:`1px solid ${activePriColor}`, background:C.bgSoft, color:C.text, padding:"7px 10px", fontSize:ncType.body, fontFamily:NC_FONT_STACK, outline:"none", resize:"none", overflowY:"hidden" }} />
                  <button onClick={() => addDraft(taskPriority,{mrsW:taskComposerMrsW})} disabled={!taskDraft.trim()} style={{ width:32, height:32, borderRadius:8, border:"none", background:activePriColor, color:"#fff", cursor:taskDraft.trim()?"pointer":"default", opacity:taskDraft.trim()?1:0.38, display:"flex", alignItems:"center", justifyContent:"center" }}>{suiteIcon("check",15)}</button>
                  <button onClick={() => {setTaskComposerOpen(false);setTaskDraft("");}} style={gvIconButton({width:32,height:32,borderRadius:8},C)}>{suiteIcon("close",14)}</button>
                </div>
              </div>
            )}
            {primaryTaskQueue.length === 0 && !taskComposerOpen ? emptyMsg("No open tasks.") : primaryTaskQueue.map(t => {
              const pri = gP(priorities, t.priority);
              const priColor = pri?.color || T.primary || "#7EB0DE";
              const isEditing = editingTaskId === t.id;
              return (
                <div key={t.id} style={{ display:"grid", gridTemplateColumns:"3px minmax(0,1fr) auto", alignItems:"start", padding:"10px 12px 10px 0", gap:10, borderBottom:`1px solid ${C.divider}`, minHeight:40 }}>
                  <span style={{ width:3, alignSelf:"stretch", minHeight:20, borderRadius:"0 3px 3px 0", background:priColor, flexShrink:0 }} />
                  {isEditing ? (
                    <textarea value={editText} autoFocus rows={2}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(editText.trim())onEditTask?.(t.id,editText.trim());setEditingTaskId(null);} if(e.key==="Escape")setEditingTaskId(null); }}
                      onBlur={() => { if(editText.trim()&&editText!==t.text)onEditTask?.(t.id,editText.trim());setEditingTaskId(null); }}
                      style={{ width:"100%", boxSizing:"border-box", borderRadius:6, border:`1px solid ${priColor}`, background:C.bgSoft, color:C.text, padding:"6px 8px", fontSize:ncType.body, fontFamily:"system-ui", resize:"none", outline:"none" }} />
                  ) : (
                    <span onClick={() => { setEditingTaskId(t.id); setEditText(t.text); }} style={{ display:"block", fontSize:ncType.body, lineHeight:ncType.line, color:C.text, wordBreak:"break-word", cursor:"text", paddingTop:1 }}>{nerveDisplaySummary(t,"Untitled task")}</span>
                  )}
                  {!isEditing && (
                    <div style={{ display:"flex", gap:3 }}>
                      <button onClick={() => onCompleteTask?.(t.id)} style={gvIconButton({width:30,height:30,color:C.success,background:"transparent"},C)} title="Done">{suiteIcon("check",14)}</button>
                      <button onClick={() => onDeleteTask?.(t.id)} style={gvIconButton({width:30,height:30,color:C.danger,background:"transparent"},C)} title="Delete">{suiteIcon("close",13)}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </MobileBox>

          {/* Shailos */}
          <MobileBox {...boxCtx} menuKey="shailos" icon="rule" title="Shailos" accentColor={GOLD} count={visibleShailos.length} style={{ gridColumn: span(3) }}
            primaryBtn={<button onClick={onOpenShailaAdd} style={gvIconButton({width:26,height:26,color:GOLD},C)} title="Add shaila">{suiteIcon("add",14)}</button>}
            menuItems={[{ icon:"open_in_full", label:"Open Shailos", run: onOpenShailos }]}>
            {visibleShailos.length === 0 ? emptyMsg("No pending shailos.") : visibleShailos.map(s => {
              const text = nerveDisplaySummary(s,"Open shaila");
              const isGetBack = s.status==="get_back"||!!s.isGetBackStep;
              return (
                <button key={s.id} onClick={onOpenShailos}
                  style={{ width:"100%", textAlign:"left", display:"grid", gridTemplateColumns:"3px minmax(0,1fr)", gap:10, padding:"9px 12px 9px 0", border:"none", background:"transparent", color:C.text, cursor:"pointer", alignItems:"start", borderBottom:`1px solid ${C.divider}` }}>
                  <span style={{ width:3, alignSelf:"stretch", minHeight:20, borderRadius:"0 3px 3px 0", background:GOLD, flexShrink:0 }} />
                  <span style={{ minWidth:0 }}>
                    <span style={{ display:"block", fontSize:ncType.body, fontWeight:500, lineHeight:ncType.line, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{text}</span>
                    <span style={{ fontSize:ncType.meta, color:GOLD, fontWeight:500 }}>{isGetBack?"waiting to reply":"pending answer"}</span>
                  </span>
                </button>
              );
            })}
          </MobileBox>

          {/* Calendar */}
          <MobileBox {...boxCtx} menuKey="cal" icon="calendar_today" title="Calendar" accentColor={C.accent} count={upcomingCal.length} style={{ gridColumn: span(4) }}
            primaryBtn={<button onClick={() => setShowAddEvent(true)} style={gvIconButton({width:26,height:26,color:C.accent},C)} title="Add event">{suiteIcon("add",14)}</button>}
            menuItems={[{ icon:"refresh", label:"Refresh", run: onRefreshCalendar || onConnectGoogle }, { icon:"open_in_new", label:"Open Google Calendar", run: () => window.open("https://calendar.google.com/calendar/r","_blank") }]}>
            {showAddEvent && (
              <div style={{ padding:"10px 12px", borderBottom:`1px solid ${C.divider}` }}>
                <textarea autoFocus value={addEventText} onChange={e=>setAddEventText(e.target.value)} rows={2} placeholder='e.g. "Call David Mon at 3pm"'
                  onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();handleAddEvent();}}}
                  style={{ width:"100%", boxSizing:"border-box", borderRadius:7, border:`1px solid ${C.divider}`, background:C.bgSoft, color:C.text, fontSize:ncType.body, padding:"7px 10px", resize:"none", fontFamily:NC_FONT_STACK, outline:"none" }} />
                {addEventError && <div style={{ fontSize:ncType.meta, color:C.danger, marginTop:4 }}>{addEventError}</div>}
                <div style={{ display:"flex", gap:6, marginTop:6, justifyContent:"flex-end" }}>
                  <button onClick={()=>{setShowAddEvent(false);setAddEventText("");setAddEventError(null);}} style={{ padding:"6px 12px", borderRadius:6, border:`1px solid ${C.divider}`, background:"none", color:C.muted, cursor:"pointer", fontSize:ncType.meta, fontFamily:NC_FONT_STACK }}>Cancel</button>
                  <button onClick={handleAddEvent} disabled={addEventLoading||!addEventText.trim()} style={{ padding:"6px 14px", borderRadius:6, border:"none", background:C.accent, color:"#fff", cursor:addEventLoading?"wait":"pointer", fontSize:ncType.meta, fontFamily:NC_FONT_STACK, opacity:(!addEventText.trim()||addEventLoading)?0.55:1 }}>{addEventLoading?"Adding…":"Add"}</button>
                </div>
              </div>
            )}
            {!calendarEvents ? emptyMsg("Loading…") : upcomingCal.length === 0 ? emptyMsg("Nothing upcoming.") : upcomingCal.map(row => (
              <div key={row.evt?.id||row.index} style={{ display:"grid", gridTemplateColumns:"auto minmax(0,1fr)", gap:8, padding:"9px 12px", borderBottom:`1px solid ${C.divider}`, alignItems:"start" }}>
                <span style={{ fontSize:ncType.meta, color:row.now?C.accent:C.faint, fontFamily:NC_FONT_STACK, whiteSpace:"nowrap", paddingTop:1, fontWeight:row.now?700:400, minWidth:54 }}>
                  {row.evt?.start?.date ? "All day" : new Date(row.evt?.start?.dateTime).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
                </span>
                <span style={{ fontSize:ncType.body, color:row.now||row.special?C.text:C.muted, fontFamily:NC_FONT_STACK, fontWeight:row.now||row.special?600:400, lineHeight:ncType.line }}>
                  {row.evt?.summary||"(no title)"}
                </span>
              </div>
            ))}
          </MobileBox>
        </div>

        {/* Actions drawer */}
        {actionsOpen && (
          <div style={{ position:"fixed", inset:`0 0 0 ${sidebarW}px`, zIndex:7800, display:"flex", justifyContent:"flex-end", background:"rgba(0,0,0,0.28)" }} onClick={()=>setActionsOpen(false)}>
            <aside onClick={e=>e.stopPropagation()} style={{ width:"min(540px,94vw)", height:"100%", background:C.bg, borderLeft:`1px solid ${C.divider}`, boxShadow:"-10px 0 28px rgba(60,64,67,0.18)", display:"flex", flexDirection:"column" }}>
              <div style={{ height:64, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 18px", borderBottom:`1px solid ${C.divider}`, flexShrink:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, fontSize:NC_TYPE.title, fontWeight:500, fontFamily:NC_FONT_STACK, color:C.text }}>{suiteIcon("apps",20)} More Actions</div>
                <button onClick={()=>setActionsOpen(false)} style={gvIconButton({},C)}>{suiteIcon("close",17)}</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"130px minmax(0,1fr)", minHeight:0, flex:1 }}>
                <div style={{ borderRight:`1px solid ${C.divider}`, padding:12, display:"grid", alignContent:"start", gap:6, background:C.bgSoft, overflow:"auto" }}>
                  {actionCategories.map(cat => {
                    const isCatActive = activeActionCategory?.id === cat.id;
                    return (
                      <button key={cat.id} onClick={()=>setActionCategoryId(cat.id)}
                        style={{ height:40, borderRadius:20, border:"none", background:isCatActive?C.hover:"transparent", color:isCatActive?C.text:C.muted, cursor:"pointer", display:"flex", alignItems:"center", gap:8, padding:"0 12px", fontWeight:500, fontFamily:NC_FONT_STACK, fontSize:NC_TYPE.control, textAlign:"left" }}>
                        {suiteIcon(cat.icon,17)} {cat.title}
                      </button>
                    );
                  })}
                </div>
                <div style={{ padding:14, overflow:"auto", display:"grid", alignContent:"start", gap:8 }}>
                  {(activeActionCategory?.actions||[]).map(action=>(
                    <button key={action.id||action.label} onClick={()=>{if(action.disabled)return;setActionsOpen(false);action.run?.();}} disabled={action.disabled}
                      style={{ minHeight:48, borderRadius:8, border:`1px solid ${action.primary?"transparent":C.divider}`, background:action.primary?C.accent:C.bg, color:action.primary?"#fff":C.text, cursor:action.disabled?"default":"pointer", opacity:action.disabled?0.5:1, padding:"0 14px", display:"grid", gridTemplateColumns:"32px minmax(0,1fr)", gap:10, alignItems:"center", fontFamily:NC_FONT_STACK, textAlign:"left" }}>
                      <span style={{ width:32, height:32, borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", background:action.primary?"rgba(255,255,255,0.16)":C.hover, color:action.primary?"#fff":C.muted, flexShrink:0 }}>{suiteIcon(action.icon,16)}</span>
                      <span style={{ fontSize:NC_TYPE.control, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    );
  }

  // ── Mobile "nerve center" — all sections on one screen ──────────────────────
  if (isStacked && !healthPage && !chiefPage) {
    const mobileMenuToggle = id => setMobileMenuOpen(prev => prev === id ? null : id);
    const mobileMenuClose  = () => setMobileMenuOpen(null);
    const mobileExpandToggle = id => setMobileExpanded(prev => prev === id ? null : id);

    // Shared props for the module-level <MobileSection>. The component is hoisted out
    // of this render (see top of file) so it is NOT recreated on every clock tick —
    // that per-second remount was tearing down and rebuilding each section mid-gesture,
    // which dropped taps on the ··· menu and reset focus in the task composer. With a
    // stable component type React now just re-renders with fresh props.
    const sectionCtx = { C, expandedId: mobileExpanded, menuId: mobileMenuOpen, onExpand: mobileExpandToggle, onMenuToggle: mobileMenuToggle, onMenuClose: mobileMenuClose };

    const fmtTimeM = (raw) => { try { const d = new Date(raw); const now = new Date(); return d.toDateString()===now.toDateString() ? d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}) : d.toLocaleDateString([],{month:"short",day:"numeric"}); } catch { return ""; } };
    const gmailHdr = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || "";
    const fmtFromM = (raw) => { const m = raw?.match(/^"?([^"<]+)"?\s*<[^>]+>/); return m ? m[1].trim() : (raw || "").split("@")[0]; };
    const decodeSnipM = s => (s || "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").trim();

    const hd = healthData || {};
    const fmtStepsM  = v => v != null ? Math.round(v).toLocaleString() : "—";
    const fmtSleepM  = v => { if (v == null) return "—"; const h = Math.floor(v); const m = Math.round((v%1)*60); return `${h}h${m>0?(m<10?"0":"")+m:""}`; };

    const taskMax = 4;
    const topTasks = primaryTaskQueue.slice(0, taskMax);
    const hiddenMobileTasks = Math.max(0, primaryTaskQueue.length - taskMax);

    return (
      // height uses 100dvh (dynamic viewport) + safe-area padding so the iOS
      // toolbar / home indicator never chops the last card off the bottom.
      <div style={{ position: "fixed", top: topOffset, left: sidebarW, right: 0, height: `calc(100dvh - ${topOffset}px)`, zIndex: 7600, background: C.bg, overflowY: "auto", overscrollBehavior: "contain", borderLeft: `1px solid ${C.divider}`, WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 10px calc(34px + env(safe-area-inset-bottom, 0px))", boxSizing: "border-box" }}>

          {/* Time strip — tap the time to reveal the timeline */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 2px 4px" }}>
            <button onClick={() => setMobileTimelineOpen(o => !o)} style={{ all: "unset", display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, cursor: "pointer" }} aria-expanded={mobileTimelineOpen} title="Show timeline">
              <span style={{ fontSize: 24, fontWeight: 300, color: C.text, fontFamily: NC_FONT_STACK, letterSpacing: -0.5 }}>{clockParts.timeMain}</span>
              <span style={{ fontSize: 11, color: C.faint, fontFamily: NC_FONT_STACK }}>{nowDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
              <span style={{ alignSelf: "center", color: C.faint, display: "flex", transform: mobileTimelineOpen ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>{suiteIcon("expand_more", 14)}</span>
            </button>
            <button onClick={() => { setActionCategoryId("tasks"); setActionsOpen(true); }} title="More actions" style={gvIconButton({ width: 34, height: 34 }, C)}>{suiteIcon("apps", 16)}</button>
          </div>

          {/* Timeline reveal (seconds → English year, with Hebrew date) */}
          {mobileTimelineOpen && (
            <div style={{ padding: "10px 12px 5px", background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8 }}>
              <TimelineFace nowDate={nowDate} C={C} compact />
            </div>
          )}

          {/* Health mini-strip */}
          <button onClick={onOpenHealth} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 12px", background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, fontFamily: NC_FONT_STACK, letterSpacing: 0.8, textTransform: "uppercase", flexShrink: 0 }}>Health</span>
            {[["👣", fmtStepsM(hd.steps)], ["😴", fmtSleepM(hd.sleep)], ["♥", hd.heartRate != null ? `${Math.round(hd.heartRate)} bpm` : "—"], ["⚖", hd.weight != null ? `${(+hd.weight).toFixed(1)} lb` : "—"]].map(([ico, val]) => (
              <span key={ico} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12, color: val === "—" ? C.faint : C.text, fontFamily: NC_FONT_STACK, fontWeight: val === "—" ? 400 : 600 }}>
                <span style={{ fontSize: 11 }}>{ico}</span>{val}
              </span>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 11, color: C.faint }}>↗</span>
          </button>

          {/* Tasks — primary, always expanded */}
          <MobileSection {...sectionCtx} id="tasks" icon="task_alt" title="Tasks" count={primaryTaskQueue.length} expandable={false}
            primaryBtn={<button onClick={() => openTaskComposer(taskPriority)} style={gvIconButton({ width: 26, height: 26, color: C.muted }, C)} title="Add task">{suiteIcon("add", 14)}</button>}
            menuItems={[
              { icon: "list_alt",    label: "Open full queue", run: onOpenQueue },
              { icon: "local_drink", label: "Zen mode",        run: onOpenZen },
              ...(onAddMrsWTask ? [{ icon: "person", label: "Add Mrs W task", run: () => openTaskComposer(taskPriority, { mrsW: true }) }] : []),
            ]}
          >
            {taskComposerOpen && (
              <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.divider}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 32px 32px", gap: 6, alignItems: "start" }}>
                  <textarea ref={stackedTaskInputRef} value={taskDraft} rows={1} autoFocus
                    onChange={e => { setTaskDraft(e.target.value); e.target.style.height="34px"; e.target.style.height=Math.min(e.target.scrollHeight,88)+"px"; }}
                    onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addDraft(taskPriority,{mrsW:taskComposerMrsW});} if(e.key==="Escape"){setTaskComposerOpen(false);setTaskDraft("");} }}
                    placeholder="New task"
                    style={{ width:"100%",minWidth:0,height:34,maxHeight:88,boxSizing:"border-box",borderRadius:7,border:`1px solid ${activePriColor}`,background:C.bgSoft,color:C.text,padding:"7px 10px",fontSize:ncType.body,fontFamily:NC_FONT_STACK,outline:"none",resize:"none",overflowY:"hidden" }} />
                  <button onClick={() => addDraft(taskPriority,{mrsW:taskComposerMrsW})} disabled={!taskDraft.trim()} style={{ width:32,height:32,borderRadius:8,border:"none",background:activePriColor,color:"#fff",cursor:taskDraft.trim()?"pointer":"default",opacity:taskDraft.trim()?1:0.38,display:"flex",alignItems:"center",justifyContent:"center" }}>{suiteIcon("check",15)}</button>
                  <button onClick={() => {setTaskComposerOpen(false);setTaskDraft("");}} style={gvIconButton({width:32,height:32,borderRadius:8},C)}>{suiteIcon("close",14)}</button>
                </div>
              </div>
            )}
            {topTasks.length === 0 && !taskComposerOpen && <div style={{ padding:"12px 14px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK }}>No open tasks.</div>}
            {topTasks.map(t => {
              const pri = gP(priorities, t.priority);
              const priColor = pri?.color || T.primary || "#7EB0DE";
              const isEditing = editingTaskId === t.id;
              return (
                <div key={t.id} data-nc-task-row="true" style={{ display:"grid",gridTemplateColumns:"3px minmax(0,1fr) auto",alignItems:"start",padding:"10px 12px 10px 0",gap:10,borderTop:`1px solid ${C.divider}`,minHeight:40 }}>
                  <span style={{ width:3,alignSelf:"stretch",minHeight:20,borderRadius:"0 3px 3px 0",background:priColor,flexShrink:0 }} />
                  {isEditing ? (
                    <textarea value={editText} autoFocus rows={2}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(editText.trim())onEditTask?.(t.id,editText.trim());setEditingTaskId(null);} if(e.key==="Escape")setEditingTaskId(null); }}
                      onBlur={() => { if(editText.trim()&&editText!==t.text)onEditTask?.(t.id,editText.trim());setEditingTaskId(null); }}
                      style={{ width:"100%",boxSizing:"border-box",borderRadius:6,border:`1px solid ${priColor}`,background:C.bgSoft,color:C.text,padding:"6px 8px",fontSize:ncType.body,fontFamily:"system-ui",resize:"none",outline:"none" }} />
                  ) : (
                    <span onClick={() => { setEditingTaskId(t.id); setEditText(t.text); }} style={{ display:"block",fontSize:ncType.body,lineHeight:ncType.line,color:C.text,wordBreak:"break-word",cursor:"text",paddingTop:1 }}>{nerveDisplaySummary(t,"Untitled task")}</span>
                  )}
                  {!isEditing && (
                    <div style={{ display:"flex",gap:3 }}>
                      <button onClick={() => onCompleteTask?.(t.id)} style={gvIconButton({width:30,height:30,color:C.success,background:"transparent"},C)} title="Done">{suiteIcon("check",14)}</button>
                      <button onClick={() => onDeleteTask?.(t.id)} style={gvIconButton({width:30,height:30,color:C.danger,background:"transparent"},C)} title="Delete">{suiteIcon("close",13)}</button>
                    </div>
                  )}
                </div>
              );
            })}
            {hiddenMobileTasks > 0 && (
              <button onClick={onOpenQueue} style={{ width:"100%",padding:"8px 0",border:"none",borderTop:`1px solid ${C.divider}`,background:"transparent",color:C.faint,cursor:"pointer",fontSize:ncType.meta,fontFamily:NC_FONT_STACK }}>
                +{hiddenMobileTasks} more — open queue
              </button>
            )}
          </MobileSection>

          {/* Calendar */}
          {(googleToken || calendarEvents !== null) && (
            <MobileSection {...sectionCtx} id="cal" icon="calendar_today" title="Calendar" accentColor={C.accent}
              preview={(() => {
                if (!calendarEvents) return "Loading…";
                const up = calendarRows.filter(r => !r.past);
                if (!up.length) return "Nothing upcoming";
                const r = up[0];
                const t = r.evt?.start?.date ? "All day" : new Date(r.evt?.start?.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                return `${t} · ${r.evt?.summary || "(no title)"}`;
              })()}
              menuItems={[
                { icon: "add",         label: "Add event",            run: () => { setMobileExpanded("cal"); setShowAddEvent(true); } },
                { icon: "refresh",     label: "Refresh",              run: onRefreshCalendar || onConnectGoogle },
                { icon: "open_in_new", label: "Open Google Calendar", run: () => window.open("https://calendar.google.com/calendar/r","_blank") },
                { icon: "link_off",    label: "Disconnect",           run: onDisconnectGoogle },
              ]}
            >
              {!calendarEvents ? (
                <div style={{ padding:"12px 14px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,display:"flex",gap:8,alignItems:"center",borderTop:`1px solid ${C.divider}` }}>
                  <div style={{width:10,height:10,borderRadius:"50%",border:`2px solid ${C.faint}`,borderTopColor:"transparent",animation:"ot-spin 0.8s linear infinite"}} /> Loading…
                </div>
              ) : calendarRows.filter(r=>!r.past).length === 0 ? (
                <div style={{ padding:"12px 14px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,borderTop:`1px solid ${C.divider}` }}>Nothing upcoming today.</div>
              ) : calendarRows.filter(r=>!r.past).slice(0,3).map(row => (
                <div key={row.evt?.id||row.index} style={{ display:"grid",gridTemplateColumns:"auto minmax(0,1fr)",gap:8,padding:"9px 12px",borderTop:`1px solid ${C.divider}`,alignItems:"start" }}>
                  <span style={{ fontSize:ncType.meta,color:row.now?C.accent:C.faint,fontFamily:NC_FONT_STACK,whiteSpace:"nowrap",paddingTop:1,fontWeight:row.now?700:400,minWidth:54 }}>
                    {row.evt?.start?.date ? "All day" : new Date(row.evt?.start?.dateTime).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
                  </span>
                  <span style={{ fontSize:ncType.body,color:row.now||row.special?C.text:C.muted,fontFamily:NC_FONT_STACK,fontWeight:row.now||row.special?600:400,lineHeight:ncType.line,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                    {row.now && <span style={{width:6,height:6,borderRadius:"50%",background:C.accent,display:"inline-block",marginRight:5,verticalAlign:"middle"}} />}
                    {row.evt?.summary||"(no title)"}
                  </span>
                </div>
              ))}
              {showAddEvent && (
                <div style={{ padding:"10px 12px",borderTop:`1px solid ${C.divider}` }}>
                  <textarea autoFocus value={addEventText} onChange={e=>setAddEventText(e.target.value)} rows={2} placeholder='e.g. "Call David Mon at 3pm"'
                    onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();handleAddEvent();}}}
                    style={{width:"100%",boxSizing:"border-box",borderRadius:7,border:`1px solid ${C.divider}`,background:C.bgSoft,color:C.text,fontSize:ncType.body,padding:"7px 10px",resize:"none",fontFamily:NC_FONT_STACK,outline:"none"}} />
                  {addEventError && <div style={{fontSize:ncType.meta,color:C.danger,marginTop:4}}>{addEventError}</div>}
                  <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
                    <button onClick={()=>{setShowAddEvent(false);setAddEventText("");setAddEventError(null);}} style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${C.divider}`,background:"none",color:C.muted,cursor:"pointer",fontSize:ncType.meta,fontFamily:NC_FONT_STACK}}>Cancel</button>
                    <button onClick={handleAddEvent} disabled={addEventLoading||!addEventText.trim()} style={{padding:"6px 14px",borderRadius:6,border:"none",background:C.accent,color:"#fff",cursor:addEventLoading?"wait":"pointer",fontSize:ncType.meta,fontFamily:NC_FONT_STACK,opacity:(!addEventText.trim()||addEventLoading)?0.55:1}}>{addEventLoading?"Adding…":"Add"}</button>
                  </div>
                </div>
              )}
            </MobileSection>
          )}

          {/* Gmail */}
          {(googleToken || gmailMessages !== null) && (
            <MobileSection {...sectionCtx} id="mail" icon="mail" title="Mail" count={(gmailMessages||[]).length}
              preview={(!gmailMessages || !gmailMessages.length) ? "Inbox clear" : `${fmtFromM(gmailHdr(gmailMessages[0], "From"))} · ${gmailMessages[0].aiSummary || decodeSnipM(gmailMessages[0].snippet) || gmailHdr(gmailMessages[0], "Subject") || "(no subject)"}`}
              menuItems={[
                { icon: "refresh",     label: "Refresh",    run: onRefreshCalendar || onConnectGoogle },
                { icon: "open_in_new", label: "Open Gmail", run: () => window.open("https://mail.google.com/mail/u/0/#inbox","_blank") },
              ]}
            >
              {!gmailMessages || gmailMessages.length === 0 ? (
                <div style={{ padding:"12px 14px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,borderTop:`1px solid ${C.divider}` }}>Inbox clear.</div>
              ) : gmailMessages.slice(0,3).map((msg,i) => {
                const subj = gmailHdr(msg,"Subject")||"(no subject)";
                const from = fmtFromM(gmailHdr(msg,"From"));
                const date = fmtTimeM(gmailHdr(msg,"Date"));
                const url  = `https://mail.google.com/mail/u/0/#inbox/${msg.id}`;
                return (
                  <a key={msg.id||i} href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:6,padding:"9px 12px",borderTop:`1px solid ${C.divider}`,textDecoration:"none",color:"inherit",alignItems:"start" }}>
                    <div style={{minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:6,marginBottom:2}}>
                        <span style={{fontSize:ncType.body,fontWeight:600,color:C.text,fontFamily:NC_FONT_STACK,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{from}</span>
                        <span style={{fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,flexShrink:0}}>{date}</span>
                      </div>
                      <span style={{fontSize:ncType.meta,color:C.muted,fontFamily:NC_FONT_STACK,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{msg.aiSummary||decodeSnipM(msg.snippet)||subj}</span>
                    </div>
                  </a>
                );
              })}
            </MobileSection>
          )}

          {/* Shailos */}
          <MobileSection {...sectionCtx} id="shailos" icon="rule" title="Shailos" accentColor={GOLD} count={visibleShailos.length}
            preview={visibleShailos.length ? nerveDisplaySummary(visibleShailos[0], "Open shaila") : "None pending"}
            primaryBtn={<button onClick={onOpenShailaAdd} style={gvIconButton({width:26,height:26,color:GOLD},C)} title="Add shaila">{suiteIcon("add",14)}</button>}
            menuItems={[{ icon: "open_in_full", label: "Open Shailos", run: onOpenShailos }]}
          >
            {visibleShailos.length === 0 ? (
              <div style={{ padding:"12px 14px",fontSize:ncType.meta,color:C.faint,fontFamily:NC_FONT_STACK,borderTop:`1px solid ${C.divider}` }}>No pending shailos.</div>
            ) : visibleShailos.slice(0,2).map(s => {
              const text = nerveDisplaySummary(s,"Open shaila");
              const isGetBack = s.status==="get_back"||!!s.isGetBackStep;
              return (
                <button key={s.id} onClick={onOpenShailos}
                  style={{ width:"100%",textAlign:"left",display:"grid",gridTemplateColumns:"3px minmax(0,1fr)",gap:10,padding:"9px 12px 9px 0",border:"none",background:"transparent",color:C.text,cursor:"pointer",alignItems:"start",borderTop:`1px solid ${C.divider}` }}>
                  <span style={{width:3,alignSelf:"stretch",minHeight:20,borderRadius:"0 3px 3px 0",background:GOLD,flexShrink:0}} />
                  <span>
                    <span style={{display:"block",fontSize:ncType.body,fontWeight:500,lineHeight:ncType.line,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{text}</span>
                    <span style={{fontSize:ncType.meta,color:GOLD,fontWeight:500}}>{isGetBack?"waiting to reply":"pending answer"}</span>
                  </span>
                </button>
              );
            })}
            {visibleShailos.length > 2 && (
              <button onClick={onOpenShailos} style={{width:"100%",padding:"7px 0",border:"none",borderTop:`1px solid ${C.divider}`,background:"transparent",color:C.faint,cursor:"pointer",fontSize:ncType.meta,fontFamily:NC_FONT_STACK}}>
                +{visibleShailos.length-2} more
              </button>
            )}
          </MobileSection>

          {/* Phone — keepMounted so the DeskPhone poller keeps running while collapsed */}
          <MobileSection {...sectionCtx} id="phone" icon="phone_in_talk" title="Phone" keepMounted
            preview={phoneStatusSummary?.label || "DeskPhone"}
            menuItems={[{ icon: "open_in_full", label: "Open phone view", run: onOpenPhone }]}
          >
            <div style={{ padding: "4px 12px 10px", borderTop: `1px solid ${C.divider}` }}>
              <NerveCenterPhoneSurface T={T} user={user} onOnlineChange={onOnlineChange} onStatusSummary={handlePhoneStatusSummary} onActivitySnapshot={handlePhoneActivitySummary} compact onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
            </div>
          </MobileSection>

          {/* Connect Google prompt (no token yet) */}
          {googleClientId && !googleToken && !googleLoading && calendarEvents === null && gmailMessages === null && (
            <button onClick={onConnectGoogle}
              style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 14px",background:"none",border:`1px dashed ${C.divider}`,borderRadius:8,cursor:"pointer",color:C.muted,fontFamily:NC_FONT_STACK,fontSize:ncType.body,width:"100%",boxSizing:"border-box" }}>
              {suiteIcon("add_link",15)} Connect Google Calendar &amp; Gmail
            </button>
          )}

        </div>

        {/* Actions drawer (same as desktop) */}
        {actionsOpen && (
          <div style={{ position:"fixed",inset:`0 0 0 ${sidebarW}px`,zIndex:7800,display:"flex",justifyContent:"flex-end",background:"rgba(0,0,0,0.28)" }} onClick={()=>setActionsOpen(false)}>
            <aside onClick={e=>e.stopPropagation()} style={{ width:"min(540px,94vw)",height:"100%",background:C.bg,borderLeft:`1px solid ${C.divider}`,boxShadow:"-10px 0 28px rgba(60,64,67,0.18)",display:"flex",flexDirection:"column" }}>
              <div style={{height:64,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 18px",borderBottom:`1px solid ${C.divider}`,flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10,fontSize:NC_TYPE.title,fontWeight:500,fontFamily:NC_FONT_STACK,color:C.text}}>{suiteIcon("apps",20)} More Actions</div>
                <button onClick={()=>setActionsOpen(false)} style={gvIconButton({},C)}>{suiteIcon("close",17)}</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"130px minmax(0,1fr)",minHeight:0,flex:1}}>
                <div style={{borderRight:`1px solid ${C.divider}`,padding:12,display:"grid",alignContent:"start",gap:6,background:C.bgSoft,overflow:"auto"}}>
                  {actionCategories.map(cat => {
                    const isCatActive = activeActionCategory?.id === cat.id;
                    return (
                      <button key={cat.id} onClick={()=>setActionCategoryId(cat.id)}
                        style={{height:40,borderRadius:20,border:"none",background:isCatActive?C.hover:"transparent",color:isCatActive?C.text:C.muted,cursor:"pointer",display:"flex",alignItems:"center",gap:8,padding:"0 12px",fontWeight:500,fontFamily:NC_FONT_STACK,fontSize:NC_TYPE.control,textAlign:"left"}}>
                        {suiteIcon(cat.icon,17)} {cat.title}
                      </button>
                    );
                  })}
                </div>
                <div style={{padding:14,overflow:"auto",display:"grid",alignContent:"start",gap:8}}>
                  {(activeActionCategory?.actions||[]).map(action=>(
                    <button key={action.id||action.label} onClick={()=>{if(action.disabled)return;setActionsOpen(false);action.run?.();}} disabled={action.disabled}
                      style={{minHeight:48,borderRadius:8,border:`1px solid ${action.primary?"transparent":C.divider}`,background:action.primary?C.accent:C.bg,color:action.primary?"#fff":C.text,cursor:action.disabled?"default":"pointer",opacity:action.disabled?0.5:1,padding:"0 14px",display:"grid",gridTemplateColumns:"32px minmax(0,1fr)",gap:10,alignItems:"center",fontFamily:NC_FONT_STACK,textAlign:"left"}}>
                      <span style={{width:32,height:32,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",background:action.primary?"rgba(255,255,255,0.16)":C.hover,color:action.primary?"#fff":C.muted,flexShrink:0}}>{suiteIcon(action.icon,16)}</span>
                      <span style={{fontSize:NC_TYPE.control,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: `${topOffset}px 0 0 ${sidebarW}px`, zIndex: 7600, background: C.bg, overflow: isStacked ? "hidden" : touchLayout ? "auto" : "hidden", overscrollBehavior: "contain", borderLeft: `1px solid ${C.divider}` }}>
      <div style={isStacked ? { height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" } : { minHeight: "100%", height: touchLayout ? "auto" : "100%", maxWidth: 1520, margin: "0 auto", padding: "clamp(20px,2.4vw,32px)", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: touchLayout ? 12 : 4 }}>

        {/* Panel tab bar — mobile/stacked only */}
        {isStacked && (
          <div style={{ display: "flex", background: C.bg, borderBottom: `1px solid ${C.divider}`, flexShrink: 0 }}>
            {[["Tasks", "task_alt", 0], ["Shailos", "rule", 1], ["Phone", "phone_in_talk", 2]].map(([lbl, ico, idx]) => (
              <button key={idx} onClick={() => goToPanel(idx)}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap:6, height: 42, padding: "0 4px", border: "none", borderBottom: `2px solid ${idx === activeStackPanel ? C.accent : "transparent"}`, background: "none", cursor: "pointer", color: idx === activeStackPanel ? C.text : C.muted, fontSize: ncType.label, fontWeight: 500, fontFamily: NC_FONT_STACK, transition: "color 0.15s" }}>
                {suiteIcon(ico, 13)} {lbl}
              </button>
            ))}
          </div>
        )}

        {/* Three-panel grid — fills all remaining height; CSS scroll-snap carousel when stacked */}
        <div ref={taskGridRef} data-nc-task-grid="true" style={isStacked ? { display: "flex", overflowX: "auto", overflowY: "hidden", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none", flex: "1 1 0", minHeight: 0 } : { display: "grid", gridTemplateColumns: gridColumns, gap: touchLayout ? 16 : 0, flex: touchLayout ? "0 0 auto" : "1 1 0", minHeight: 0, alignItems: "stretch" }}>

          {/* ── Tasks ── */}
          <section style={isStacked ? { ...ncPanel, flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", height: "100%", touchAction: "pan-y" } : (primaryTaskQueue.length > MIN_COLLAPSED_TASKS ? ncPanel : ncTasksPanel)}>
            {!isStacked && (
            <div ref={taskHeaderRef} style={{ ...ncHeader, display: taskComposerOpen ? "block" : "flex", ...(taskComposerOpen ? { padding: "7px 12px" } : {}) }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, ...(taskComposerOpen ? { marginBottom: 7 } : {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap:8 }}>
                  <span style={ncSectionIcon()}>{suiteIcon("task_alt", 16)}</span>
                  <span style={ncTitle}>Tasks</span>
                </div>
                <div style={{ display: "flex", gap:4, alignItems: "center" }}>
                  {ncCorePills.map(p => {
                    const active = taskPriority === p.id;
                    return (
                      <button key={p.id} onClick={() => openTaskComposer(p.id)}
                        title={`Add ${p.ncLabel} task`} aria-label={`Add ${p.ncLabel} task`} aria-expanded={taskComposerOpen && active && !taskComposerMrsW}
                        style={compactAddDot(p.color, active && taskComposerOpen && !taskComposerMrsW)}>
                        {suiteIcon("add", 12)}
                      </button>
                    );
                  })}
                  {onAddMrsWTask && (
                    <button onClick={() => openTaskComposer(taskPriority, { mrsW: true })} title="Add Mrs W task" aria-label="Add Mrs W task" aria-expanded={taskComposerOpen && taskComposerMrsW}
                      style={compactAddDot("#4F9B6B", taskComposerOpen && taskComposerMrsW)}>
                      {suiteIcon("add", 12)}
                    </button>
                  )}
                  <span style={{ width: 1, height: 13, background: C.divider, margin: "0 3px", flexShrink: 0 }} />
                  {onOpenZen && <button onClick={onOpenZen} title="Zen mode" aria-label="Zen mode" style={ncSmallIconButton()}>{suiteIcon("local_drink", 14)}</button>}
                  <button onClick={onOpenQueue} title="Open full task queue" aria-label="Open full task queue" style={ncSmallIconButton()}>{suiteIcon("list_alt", 14)}</button>
                  <button onClick={() => { setActionCategoryId("tasks"); setActionsOpen(true); }} title="Task actions" style={ncSmallIconButton()}>{suiteIcon("apps", 14)}</button>
                </div>
              </div>
              {taskComposerOpen && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 30px 30px", gap: 6, alignItems: "start" }}>
                  <textarea ref={taskInputRef} value={taskDraft} rows={1}
                    onChange={e => { setTaskDraft(e.target.value); e.target.style.height = "34px"; e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px"; }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addDraft(taskPriority, { mrsW: taskComposerMrsW }); } if (e.key === "Escape") { setTaskComposerOpen(false); setTaskDraft(""); setTaskComposerMrsW(false); } }}
                    placeholder={taskComposerMrsW ? "Mrs W task" : `${priorities.find(p => p.id === taskPriority)?.ncLabel || "Task"} task`}
                    style={{ width: "100%", minWidth: 0, height: 34, maxHeight: 88, boxSizing: "border-box", borderRadius: 7, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: "7px 10px", fontSize: ncType.meta, fontWeight: 400, fontFamily: NC_FONT_STACK, outline: "none", resize: "none", overflowY: "hidden", lineHeight: ncType.line }} />
                  <button onClick={() => addDraft(taskPriority, { mrsW: taskComposerMrsW })} disabled={!taskDraft.trim()} title="Save task" aria-label="Save task"
                    style={{ width: 30, height: 30, borderRadius: 7, border: "none", background: taskComposerMrsW ? "#A8D8B9" : activePriColor, color: taskComposerMrsW ? "#123D25" : textOnColor(activePriColor), cursor: taskDraft.trim() ? "pointer" : "default", opacity: taskDraft.trim() ? 1 : 0.38, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {suiteIcon("check", 15)}
                  </button>
                  <button onClick={() => { setTaskComposerOpen(false); setTaskDraft(""); setTaskComposerMrsW(false); }} title="Cancel" aria-label="Cancel task entry"
                    style={gvIconButton({ width: 30, height: 30, borderRadius: 7 }, C)}>
                    {suiteIcon("close", 14)}
                  </button>
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
                      style={{ width: "100%", minWidth: 0, height: 34, maxHeight: 88, boxSizing: "border-box", borderRadius: 7, border: `1px solid ${activePriColor}`, background: C.bgSoft, color: C.text, padding: "7px 10px", fontSize: ncType.body, fontFamily: NC_FONT_STACK, outline: "none", resize: "none", overflowY: "hidden", lineHeight: ncType.line }} />
                    <button onClick={() => addDraft(taskPriority, { mrsW: taskComposerMrsW })} disabled={!taskDraft.trim()} title="Save"
                      style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: activePriColor, color: textOnColor(activePriColor), cursor: taskDraft.trim() ? "pointer" : "default", opacity: taskDraft.trim() ? 1 : 0.38, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {suiteIcon("check", 15)}
                    </button>
                    <button onClick={() => { setTaskComposerOpen(false); setTaskDraft(""); setTaskComposerMrsW(false); }} title="Cancel"
                      style={gvIconButton({ width: 32, height: 32, borderRadius: 8 }, C)}>
                      {suiteIcon("close", 14)}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => openTaskComposer(taskPriority)}
                  style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, padding: "11px 18px", border: "none", background: "none", color: C.faint, cursor: "pointer", fontFamily: NC_FONT_STACK, fontSize: ncType.body, borderBottom: `1px solid ${C.divider}`, flexShrink: 0, touchAction: "manipulation" }}>
                  {suiteIcon("add", 17)} <span>New task</span>
                </button>
              ))}
              <div ref={taskListRef} style={ncTaskList}>
              {primaryTasks.length ? primaryTasks.map(t => {
                const pri = gP(priorities, t.priority);
                const priColor = pri?.color || T.primary || "#7EB0DE";
                const isEditing = editingTaskId === t.id;
                const actionsOpen = openTaskActionsId === t.id;
                const displayText = nerveDisplaySummary(t, "Untitled task");
                return (
                  <div key={t.id} data-nc-task-row="true" className="nc-action-row" style={{ display: "grid", gridTemplateColumns: touchLayout ? "3px minmax(0,1fr) 40px" : "3px minmax(0,1fr)", alignItems: "start", padding: "14px 18px 14px 0", gap:12, minHeight: 56 }}>
                    {/* Priority color bar */}
                    <span style={{ width: 3, alignSelf: "stretch", minHeight: 24, borderRadius: "0 3px 3px 0", background: priColor, flexShrink: 0 }} />
                    {/* Text — click to edit inline */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                      {isEditing ? (
                        <textarea value={editText} autoFocus rows={2}
                          onChange={e => setEditText(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (editText.trim()) onEditTask?.(t.id, editText.trim()); setEditingTaskId(null); } if (e.key === "Escape") setEditingTaskId(null); }}
                          onBlur={() => { if (editText.trim() && editText !== t.text) onEditTask?.(t.id, editText.trim()); setEditingTaskId(null); }}
                          style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${priColor}`, background: C.bgSoft, color: C.text, padding: "8px 10px", fontSize: ncType.body, fontWeight: 400, fontFamily: "system-ui", resize: "none", outline: "none", lineHeight: ncType.line }} />
                      ) : (
                        <span onClick={() => { setEditingTaskId(t.id); setEditText(t.text); }}
                          title="Click to edit"
                          style={{ display: "block", fontSize: ncType.body, fontWeight: "var(--nc-font-weight-normal, 400)", lineHeight: ncType.line, color: C.text, wordBreak: "break-word", cursor: "text" }}>{displayText}</span>
                      )}
                    </div>
                    {/* Checkmark — plain icon, no pill */}
                    {touchLayout && !isEditing && (
                      <button onClick={e => { e.stopPropagation(); setOpenTaskActionsId(actionsOpen ? null : t.id); }} title={actionsOpen ? "Hide actions" : "Show actions"} aria-label={actionsOpen ? "Hide actions" : "Show actions"} style={gvIconButton({ width: 40, height: 40, background: actionsOpen ? C.hover : "transparent" }, C)}>
                        {suiteIcon("more_horiz", 17)}
                      </button>
                    )}
                    {(!touchLayout || actionsOpen) && !isEditing && (
                      <div className={touchLayout ? "" : "nc-hover-actions"} data-open={actionsOpen ? "true" : undefined} style={{ display: "flex", gap: 4, justifyContent: touchLayout ? "flex-start" : "flex-end", gridColumn: touchLayout ? "2 / 4" : "auto", marginTop: touchLayout ? -4 : 0, ...(touchLayout ? {} : { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 2, background: C.bg, borderRadius: 8, boxShadow: "0 1px 8px rgba(60,64,67,0.12)", padding:4 }) }}>
                        <button onClick={() => { setOpenTaskActionsId(null); onCompleteTask?.(t.id); }} title="Mark done" aria-label="Mark done" style={gvTextButton({ minHeight: 34, height: 34, padding: "0 10px", fontSize: NC_TYPE.small, border: "none", background: C.bgSoft, color: C.success }, C)}>
                          {suiteIcon("check", 17)} <span>Done</span>
                        </button>
                        <button onClick={() => { setOpenTaskActionsId(null); onDeleteTask?.(t.id); }} title="Delete task" aria-label="Delete task" style={gvTextButton({ minHeight: 34, height: 34, padding: "0 10px", fontSize: NC_TYPE.small, border: "none", background: C.bgSoft, color: C.danger }, C)}>
                          {suiteIcon("close", 15)} <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              }) : <div style={{ padding: "18px 20px", fontSize: ncType.meta, lineHeight: ncType.line, color: C.faint }}>No open tasks.</div>}
              </div>
              {!isStacked && (showAllTasks || primaryTaskQueue.length > collapsedTaskLimit) && primaryTaskQueue.length > MIN_COLLAPSED_TASKS && (
                <button ref={taskMoreButtonRef} onClick={() => setShowAllTasks(v => !v)} title={showAllTasks ? "Show fewer tasks" : `Show ${hiddenTaskCount} more tasks`} aria-label={showAllTasks ? "Show fewer tasks" : `Show ${hiddenTaskCount} more tasks`}
                  style={{ width: "100%", height: 24, flex: "0 0 24px", display: "flex", alignItems: "center", justifyContent: "center", gap:4, border: "none", borderTop: `1px solid ${C.divider}`, background: "transparent", color: C.faint, cursor: "pointer", fontSize: 11, fontFamily: NC_FONT_STACK, flexShrink: 0 }}>
                  {suiteIcon(showAllTasks ? "expand_less" : "expand_more", 12)}
                  {!showAllTasks && <span>+{hiddenTaskCount} more</span>}
                </button>
              )}

            </div>
          </section>
          {paneResizeHandle("tasks", "shailos")}

          {/* ── Shailos ── */}
          <section style={isStacked ? { ...ncPanel, flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", height: "100%", touchAction: "pan-y" } : ncPanel}>
            <div style={{ ...ncHeader, display: isStacked ? "none" : "flex" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={ncSectionIcon(GOLD)}>{suiteIcon("rule", 16)}</span>
                <span style={ncTitle}>Shailos</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={onOpenShailaAdd} style={cleanToolbarButton(false, C, { border: "none", background: GOLD, color: "#fff" })}>
                  {suiteIcon("add", 15)} Add
                </button>
                <button onClick={onOpenShailos} style={cleanToolbarButton(false, C, { color: GOLD })}>
                  {suiteIcon("open_in_full", 15)} Open
                </button>
                <button onClick={() => { setActionCategoryId("shailos"); setActionsOpen(true); }} title="Shailos actions" style={ncSmallIconButton(false, GOLD)}>{suiteIcon("apps", 14)}</button>
              </div>
            </div>
            <div style={ncScrollPane}>
              {/* Active shailos — open + pending get-back */}
              {visibleShailos.length ? visibleShailos.map((s, idx) => {
                const text = nerveDisplaySummary(s, "Open shaila");
                const isGetBack = s.status === "get_back" || !!s.isGetBackStep;
                const chipLabel = isGetBack ? "Get back" : "Answer";
                const chipBg = isGetBack ? "rgba(201,146,60,0.22)" : "rgba(201,146,60,0.10)";
                return (
                  <button key={s.id} onClick={onOpenShailos}
                    style={{ width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: "3px minmax(0,1fr) auto", gap:12, padding: "16px 20px 16px 0", border: "none", background: GOLD_BG, color: C.text, cursor: "pointer", alignItems: "start", minHeight: 60 }}>
                    <span style={{ width: 3, alignSelf: "stretch", minHeight: 28, borderRadius: 2, background: GOLD, flexShrink: 0 }} />
                    <span style={{ paddingLeft: 5, paddingTop: 1 }}>
                      <span style={{ display: "block", fontSize: ncType.body, fontWeight: "var(--nc-font-weight-strong, 500)", lineHeight: ncType.line, color: C.text, wordBreak: "break-word" }}>{text}</span>
                      <span style={{ display: "block", fontSize: ncType.label, color: GOLD, fontWeight: 500, marginTop: 4 }}>{suiteIcon(isGetBack ? "schedule" : "search", 13)} {isGetBack ? "waiting to reply" : "pending answer"}</span>
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: GOLD, background: chipBg, border: `1px solid ${GOLD_BRD}`, borderRadius: 999, padding: "4px 9px", whiteSpace: "nowrap", flexShrink: 0, marginRight: 4, marginTop: 2 }}>{chipLabel}</span>
                  </button>
                );
              }) : <div style={{ padding: "18px 20px", fontSize: ncType.meta, lineHeight: ncType.line, color: T.tFaint }}>No pending shailos.</div>}

              {/* Recently completed shailos */}
              {shailosCompleted.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 20px 8px", borderTop: `1px solid ${C.divider}` }}>
                    <span style={{ color: "T.success" }}>{suiteIcon("check_circle", 15)}</span>
                    <span style={{ fontSize: ncType.label, fontWeight: 500, color: C.muted, letterSpacing: 0, textTransform: "uppercase" }}>Recently resolved</span>
                  </div>
                  {shailosCompleted.map(s => {
                    const text = nerveDisplaySummary(s, "Resolved shaila");
                    return (
                      <div key={s.id} style={{ display: "grid", gridTemplateColumns: "3px minmax(0,1fr) auto", gap:12, padding: "14px 20px 14px 0", alignItems: "start", opacity: 0.72, minHeight: 56 }}>
                        <span style={{ width: 3, alignSelf: "stretch", minHeight: 24, borderRadius: 2, background: "T.success", flexShrink: 0 }} />
                        <span style={{ paddingLeft: 5, paddingTop: 1, fontSize: ncType.meta, fontWeight: "var(--nc-font-weight-normal, 400)", lineHeight: ncType.line, color: C.muted, wordBreak: "break-word", textDecoration: "line-through" }}>{text}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "T.success", background: "rgba(46,125,50,0.10)", border: "1px solid rgba(46,125,50,0.22)", borderRadius: 999, padding: "4px 9px", whiteSpace: "nowrap", flexShrink: 0, marginRight: 4, marginTop: 2 }}>Done</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
          {paneResizeHandle("shailos", "phone")}

          {/* ── Phone ── */}
          <section style={isStacked ? { ...ncPanel, flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", height: "100%", touchAction: "pan-y" } : ncPanel}>
            <div style={{ ...ncHeader, display: isStacked ? "none" : "flex" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={ncSectionIcon()}>{suiteIcon("phone_in_talk", 16)}</span>
                <span style={ncTitle}>Phone</span>
                <span title={phoneStatusSummary.label} style={{ display: "inline-flex", alignItems: "center", gap:6, minWidth: 0, color: phoneStatusColor, fontSize: 12, fontWeight: 500 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: phoneStatusColor, flexShrink: 0 }} />
                  {(phoneStatusSummary.tone === "incoming" || phoneStatusSummary.tone === "call") && (
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{phoneStatusSummary.label}</span>
                  )}
                  {phoneStatusSummary.voicemailCount > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap:4, color: C.danger }}>{suiteIcon("voicemail", 12)} {phoneStatusSummary.voicemailCount}</span>
                  )}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={onOpenPhone} style={cleanToolbarButton(false, C)}>
                  {suiteIcon("open_in_full", 15)} Open
                </button>
                <button onClick={() => { setActionCategoryId("phone"); setActionsOpen(true); }} title="Phone actions" style={ncSmallIconButton()}>{suiteIcon("apps", 14)}</button>
              </div>
            </div>
            <div style={{ overflow: "hidden", flex: "1 1 auto", minHeight: 0, padding: "10px 14px 14px", display: "flex", flexDirection: "column" }}>
              <NerveCenterPhoneSurface T={T} user={user} onOnlineChange={onOnlineChange} onStatusSummary={handlePhoneStatusSummary} onActivitySnapshot={handlePhoneActivitySummary} compact onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
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
          // isFocus: focus mode hides headers and softens borders for a cleaner at-a-glance read.
          const isFocus = ncViewMode === "focus";
          const cardWrap = {
            background: C.bg,
            borderRadius: isFocus ? 4 : 6,
            border: `1px solid ${softBorder(C.divider, isFocus ? 0.3 : 0.65)}`,
            ...(isFocus ? { boxShadow: "0 1px 4px rgba(0,0,0,0.05)" } : {}),
            flex: isStacked ? "1 1 0" : 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden",
          };
          const cardHead = isFocus
            ? { display: "none" }
            : {
                minHeight: isStacked ? 24 : 28,
                padding: isStacked ? "3px 8px" : "5px 10px 3px",
                borderBottom: `1px solid ${softBorder(C.divider, 0.5)}`,
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
              };
          const cardBody = { flex: "1 1 0", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: isStacked ? "2px 8px 6px" : (isFocus ? "6px 12px 8px" : "4px 12px 8px"), overscrollBehavior: "contain", scrollbarGutter: "stable" };
          // headLabel: ambient watermark — small, spaced, low-opacity; not a structural bar
          const headLabel = { fontSize: 8, fontWeight: 700, color: C.faint, fontFamily: NC_FONT_STACK, letterSpacing: 1.8, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, opacity: 0.7 };
          const selectedEmail = selectedEmailId ? (gmailMessages || []).find(msg => msg.id === selectedEmailId) : null;
          const selectedEmailDetail = selectedEmailId ? emailDetails[selectedEmailId] : null;
          const selectedEmailSource = selectedEmailDetail || selectedEmail;
          const selectedEmailBody = selectedEmailDetail?.fullBody || decodeSnippet(selectedEmail?.snippet || "");
          const lowerGridStyle = {
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 172px minmax(0,1fr)",
            gap: 8,
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
          const currentEventNowRule = () => (
            <span aria-hidden="true" style={{
              position: "absolute",
              left: isStacked ? 64 : 82,
              right: 6,
              top: "50%",
              height: 2,
              borderRadius: 2,
              background: nowLineColor,
              boxShadow: `0 0 0 1px ${softBorder(nowLineColor, 0.16)}`,
              zIndex: 1,
              pointerEvents: "none",
            }} />
          );

          return (
            <React.Fragment>
            <div style={{ display: "flex", flexDirection: "column", flex: "0 0 auto", gap: 6, minHeight: 0 }}>
              {/* ── Focus / Full mode toggle ── */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "0 2px 2px" }}>
                {[{ id: "full", lbl: "Full" }, { id: "focus", lbl: "Focus" }].map(({ id, lbl }) => (
                  <button key={id}
                    onClick={() => { setNcViewMode(id); try { localStorage.setItem("nc_view_mode", id); } catch {} }}
                    style={{
                      background: ncViewMode === id ? softBorder(C.divider, 0.45) : "transparent",
                      border: "none", borderRadius: 4, padding: "2px 7px",
                      cursor: "pointer", fontFamily: NC_FONT_STACK,
                      fontSize: 8, fontWeight: 700, letterSpacing: 1.4,
                      textTransform: "uppercase",
                      color: ncViewMode === id ? C.muted : C.faint,
                      transition: "background 0.12s, color 0.12s",
                    }}
                  >{lbl}</button>
                ))}
              </div>
              <div style={lowerGridStyle}>

              {!googleConfigured && (
                <button onClick={onOpenGoogleSettings}
                  style={{ ...cardWrap, borderStyle: "dashed", cursor: "pointer", alignItems: "center", justifyContent: "center", gap: 8, color: C.muted, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.control, fontWeight: 500 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accentBlue; e.currentTarget.style.color = accentBlue; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.divider; e.currentTarget.style.color = C.muted; }}>
                  {suiteIcon("add_link", 16)}
                  Set up Google
                </button>
              )}

              {/* Not connected — never been connected: show connect button */}
              {notConnected && !googleError && !googleWasConnected && (
                <button onClick={onConnectGoogle}
                  style={{ flex: 1, borderRadius: 16, border: `1px dashed ${T.brd}`, background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: T.tSoft, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.control, fontWeight: 500, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accentBlue; e.currentTarget.style.color = accentBlue; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.brd; e.currentTarget.style.color = T.tSoft; }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Connect Google Calendar &amp; Gmail
                </button>
              )}
              {/* Was connected before — spinner until timeout, then show reconnect button */}
              {notConnected && !googleError && googleWasConnected && !reconnectTimedOut && (
                <div style={{ flex: 1, borderRadius: 16, border: `1px solid ${T.brd}`, background: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: T.tFaint, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.meta }}>
                  <div style={{ width: 11, height: 11, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                  Reconnecting…
                </div>
              )}
              {notConnected && !googleError && googleWasConnected && reconnectTimedOut && (
                <button onClick={onConnectGoogle}
                  style={{ flex: 1, borderRadius: 16, border: `1px dashed ${T.brd}`, background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: T.tSoft, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.control, fontWeight: 500, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accentBlue; e.currentTarget.style.color = accentBlue; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.brd; e.currentTarget.style.color = T.tSoft; }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                  Reconnect Google
                </button>
              )}

              {/* Error banner */}
              {googleError && (
                <div style={{ ...cardWrap, borderColor: "T.warning", flexDirection: "row", alignItems: "center", padding: "0 14px", gap: 10 }}>
                  <span style={{ fontSize: NC_TYPE.meta, color: "T.warning", fontFamily: NC_FONT_STACK, flex: 1 }}>{googleError}</span>
                  <button onClick={onConnectGoogle} style={{ fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, fontWeight: 500, color: accentBlue, background: "none", border: `1px solid ${accentBlue}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", flexShrink: 0 }}>Retry</button>
                  <button onClick={onDisconnectGoogle} style={{ fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, color: T.tFaint, background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: 0 }}>✕</button>
                </div>
              )}

              {/* Loading (before any data) */}
              {googleLoading && !calendarEvents && !gmailMessages && !googleError && (
                <div style={{ ...cardWrap, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <div style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: NC_TYPE.meta, color: T.tFaint, fontFamily: NC_FONT_STACK }}>Loading…</span>
                </div>
              )}

              {/* ── Calendar card ── */}
              {(calendarEvents !== null || (googleLoading && googleToken)) && (
                <div className="nc-card-group" style={cardWrap}>
                  <div style={cardHead}>
                    <span style={headLabel}>{suiteIcon("calendar_today", 11)} Today</span>
                    <div className="nc-card-action" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {googleLoading && <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${T.tFaint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />}
                      <button onClick={() => setShowAddEvent(true)} title="Add event"
                         style={{ fontSize: 16, color: T.tFaint, background: "none", border: "none", cursor: "pointer", lineHeight: 1, opacity: .6, padding: 0, display: "flex" }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .6}>+</button>
                      <a href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer" title="Open Google Calendar"
                         style={{ fontSize: 14, color: T.tFaint, textDecoration: "none", lineHeight: 1, opacity: .6, display: "flex" }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .6}>↗</a>
                      <button onClick={onRefreshCalendar || onConnectGoogle} title="Refresh" style={{ fontSize: 14, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .6, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .6}>↺</button>
                      <button onClick={onDisconnectGoogle} title="Disconnect" style={{ fontSize: 14, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .35, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = .85} onMouseLeave={e => e.currentTarget.style.opacity = .35}>✕</button>
                    </div>
                  </div>
                  <div style={cardBody}>
                    {!calendarEvents ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap:8 }}>
                        <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                        <span style={{ fontSize: NC_TYPE.meta, color: T.tFaint, fontFamily: NC_FONT_STACK }}>Loading calendar…</span>
                      </div>
                    ) : calendarRows.length === 0 ? (
                      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
                        {calendarNowLine("now-empty")}
                        <p style={{ fontSize: NC_TYPE.meta, color: T.tFaint, fontFamily: NC_FONT_STACK, margin: "0", textAlign: "center" }}>Nothing today</p>
                      </div>
                    ) : (
                      <React.Fragment>
                      {specialCalendarRows.length > 0 && (
                        <div style={{ border: `1px solid ${softBorder(accentBlue, 0.24)}`, background: softBg(accentBlue, 0.08), borderRadius: 7, padding: "8px 9px", margin: "2px 0 6px" }}>
                          {specialCalendarRows.map(row => (
                            <div key={`special-${row.evt?.id || row.index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "start", fontFamily: NC_FONT_STACK }}>
                              <span style={{ minWidth: 0, color: C.text, fontSize: NC_TYPE.control, fontWeight: 600, lineHeight: 1.22, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{row.evt?.summary || "(no title)"}</span>
                              <span style={{ color: row.now ? C.danger : C.accent, fontSize: NC_TYPE.meta, fontWeight: 600, whiteSpace: "nowrap" }}>{row.now ? "Now" : row.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {calendarRows.map((row, i) => {
                      const evt = row.evt;
                      const now = row.now;
                      const lifted = row.special || row.now;
                      const rowStyle = { position: "relative", overflow: "hidden", display: "flex", gap: isStacked ? 7 : 10, alignItems: "flex-start", padding: isStacked ? "5px 2px" : "8px 4px", textDecoration: "none", color: "inherit", borderRadius: 4, background: lifted ? softBg(accentBlue, row.now ? 0.10 : 0.055) : "transparent" };
                      const inner = (
                        <>
                          <span style={{ position: "relative", zIndex: 2, fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, color: now ? accentBlue : T.tFaint, fontWeight: lifted ? 600 : 400, flexShrink: 0, width: isStacked ? 54 : 66, textAlign: "right", paddingTop: 1 }}>{fmtEvtTime(evt)}</span>
                          <div style={{ position: "relative", zIndex: 2, flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {now && <span style={{ width: 5, height: 5, borderRadius: "50%", background: accentBlue, flexShrink: 0 }} />}
                              <span style={{ fontSize: NC_TYPE.control, color: lifted ? C.text : C.muted, fontWeight: lifted ? 600 : 400, fontFamily: NC_FONT_STACK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: row.routine && !lifted ? 0.78 : 1 }}>{evt.summary || "(no title)"}</span>
                            </div>
                          </div>
                        </>
                      );
                      return evt.htmlLink
                        ? <React.Fragment key={evt.id || i}>{!hasCurrentCalendarEvent && i === calendarNowInsertIndex && calendarNowLine("now-line")}<a ref={now ? calendarNowRef : null} href={evt.htmlLink} target="_blank" rel="noopener noreferrer" style={{ ...rowStyle, scrollMarginBlock: now ? "50%" : undefined }} onMouseEnter={e => e.currentTarget.style.background = T.bgW || 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = rowStyle.background}>{now && currentEventNowRule()}{inner}</a></React.Fragment>
                        : <React.Fragment key={evt.id || i}>{!hasCurrentCalendarEvent && i === calendarNowInsertIndex && calendarNowLine("now-line")}<div ref={now ? calendarNowRef : null} style={{ ...rowStyle, scrollMarginBlock: now ? "50%" : undefined }}>{now && currentEventNowRule()}{inner}</div></React.Fragment>;
                    })}
                    {!hasCurrentCalendarEvent && calendarNowInsertIndex === calendarRows.length && calendarNowLine("now-line-end")}
                    </React.Fragment>
                    )}
                  </div>
                </div>
              )}


              {/* ── Clock card — right-click to change style ── */}
              {(() => {
                const ampmMatch = clockParts.timeMain.match(/\s?(AM|PM)$/i);
                const timeDigits = ampmMatch ? clockParts.timeMain.slice(0, -ampmMatch[0].length) : clockParts.timeMain;
                const timePeriod = ampmMatch ? ampmMatch[1] : "";
                const clockFF = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
                const base = { borderRadius: 10, minHeight: 0, overflow: "hidden", fontFamily: clockFF, fontVariantNumeric: "tabular-nums", userSelect: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" };
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
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 14 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5, lineHeight: 1 }}>
                        <span style={{ fontSize: 38, fontWeight: 300, color: C.text, letterSpacing: -1 }}>{timeDigits}</span>
                        {timePeriod && <span style={{ fontSize: 14, fontWeight: 600, color: C.muted, letterSpacing: 0.5 }}>{timePeriod}</span>}
                      </div>
                      {secBar}
                    </div>
                  ),
                  minimal: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "16px 8px 10px" }}>
                      <div style={{ fontSize: 36, fontWeight: 200, lineHeight: 1, color: C.text, letterSpacing: -1, textAlign: "center", maxWidth: "100%" }}>{clockParts.timeMain}</div>
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
                      <div style={{ fontSize: 15, fontWeight: 300, color: C.text, letterSpacing: -0.5, lineHeight: 1, fontVariantNumeric: "tabular-nums", fontFamily: clockFF }}>
                        {clockParts.timeMain}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginTop: 2 }}>
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
                            : <span key={i} style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: C.text, background: C.hover, borderRadius: 7, padding: "8px 6px", minWidth: 34, textAlign: "center", display: "inline-flex", justifyContent: "center" }}>{ch}</span>
                        ))}
                        {timePeriod && <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginLeft: 2, alignSelf: "flex-end", paddingBottom: 8 }}>{timePeriod}</span>}
                      </div>
                      {secBar}
                    </div>
                  ),
                  verbose: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, borderLeft: `3px solid ${C.accent}`, background: C.bg, padding: "14px 10px 10px", alignItems: "flex-start" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1, marginBottom: 3 }}>
                        {nowDate.toLocaleDateString([], { weekday: "long" })}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 400, color: C.faint, fontFamily: NC_FONT_STACK, marginBottom: 10 }}>
                        {nowDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, lineHeight: 1, marginBottom: 4 }}>
                        <span style={{ fontSize: 34, fontWeight: 300, color: C.text, letterSpacing: -0.5 }}>{timeDigits}</span>
                        {timePeriod && <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{timePeriod}</span>}
                      </div>
                      {secBar}
                    </div>
                  ),
                  word: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "18px 10px 10px", gap: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: 2, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 10 }}>
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
                      <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginTop: 2 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                    </div>
                  ),
                  neon: (
                    <div aria-label="Current time" onContextMenu={openMenu} style={{ ...base, border: `1px solid ${C.divider}`, background: C.bg, padding: "16px 8px 10px", gap: 4 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 10 }}>
                        {nowDate.toLocaleDateString([], { weekday: "short" })} · {nowDate.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, lineHeight: 1 }}>
                        <span style={{ fontSize: 40, fontWeight: 700, color: C.accent, letterSpacing: -1, textShadow: `0 0 14px ${C.accent}70, 0 0 30px ${C.accent}38` }}>{timeDigits}</span>
                        {timePeriod && <span style={{ fontSize: 14, fontWeight: 700, color: C.accent, opacity: 0.72, textShadow: `0 0 10px ${C.accent}55` }}>{timePeriod}</span>}
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
                    <button onClick={toggleTimeline} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "3px 0 4px", border: "none", background: "transparent", cursor: "pointer" }}>
                      <span style={{ fontSize: 8, fontWeight: 700, color: clockTimelineOpen ? C.muted : C.faint, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK }}>
                        {clockTimelineOpen ? "▲ timeline" : "▼ timeline"}
                      </span>
                    </button>
                    <button className="nc-hover-actions" onClick={e => { e.stopPropagation(); setClockMenuPos({ x: e.clientX, y: e.clientY }); }}
                      title="Change clock style"
                      style={{ position: "absolute", top: 5, right: 5, width: 20, height: 20, borderRadius: 3, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.faint, padding: 0, lineHeight: 1 }}>
                      ···
                    </button>
                  </div>
                );
              })()}

              {/* ── Gmail card ── */}
              {(gmailMessages !== null || (googleLoading && googleToken)) && (
                <div className="nc-card-group" style={cardWrap}>
                  <div style={cardHead}>
                    <span style={headLabel}>{suiteIcon("mail", 11)} Mail</span>
                    <div className="nc-card-action" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {googleLoading && <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${T.tFaint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />}
                      <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" title="Open Gmail"
                         style={{ fontSize: 14, color: T.tFaint, textDecoration: "none", opacity: .6, lineHeight: 1 }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .6}>↗</a>
                      <button onClick={onRefreshCalendar || onConnectGoogle} title="Refresh mail and calendar" style={{ fontSize: 14, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .6, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .6}>↺</button>
                    </div>
                  </div>
                  <div style={cardBody}>
                    {!gmailMessages ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap:8 }}>
                        <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                        <span style={{ fontSize: NC_TYPE.meta, color: T.tFaint, fontFamily: NC_FONT_STACK }}>Loading mail…</span>
                      </div>
                    ) : gmailMessages.length === 0 ? (
                      <p style={{ fontSize: NC_TYPE.meta, color: T.tFaint, fontFamily: NC_FONT_STACK, margin: "12px 0", textAlign: "center" }}>Inbox zero 🎉</p>
                    ) : (
                      <React.Fragment>
                      {gmailMessages.map((msg, i) => {
                      const subject = gmailHeader(msg, 'Subject') || '(no subject)';
                      const from = fmtFrom(gmailHeader(msg, 'From'));
                      const date = fmtTime(gmailHeader(msg, 'Date'));
                      const url = `https://mail.google.com/mail/u/0/#inbox/${msg.id}`;
                      const selected = selectedEmailId === msg.id;
                      return (
                        <React.Fragment key={msg.id || i}>
                        <div className="nc-action-row"
                          style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: isStacked ? "5px 2px" : "8px 4px", borderRadius: 4, background: selected ? (T.bgW || 'rgba(255,255,255,0.05)') : "transparent" }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = T.bgW || 'rgba(255,255,255,0.05)';
                            clearTimeout(hoverTimerRef.current);
                            hoverTimerRef.current = setTimeout(() => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoverEmail({ id: msg.id, top: rect.bottom + 6, left: rect.left, from: gmailHeader(msg, 'From'), subject, snippet: msg.snippet || '' });
                            }, 400);
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent';
                            clearTimeout(hoverTimerRef.current);
                            setHoverEmail(null);
                            if (selectedEmailId !== msg.id) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <button type="button" onClick={() => handleEmailSelect(msg)}
                            style={{ flex: 1, minWidth: 0, minHeight: 0, border: "none", background: "transparent", color: "inherit", textAlign: "left", padding: 0, cursor: "pointer", fontFamily: NC_FONT_STACK }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                              <span style={{ fontSize: NC_TYPE.control, fontWeight: 500, color: C.text, fontFamily: NC_FONT_STACK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{from}</span>
                              <span style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK, flexShrink: 0 }}>{date}</span>
                            </div>
                            <span style={{ fontSize: NC_TYPE.meta, color: C.muted, fontFamily: NC_FONT_STACK, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word", lineHeight: 1.4 }}>{msg.aiSummary || decodeSnippet(msg.snippet) || subject}</span>
                          </button>
                          <a href={url} target="_blank" rel="noopener noreferrer" title="Open in Gmail"
                            className="nc-hover-actions"
                            style={{ color: C.faint, textDecoration: "none", fontSize: NC_TYPE.meta, lineHeight: 1.4, padding: "1px 2px", flexShrink: 0 }}
                            onClick={e => e.stopPropagation()}>↗</a>
                        </div>
                        {selected && selectedEmailSource && (
                          <div style={{ margin: "2px 0 8px", padding: "10px 10px 11px", borderRadius: 6, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, fontFamily: NC_FONT_STACK }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: NC_TYPE.control, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gmailHeader(selectedEmailSource, 'Subject') || '(no subject)'}</div>
                                <div style={{ fontSize: NC_TYPE.meta, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{fmtFrom(gmailHeader(selectedEmailSource, 'From'))}</div>
                              </div>
                              <button type="button" onClick={() => { setSelectedEmailId(null); setEmailDetailError(""); }}
                                title="Close message"
                                style={{ width: 24, height: 24, minHeight: 0, border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>x</button>
                            </div>
                            {emailDetailLoadingId === selectedEmailId ? (
                              <div style={{ display: "flex", alignItems: "center", gap:8, fontSize: NC_TYPE.meta, color: C.muted }}>
                                <div style={{ width: 11, height: 11, borderRadius: "50%", border: `2px solid ${C.muted}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                                Loading full message...
                              </div>
                            ) : emailDetailError ? (
                              <div style={{ fontSize: NC_TYPE.meta, color: C.danger }}>{emailDetailError}</div>
                            ) : (
                              <div style={{ fontSize: NC_TYPE.meta, lineHeight: 1.5, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isStacked ? 150 : 220, overflowY: "auto", paddingRight: 2 }}>
                                {selectedEmailBody || "No message body available."}
                              </div>
                            )}
                          </div>
                        )}
                        </React.Fragment>
                      );
                    })}
                    </React.Fragment>
                    )}
                  </div>
                </div>
              )}
              </div>{/* end cards row */}
            </div>

            {/* ── Gmail hover tooltip ── */}
            {hoverEmail && (
              <div style={{ position: "fixed", top: hoverEmail.top, left: hoverEmail.left, zIndex: 9999, background: T.card, border: `1px solid ${T.brd}`, borderRadius: 10, padding: "10px 14px", maxWidth: 320, boxShadow: "0 8px 28px rgba(0,0,0,0.22)", fontFamily: NC_FONT_STACK, pointerEvents: "none" }}>
                <div style={{ fontSize: NC_TYPE.meta, fontWeight: 500, color: T.tSoft, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtFrom(hoverEmail.from)}</div>
                <div style={{ fontSize: NC_TYPE.control, color: T.text, fontWeight: 500, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hoverEmail.subject}</div>
                {hoverEmail.snippet && <div style={{ fontSize: NC_TYPE.meta, color: T.tFaint, lineHeight: NC_TYPE.line }}>{hoverEmail.snippet}</div>}
              </div>
            )}

            {/* ── Add Event modal ── */}
            {showAddEvent && (
              <div style={{ position: "fixed", inset: 0, zIndex: 9990, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }} onClick={() => { setShowAddEvent(false); setAddEventText(''); setAddEventError(null); }}>
                <div style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, padding: "24px 22px 18px", width: "min(460px,92vw)", boxShadow: "0 12px 32px rgba(60,64,67,0.22)", fontFamily: NC_FONT_STACK }} onClick={e => e.stopPropagation()}>
                  <div style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text, marginBottom: 12 }}>Add Event</div>
                  <textarea autoFocus rows={4}
                    placeholder='e.g. "Speech at BYHSI on Thu May 14 at 12:55pm – 2pm, remind me 30 mins and 1 hr before"'
                    value={addEventText}
                    onChange={e => setAddEventText(e.target.value)}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleAddEvent(); } }}
                    style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, fontSize: NC_TYPE.control, padding: "12px 14px", resize: "none", fontFamily: NC_FONT_STACK, outline: "none", lineHeight: NC_TYPE.line }}
                  />
                  {addEventError && <div style={{ fontSize: NC_TYPE.meta, color: "T.warning", marginTop: 6 }}>{addEventError}</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                    <button onClick={() => { setShowAddEvent(false); setAddEventText(''); setAddEventError(null); }} style={{ padding: "8px 16px", borderRadius: 4, border: `1px solid ${C.divider}`, background: "none", color: C.muted, cursor: "pointer", fontSize: NC_TYPE.control, fontWeight: 500 }}>Cancel</button>
                    <button onClick={handleAddEvent} disabled={addEventLoading || !addEventText.trim()} style={{ padding: "8px 18px", borderRadius: 4, border: "none", background: accentBlue, color: "#fff", cursor: addEventLoading ? "wait" : "pointer", fontSize: NC_TYPE.control, fontWeight: 500, opacity: (!addEventText.trim() || addEventLoading) ? 0.55 : 1 }}>
                      {addEventLoading ? "Adding…" : "Add Event"}
                    </button>
                  </div>
                  <div style={{ fontSize: NC_TYPE.small, color: C.faint, marginTop: 8, textAlign: "right" }}>Cmd/Ctrl+Enter to submit</div>
                </div>
              </div>
            )}
            {/* Clock style picker — opened by right-click on the clock card */}
            {clockMenuPos && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 9090 }} onClick={() => setClockMenuPos(null)} />
                <div onMouseDown={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(clockMenuPos.x, window.innerWidth - 212), top: Math.min(clockMenuPos.y, window.innerHeight - 460), zIndex: 9091, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 10, padding: 6, minWidth: 200, maxHeight: "min(455px, 85vh)", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: NC_FONT_STACK, padding: "6px 8px 4px" }}>Clock Style</div>
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
                      <button key={opt.id} onClick={() => { setClockStyle(opt.id); try { localStorage.setItem("nc_clock_style", opt.id); } catch {} setClockMenuPos(null); }}
                        style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "7px 10px", borderRadius: 7, border: "none", background: active ? C.hover : "transparent", cursor: "pointer", width: "100%", textAlign: "left" }}>
                        <span style={{ fontSize: NC_TYPE.control, fontWeight: active ? 600 : 400, color: active ? C.text : C.muted, fontFamily: NC_FONT_STACK }}>{opt.label}</span>
                        <span style={{ fontSize: 10, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 1 }}>{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            </React.Fragment>
          );
        })()}

        {/* ── Health Card — bottom row, resizable, closeable ── */}
        {!isStacked && healthCardVisible && (
          <div style={{ height: healthCardH, flexShrink: 0, position: "sticky", bottom: 0, zIndex: 2, background: C.bg }}>
            <HealthCard
              C={C}
              healthData={healthData}
              healthHistory={healthHistory}
              healthConfig={healthConfig}
              onOpenHealth={onOpenHealth}
              cardHeight={healthCardH}
              onResizeStart={startHealthResize}
              onDismiss={() => {
                setHealthCardVisible(false);
                try { localStorage.setItem("nc_health_card_visible", "0"); } catch {}
              }}
            />
          </div>
        )}

        {/* Actions drawer */}
        {actionsOpen && (
          <div style={{ position: "fixed", inset: `0 0 0 ${sidebarW}px`, zIndex: 7800, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,0.28)" }} onClick={() => setActionsOpen(false)}>
            <aside onClick={e => e.stopPropagation()} style={{ width: "min(540px,94vw)", height: "100%", background: C.bg, borderLeft: `1px solid ${C.divider}`, boxShadow: "-10px 0 28px rgba(60,64,67,0.18)", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", borderBottom: `1px solid ${C.divider}`, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: NC_TYPE.title, fontWeight: 500, fontFamily: NC_FONT_STACK, color: C.text }}>
                  {suiteIcon("apps", 20)} More Actions
                </div>
                <button onClick={() => setActionsOpen(false)} style={gvIconButton({}, C)}>
                  {suiteIcon("close", 17)}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", minHeight: 0, flex: 1 }}>
                <div style={{ borderRight: `1px solid ${C.divider}`, padding: 12, display: "grid", alignContent: "start", gap: 6, background: C.bgSoft, overflow: "auto" }}>
                  {actionCategories.map(cat => {
                    const isActive = activeActionCategory?.id === cat.id;
                    return (
                      <button key={cat.id} onClick={() => setActionCategoryId(cat.id)}
                        style={{ height: 40, borderRadius: 20, border: "none", background: isActive ? C.hover : "transparent", color: isActive ? C.text : C.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", fontWeight: 500, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.control, textAlign: "left" }}>
                        {suiteIcon(cat.icon, 17)} {cat.title}
                      </button>
                    );
                  })}
                </div>
                <div style={{ padding: 14, overflow: "auto", display: "grid", alignContent: "start", gap: 8 }}>
                  {(activeActionCategory?.actions || []).map(action => (
                    <button key={action.id || action.label} onClick={() => { if (action.disabled) return; setActionsOpen(false); action.run?.(); }} disabled={action.disabled}
                      style={{ minHeight: 48, borderRadius: 8, border: `1px solid ${action.primary ? "transparent" : C.divider}`, background: action.primary ? C.accent : C.bg, color: action.primary ? "#fff" : C.text, cursor: action.disabled ? "default" : "pointer", opacity: action.disabled ? 0.5 : 1, padding: "0 14px", display: "grid", gridTemplateColumns: "32px minmax(0,1fr)", gap: 10, alignItems: "center", fontFamily: NC_FONT_STACK, textAlign: "left" }}>
                      <span style={{ width: 32, height: 32, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: action.primary ? "rgba(255,255,255,0.16)" : C.hover, color: action.primary ? "#fff" : C.muted, flexShrink: 0 }}>{suiteIcon(action.icon, 16)}</span>
                      <span style={{ fontSize: NC_TYPE.control, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

export { nerveSummarySource, compactNerveSummary, nerveDisplaySummary, NerveCenterPanel };
