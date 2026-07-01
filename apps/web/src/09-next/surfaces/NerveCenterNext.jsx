import React, { useEffect, useMemo, useState } from 'react';
import { cleanTheme, SP, RADIUS, suiteIcon, NC_FONT_STACK, useViewportWidth } from '../../08-app-split/ui-tokens.jsx';
import { ActionBtn, IconBtn, List, ListItem, FilterChip, ChipSet, TextField, denseListVars } from '../../08-app-split/m3.jsx';
import { buildNerveShailaRows } from '../../08-app-split/utils/shailosQueue.js';
import { Card, EmptyState, QuickBar, IconPuck, tonal, FONT, NEXT_RADIUS } from '../system/kit.jsx';

// ═════════════════════════════════════════════════════════════════════════════
// NerveCenterNext — the from-scratch Material 3 (Expressive) NerveCenter.
//
// Design intent (owner): everything-at-a-glance. All sources live on ONE screen
// with NO page scroll — a fixed-height dashboard grid that fills the viewport;
// only a long list scrolls inside its own card. Pure presentation: it takes the
// same props App hands the legacy NerveCenterPanel and wires every button to the
// real backend handler. App swaps it in only under ?ui=next.
// ═════════════════════════════════════════════════════════════════════════════

const displayText = (t) => String(t?.ncSummary || t?.text || '').trim() || 'Untitled';

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
  const viewportW = useViewportWidth();
  const avail = viewportW - sidebarW;
  const cols = avail >= 1080 ? 3 : avail >= 760 ? 2 : 1;

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
    if (editId !== t.id) return;
    const v = editText.trim();
    setEditId(null);
    if (v && v !== t.text) onEditTask?.(t.id, v);
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
  const upcomingEvents = useMemo(() => (Array.isArray(calendarEvents) ? calendarEvents : []).slice(0, 5), [calendarEvents]);
  const unreadEmails = useMemo(() => (Array.isArray(gmailMessages) ? gmailMessages : []).slice(0, 4), [gmailMessages]);

  const openShailos = shailaRows.length;
  const clock = {
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    date: now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
  };
  const denseVars = denseListVars({ dense: true, primary: C.text, secondary: C.muted, hover: tonal(C.accent, 0.08) });
  const gold = priById.get('shaila')?.color || '#C8A84C';

  // ── Responsive dashboard layout (explicit breakpoints — no overrun) ───────
  let gridStyle = null;
  let place = {};
  if (cols === 3) {
    gridStyle = { gridTemplateColumns: '1.6fr 1fr 1fr', gridTemplateRows: '1fr 1fr' };
    place = {
      tasks: { gridColumn: '1', gridRow: '1 / 3' },
      shailos: { gridColumn: '2', gridRow: '1' },
      calendar: { gridColumn: '3', gridRow: '1' },
      phone: { gridColumn: '2', gridRow: '2' },
      command: { gridColumn: '3', gridRow: '2' },
    };
  } else if (cols === 2) {
    gridStyle = { gridTemplateColumns: '1.5fr 1fr', gridTemplateRows: '1.25fr 1fr auto' };
    place = {
      tasks: { gridColumn: '1', gridRow: '1 / 3' },
      shailos: { gridColumn: '2', gridRow: '1' },
      calendar: { gridColumn: '2', gridRow: '2' },
      phone: { gridColumn: '1', gridRow: '3' },
      command: { gridColumn: '2', gridRow: '3' },
    };
  }
  const cardStyle = (key, minH) => (cols === 1 ? { minHeight: minH } : { ...place[key], height: '100%', minHeight: 0 });
  const scrollPane = { flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' };

  // ── Row renderers ─────────────────────────────────────────────────────────
  const renderTaskRow = (t) => {
    const pri = priById.get(t.priority);
    const color = pri?.color || C.accent;
    if (editId === t.id) {
      return (
        <div key={t.id} style={{ padding: `2px ${SP.sm}` }}>
          <TextField
            value={editText}
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
        <span slot="start" style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 0 3px ${tonal(color, 0.16)}` }} />
        <span style={{ fontSize: 13, color: C.text, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText(t)}</span>
        <span slot="supporting-text" style={{ color, fontSize: 10.5, fontWeight: 600 }}>
          {pri?.label || 'Task'}{t.mrsW ? ' · Mrs. W' : ''}
        </span>
        <span slot="end" style={{ display: 'inline-flex', gap: 0 }}>
          <IconBtn icon="check_circle" iconSize={17} size={30} color={C.success} title="Complete"
            onClick={(e) => { e.stopPropagation(); onCompleteTask?.(t.id); }} />
          <IconBtn icon="delete_outline" iconSize={16} size={30} color={C.faint} title="Delete"
            onClick={(e) => { e.stopPropagation(); onDeleteTask?.(t.id); }} />
        </span>
      </ListItem>
    );
  };

  const renderShailaRow = (s) => {
    const isGetBack = s.status === 'get_back';
    return (
      <ListItem key={s.id} type="button" onClick={onOpenShailos} style={{ borderRadius: RADIUS.sm, '--md-list-item-leading-space': SP.sm }}>
        <span slot="start"><IconPuck icon={isGetBack ? 'reply' : 'help'} color={gold} size={26} iconSize={15} /></span>
        <span style={{ fontSize: 13, color: C.text, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText(s)}</span>
        <span slot="supporting-text" style={{ color: isGetBack ? C.warning : gold, fontSize: 10.5, fontWeight: 600 }}>
          {isGetBack ? 'Get back to asker' : 'Researching'}
        </span>
        <span slot="end" style={{ color: C.faint, display: 'inline-flex' }}>{suiteIcon('chevron_right', 18)}</span>
      </ListItem>
    );
  };

  // ═══ Cards ════════════════════════════════════════════════════════════════
  const tasksCard = (
    <Card
      key="tasks" icon="checklist" title="Tasks" count={primaryTasks.length} C={C}
      style={cardStyle('tasks', 360)}
      actions={<>
        <IconBtn icon="bolt" iconSize={17} size={32} color={C.muted} title="Zen focus" onClick={onOpenZen} />
        <IconBtn icon="open_in_full" iconSize={16} size={32} color={C.muted} title="Open task list" onClick={onOpenTasks} />
      </>}
    >
      <div style={{ padding: `0 ${SP.xs} ${SP.sm}`, flexShrink: 0 }}>
        <ChipSet>
          <FilterChip label={`All ${primaryTasks.length}`} selected={priFilter === 'all'} onClick={() => setPriFilter('all')} />
          {workPriorities.map((p) => (
            <FilterChip key={p.id} label={`${p.label} ${countByPri[p.id] || 0}`} selected={priFilter === p.id}
              onClick={() => setPriFilter(p.id)} style={{ '--md-filter-chip-selected-container-color': tonal(p.color, 0.2) }} />
          ))}
        </ChipSet>
      </div>
      <div style={scrollPane}>
        {filteredTasks.length === 0
          ? <EmptyState icon="task_alt" text={priFilter === 'all' ? 'No open tasks — you are clear.' : 'Nothing in this lane.'} C={C} />
          : <List style={denseVars}>{filteredTasks.map(renderTaskRow)}</List>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, paddingTop: SP.sm, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center' }}>
          <TextField value={draft} placeholder="Add a task…"
            style={{ flex: 1, '--md-outlined-text-field-container-shape': RADIUS.pill }}
            onInput={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitTask(); }} />
          <IconBtn icon="add" variant="filled" iconSize={20} size={42} color={C.accent}
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
        <ActionBtn variant="text" icon="psychology" onClick={onOpenBrainDump} title="Brain dump">Dump</ActionBtn>
        <ActionBtn variant="text" icon="grain" onClick={onOpenShatter} title="Shatter a big task">Shatter</ActionBtn>
        <ActionBtn variant="text" icon="list_alt" onClick={onOpenQueue} title="Open queue">Queue</ActionBtn>
      </QuickBar>
    </Card>
  );

  const shailosCard = (
    <Card key="shailos" icon="help" title="Shailos" count={openShailos} accent={gold} C={C}
      style={cardStyle('shailos', 220)}
      actions={<IconBtn icon="add" iconSize={17} size={32} color={C.muted} title="Add shaila" onClick={onOpenShailaAdd} />}>
      <div style={scrollPane}>
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
  );

  const phoneCard = (
    <Card key="phone" icon="smartphone" title="Phone" accent={phoneOnline ? C.success : C.faint} C={C}
      style={cardStyle('phone', 150)}
      headerRight={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: phoneOnline ? C.success : C.faint, fontWeight: 600 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: phoneOnline ? C.success : C.faint }} />
        {phoneOnline ? 'This PC' : 'Offline'}
      </span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, padding: `${SP.xs} ${SP.xs}` }}>
        <ActionBtn variant="tonal" icon="dialpad" onClick={onOpenPhone} title="Open phone">Open DeskPhone</ActionBtn>
        <div style={{ display: 'flex', gap: SP.sm }}>
          <ActionBtn variant="outlined" icon="call" onClick={onRecordCall} title="Record a call" style={{ flex: 1 }}>Call</ActionBtn>
          <ActionBtn variant="outlined" icon="graphic_eq" onClick={onRecordConversation} title="Record a conversation" style={{ flex: 1 }}>Convo</ActionBtn>
        </div>
      </div>
    </Card>
  );

  const calendarCard = (
    <Card key="calendar" icon="calendar_month" title="Calendar & Mail" accent="#3D6CB5" C={C}
      style={cardStyle('calendar', 220)}
      actions={googleConnected ? <>
        <IconBtn icon="refresh" iconSize={17} size={32} color={C.muted} title="Refresh" onClick={onRefreshCalendar} />
        <IconBtn icon="settings" iconSize={16} size={32} color={C.muted} title="Google settings" onClick={onOpenGoogleSettings} />
      </> : null}>
      {!googleConnected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md, padding: SP.md, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 12.5, color: C.muted }}>
            {googleWasConnected ? 'Google session expired — reconnect.' : 'Connect Google to see calendar and mail.'}
          </span>
          <ActionBtn variant="filled" icon="link" onClick={onConnectGoogle} title="Connect Google">Connect Google</ActionBtn>
        </div>
      ) : (
        <div style={{ ...scrollPane, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={sectionLabel(C)}>Next up</div>
          {upcomingEvents.length === 0
            ? <span style={{ fontSize: 12, color: C.faint, padding: `0 ${SP.sm} ${SP.sm}` }}>{googleLoading ? 'Loading…' : 'Nothing scheduled.'}</span>
            : upcomingEvents.map((ev, i) => {
                const start = ev?.start?.dateTime || ev?.start?.date || ev?.start;
                const label = start ? new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
                return (
                  <div key={ev?.id || i} style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: `3px ${SP.sm}` }}>
                    <span style={{ width: 3, alignSelf: 'stretch', minHeight: 18, borderRadius: 2, background: '#3D6CB5' }} />
                    <span style={{ flex: 1, fontSize: 12.5, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev?.summary || '(no title)'}</span>
                    <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
                  </div>
                );
              })}
          {unreadEmails.length > 0 && <div style={sectionLabel(C)}>Inbox</div>}
          {unreadEmails.map((m, i) => (
            <div key={m?.id || i} style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: `2px ${SP.sm}` }}>
              <span style={{ color: C.faint, display: 'inline-flex' }}>{suiteIcon('mail', 14)}</span>
              <span style={{ flex: 1, fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m?.subject || m?.snippet || '(no subject)'}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  const commandCard = (
    <Card key="command" icon="hub" title="Command" C={C} style={cardStyle('command', 150)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SP.xs, padding: `${SP.xs} ${SP.xs}` }}>
        <button onClick={onOpenChiefPage} style={tileStyle(C)} title="Open Chief of Staff">
          <IconPuck icon="smart_toy" color={C.accent} size={28} iconSize={16} />
          <span style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: C.text }}>Chief of Staff</span>
            <span style={{ display: 'block', fontSize: 11, color: C.muted }}>{chiefProfile ? 'Profile ready' : 'AI planning & profile'}</span>
          </span>
          <span style={{ color: C.faint, display: 'inline-flex' }}>{suiteIcon('chevron_right', 18)}</span>
        </button>
        <button onClick={onOpenHealth} style={tileStyle(C)} title="Open Health">
          <IconPuck icon="favorite" color={C.danger} size={28} iconSize={16} />
          <span style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: C.text }}>Health</span>
            <span style={{ display: 'block', fontSize: 11, color: C.muted }}>{healthData ? 'Synced' : 'Steps, sleep & vitals'}</span>
          </span>
          {onSyncHealth && <IconBtn icon="sync" iconSize={15} size={30} color={C.muted} title="Sync now" onClick={(e) => { e.stopPropagation(); onSyncHealth(); }} />}
        </button>
      </div>
    </Card>
  );

  const cards = [tasksCard, shailosCard, calendarCard, phoneCard, commandCard];

  // ═══ Shell ════════════════════════════════════════════════════════════════
  return (
    <div style={{
      position: 'fixed', top: topOffset, left: sidebarW, right: 0, bottom: 0, zIndex: 7600,
      background: C.bgSoft, borderLeft: `1px solid ${C.divider}`, fontFamily: NC_FONT_STACK,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', WebkitFontSmoothing: 'antialiased',
    }}>
      {/* Thin header bar — clock left, subtle readouts + Polish right */}
      <header style={{ display: 'flex', alignItems: 'center', gap: SP.md, padding: `${SP.sm} ${SP.lg}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: SP.sm, minWidth: 0 }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: C.text, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{clock.time}</span>
          <span style={{ fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap' }}>{clock.date}</span>
        </div>
        <span style={{ flex: 1 }} />
        <span style={miniStat(C, gold)} title={`${openShailos} open shailos`}>
          {suiteIcon('help', 14)}<b style={{ fontVariantNumeric: 'tabular-nums' }}>{openShailos}</b>
        </span>
        <span style={miniStat(C, phoneOnline ? C.success : C.faint)} title={phoneOnline ? 'Phone online' : 'Phone offline'}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: phoneOnline ? C.success : C.faint }} />
          {phoneOnline ? 'Phone' : 'Offline'}
        </span>
        {onPolishNerveItems && (
          <IconBtn icon="auto_awesome" iconSize={16} size={30} color={C.faint} title="Polish items with AI" onClick={onPolishNerveItems} />
        )}
      </header>

      {/* Dashboard — grid (no page scroll) on wide, graceful column-scroll when narrow */}
      {cols === 1 ? (
        <div style={{ flex: 1, overflow: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: SP.md, padding: `0 ${SP.lg} ${SP.lg}` }}>
          {cards}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', ...gridStyle, gap: SP.md, padding: `0 ${SP.lg} ${SP.lg}` }}>
          {cards}
        </div>
      )}
    </div>
  );
}

function sectionLabel(C) {
  return { fontSize: 10.5, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em', padding: `${SP.xs} ${SP.sm} 0` };
}

function miniStat(C, color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT,
    fontSize: 12, fontWeight: 600, color: color || C.muted, whiteSpace: 'nowrap',
  };
}

function tileStyle(C) {
  return {
    display: 'flex', alignItems: 'center', gap: SP.md, width: '100%',
    padding: SP.sm, border: 'none', background: 'transparent', cursor: 'pointer',
    borderRadius: NEXT_RADIUS.inner, fontFamily: FONT,
  };
}
