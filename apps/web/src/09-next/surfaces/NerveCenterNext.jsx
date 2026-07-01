import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, SP, RADIUS, ICON, suiteIcon, NC_FONT_STACK } from '../../08-app-split/ui-tokens.jsx';
import { ActionBtn, IconBtn, List, ListItem, FilterChip, ChipSet, TextField, denseListVars } from '../../08-app-split/m3.jsx';
import { buildNerveShailaRows } from '../../08-app-split/utils/shailosQueue.js';
import { Card, CountPill, EmptyState, QuickBar, IconPuck, tonal, FONT, NEXT_RADIUS } from '../system/kit.jsx';

// ═════════════════════════════════════════════════════════════════════════════
// NerveCenterNext — the from-scratch Material 3 (Expressive) NerveCenter.
//
// This is PURE PRESENTATION. It takes the exact same props contract App already
// hands the legacy NerveCenterPanel (data + every on* handler) and rebuilds the
// UI from nothing on the 09-next design kit. Every button is wired to the real
// backend handler that App passes in — no backend/data logic lives here. App
// swaps in this surface only when ?ui=next is set, so production is untouched.
// ═════════════════════════════════════════════════════════════════════════════

const displayText = (t) => String(t?.ncSummary || t?.text || '').trim() || 'Untitled';

function greeting(h) {
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

// StatPill — a labelled figure for the hero at-a-glance strip.
function StatPill({ icon, label, value, color, C, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: SP.sm,
        padding: `7px 13px 7px 10px`, border: 'none', cursor: onClick ? 'pointer' : 'default',
        borderRadius: RADIUS.pill, background: tonal(color || C.muted, 0.12), fontFamily: FONT,
      }}
      title={label}
    >
      <span style={{ color: color || C.muted, display: 'inline-flex' }}>{suiteIcon(icon, 16)}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 12, color: C.muted, lineHeight: 1 }}>{label}</span>
    </button>
  );
}

export default function NerveCenterNext(props) {
  const {
    T, tasks = [], shailos = [], priorities = [], sidebarW = 0, topOffset = 0,
    onAddTask, onAddMrsWTask, onCompleteTask, onDeleteTask, onEditTask,
    onOpenTasks, onOpenQueue, onOpenZen, onOpenBrainDump, onOpenBulkAdd, onOpenShatter,
    onOpenShailos, onOpenShailaAdd, onOpenShailaFollowup, onRecordShaila,
    onRecordConversation, onRecordCall, onOpenPhone, onOnlineChange,
    calendarEvents, gmailMessages, googleToken, googleLoading, onConnectGoogle,
    onRefreshCalendar, onOpenGoogleSettings, googleWasConnected,
    chiefProfile, onOpenChiefPage, healthData, onOpenHealth, onSyncHealth,
    onPolishNerveItems,
  } = props;

  const C = useMemo(() => cleanTheme(T), [T]);

  // ── Live clock (self-contained, zero cloud cost) ──────────────────────────
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Priority helpers ──────────────────────────────────────────────────────
  const priById = useMemo(() => new Map(priorities.map((p) => [p.id, p])), [priorities]);
  const workPriorities = useMemo(() => priorities.filter((p) => !p.isShaila && !p.deleted), [priorities]);
  const defaultPriId = workPriorities.find((p) => p.id === 'now')?.id || workPriorities[0]?.id || 'now';

  // ── Derived task/shaila rows ──────────────────────────────────────────────
  const isShaila = (t) => t?._nerveKind === 'shaila' || t?.type === 'shailo-research' || t?.type === 'shaila-research' || !!t?.shailaId || !!t?.isGetBackStep;
  const primaryTasks = useMemo(() => tasks.filter((t) => !t.completed && !isShaila(t)), [tasks]);
  const shailaRows = useMemo(() => buildNerveShailaRows(tasks, priorities, shailos), [tasks, priorities, shailos]);

  const [priFilter, setPriFilter] = useState('all');
  const filteredTasks = useMemo(
    () => (priFilter === 'all' ? primaryTasks : primaryTasks.filter((t) => t.priority === priFilter)),
    [primaryTasks, priFilter]
  );
  const countByPri = useMemo(() => {
    const m = {};
    primaryTasks.forEach((t) => { m[t.priority] = (m[t.priority] || 0) + 1; });
    return m;
  }, [primaryTasks]);

  // ── Task composer ─────────────────────────────────────────────────────────
  const [draft, setDraft] = useState('');
  const [composerPri, setComposerPri] = useState(defaultPriId);
  const [mrsW, setMrsW] = useState(false);
  useEffect(() => { if (!priById.has(composerPri)) setComposerPri(defaultPriId); }, [defaultPriId]); // eslint-disable-line

  const submitTask = () => {
    const text = draft.trim();
    if (!text) return;
    if (mrsW && onAddMrsWTask) onAddMrsWTask(text, composerPri);
    else onAddTask?.(text, composerPri);
    setDraft('');
  };

  // ── Inline task edit ──────────────────────────────────────────────────────
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const commitEdit = (t) => {
    const v = editText.trim();
    if (v && v !== t.text) onEditTask?.(t.id, v);
    setEditId(null);
  };

  // ── Phone reachability (same loopback pipe main.jsx uses) ──────────────────
  const [phoneOnline, setPhoneOnline] = useState(false);
  useEffect(() => {
    let alive = true;
    const ping = () => {
      fetch('http://127.0.0.1:8765/status', { cache: 'no-store' })
        .then((r) => r.ok)
        .then((ok) => { if (alive) { setPhoneOnline(ok); onOnlineChange?.(ok); } })
        .catch(() => { if (alive) { setPhoneOnline(false); onOnlineChange?.(false); } });
    };
    ping();
    const id = setInterval(ping, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []); // eslint-disable-line

  // ── Google derived ────────────────────────────────────────────────────────
  const googleConnected = !!googleToken;
  const upcomingEvents = useMemo(() => {
    const list = Array.isArray(calendarEvents) ? calendarEvents : [];
    return list.slice(0, 4);
  }, [calendarEvents]);
  const unreadEmails = useMemo(() => {
    const list = Array.isArray(gmailMessages) ? gmailMessages : [];
    return list.slice(0, 4);
  }, [gmailMessages]);

  // ── At-a-glance figures ───────────────────────────────────────────────────
  const nowCount = primaryTasks.filter((t) => t.priority === 'now').length;
  const todayCount = primaryTasks.filter((t) => t.priority === 'today').length;
  const openShailos = shailaRows.length;

  const clock = {
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    date: now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
  };

  const denseVars = denseListVars({ primary: C.text, secondary: C.muted, hover: tonal(C.accent, 0.08) });

  // ── Task row renderer ─────────────────────────────────────────────────────
  const renderTaskRow = (t) => {
    const pri = priById.get(t.priority);
    const color = pri?.color || C.accent;
    if (editId === t.id) {
      return (
        <div key={t.id} style={{ padding: `2px ${SP.sm}` }}>
          <TextField
            value={editText}
            autoFocus
            style={{ width: '100%', '--md-outlined-text-field-container-shape': RADIUS.sm }}
            onInput={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(t); if (e.key === 'Escape') setEditId(null); }}
            onChange={() => commitEdit(t)}
          />
        </div>
      );
    }
    return (
      <ListItem
        key={t.id}
        type="button"
        onClick={() => { setEditId(t.id); setEditText(t.text || ''); }}
        style={{ borderRadius: RADIUS.sm, '--md-list-item-leading-space': SP.sm }}
      >
        <span slot="start" style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 0 3px ${tonal(color, 0.16)}` }} />
        <span style={{ fontSize: 13.5, color: C.text, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText(t)}</span>
        <span slot="supporting-text" style={{ color, fontSize: 11, fontWeight: 600 }}>
          {pri?.label || 'Task'}{t.mrsW ? ' · Mrs. W' : ''}
        </span>
        <span slot="end" style={{ display: 'inline-flex', gap: 2 }}>
          <IconBtn icon="check_circle" iconSize={18} size={34} color={C.success} title="Complete"
            onClick={(e) => { e.stopPropagation(); onCompleteTask?.(t.id); }} />
          <IconBtn icon="delete_outline" iconSize={17} size={34} color={C.faint} title="Delete"
            onClick={(e) => { e.stopPropagation(); onDeleteTask?.(t.id); }} />
        </span>
      </ListItem>
    );
  };

  // ── Shaila row renderer ───────────────────────────────────────────────────
  const renderShailaRow = (s) => {
    const gold = priById.get('shaila')?.color || '#C8A84C';
    const isGetBack = s.status === 'get_back';
    return (
      <ListItem key={s.id} type="button" onClick={onOpenShailos} style={{ borderRadius: RADIUS.sm, '--md-list-item-leading-space': SP.sm }}>
        <span slot="start"><IconPuck icon={isGetBack ? 'reply' : 'help'} color={gold} size={30} iconSize={16} /></span>
        <span style={{ fontSize: 13.5, color: C.text, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText(s)}</span>
        <span slot="supporting-text" style={{ color: isGetBack ? C.warning : gold, fontSize: 11, fontWeight: 600 }}>
          {isGetBack ? 'Get back to asker' : 'Researching'}
        </span>
        <span slot="end" style={{ color: C.faint, display: 'inline-flex' }}>{suiteIcon('chevron_right', 18)}</span>
      </ListItem>
    );
  };

  // ── Card grid ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed', top: topOffset, left: sidebarW, right: 0, bottom: 0,
        zIndex: 7600, background: C.bgSoft, overflow: 'auto', overscrollBehavior: 'contain',
        borderLeft: `1px solid ${C.divider}`, fontFamily: NC_FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: `${SP.xl} ${SP.xl} 64px`, display: 'flex', flexDirection: 'column', gap: SP.xl }}>

        {/* ── Hero header ──────────────────────────────────────────────── */}
        <header style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: SP.lg, justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, letterSpacing: '0.02em' }}>{greeting(now.getHours())}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: SP.md, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', color: C.text, fontVariantNumeric: 'tabular-nums' }}>{clock.time}</h1>
              <span style={{ fontSize: 15, color: C.muted }}>{clock.date}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' }}>
            <StatPill icon="bolt" label="Now" value={nowCount} color={priById.get('now')?.color} C={C} onClick={onOpenTasks} />
            <StatPill icon="today" label="Today" value={todayCount} color={priById.get('today')?.color} C={C} onClick={onOpenTasks} />
            <StatPill icon="help" label="Shailos" value={openShailos} color={priById.get('shaila')?.color} C={C} onClick={onOpenShailos} />
            <StatPill icon={phoneOnline ? 'smartphone' : 'mobile_off'} label={phoneOnline ? 'Online' : 'Offline'} value="" color={phoneOnline ? C.success : C.faint} C={C} onClick={onOpenPhone} />
            {onPolishNerveItems && (
              <ActionBtn variant="tonal" icon="auto_awesome" onClick={onPolishNerveItems} title="Polish items with AI">Polish</ActionBtn>
            )}
          </div>
        </header>

        {/* ── Responsive card grid ─────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: SP.lg, alignItems: 'start' }}>

          {/* Tasks — the hero card (spans wide) */}
          <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
            <Card
              icon="checklist" title="Tasks" count={primaryTasks.length} C={C}
              actions={<>
                <IconBtn icon="bolt" iconSize={18} size={36} color={C.muted} title="Zen focus" onClick={onOpenZen} />
                <IconBtn icon="open_in_full" iconSize={17} size={36} color={C.muted} title="Open task list" onClick={onOpenTasks} />
              </>}
            >
              {/* Priority filter chips */}
              <div style={{ padding: `0 ${SP.xs} ${SP.sm}` }}>
                <ChipSet>
                  <FilterChip label={`All ${primaryTasks.length}`} selected={priFilter === 'all'} onClick={() => setPriFilter('all')} />
                  {workPriorities.map((p) => (
                    <FilterChip
                      key={p.id}
                      label={`${p.label} ${countByPri[p.id] || 0}`}
                      selected={priFilter === p.id}
                      onClick={() => setPriFilter(p.id)}
                      style={{ '--md-filter-chip-selected-container-color': tonal(p.color, 0.2) }}
                    />
                  ))}
                </ChipSet>
              </div>

              {/* Task list */}
              <div style={{ maxHeight: 420, overflow: 'auto', overscrollBehavior: 'contain' }}>
                {filteredTasks.length === 0
                  ? <EmptyState icon="task_alt" text={priFilter === 'all' ? 'No open tasks — you are clear.' : 'Nothing in this lane.'} C={C} />
                  : <List style={denseVars}>{filteredTasks.map(renderTaskRow)}</List>}
              </div>

              {/* Composer */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, paddingTop: SP.md, marginTop: 'auto' }}>
                <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center' }}>
                  <TextField
                    value={draft}
                    placeholder="Add a task…"
                    style={{ flex: 1, '--md-outlined-text-field-container-shape': RADIUS.pill }}
                    onInput={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitTask(); }}
                  />
                  <IconBtn icon="add" variant="filled" iconSize={20} size={44} color={C.accent}
                    containerColor={tonal(C.accent, draft.trim() ? 1 : 0.14)} title="Add task" onClick={submitTask} />
                </div>
                <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                  <ChipSet>
                    {workPriorities.map((p) => (
                      <FilterChip key={p.id} label={p.label} selected={composerPri === p.id} onClick={() => setComposerPri(p.id)}
                        style={{ '--md-filter-chip-selected-container-color': tonal(p.color, 0.2) }} />
                    ))}
                  </ChipSet>
                  <FilterChip label="Mrs. W" selected={mrsW} onClick={() => setMrsW((v) => !v)} style={{ marginLeft: 'auto' }} />
                </div>
              </div>

              <QuickBar>
                <ActionBtn variant="text" icon="playlist_add" onClick={onOpenBulkAdd} title="Bulk add">Bulk</ActionBtn>
                <ActionBtn variant="text" icon="psychology" onClick={onOpenBrainDump} title="Brain dump">Brain dump</ActionBtn>
                <ActionBtn variant="text" icon="grain" onClick={onOpenShatter} title="Shatter a big task">Shatter</ActionBtn>
                <ActionBtn variant="text" icon="list_alt" onClick={onOpenQueue} title="Open queue">Queue</ActionBtn>
              </QuickBar>
            </Card>
          </div>

          {/* Shailos */}
          <Card
            icon="help" title="Shailos" count={openShailos} accent={priById.get('shaila')?.color} C={C}
            actions={<IconBtn icon="add" iconSize={18} size={36} color={C.muted} title="Add shaila" onClick={onOpenShailaAdd} />}
          >
            <div style={{ maxHeight: 340, overflow: 'auto', overscrollBehavior: 'contain' }}>
              {shailaRows.length === 0
                ? <EmptyState icon="task_alt" text="No open shailos." C={C} />
                : <List style={denseVars}>{shailaRows.map(renderShailaRow)}</List>}
            </div>
            <QuickBar>
              <ActionBtn variant="text" icon="mic" onClick={onRecordShaila} title="Record a shaila">Record</ActionBtn>
              <ActionBtn variant="text" icon="event_repeat" onClick={onOpenShailaFollowup} title="Follow-ups">Follow-up</ActionBtn>
              <ActionBtn variant="text" icon="open_in_full" onClick={onOpenShailos} title="Open shailos">Open</ActionBtn>
            </QuickBar>
          </Card>

          {/* Phone */}
          <Card
            icon="smartphone" title="Phone" accent={phoneOnline ? C.success : C.faint} C={C}
            headerRight={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: phoneOnline ? C.success : C.faint, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: phoneOnline ? C.success : C.faint }} />
              {phoneOnline ? 'This PC' : 'Offline'}
            </span>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, padding: `${SP.sm} ${SP.xs}` }}>
              <ActionBtn variant="tonal" icon="dialpad" onClick={onOpenPhone} title="Open phone">Open DeskPhone</ActionBtn>
              <div style={{ display: 'flex', gap: SP.sm }}>
                <ActionBtn variant="outlined" icon="call" onClick={onRecordCall} title="Record a call" style={{ flex: 1 }}>Record call</ActionBtn>
                <ActionBtn variant="outlined" icon="graphic_eq" onClick={onRecordConversation} title="Record a conversation" style={{ flex: 1 }}>Conversation</ActionBtn>
              </div>
            </div>
          </Card>

          {/* Google */}
          <Card
            icon="calendar_month" title="Calendar & Mail" accent="#3D6CB5" C={C}
            actions={googleConnected ? <>
              <IconBtn icon="refresh" iconSize={18} size={36} color={C.muted} title="Refresh" onClick={onRefreshCalendar} />
              <IconBtn icon="settings" iconSize={17} size={36} color={C.muted} title="Google settings" onClick={onOpenGoogleSettings} />
            </> : null}
          >
            {!googleConnected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md, padding: SP.md, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, color: C.muted }}>
                  {googleWasConnected ? 'Google session expired — reconnect to see your day.' : 'Connect Google to see calendar and mail.'}
                </span>
                <ActionBtn variant="filled" icon="link" onClick={onConnectGoogle} title="Connect Google">Connect Google</ActionBtn>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, maxHeight: 300, overflow: 'auto' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em', padding: `0 ${SP.sm}` }}>Next up</div>
                {upcomingEvents.length === 0
                  ? <span style={{ fontSize: 12.5, color: C.faint, padding: `0 ${SP.sm} ${SP.sm}` }}>{googleLoading ? 'Loading…' : 'Nothing on the calendar.'}</span>
                  : upcomingEvents.map((ev, i) => {
                      const start = ev?.start?.dateTime || ev?.start?.date || ev?.start;
                      const label = start ? new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
                      return (
                        <div key={ev?.id || i} style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: `4px ${SP.sm}` }}>
                          <span style={{ width: 3, alignSelf: 'stretch', minHeight: 20, borderRadius: 2, background: '#3D6CB5' }} />
                          <span style={{ flex: 1, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev?.summary || '(no title)'}</span>
                          <span style={{ fontSize: 11.5, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
                        </div>
                      );
                    })}
                {unreadEmails.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em', padding: `${SP.sm} ${SP.sm} 0` }}>Inbox</div>
                )}
                {unreadEmails.map((m, i) => (
                  <div key={m?.id || i} style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: `2px ${SP.sm}` }}>
                    <span style={{ color: C.faint, display: 'inline-flex' }}>{suiteIcon('mail', 15)}</span>
                    <span style={{ flex: 1, fontSize: 12.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m?.subject || m?.snippet || '(no subject)'}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Chief + Health */}
          <Card icon="hub" title="Command" C={C}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, padding: `${SP.sm} ${SP.xs}` }}>
              <button onClick={onOpenChiefPage} style={tileStyle(C)} title="Open Chief of Staff">
                <IconPuck icon="smart_toy" color={C.accent} />
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: C.text }}>Chief of Staff</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{chiefProfile ? 'Profile ready' : 'AI planning & profile'}</span>
                </span>
                <span style={{ color: C.faint, display: 'inline-flex' }}>{suiteIcon('chevron_right', 18)}</span>
              </button>
              <button onClick={onOpenHealth} style={tileStyle(C)} title="Open Health">
                <IconPuck icon="favorite" color={C.danger} />
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: C.text }}>Health</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{healthData ? 'Synced' : 'Steps, sleep & vitals'}</span>
                </span>
                {onSyncHealth && <IconBtn icon="sync" iconSize={16} size={32} color={C.muted} title="Sync now" onClick={(e) => { e.stopPropagation(); onSyncHealth(); }} />}
              </button>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}

function tileStyle(C) {
  return {
    display: 'flex', alignItems: 'center', gap: SP.md, width: '100%',
    padding: SP.sm, border: 'none', background: 'transparent', cursor: 'pointer',
    borderRadius: NEXT_RADIUS.inner, fontFamily: FONT,
  };
}
