/**
 * TaskRiverPanel — one calm, auto-prioritized river of everything.
 *
 * A single tightly-spaced list mixing ALL sources (tasks, shailos, calendar, mail),
 * auto-sorted by urgency. One continuous color bar runs down the left edge, blending
 * smoothly from each item's priority color into the next — a flowing river of priority.
 * Reorder by drag, tap-drag, or ▲▼; "Re-prioritize" drops your manual order.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, NC_FONT_STACK } from '../ui-tokens.jsx';
import { isNerveTaskShailaWork } from '../utils/shailosQueue.js';
import { runAIJob } from '../../01-core.js';

// ── color helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return { r: 120, g: 160, b: 175 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgba(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return `rgb(${Math.round(x.r + (y.r - x.r) * t)},${Math.round(x.g + (y.g - x.g) * t)},${Math.round(x.b + (y.b - x.b) * t)})`;
}

const COL_SHAILA = '#5BA8A0';   // teal
const COL_CAL    = '#D9A23B';   // amber
const COL_MAIL   = '#8E86C9';   // indigo
const ORDER_KEY = 'taskriver_order_v1';
const readOrder = () => { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') || []; } catch { return []; } };
const writeOrder = (a) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(a)); } catch {} };

function gmailHeader(msg, name) {
  return (msg?.payload?.headers || []).find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}
function fmtSender(raw) { const m = (raw || '').match(/^"?([^"<]+?)"?\s*(?:<[^>]+>)?$/); return m ? m[1].trim() : (raw || '').split('@')[0]; }
// Terse fallback line (no ellipsis — kept short enough to fit).
function terse(t) { t = (t || '').replace(/\s+/g, ' ').trim(); if (t.length <= 48) return t; const cut = t.slice(0, 48); const sp = cut.lastIndexOf(' '); return sp > 24 ? cut.slice(0, sp) : cut; }

// Lightweight "task analysis" so emails earn their place in the priority stream instead of
// sinking to the bottom: real asks/deadlines/money rise; bulk/no-reply noise sinks.
const RE_ACTION = /\b(please|can you|could you|kindly|need(ed)?|review|approve|confirm|reply|respond|sign|complete|submit|pay|due|deadline|overdue|urgent|asap|action required|requested|waiting on|follow.?up|by (today|tomorrow|mon|tue|wed|thu|fri|sat|sun|\d))\b/i;
const RE_MONEY  = /(\$\s?\d|invoice|payment|past due|balance due|bill|receipt|refund|wire|transfer)/i;
const RE_BULK   = /(no.?reply|do.?not.?reply|donotreply|notification|newsletter|unsubscribe|mailer|digest|noreply|automated|via )/i;
function scoreEmail(m, i) {
  const subj = gmailHeader(m, 'Subject') || '';
  const from = gmailHeader(m, 'From') || '';
  const text = `${m.aiSummary || ''} ${subj} ${m.snippet || ''}`;
  let s = 46;
  if (RE_BULK.test(from) || RE_BULK.test(subj)) s -= 20;
  if (RE_ACTION.test(text) || /\?/.test(subj)) s += 22;
  if (RE_MONEY.test(text)) s += 12;
  s += Math.max(0, 6 - i); // recency nudge (list is newest-first)
  return Math.max(22, Math.min(82, s));
}
function scoreCalendar(startMs, endMs, hasTime, nowMs) {
  if (startMs <= nowMs && endMs >= nowMs) return 94;     // happening now
  if (!hasTime) return 56;                                // all-day today
  const soonH = Math.max(0, (startMs - nowMs) / 3600000);
  return Math.max(50, 88 - soonH * 3.5);                  // sooner = higher
}

// ── build the mixed, scored stream ───────────────────────────────────────────
function buildItems(tasks, shailos, calendarEvents, gmailMessages, priorities, nowMs) {
  const priById = new Map((priorities || []).map(p => [p.id, p]));
  const weights = (priorities || []).filter(p => !p.deleted).map(p => Number(p.weight) || 0);
  const maxW = weights.length ? Math.max(...weights) : 1;
  const norm = (w) => maxW ? (Number(w) || 0) / maxW : 0;   // 0..1
  const items = [];

  (tasks || []).forEach(t => {
    if (!t || t.completed || t.deleted || isNerveTaskShailaWork(t)) return;
    const pri = priById.get(t.priority);
    items.push({
      id: t.id, type: 'task', icon: '◆',
      text: (t.ncSummary || t.text || 'Untitled').trim(),
      meta: '', // manual priority label hidden — the river auto-prioritizes
      color: pri?.color || '#8FB7C9',
      score: (t.pinned ? 100 : 0) + 35 + norm(pri?.weight) * 55,
      dreason: t.pinned ? 'pinned' : '',
      pinned: !!t.pinned, raw: t,
    });
  });

  (shailos || []).forEach(s => {
    if (!s || s.deleted || s.completed || s.status === 'answered') return;
    const getBack = s.status === 'get_back' || !!s.isGetBackStep;
    items.push({
      id: s.id, type: 'shaila', icon: '?',
      text: (s.synopsis || s.text || s.content || 'Open shaila').trim(),
      meta: getBack ? 'waiting to reply' : 'pending answer',
      color: COL_SHAILA, score: getBack ? 52 : 72, dreason: getBack ? 'follow up' : 'awaiting', raw: s,
    });
  });

  (calendarEvents || []).forEach(e => {
    if (!e || e.status === 'cancelled') return;
    const startMs = new Date(e.start?.dateTime || e.start?.date || 0).getTime();
    const endMs = new Date(e.end?.dateTime || e.end?.date || 0).getTime();
    if (endMs && endMs < nowMs) return; // past
    const soonH = Math.max(0, (startMs - nowMs) / 3600000);
    const inProgress = startMs <= nowMs && endMs >= nowMs;
    const when = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'All day';
    items.push({
      id: 'cal_' + (e.id || startMs), type: 'calendar', icon: '◷',
      text: (e.summary || '(untitled event)').trim(), meta: when,
      color: COL_CAL, score: scoreCalendar(startMs, endMs, !!e.start?.dateTime, nowMs), dreason: inProgress ? 'in progress' : 'upcoming', raw: e,
    });
  });

  (gmailMessages || []).slice(0, 12).forEach((m, i) => {
    if (!m) return;
    const subj = gmailHeader(m, 'Subject') || '(no subject)';
    const from = gmailHeader(m, 'From') || '';
    const mt = `${m.aiSummary || ''} ${subj} ${m.snippet || ''}`;
    const dreason = (RE_BULK.test(from) || RE_BULK.test(subj)) ? 'fyi' : RE_MONEY.test(mt) ? 'payment' : (RE_ACTION.test(mt) || /\?/.test(subj)) ? 'needs reply' : '';
    items.push({
      id: 'mail_' + (m.id || i), type: 'mail', icon: '✉',
      text: (m.aiSummary || subj).trim(), meta: fmtSender(from),
      color: COL_MAIL, score: scoreEmail(m, i), dreason, raw: m,
    });
  });

  return items;
}

function applyOrder(items, order) {
  const byId = new Map(items.map(i => [i.id, i]));
  const seen = new Set(); const out = [];
  (order || []).forEach(id => { const it = byId.get(id); if (it) { out.push(it); seen.add(id); } });
  return [...out, ...items.filter(i => !seen.has(i.id)).sort((a, b) => b.score - a.score)];
}

export function TaskRiverPanel({
  T, tasks = [], shailos = [], calendarEvents = null, gmailMessages = null,
  priorities = [], aiOpts = null, sidebarW = 64, topOffset = 0, clockTime,
  onCompleteTask, onOpenTasks, onOpenShailos, onOpenPhone,
}) {
  const C = cleanTheme(T);
  const now = clockTime instanceof Date ? clockTime : new Date(clockTime || Date.now());
  const nowMs = now.getTime();

  const items = useMemo(
    () => buildItems(tasks, shailos, calendarEvents, gmailMessages, priorities, nowMs),
    [tasks, shailos, calendarEvents, gmailMessages, priorities, Math.floor(nowMs / 60000)]
  );

  // ── AI ranking ──────────────────────────────────────────────────────────────
  // Each item is scored 0-100 by the river_rank AI job (deadlines, asks, money, sender,
  // event proximity). The deterministic score from buildItems is the instant fallback and
  // the safety net if the gateway is slow/down, so the river is never broken or blank.
  const [aiMeta, setAiMeta] = useState({}); // id -> { score, label, reason }
  const [aiState, setAiState] = useState('idle'); // idle | ranking | ok | error
  const rankInFlight = useRef(false);
  const lastRankKeyRef = useRef('');
  const rankKey = useMemo(() => items.map(i => i.id).join('|'), [items]);

  useEffect(() => {
    if (!items.length) { setAiState('idle'); return; }
    if (rankInFlight.current) return;
    if (lastRankKeyRef.current === rankKey && Object.keys(aiMeta).length) { setAiState('ok'); return; }
    rankInFlight.current = true;
    setAiState('ranking');
    let settled = false;
    const settle = (state, meta) => {
      if (settled) return; settled = true; rankInFlight.current = false;
      if (meta) { setAiMeta(meta); lastRankKeyRef.current = rankKey; }
      setAiState(state);
    };
    // Watchdog: the river always falls back to its own order; never claim "AI prioritizing"
    // longer than this if the gateway is slow/unreachable.
    const watchdog = setTimeout(() => settle('error'), 16000);
    const payload = items.map(i => ({ id: i.id, type: i.type, text: (i.text || '').slice(0, 200), meta: i.meta || '' }));
    runAIJob('dashboard.river_rank.v1', { items: payload, currentTime: now.toLocaleString() }, aiOpts || {}, { genConfig: { temperature: 0.1, maxOutputTokens: 1400 } })
      .then(job => {
        const ranking = job?.output?.ranking;
        if (Array.isArray(ranking) && ranking.length) {
          const map = {}; ranking.forEach(r => { if (r && r.id != null) map[r.id] = { score: r.score, label: r.label, reason: r.reason }; });
          settle('ok', map);
        } else { settle('error'); }
      })
      .catch(() => settle('error'))
      .finally(() => clearTimeout(watchdog));
    return () => clearTimeout(watchdog);
  }, [rankKey, aiOpts]); // eslint-disable-line react-hooks/exhaustive-deps
  // attach AI score (fallback to heuristic), terse line text, and a short reason tag

  // AI score overrides the deterministic fallback once it arrives.
  const scoredItems = useMemo(
    () => items.map(i => {
      const m = aiMeta[i.id];
      return { ...i, score: m && m.score != null ? m.score : i.score, line: (m && m.label) || terse(i.text), reason: (m && m.reason) || i.dreason || '' };
    }),
    [items, aiMeta]
  );

  const [order, setOrder] = useState(readOrder);
  const ordered = useMemo(() => applyOrder(scoredItems, order), [scoredItems, order]);
  const manual = (order || []).length > 0;
  const [dragId, setDragId] = useState(null);
  useEffect(() => { writeOrder(order); }, [order]);

  const ids = () => ordered.map(i => i.id);
  const move = (id, dir) => {
    const a = ids(); const i = a.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; setOrder(a);
  };
  const dropBefore = (drag, target) => {
    if (drag === target) return;
    const a = ids().filter(x => x !== drag); const t = a.indexOf(target);
    if (t < 0) a.push(drag); else a.splice(t, 0, drag); setOrder(a);
  };
  const reprioritize = () => setOrder([]);

  const onHandleDown = (id) => (e) => {
    e.preventDefault(); e.stopPropagation(); setDragId(id);
    const mv = (ev) => {
      const pt = ev.touches?.[0] || ev;
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const row = el?.closest?.('[data-river-row]');
      const over = row?.getAttribute('data-river-row');
      if (over && over !== id) dropBefore(id, over);
    };
    const up = () => {
      setDragId(null);
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      window.removeEventListener('touchmove', mv); window.removeEventListener('touchend', up);
    };
    window.addEventListener('pointermove', mv, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('touchmove', mv, { passive: false });
    window.addEventListener('touchend', up);
  };

  const act = (it) => { if (it.type === 'task') onCompleteTask?.(it.id); else if (it.type === 'shaila') onOpenShailos?.(); else if (it.type === 'mail') window.open('https://mail.google.com/mail/u/0/#inbox/' + (it.raw?.id || ''), '_blank'); else if (it.type === 'calendar') window.open('https://calendar.google.com/calendar/r', '_blank'); };

  // One continuous left bar: a vertical gradient through every item's color, in order.
  const riverGradient = ordered.length
    ? `linear-gradient(to bottom, ${ordered.map((it, i) => `${rgba(it.color, 0.85)} ${(i / Math.max(1, ordered.length - 1)) * 100}%`).join(', ')})`
    : rgba(COL_SHAILA, 0.4);

  const supercrunch = ordered.slice(0, 7).map(i => i.text.replace(/\s+/g, ' ').slice(0, 38)).join('  ·  ');

  const waterBg = {
    background: `
      radial-gradient(120% 55% at 18% -8%, ${rgba('#7FC6D9', 0.06)} 0%, transparent 60%),
      radial-gradient(120% 65% at 92% 108%, ${rgba('#4F9AA6', 0.07)} 0%, transparent 55%),
      linear-gradient(180deg, ${C.bg} 0%, ${mix(C.bg, '#16323a', 0.08)} 100%)`,
  };

  return (
    <div style={{
      position: 'fixed', top: topOffset, left: sidebarW, right: 0, bottom: 0, zIndex: 7600,
      display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.divider}`,
      overflow: 'hidden', ...waterBg,
    }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: '14px clamp(14px,3vw,32px) 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 23, fontWeight: 300, letterSpacing: -0.5, color: C.text, fontFamily: NC_FONT_STACK }}>The River</span>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: NC_FONT_STACK }}>
            {ordered.length} items · {aiState === 'ranking' ? 'AI prioritizing…' : aiState === 'error' ? 'auto-prioritized' : 'AI-prioritized'}
          </span>
          <button onClick={reprioritize} disabled={!manual} title="Drop manual order; let priority flow again"
            style={{ marginLeft: 'auto', fontSize: 12, fontFamily: NC_FONT_STACK, fontWeight: 500, color: manual ? '#fff' : C.faint, background: manual ? rgba(COL_SHAILA, 0.9) : 'transparent', border: `1px solid ${manual ? rgba(COL_SHAILA, 0.9) : C.divider}`, borderRadius: 16, padding: '4px 12px', cursor: manual ? 'pointer' : 'default' }}>
            ↻ Re-prioritize
          </button>
        </div>
        {supercrunch && (
          <div style={{ fontSize: 12.5, color: C.muted, fontFamily: NC_FONT_STACK, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{supercrunch}</div>
        )}
      </div>

      {/* The stream — tightly spaced rows with one flowing color bar on the left */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', padding: '2px clamp(8px,2vw,24px) 40px' }}>
        {ordered.length === 0 ? (
          <div style={{ padding: '50px 20px', textAlign: 'center', color: C.faint, fontFamily: NC_FONT_STACK, fontSize: 15 }}>The river is still. Nothing waiting.</div>
        ) : (
          <div style={{ position: 'relative', paddingLeft: 16 }}>
            {/* the one long blended river bar */}
            <div aria-hidden style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 7, borderRadius: 5, background: riverGradient, boxShadow: `0 0 0 1px ${rgba('#000', 0.04)}` }} />
            {ordered.map((it, idx) => {
              const isDrag = dragId === it.id;
              return (
                <div key={it.id} data-river-row={it.id} onClick={() => act(it)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8,
                    padding: '3px 6px 3px 10px', minHeight: 26, cursor: 'pointer', borderRadius: 7,
                    background: isDrag ? rgba(it.color, 0.12) : 'transparent', transition: 'background .12s' }}>
                  <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 7, overflow: 'hidden' }}>
                    {it.meta && <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, fontFamily: NC_FONT_STACK, flexShrink: 0, whiteSpace: 'nowrap' }}>{it.meta}</span>}
                    <span style={{ fontSize: 13, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
                      {it.pinned && <span style={{ color: it.color, marginRight: 4 }}>★</span>}{it.line}
                    </span>
                    {it.reason && <span style={{ fontSize: 10, color: C.faint, fontFamily: NC_FONT_STACK, fontStyle: 'italic', flexShrink: 0, whiteSpace: 'nowrap', marginLeft: 'auto', paddingLeft: 6 }}>{it.reason}</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onPointerDown={onHandleDown(it.id)} onTouchStart={onHandleDown(it.id)} title="Drag to reorder" style={{ ...mini(C, false), cursor: 'grab', touchAction: 'none', fontSize: 14 }}>⠿</button>
                    {it.type === 'task' && <button onClick={() => act(it)} title="Done" style={{ ...mini(C, false), color: it.color, fontSize: 14 }}>✓</button>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function mini(C, disabled) {
  return { width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent',
    color: disabled ? C.faint : C.muted, opacity: disabled ? 0.3 : 0.85, cursor: disabled ? 'default' : 'pointer',
    fontSize: 9, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: NC_FONT_STACK };
}
