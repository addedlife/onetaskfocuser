/**
 * TaskRiverPanel — a unified temporal stream of all data sources.
 *
 * Design philosophy: one scrolling column, everything sorted by urgency
 * to the current moment. No cards. No source-based sections. Typography
 * and a 2px left-rule color are the only structural signals.
 *
 * Sections (temporal buckets):
 *   NOW        — things happening or urgent right this instant
 *   TODAY      — calendar left today, today-priority tasks, open shailos, mail
 *   COMING UP  — upcoming events beyond today
 *
 * Clicking any row opens a detail pane from the right without losing the stream.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, NC_FONT_STACK } from '../ui-tokens.jsx';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function gmailHeader(msg, name) {
  return (msg?.payload?.headers || []).find(
    h => h.name?.toLowerCase() === name.toLowerCase()
  )?.value || '';
}

function fmtSender(raw) {
  if (!raw) return '';
  const m = raw.match(/^"?([^"<]+?)"?\s*(?:<[^>]+>)?$/);
  return m ? m[1].trim() : raw.split('@')[0];
}

function fmtClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(date) {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
}

function relDay(date, now) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const n = new Date(now);  n.setHours(0, 0, 0, 0);
  const diff = Math.round((d - n) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7)  return new Date(date).toLocaleDateString([], { weekday: 'long' });
  return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtAgo(date, now) {
  if (!date) return '';
  const ms = now - date;
  if (ms < 0) return '';
  if (ms < 3600000)  return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

// Hebrew year lookup — same rosh-hashana table as NerveCenterPanel
const ROSH_H = [
  { y: 5785, d: new Date(2024, 9, 2)  },
  { y: 5786, d: new Date(2025, 8, 22) },
  { y: 5787, d: new Date(2026, 8, 11) },
  { y: 5788, d: new Date(2027, 9, 1)  },
  { y: 5789, d: new Date(2028, 8, 20) },
  { y: 5790, d: new Date(2029, 8, 10) },
];
function hebrewYear(date) {
  for (let i = 0; i < ROSH_H.length - 1; i++) {
    if (date >= ROSH_H[i].d && date < ROSH_H[i + 1].d) return ROSH_H[i].y;
  }
  return ROSH_H[1].y;
}

// ─── rAF-driven sweep bar (same pattern as NerveCenterPanel) ─────────────────
function SweepBar({ duration, getOffset, color, opacity = 0.38 }) {
  const barRef = useRef(null);
  const getOffRef = useRef(getOffset);
  useEffect(() => { getOffRef.current = getOffset; });
  useEffect(() => {
    let raf;
    const tick = () => {
      if (barRef.current) {
        const frac = Math.min((getOffRef.current() % duration) / duration, 1);
        const fade = frac > 0.97 ? Math.max(0, (1 - frac) / 0.03) : 1;
        barRef.current.style.transform = `scaleX(${frac})`;
        barRef.current.style.opacity   = String(opacity * fade);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: 'relative', height: 2, borderRadius: 1, background: 'rgba(128,128,128,0.1)', overflow: 'hidden', flex: 1 }}>
      <div
        ref={barRef}
        style={{ position: 'absolute', inset: 0, borderRadius: 1, background: color, transformOrigin: 'left center', transform: 'scaleX(0)', opacity: 0 }}
      />
    </div>
  );
}

// ─── Accent colours by source type ────────────────────────────────────────────
const TYPE_ACCENT = {
  event:  '#3B82F6',  // blue   — calendar
  task:   '#EF4444',  // red    — now-priority tasks
  taskT:  '#F59E0B',  // amber  — today tasks
  taskS:  'rgba(128,128,128,0.28)', // subtle — soon / backlog
  shaila: '#8B5CF6',  // violet — shailos
  email:  'transparent',
  call:   '#10B981',  // green  — phone
  text:   '#6B7280',  // gray   — texts
};

// ─── Main panel ───────────────────────────────────────────────────────────────

export function TaskRiverPanel({
  T,
  tasks        = [],
  shailos      = [],
  calendarEvents = null,
  gmailMessages  = null,
  googleToken,
  sidebarW     = 64,
  topOffset    = 0,
  clockTime,
  priorities   = [],
  onCompleteTask,
  onOpenTasks,
  onOpenShailos,
  onOpenPhone,
  onLoadEmailDetail,
}) {
  const C   = cleanTheme(T);
  const now = useMemo(() => {
    const d = clockTime instanceof Date ? clockTime : new Date(clockTime || Date.now());
    return Number.isFinite(d.getTime()) ? d : new Date();
  }, [clockTime]);

  // Detail pane state
  const [selected,       setSelected]       = useState(null);  // { type, id, raw }
  const [emailBody,      setEmailBody]      = useState('');
  const [emailLoading,   setEmailLoading]   = useState(false);
  const [emailError,     setEmailError]     = useState('');

  // Load email body when an email row is selected
  useEffect(() => {
    if (selected?.type !== 'email') {
      setEmailBody('');
      setEmailLoading(false);
      setEmailError('');
      return;
    }
    if (!onLoadEmailDetail) return;
    setEmailBody('');
    setEmailLoading(true);
    setEmailError('');
    onLoadEmailDetail(selected.raw.id)
      .then(data => {
        // Extract plain-text body from Gmail payload recursively
        const extractBody = (payload) => {
          if (!payload) return '';
          if (payload.mimeType === 'text/plain' && payload.body?.data) {
            try { return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
          }
          for (const part of payload.parts || []) {
            const r = extractBody(part);
            if (r) return r;
          }
          return '';
        };
        const body = extractBody(data?.payload) || data?.snippet || '';
        setEmailBody(body);
        setEmailLoading(false);
      })
      .catch(err => {
        setEmailError(err?.message || 'Could not load message.');
        setEmailLoading(false);
      });
  }, [selected?.raw?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Time header values ──────────────────────────────────────────────────────
  const hYear = hebrewYear(now);
  let hMonthName = '';
  try { hMonthName = new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'long' }).format(now); } catch {}

  const gregYrStart = new Date(now.getFullYear(), 0, 1);
  const gregYrFrac  = (now - gregYrStart) / (new Date(now.getFullYear() + 1, 0, 1) - gregYrStart);

  // Sweep offsets — always read fresh time for rAF callbacks
  const getSecOfDay = () => {
    const n = new Date();
    return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds() + n.getMilliseconds() / 1000;
  };
  const getSecOfHr = () => {
    const n = new Date();
    return n.getMinutes() * 60 + n.getSeconds() + n.getMilliseconds() / 1000;
  };

  // ── Stream builder ──────────────────────────────────────────────────────────
  const entries = useMemo(() => {
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

    const nowBucket      = [];
    const todayBucket    = [];
    const upcomingBucket = [];

    // ── Calendar events ──────────────────────────────────────────────────────
    if (Array.isArray(calendarEvents)) {
      for (const evt of calendarEvents) {
        if (!evt?.start) continue;
        const start = evt.start.dateTime
          ? new Date(evt.start.dateTime)
          : new Date(evt.start.date);
        const end = evt.end?.dateTime
          ? new Date(evt.end.dateTime)
          : (evt.end?.date ? new Date(evt.end.date) : new Date(start.getTime() + 3600000));

        const happening = start <= now && end > now;
        const laterToday = !happening && start > now && start <= todayEnd;
        const upcoming   = start > todayEnd;

        const base = {
          type: 'event',
          id:    evt.id || `evt-${start.getTime()}`,
          time:  start,
          end,
          title: evt.summary || '(no title)',
          sub:   evt.location || null,
          accent: TYPE_ACCENT.event,
          raw:   evt,
        };

        if (happening)   nowBucket.push({ ...base, tag: `ends ${fmtClock(end)}` });
        else if (laterToday) todayBucket.push({ ...base, tag: fmtClock(start) });
        else if (upcoming)   upcomingBucket.push({ ...base, tag: relDay(start, now) });
      }
    }

    // ── Tasks ────────────────────────────────────────────────────────────────
    const nowPriIds = new Set(
      priorities.filter(p => p.id === 'now' || p.level === 0 || p.level === 1).map(p => p.id)
    );
    nowPriIds.add('now');
    const todayPriIds = new Set(
      priorities.filter(p => p.id === 'today' || p.level === 2).map(p => p.id)
    );
    todayPriIds.add('today');

    for (const task of tasks) {
      if (task.completed || task.deleted || task.parked || task.archived) continue;
      const pId    = task.priority || task.priorityId || '';
      const isNow  = nowPriIds.has(pId);
      const isToday = !isNow && todayPriIds.has(pId);
      const display = task.ncSummary || task.frontSummary || task.text || 'Task';

      const base = {
        type:   'task',
        id:     task.id,
        time:   null,
        title:  display,
        sub:    null,
        raw:    task,
      };

      if (isNow) {
        nowBucket.push({ ...base, accent: TYPE_ACCENT.task, tag: 'now' });
      } else if (isToday) {
        todayBucket.push({ ...base, accent: TYPE_ACCENT.taskT, tag: 'today' });
      } else {
        todayBucket.push({ ...base, accent: TYPE_ACCENT.taskS, tag: '' });
      }
    }

    // ── Shailos ──────────────────────────────────────────────────────────────
    for (const s of shailos) {
      if (s.completed || s.archived || s.dismissed) continue;
      todayBucket.push({
        type:   'shaila',
        id:     s.id,
        time:   null,
        title:  s.shaila || s.question || s.text || 'Shaila',
        sub:    s.answerSummary || null,
        accent: TYPE_ACCENT.shaila,
        raw:    s,
        tag:    'shaila',
      });
    }

    // ── Emails ───────────────────────────────────────────────────────────────
    if (Array.isArray(gmailMessages)) {
      for (const msg of gmailMessages.slice(0, 7)) {
        const from    = fmtSender(gmailHeader(msg, 'From'));
        const subject = gmailHeader(msg, 'Subject') || '(no subject)';
        const dateStr = gmailHeader(msg, 'Date');
        const date    = dateStr ? new Date(dateStr) : null;

        todayBucket.push({
          type:   'email',
          id:     msg.id,
          time:   date,
          title:  from,
          sub:    msg.aiSummary || subject,
          accent: TYPE_ACCENT.email,
          raw:    msg,
          tag:    date ? fmtAgo(date, now) : '',
        });
      }
    }

    // ── Sort today bucket: events first (chronological), then tasks, then shailos, then email ──
    const typeOrder = { event: 0, task: 1, shaila: 2, email: 3 };
    todayBucket.sort((a, b) => {
      const to = typeOrder[a.type] - typeOrder[b.type];
      if (to !== 0) return to;
      if (a.time && b.time) return a.time - b.time;
      if (a.time) return -1;
      if (b.time) return  1;
      return 0;
    });

    // Sort upcoming chronologically, cap at 6
    upcomingBucket.sort((a, b) => (a.time || 0) - (b.time || 0));

    return {
      now:      nowBucket,
      today:    todayBucket,
      upcoming: upcomingBucket.slice(0, 6),
    };
  }, [tasks, shailos, calendarEvents, gmailMessages, now, priorities]);

  // ── Entry renderer ───────────────────────────────────────────────────────────
  const isSel = (e) => selected && selected.type === e.type && selected.id === e.id;

  const timeLabel = (entry) => {
    if (!entry.time) return null;
    const t = entry.time;
    const label = isSameDay(t, now)
      ? fmtClock(t)
      : t.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return (
      <span style={{
        fontSize: 9, color: C.faint, fontFamily: NC_FONT_STACK,
        width: 44, textAlign: 'right', flexShrink: 0,
        letterSpacing: 0.2, lineHeight: 1.3, paddingTop: 1,
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    );
  };

  const renderEntry = (entry) => {
    const sel = isSel(entry);
    const titleWeight = entry.type === 'event' ? 500
      : (entry.tag === 'now' ? 600 : 400);
    const titleColor = (entry.type === 'email' && !sel) ? C.muted : C.text;

    return (
      <div
        key={`${entry.type}-${entry.id}`}
        className="nc-action-row"
        onClick={() => setSelected(sel ? null : { type: entry.type, id: entry.id, raw: entry.raw })}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 0,
          paddingLeft: 10,
          borderLeft: `2px solid ${entry.accent}`,
          marginLeft: 2,
          cursor: 'pointer',
          background: sel ? (T.bgW || 'rgba(120,120,120,0.07)') : 'transparent',
          borderRadius: sel ? '0 5px 5px 0' : '0 3px 3px 0',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (!sel) e.currentTarget.style.background = T.bgW || 'rgba(120,120,120,0.04)'; }}
        onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
      >
        {timeLabel(entry)}
        <div style={{ flex: 1, minWidth: 0, padding: '7px 6px 7px 10px' }}>
          <div style={{
            fontSize: 12, fontWeight: titleWeight, color: titleColor,
            fontFamily: NC_FONT_STACK, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {entry.title}
          </div>
          {entry.sub && (
            <div style={{
              fontSize: 10, color: C.faint, fontFamily: NC_FONT_STACK,
              lineHeight: 1.3, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {entry.sub}
            </div>
          )}
        </div>
        {entry.tag && (
          <span style={{
            fontSize: 9, color: C.faint, fontFamily: NC_FONT_STACK,
            flexShrink: 0, padding: '8px 4px 0 0',
            letterSpacing: 0.3, whiteSpace: 'nowrap',
          }}>
            {entry.tag}
          </span>
        )}
      </div>
    );
  };

  // ── Section divider ──────────────────────────────────────────────────────────
  const Section = ({ label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0 7px 2px', flexShrink: 0 }}>
      <span style={{
        fontSize: 8, fontWeight: 700, color: C.faint, fontFamily: NC_FONT_STACK,
        letterSpacing: 2, textTransform: 'uppercase', flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'rgba(128,128,128,0.12)' }} />
    </div>
  );

  // ── Detail pane ──────────────────────────────────────────────────────────────
  const renderDetail = () => {
    if (!selected) return null;
    const { type, raw } = selected;

    if (type === 'task') {
      return (
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.45 }}>
            {raw.text || raw.ncSummary || 'Task'}
          </div>
          {raw.ncSummary && raw.text && raw.ncSummary !== raw.text && (
            <div style={{ fontSize: 11, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.55, paddingTop: 2 }}>
              {raw.text}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {onCompleteTask && (
              <button
                onClick={() => { onCompleteTask(raw.id); setSelected(null); }}
                style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: C.accent, border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontFamily: NC_FONT_STACK }}
              >
                ✓  Done
              </button>
            )}
            {onOpenTasks && (
              <button
                onClick={onOpenTasks}
                style={{ fontSize: 12, color: C.muted, background: 'none', border: `1px solid ${C.divider}`, borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontFamily: NC_FONT_STACK }}
              >
                Open Tasks →
              </button>
            )}
          </div>
        </div>
      );
    }

    if (type === 'email') {
      const subject = gmailHeader(raw, 'Subject') || '(no subject)';
      const from    = gmailHeader(raw, 'From') || '';
      const dateStr = gmailHeader(raw, 'Date');
      const url     = `https://mail.google.com/mail/u/0/#inbox/${raw.id}`;
      return (
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 10, height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.4 }}>{subject}</div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: NC_FONT_STACK }}>{fmtSender(from)}</div>
          {dateStr && (
            <div style={{ fontSize: 10, color: C.faint, fontFamily: NC_FONT_STACK }}>
              {new Date(dateStr).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
          <a href={url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.accent, fontFamily: NC_FONT_STACK, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            ↗  Open in Gmail
          </a>
          <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', marginTop: 6 }}>
            {emailLoading ? (
              <span style={{ fontSize: 11, color: C.faint, fontFamily: NC_FONT_STACK }}>Loading…</span>
            ) : emailError ? (
              <span style={{ fontSize: 11, color: C.danger || '#EF4444', fontFamily: NC_FONT_STACK }}>{emailError}</span>
            ) : (
              <div style={{ fontSize: 12, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {emailBody || raw.aiSummary || raw.snippet || '(no preview)'}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (type === 'event') {
      const start = raw.start?.dateTime ? new Date(raw.start.dateTime) : (raw.start?.date ? new Date(raw.start.date) : null);
      const end   = raw.end?.dateTime   ? new Date(raw.end.dateTime)   : (raw.end?.date   ? new Date(raw.end.date)   : null);
      return (
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.4 }}>
            {raw.summary || '(no title)'}
          </div>
          {start && (
            <div style={{ fontSize: 12, color: C.muted, fontFamily: NC_FONT_STACK }}>
              {start.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' })}
              {'  '}
              {fmtClock(start)}
              {end ? ` – ${fmtClock(end)}` : ''}
            </div>
          )}
          {raw.location && (
            <div style={{ fontSize: 11, color: C.faint, fontFamily: NC_FONT_STACK }}>
              📍 {raw.location}
            </div>
          )}
          {raw.description && (
            <div style={{ fontSize: 12, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {raw.description}
            </div>
          )}
          {raw.htmlLink && (
            <a href={raw.htmlLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: C.accent, fontFamily: NC_FONT_STACK, textDecoration: 'none', marginTop: 4 }}>
              ↗  Open in Calendar
            </a>
          )}
        </div>
      );
    }

    if (type === 'shaila') {
      return (
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.45 }}>
            {raw.shaila || raw.question || raw.text || 'Shaila'}
          </div>
          {(raw.answerSummary || raw.answer) && (
            <div style={{ fontSize: 12, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.6 }}>
              {raw.answerSummary || raw.answer}
            </div>
          )}
          {onOpenShailos && (
            <button onClick={onOpenShailos}
              style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: 12, color: C.muted, background: 'none', border: `1px solid ${C.divider}`, borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
              Open Shailos →
            </button>
          )}
        </div>
      );
    }

    return null;
  };

  // ── Layout ───────────────────────────────────────────────────────────────────
  const hasDetail   = !!selected;
  const streamWidth = hasDetail ? 'clamp(260px, 38%, 400px)' : '100%';

  const allEmpty = entries.now.length === 0 && entries.today.length === 0 && entries.upcoming.length === 0;

  return (
    <div style={{
      position: 'fixed',
      inset: `${topOffset}px 0 0 ${sidebarW}px`,
      zIndex: 7600,
      background: C.bg,
      borderLeft: `1px solid ${C.divider}`,
      display: 'flex',
      flexDirection: 'row',
      overflow: 'hidden',
      fontFamily: NC_FONT_STACK,
    }}>

      {/* ══ Stream column ════════════════════════════════════════════════════ */}
      <div style={{
        width: streamWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        borderRight: hasDetail ? `1px solid ${C.divider}` : 'none',
        transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Time header — slim strip, not a card */}
        <div style={{ flexShrink: 0, padding: '16px 18px 12px', borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: C.text, fontFamily: NC_FONT_STACK, letterSpacing: 0.2 }}>
              {fmtDate(now)}
            </span>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: NC_FONT_STACK, letterSpacing: 0.2 }}>
              {fmtClock(now)}
            </span>
          </div>
          {/* Hebrew year line */}
          <div style={{ fontSize: 9, color: C.faint, fontFamily: NC_FONT_STACK, letterSpacing: 0.5, marginBottom: 8, opacity: 0.8 }}>
            {hMonthName && `${hMonthName} · `}{hYear}
          </div>
          {/* Day and hour sweep bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 8, color: C.faint, fontFamily: NC_FONT_STACK, width: 26, textAlign: 'right', flexShrink: 0, letterSpacing: 0.5 }}>day</span>
              <SweepBar duration={86400} getOffset={getSecOfDay} color={C.accent} opacity={0.45} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 8, color: C.faint, fontFamily: NC_FONT_STACK, width: 26, textAlign: 'right', flexShrink: 0, letterSpacing: 0.5 }}>hr</span>
              <SweepBar duration={3600} getOffset={getSecOfHr} color={C.muted} opacity={0.3} />
            </div>
          </div>
        </div>

        {/* Stream body */}
        <div style={{ flex: '1 1 0', overflowY: 'auto', overflowX: 'hidden', padding: '0 16px 32px', overscrollBehavior: 'contain' }}>

          {allEmpty && (
            <div style={{ paddingTop: 64, textAlign: 'center', color: C.faint, fontSize: 12, fontFamily: NC_FONT_STACK, lineHeight: 1.7 }}>
              Connect Google and add some tasks<br />to start the river flowing.
            </div>
          )}

          {entries.now.length > 0 && (
            <>
              <Section label="Now" />
              {entries.now.map(renderEntry)}
            </>
          )}

          {entries.today.length > 0 && (
            <>
              <Section label="Today" />
              {entries.today.map(renderEntry)}
            </>
          )}

          {entries.upcoming.length > 0 && (
            <>
              <Section label="Coming up" />
              {entries.upcoming.map(renderEntry)}
            </>
          )}

        </div>
      </div>

      {/* ══ Detail pane ══════════════════════════════════════════════════════ */}
      {hasDetail && (
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          background: C.bgSoft || C.bg,
        }}>
          {/* Pane header */}
          <div style={{
            flexShrink: 0,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 16px',
            borderBottom: `1px solid ${C.divider}`,
          }}>
            <button
              onClick={() => setSelected(null)}
              title="Close"
              style={{ fontSize: 20, color: C.faint, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px', fontFamily: NC_FONT_STACK }}
            >
              ×
            </button>
          </div>
          {/* Pane content */}
          <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {renderDetail()}
          </div>
        </div>
      )}

    </div>
  );
}
