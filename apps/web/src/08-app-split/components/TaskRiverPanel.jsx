/**
 * TaskRiverPanel — one calm river of everything, prioritized ONLY by AI.
 *
 * A single tightly-spaced list mixing all sources (tasks, shailos, calendar, mail).
 * Ordering, the terse line, and the short reason come exclusively from the river_rank AI
 * job — there is no heuristic "guessing" of priority or intent (that would fabricate
 * assessments the data doesn't support). When the AI is unavailable the river is honest:
 * it lists the items in their plain source order and says "AI unavailable", with no
 * invented priority or reasons. One continuous color bar runs down the left edge.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, ICON, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon } from '../ui-tokens.jsx';
import { isNerveTaskShailaWork } from '../utils/shailosQueue.js';
import { runAIJob } from '../../01-core.js';

const RANK_LAST_RUN_KEY = 'ot_river_rank_last_run_v1';
const RANK_MIN_GAP_MS = 4 * 60 * 1000; // 4-min cross-tab throttle

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

const COL_TASK   = '#8FB7C9';   // steel blue — all tasks, one color
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
// Shorten the item's OWN text (authentic — not a generated summary) when no AI label exists.
function clip(t) { t = (t || '').replace(/\s+/g, ' ').trim(); if (t.length <= 60) return t; const cut = t.slice(0, 60); const sp = cut.lastIndexOf(' '); return sp > 30 ? cut.slice(0, sp) : cut; }

// ── collect the items (NO priority/scoring assumptions — that is the AI's job) ──
function buildItems(tasks, shailos, calendarEvents, gmailMessages, _priorities, nowMs) {
  const items = [];

  (tasks || []).forEach(t => {
    if (!t || t.completed || t.deleted || isNerveTaskShailaWork(t)) return;
    items.push({
      id: t.id, type: 'task',
      text: (t.ncSummary || t.text || 'Untitled').trim(),
      meta: '', color: COL_TASK,
      pinned: !!t.pinned, raw: t,
    });
  });

  (shailos || []).forEach(s => {
    if (!s || s.deleted || s.completed || s.status === 'answered') return;
    const getBack = s.status === 'get_back' || !!s.isGetBackStep;
    items.push({
      id: s.id, type: 'shaila',
      text: (s.synopsis || s.text || s.content || 'Open shaila').trim(),
      meta: getBack ? 'waiting to reply' : 'pending answer', color: COL_SHAILA, raw: s,
    });
  });

  (calendarEvents || []).forEach(e => {
    if (!e || e.status === 'cancelled') return;
    const startMs = new Date(e.start?.dateTime || e.start?.date || 0).getTime();
    const endMs = new Date(e.end?.dateTime || e.end?.date || 0).getTime();
    if (endMs && endMs < nowMs) return; // past
    const when = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'All day';
    items.push({
      id: 'cal_' + (e.id || startMs), type: 'calendar',
      text: (e.summary || '(untitled event)').trim(), meta: when, color: COL_CAL, raw: e,
    });
  });

  (gmailMessages || []).slice(0, 25).forEach((m, i) => {
    if (!m) return;
    items.push({
      id: 'mail_' + (m.id || i), type: 'mail',
      text: (m.aiSummary || gmailHeader(m, 'Subject') || '(no subject)').trim(),
      meta: fmtSender(gmailHeader(m, 'From')), color: COL_MAIL, raw: m,
    });
  });

  return items;
}

// Manual (user) order wins. Otherwise: AI score order when present; else plain source order.
function applyOrder(items, order, aiMeta) {
  const byId = new Map(items.map(i => [i.id, i]));
  const seen = new Set(); const out = [];
  (order || []).forEach(id => { const it = byId.get(id); if (it) { out.push(it); seen.add(id); } });
  const rest = items.filter(i => !seen.has(i.id));
  const hasAi = rest.some(i => aiMeta[i.id] && aiMeta[i.id].score != null);
  if (hasAi) {
    rest.sort((a, b) => ((aiMeta[b.id]?.score ?? -1) - (aiMeta[a.id]?.score ?? -1)));
  } else {
    // No AI yet — interleave by type so no single source dominates the top or bottom.
    const buckets = {};
    rest.forEach(i => { (buckets[i.type] = buckets[i.type] || []).push(i); });
    const lanes = Object.values(buckets);
    rest.length = 0;
    for (let r = 0; lanes.some(l => r < l.length); r++) {
      lanes.forEach(l => { if (r < l.length) rest.push(l[r]); });
    }
  }
  return [...out, ...rest];
}

export function TaskRiverPanel({
  T, tasks = [], shailos = [], calendarEvents = null, gmailMessages = null,
  priorities = [], aiOpts = null, sidebarW = 64, topOffset = 0, clockTime,
  visible = true,
  onCompleteTask, onOpenTasks, onOpenShailos, onOpenPhone,
}) {
  const C = cleanTheme(T);
  const now = clockTime instanceof Date ? clockTime : new Date(clockTime || Date.now());
  const nowMs = now.getTime();

  const items = useMemo(
    () => buildItems(tasks, shailos, calendarEvents, gmailMessages, priorities, nowMs),
    [tasks, shailos, calendarEvents, gmailMessages, priorities, Math.floor(nowMs / 60000)]
  );

  // ── AI ranking ─────────────────────────────────────────────────────────────────
  const [aiMeta, setAiMeta] = useState({}); // id -> { score, label, reason }
  const [aiState, setAiState] = useState('idle'); // idle | ranking | ok | error
  const [retryIn, setRetryIn] = useState(null); // seconds until auto-retry, null = none pending
  const [rankNonce, setRankNonce] = useState(0); // increment to force a fresh rank
  const rankInFlight = useRef(false);
  const lastRankKeyRef = useRef('');
  const retryTimerRef = useRef(null);
  const retryCountdownRef = useRef(null);
  const retryStreakRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const rankKey = useMemo(() => items.map(i => i.id).join('|'), [items]);

  function cancelRetry() {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (retryCountdownRef.current) { clearInterval(retryCountdownRef.current); retryCountdownRef.current = null; }
    setRetryIn(null);
  }
  function scheduleRetry(delaySec) {
    cancelRetry();
    setRetryIn(delaySec);
    retryCountdownRef.current = setInterval(() => setRetryIn(t => (t === null ? null : Math.max(0, t - 1))), 1000);
    retryTimerRef.current = setTimeout(() => {
      clearInterval(retryCountdownRef.current); retryCountdownRef.current = null;
      retryTimerRef.current = null; setRetryIn(null);
      lastRankKeyRef.current = ''; setRankNonce(n => n + 1);
    }, delaySec * 1000);
  }
  // Cleanup on unmount
  useEffect(() => () => { // eslint-disable-line react-hooks/exhaustive-deps
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (retryCountdownRef.current) clearInterval(retryCountdownRef.current);
  }, []);

  useEffect(() => {
    if (!items.length) { setAiState('idle'); return; }
    if (rankInFlight.current) return;
    if (lastRankKeyRef.current === rankKey && Object.keys(aiMeta).length) { setAiState('ok'); return; }
    // 4-second startup delay on first call so snapshot.v1 gets the first flash-lite slot.
    const elapsed = Date.now() - mountedAtRef.current;
    if (elapsed < 4000 && retryStreakRef.current === 0 && !Object.keys(aiMeta).length) {
      const t = setTimeout(() => setRankNonce(n => n + 1), 4000 - elapsed);
      return () => clearTimeout(t);
    }
    // Cross-tab throttle: skip if another tab ranked recently AND this isn't a retry or
    // a user-forced reprioritize (reprioritize() clears lastRankKeyRef to signal forced).
    const isUserForced = lastRankKeyRef.current === '';
    const sinceLastRank = Date.now() - Number(localStorage.getItem(RANK_LAST_RUN_KEY) || 0);
    if (!isUserForced && retryStreakRef.current === 0 && sinceLastRank < RANK_MIN_GAP_MS) {
      const t = setTimeout(() => setRankNonce(n => n + 1), RANK_MIN_GAP_MS - sinceLastRank + 500);
      return () => clearTimeout(t);
    }
    // New content or forced retry — cancel any waiting countdown and rank now
    cancelRetry();
    rankInFlight.current = true;
    setAiState('ranking');
    let settled = false;
    const settle = (state, meta) => {
      if (settled) return; settled = true; rankInFlight.current = false;
      if (meta) {
        try { localStorage.setItem(RANK_LAST_RUN_KEY, String(Date.now())); } catch {}
        setAiMeta(meta); lastRankKeyRef.current = rankKey; retryStreakRef.current = 0;
      } else if (state === 'error') {
        retryStreakRef.current += 1;
        scheduleRetry(Math.min(90, 20 * retryStreakRef.current));
      }
      setAiState(state);
    };
    const watchdog = setTimeout(() => settle('error'), 29000);
    const payload = items.map(i => ({ id: i.id, type: i.type, text: (i.text || '').slice(0, 200), meta: i.meta || '' }));
    runAIJob('dashboard.river_rank.v1', { items: payload, currentTime: now.toLocaleString() }, aiOpts || {}, { genConfig: { temperature: 0.1, maxOutputTokens: 8192 } })
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
  }, [rankKey, aiOpts, rankNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const [order, setOrder] = useState(readOrder);
  useEffect(() => { writeOrder(order); }, [order]);
  const ordered = useMemo(() => applyOrder(items, order, aiMeta), [items, order, aiMeta]);
  const manual = (order || []).length > 0;
  const aiOn = aiState === 'ok';

  // Display values come ONLY from the AI; with no AI we show the item's own (real) text and
  // no reason — never an invented one.
  const view = useMemo(() => ordered.map(it => ({
    ...it,
    line: (aiMeta[it.id]?.label) || clip(it.text),
    reason: aiOn ? (aiMeta[it.id]?.reason || '') : '',
  })), [ordered, aiMeta, aiOn]);

  const [dragId, setDragId] = useState(null);
  const ids = () => view.map(i => i.id);
  const dropBefore = (drag, target) => {
    if (drag === target) return;
    const a = ids().filter(x => x !== drag); const t = a.indexOf(target);
    if (t < 0) a.push(drag); else a.splice(t, 0, drag); setOrder(a);
  };
  const reprioritize = () => {
    setOrder([]);
    cancelRetry();
    retryStreakRef.current = 0;
    lastRankKeyRef.current = '';
    setRankNonce(n => n + 1);
  };
  const onHandleDown = (id) => (e) => {
    e.preventDefault(); e.stopPropagation(); setDragId(id);
    const mv = (ev) => {
      const pt = ev.touches?.[0] || ev;
      const row = document.elementFromPoint(pt.clientX, pt.clientY)?.closest?.('[data-river-row]');
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
  const act = (it) => {
    if (it.type === 'task') onCompleteTask?.(it.id);
    else if (it.type === 'shaila') onOpenShailos?.();
    else if (it.type === 'mail') window.open('https://mail.google.com/mail/u/0/#inbox/' + (it.raw?.id || ''), '_blank');
    else if (it.type === 'calendar') window.open('https://calendar.google.com/calendar/r', '_blank');
  };

  const riverGradient = view.length
    ? `linear-gradient(to bottom, ${view.map((it, i) => `${rgba(it.color, 0.85)} ${(i / Math.max(1, view.length - 1)) * 100}%`).join(', ')})`
    : rgba(COL_SHAILA, 0.4);

  const statusText = retryIn !== null
    ? `AI restrained — retry in ${retryIn}s`
    : aiState === 'ranking' ? 'AI prioritizing…'
    : aiState === 'ok' ? 'AI-prioritized'
    : aiState === 'error' ? 'AI unavailable'
    : '';
  const waterBg = {
    background: `
      radial-gradient(120% 55% at 18% -8%, ${rgba('#7FC6D9', 0.06)} 0%, transparent 60%),
      radial-gradient(120% 65% at 92% 108%, ${rgba('#4F9AA6', 0.07)} 0%, transparent 55%),
      linear-gradient(180deg, ${C.bg} 0%, ${mix(C.bg, '#16323a', 0.08)} 100%)`,
  };

  return (
    <div style={{
      position: 'fixed', top: topOffset, left: sidebarW, right: 0, bottom: 0, zIndex: 7600,
      display: visible ? 'flex' : 'none', flexDirection: 'column', borderLeft: `1px solid ${C.divider}`,
      overflow: 'hidden', ...waterBg,
    }}>
      <div style={{ flexShrink: 0, padding: '14px clamp(14px,3vw,32px) 8px', display: 'flex', alignItems: 'baseline', gap: SP.sm, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 23, fontWeight: 300, letterSpacing: -0.5, color: C.text, fontFamily: NC_FONT_STACK }}>The River</span>
        <span style={{ fontSize: NC_TYPE.meta, color: (retryIn !== null || aiState === 'error') ? (C.warning || '#C8A84C') : C.muted, fontFamily: NC_FONT_STACK }}>{view.length} items · {statusText}</span>
        <button onClick={reprioritize}
          title={manual ? 'Reset manual order and re-rank with AI' : 'Force a fresh AI ranking'}
          style={{ marginLeft: 'auto', fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, fontWeight: 500,
            color: (manual || aiState === 'error' || retryIn !== null) ? '#fff' : C.faint,
            background: (manual || aiState === 'error' || retryIn !== null) ? rgba(COL_SHAILA, 0.9) : 'transparent',
            border: `1px solid ${(manual || aiState === 'error' || retryIn !== null) ? rgba(COL_SHAILA, 0.9) : C.divider}`,
            borderRadius: RADIUS.pill, padding: '4px 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: SP.xs }}>
          {suiteIcon('refresh', ICON.xs)} {(aiState === 'error' || retryIn !== null) ? 'Retry' : 'Re-prioritize'}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', padding: '2px clamp(8px,2vw,24px) 12px' }}>
        {view.length === 0 ? (
          <div style={{ padding: '50px 20px', textAlign: 'center', color: C.faint, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.title }}>The river is still. Nothing waiting.</div>
        ) : (
          <div style={{ position: 'relative', paddingLeft: 14 }}>
            <div aria-hidden style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 7, borderRadius: RADIUS.xs, background: riverGradient, boxShadow: `0 0 0 1px ${rgba('#000', 0.04)}` }} />
            {view.map((it) => {
              const isDrag = dragId === it.id;
              return (
                <div key={it.id} data-river-row={it.id} onClick={() => act(it)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: SP.sm,
                    padding: '3px 6px 3px 10px', minHeight: 26, cursor: 'pointer', borderRadius: RADIUS.sm,
                    background: isDrag ? rgba(it.color, 0.12) : 'transparent', transition: 'background .12s' }}>
                  <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: SP.xs, overflow: 'hidden' }}>
                    {it.meta && <span style={{ fontSize: NC_TYPE.small, fontWeight: 600, color: C.muted, fontFamily: NC_FONT_STACK, flexShrink: 0, whiteSpace: 'nowrap' }}>{it.meta}</span>}
                    <span style={{ fontSize: NC_TYPE.meta, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
                      {it.pinned && <span style={{ color: it.color, marginRight: 4 }}>★</span>}{it.line}
                    </span>
                    {it.reason && <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, fontStyle: 'italic', flexShrink: 0, whiteSpace: 'nowrap', marginLeft: 'auto', paddingLeft: 6 }}>{it.reason}</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onPointerDown={onHandleDown(it.id)} onTouchStart={onHandleDown(it.id)} title="Drag to reorder" style={{ ...mini(C, false), cursor: 'grab', touchAction: 'none' }}>{suiteIcon('drag_indicator', ICON.sm)}</button>
                    {it.type === 'task' && <button onClick={() => act(it)} title="Done" style={{ ...mini(C, false), color: it.color }}>{suiteIcon('check', ICON.sm)}</button>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Color legend */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${rgba('#888', 0.1)}`, padding: '6px clamp(14px,3vw,32px)', display: 'flex', alignItems: 'center', gap: SP.lg, flexWrap: 'wrap' }}>
        <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, letterSpacing: 0.3 }}>Color key</span>
        {[
          { color: COL_TASK,   label: 'Task' },
          { color: COL_SHAILA, label: 'Shaila' },
          { color: COL_CAL,    label: 'Calendar' },
          { color: COL_MAIL,   label: 'Email' },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: SP.xs }}>
            <span style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: color, flexShrink: 0, boxShadow: `0 0 0 1px ${rgba(color, 0.4)}` }} />
            <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function mini(C, disabled) {
  return { width: 22, height: 22, borderRadius: RADIUS.xs, border: 'none', background: 'transparent',
    color: disabled ? C.faint : C.muted, opacity: disabled ? 0.3 : 0.85, cursor: disabled ? 'default' : 'pointer',
    lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: NC_FONT_STACK };
}
