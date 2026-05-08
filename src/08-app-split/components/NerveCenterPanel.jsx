import React, { useMemo } from 'react';
import { IC } from '../../02-icons.jsx';
import { cleanTheme, gvIconButton, gvTextButton, suiteIcon } from '../ui-tokens.jsx';
import { NerveCenterPhoneSurface } from './NerveCenterPhoneSurface.jsx';

function NerveCenterPanel({ T, sections = [], tasks = [], shailos = [], shailosCompleted = [], priorities = [], onAddTask, onOpenQueue, onOpenShailos, onOpenShailaAdd, onOpenPhone, onOnlineChange, onRecordConversation, onRecordCall, onCompleteTask, onDeleteTask, onEditTask, onOpenZen, onOpenGoogleSettings, sidebarW = 0, actionsOpen = false, setActionsOpen, actionCategoryId = "tasks", setActionCategoryId, calendarEvents = null, gmailMessages = null, googleLoading = false, googleError = null, googleToken = null, googleClientId = null, onConnectGoogle, onDisconnectGoogle, googleWasConnected = false, onRefreshCalendar }) {
  const [taskDraft, setTaskDraft] = useState("");
  const [taskPriority, setTaskPriority] = useState(priorities.find(p => p.id === "now")?.id || priorities[0]?.id || "now");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editText, setEditText] = useState("");
  const taskInputRef = useRef(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [addEventText, setAddEventText] = useState('');
  const [addEventLoading, setAddEventLoading] = useState(false);
  const [addEventError, setAddEventError] = useState(null);
  const [hoverEmail, setHoverEmail] = useState(null);
  const hoverTimerRef = useRef(null);
  const [reconnectTimedOut, setReconnectTimedOut] = useState(false);
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

  async function handleAddEvent() {
    if (!addEventText.trim() || addEventLoading) return;
    setAddEventLoading(true); setAddEventError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const prompt = `Parse this natural language event description into a Google Calendar event JSON object. Today is ${today}. Return ONLY valid JSON with fields: summary (string), start (object with dateTime in RFC3339 or date in YYYY-MM-DD for all-day), end (same format), reminders (object with useDefault false and overrides array of {method,minutes}). Description: "${addEventText}"`;
      const raw = await callAI(prompt, { maxTokens: 500 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse event — try rephrasing.');
      const eventBody = JSON.parse(jsonMatch[0]);
      eventBody.reminders = eventBody.reminders || { useDefault: false, overrides: [] };
      const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error?.message || 'Failed to create event'); }
      setShowAddEvent(false); setAddEventText('');
      if (onRefreshCalendar) onRefreshCalendar();
    } catch (e) {
      setAddEventError(e.message || 'Something went wrong');
    } finally {
      setAddEventLoading(false);
    }
  }

  const GOLD = "#C9923C";
  const GOLD_BG = "rgba(201,146,60,0.07)";
  const GOLD_BRD = "rgba(201,146,60,0.18)";
  const C = cleanTheme(T);
  const ncPanel = { background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", boxShadow: "none" };
  const ncHeader = { padding: "12px 14px", borderBottom: `1px solid ${C.divider}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
  const ncTitle = { fontSize: 16, fontWeight: 500, color: C.text, fontFamily: "system-ui" };
  const ncSectionIcon = (accent = C.accent) => ({ width: 32, height: 32, borderRadius: 16, background: C.hover, color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
  const ncSmallIconButton = (active = false, accent = C.muted) => gvIconButton({ width: 36, height: 36, background: active ? C.hover : "transparent", color: active ? accent : C.muted }, C);

  const shailaPriorityIds = new Set(priorities.filter(p => p.isShaila || p.id === "shaila").map(p => p.id));
  const isShailaWork = t => t?.type === "shailo-research" || t?.type === "shaila-research" || !!t?.shailaId || !!t?.isGetBackStep || shailaPriorityIds.has(t?.priority);
  const primaryTasks = tasks.filter(t => !isShailaWork(t)).slice(0, 8);
  // Exclude research-type shaila tasks — they're not actionable get-backs until research is done
  const visibleShailos = shailos.filter(s => s.type !== "shaila-research" && s.type !== "shailo-research").slice(0, 10);

  const NC_LABEL = { now: "Now", today: "Soon", eventually: "Long" };
  const ncCorePills = ["now", "today", "eventually"]
    .map(id => { const p = priorities.find(x => x.id === id && !x.deleted); return p ? { ...p, ncLabel: NC_LABEL[id] || p.label } : null; })
    .filter(Boolean);
  const activePri = gP(priorities, taskPriority);
  const activePriColor = activePri?.color || T.primary || "#7EB0DE";

  const bySection = Object.fromEntries(sections.map(s => [s.id, s]));
  const collectActions = (...ids) => ids.flatMap(id => bySection[id]?.actions || []);
  const actionCategories = [
    { id: "tasks",   title: "Tasks",   icon: "task_alt",     actions: collectActions("priority", "focus") },
    { id: "shailos", title: "Shailos", icon: "rule",         actions: [...collectActions("shaila"), ...(bySection.record?.actions || []).filter(a => a.id === "record-shaila")] },
    { id: "phone",   title: "Phone",   icon: "phone_in_talk",actions: [...collectActions("phone"), ...(bySection.record?.actions || []).filter(a => a.id === "record-call")] },
    { id: "setup",   title: "Setup",   icon: "settings",     actions: [...(bySection.record?.actions || []).filter(a => !["record-shaila","record-call"].includes(a.id)), ...collectActions("system")] },
  ].filter(c => c.actions.length);
  const activeActionCategory = actionCategories.find(c => c.id === actionCategoryId) || actionCategories[0];

  const addDraft = () => {
    const text = taskDraft.trim();
    if (!text) return;
    onAddTask?.(text, taskPriority);
    setTaskDraft("");
    if (taskInputRef.current) { taskInputRef.current.style.height = "36px"; }
  };

  return (
    <div style={{ position: "fixed", inset: `0 0 0 ${sidebarW}px`, zIndex: 7600, background: C.bg, overflow: "hidden", borderLeft: `1px solid ${C.divider}` }}>
      <div style={{ height: "100%", maxWidth: 1400, margin: "0 auto", padding: "clamp(10px,1.6vw,18px)", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Three-panel grid — fills all remaining height */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, flex: 1, minHeight: 0, alignItems: "stretch" }}>

          {/* ── Tasks ── */}
          <section style={ncPanel}>
            <div style={{ ...ncHeader, display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={ncSectionIcon()}>{suiteIcon("task_alt", 17)}</span>
                  <span style={ncTitle}>Tasks</span>
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {onOpenZen && <button onClick={onOpenZen} title="Enter Zen mode" style={gvTextButton({}, C)}>{suiteIcon("self_improvement", 13)} Zen</button>}
                  <button onClick={onOpenQueue} style={gvTextButton({}, C)}>{suiteIcon("list_alt", 13)} Queue</button>
                  <button onClick={() => { setActionCategoryId("tasks"); setActionsOpen(true); }} title="Task actions" style={ncSmallIconButton()}>{suiteIcon("apps", 15)}</button>
                </div>
              </div>
              {/* Quick add — input + equal-width priority pills + add FAB, all inline */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <textarea ref={taskInputRef} value={taskDraft} rows={1}
                  onChange={e => { setTaskDraft(e.target.value); e.target.style.height = "36px"; e.target.style.height = Math.min(e.target.scrollHeight, 108) + "px"; }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addDraft(); } }}
                  placeholder="Add a task…"
                  style={{ flex: 1, minWidth: 0, height: 36, maxHeight: 108, boxSizing: "border-box", borderRadius: 18, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: "8px 13px", fontSize: 14, fontWeight: 400, fontFamily: "system-ui", outline: "none", resize: "none", overflowY: "hidden", lineHeight: 1.45 }} />
                {ncCorePills.map(p => {
                  const active = taskPriority === p.id;
                  return (
                    <button key={p.id} onClick={() => setTaskPriority(p.id)}
                      style={{ width: 46, height: 32, flexShrink: 0, borderRadius: 4, border: `1px solid ${active ? p.color : C.divider}`, background: active ? p.color : "transparent", color: active ? textOnColor(p.color) : C.muted, cursor: "pointer", fontSize: 12, fontWeight: 500, fontFamily: "system-ui", transition: "background 0.12s, color 0.12s" }}>
                      {p.ncLabel}
                    </button>
                  );
                })}
                <button onClick={addDraft} disabled={!taskDraft.trim()} style={{ width: 36, height: 36, borderRadius: 99, border: "none", background: activePriColor, color: textOnColor(activePriColor), cursor: "pointer", opacity: taskDraft.trim() ? 1 : 0.38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {suiteIcon("add", 19)}
                </button>
              </div>
            </div>
            <div style={{ overflow: "auto", flex: "1 1 auto", minHeight: 0 }}>
              {primaryTasks.length ? primaryTasks.map(t => {
                const pri = gP(priorities, t.priority);
                const priColor = pri?.color || T.primary || "#7EB0DE";
                const isEditing = editingTaskId === t.id;
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "start", padding: "9px 10px 9px 0", gap: 6 }}>
                    {/* Priority color bar */}
                    <span style={{ width: 8, alignSelf: "stretch", minHeight: 20, borderRadius: "0 4px 4px 0", background: priColor, flexShrink: 0 }} />
                    {/* Text — click to edit inline */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                      {isEditing ? (
                        <textarea value={editText} autoFocus rows={2}
                          onChange={e => setEditText(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (editText.trim()) onEditTask?.(t.id, editText.trim()); setEditingTaskId(null); } if (e.key === "Escape") setEditingTaskId(null); }}
                          onBlur={() => { if (editText.trim() && editText !== t.text) onEditTask?.(t.id, editText.trim()); setEditingTaskId(null); }}
                          style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${priColor}`, background: C.bgSoft, color: C.text, padding: "5px 8px", fontSize: 14, fontWeight: 400, fontFamily: "system-ui", resize: "none", outline: "none" }} />
                      ) : (
                        <span onClick={() => { setEditingTaskId(t.id); setEditText(t.text); }}
                          title="Click to edit"
                          style={{ display: "block", fontSize: 14, fontWeight: 400, lineHeight: 1.45, color: C.text, wordBreak: "break-word", cursor: "text" }}>{t.text}</span>
                      )}
                    </div>
                    {/* Checkmark — plain icon, no pill */}
                    {!isEditing && <button onClick={() => onCompleteTask?.(t.id)} title="Mark done"
                      style={gvIconButton({ width: 32, height: 32, marginTop: -2 }, C)}>
                      {suiteIcon("check", 16)}
                    </button>}
                    {/* Delete */}
                    <button onClick={() => onDeleteTask?.(t.id)} title="Delete task"
                      style={gvIconButton({ width: 32, height: 32, marginTop: -2 }, C)}>
                      {suiteIcon("close", 13)}
                    </button>
                  </div>
                );
              }) : <div style={{ padding: "16px 14px", fontSize: 13, color: C.faint }}>No open tasks.</div>}

            </div>
          </section>

          {/* ── Shailos ── */}
          <section style={ncPanel}>
            <div style={ncHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={ncSectionIcon(GOLD)}>{suiteIcon("rule", 17)}</span>
                <span style={ncTitle}>Shailos</span>
              </div>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <button onClick={onOpenShailaAdd} style={gvTextButton({ border: "none", background: GOLD, color: "#fff" }, C)}>
                  {suiteIcon("add", 13)} Add
                </button>
                <button onClick={onOpenShailos} style={gvTextButton({ borderColor: GOLD_BRD, color: GOLD }, C)}>
                  {suiteIcon("open_in_full", 13)} Open
                </button>
                <button onClick={() => { setActionCategoryId("shailos"); setActionsOpen(true); }} title="Shailos actions" style={ncSmallIconButton(false, GOLD)}>{suiteIcon("apps", 14)}</button>
              </div>
            </div>
            <div style={{ overflow: "auto", flex: "1 1 auto", minHeight: 0 }}>
              {/* Active shailos — open + pending get-back */}
              {visibleShailos.length ? visibleShailos.map((s, idx) => {
                const text = s.parentTask || s.text || s.shaila || s.question || "Open shaila";
                const isGetBack = !!s.isGetBackStep;
                const chipLabel = isGetBack ? "Get back" : "Open";
                const chipBg = isGetBack ? "rgba(201,146,60,0.22)" : "rgba(201,146,60,0.10)";
                return (
                  <button key={s.id} onClick={onOpenShailos}
                    style={{ width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: "3px minmax(0,1fr) auto", gap: 10, padding: "11px 12px 11px 0", border: "none", borderBottom: `1px solid ${GOLD_BRD}`, background: GOLD_BG, color: T.text, cursor: "pointer", alignItems: "start" }}>
                    <span style={{ width: 3, alignSelf: "stretch", minHeight: 28, borderRadius: 2, background: GOLD, flexShrink: 0 }} />
                    <span style={{ paddingLeft: 5, paddingTop: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, lineHeight: 1.4, color: T.text, wordBreak: "break-word" }}>{text}</span>
                      {isGetBack && <span style={{ display: "block", fontSize: 11, color: GOLD, fontWeight: 600, marginTop: 2 }}>{suiteIcon("schedule", 11)} waiting to reply</span>}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, background: chipBg, border: `1px solid ${GOLD_BRD}`, borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0, marginRight: 4, marginTop: 2 }}>{chipLabel}</span>
                  </button>
                );
              }) : <div style={{ padding: "16px 14px", fontSize: 13, color: T.tFaint }}>No pending shailos.</div>}

              {/* Recently completed shailos */}
              {shailosCompleted.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px 6px", borderTop: `1px solid ${T.brdS || T.brd}` }}>
                    <span style={{ color: "#2E7D32" }}>{suiteIcon("check_circle", 13)}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: T.tFaint, letterSpacing: 0.5, textTransform: "uppercase" }}>Recently resolved</span>
                  </div>
                  {shailosCompleted.map(s => {
                    const text = s.parentTask || s.text || s.shaila || s.question || "Resolved shaila";
                    return (
                      <div key={s.id} style={{ display: "grid", gridTemplateColumns: "3px minmax(0,1fr) auto", gap: 10, padding: "9px 12px 9px 0", borderBottom: `1px solid ${T.brdS || T.brd}`, alignItems: "start", opacity: 0.72 }}>
                        <span style={{ width: 3, alignSelf: "stretch", minHeight: 24, borderRadius: 2, background: "#2E7D32", flexShrink: 0 }} />
                        <span style={{ paddingLeft: 5, paddingTop: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: T.tSoft, wordBreak: "break-word", textDecoration: "line-through" }}>{text}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#2E7D32", background: "rgba(46,125,50,0.10)", border: "1px solid rgba(46,125,50,0.22)", borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0, marginRight: 4, marginTop: 2 }}>Done</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── Phone ── */}
          <section style={ncPanel}>
            <div style={ncHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={ncSectionIcon()}>{suiteIcon("phone_in_talk", 17)}</span>
                <span style={ncTitle}>Phone</span>
              </div>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <button onClick={onOpenPhone} style={gvTextButton({}, C)}>
                  {suiteIcon("open_in_full", 13)} Open
                </button>
                <button onClick={() => { setActionCategoryId("phone"); setActionsOpen(true); }} title="Phone actions" style={ncSmallIconButton()}>{suiteIcon("apps", 14)}</button>
              </div>
            </div>
            <div style={{ overflow: "hidden", flex: "1 1 auto", minHeight: 0, padding: "10px 14px", display: "flex", flexDirection: "column" }}>
              <NerveCenterPhoneSurface T={T} onOnlineChange={onOnlineChange} compact onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
            </div>
          </section>
        </div>

        {/* ── Google Calendar + Gmail strip ── fixed height, cards scroll internally */}
        {(() => {
          const accentBlue = C.accent;

          if (!googleClientId) {
            return (
              <div style={{ display: "flex", flex: "0 0 58px", minHeight: 0 }}>
                <button onClick={onOpenGoogleSettings}
                  style={{ width: "100%", borderRadius: 8, border: `1px dashed ${C.divider}`, background: C.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: C.muted, fontFamily: "system-ui", fontSize: 13, fontWeight: 500 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accentBlue; e.currentTarget.style.color = accentBlue; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.divider; e.currentTarget.style.color = C.muted; }}>
                  {suiteIcon("add_link", 16)}
                  Set up Google Calendar &amp; Gmail
                </button>
              </div>
            );
          }

          const notConnected = !googleToken && !googleLoading && calendarEvents === null && gmailMessages === null;
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
          const cardWrap = { background: C.bg, borderRadius: 8, border: `1px solid ${C.divider}`, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" };
          const cardHead = { padding: "8px 12px 6px", borderBottom: `1px solid ${C.divider}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 };
          const cardBody = { flex: 1, overflow: "auto", padding: "0 12px" };
          const headLabel = { fontSize: 12, fontWeight: 500, color: C.muted, fontFamily: "system-ui", letterSpacing: 0 };

          return (
            <React.Fragment>
            <div style={{ display: "flex", flexDirection: "column", flex: "0 0 auto", gap: 4, minHeight: 0 }}>
              <div style={{ display: "flex", gap: 10, flex: "0 0 220px", minHeight: 0 }}>

              {/* Not connected — never been connected: show connect button */}
              {notConnected && !googleError && !googleWasConnected && (
                <button onClick={onConnectGoogle}
                  style={{ flex: 1, borderRadius: 16, border: `1px dashed ${T.brd}`, background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: T.tSoft, fontFamily: "system-ui", fontSize: 13, fontWeight: 600, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accentBlue; e.currentTarget.style.color = accentBlue; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.brd; e.currentTarget.style.color = T.tSoft; }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Connect Google Calendar &amp; Gmail
                </button>
              )}
              {/* Was connected before — spinner until timeout, then show reconnect button */}
              {notConnected && !googleError && googleWasConnected && !reconnectTimedOut && (
                <div style={{ flex: 1, borderRadius: 16, border: `1px solid ${T.brd}`, background: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: T.tFaint, fontFamily: "system-ui", fontSize: 12 }}>
                  <div style={{ width: 11, height: 11, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                  Reconnecting…
                </div>
              )}
              {notConnected && !googleError && googleWasConnected && reconnectTimedOut && (
                <button onClick={onConnectGoogle}
                  style={{ flex: 1, borderRadius: 16, border: `1px dashed ${T.brd}`, background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: T.tSoft, fontFamily: "system-ui", fontSize: 13, fontWeight: 600, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accentBlue; e.currentTarget.style.color = accentBlue; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.brd; e.currentTarget.style.color = T.tSoft; }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                  Reconnect Google
                </button>
              )}

              {/* Error banner */}
              {googleError && (
                <div style={{ ...cardWrap, borderColor: "#E07040", flexDirection: "row", alignItems: "center", padding: "0 14px", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "#E07040", fontFamily: "system-ui", flex: 1 }}>{googleError}</span>
                  <button onClick={onConnectGoogle} style={{ fontSize: 11, fontFamily: "system-ui", fontWeight: 700, color: accentBlue, background: "none", border: `1px solid ${accentBlue}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", flexShrink: 0 }}>Retry</button>
                  <button onClick={onDisconnectGoogle} style={{ fontSize: 12, fontFamily: "system-ui", color: T.tFaint, background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: 0 }}>✕</button>
                </div>
              )}

              {/* Loading (before any data) */}
              {googleLoading && !calendarEvents && !gmailMessages && !googleError && (
                <div style={{ ...cardWrap, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <div style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: 12, color: T.tFaint, fontFamily: "system-ui" }}>Loading…</span>
                </div>
              )}

              {/* ── Calendar card ── */}
              {(calendarEvents !== null || (googleLoading && googleToken)) && (
                <div style={cardWrap}>
                  <div style={cardHead}>
                    <span style={headLabel}>📅 Today</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {googleLoading && <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${T.tFaint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />}
                      <button onClick={() => setShowAddEvent(true)} title="Add event"
                         style={{ fontSize: 16, color: T.tFaint, background: "none", border: "none", cursor: "pointer", lineHeight: 1, opacity: .5, padding: 0, display: "flex" }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>+</button>
                      <a href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer" title="Open Google Calendar"
                         style={{ fontSize: 11, color: T.tFaint, textDecoration: "none", lineHeight: 1, opacity: .5, display: "flex" }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>↗</a>
                      <button onClick={onConnectGoogle} title="Refresh" style={{ fontSize: 11, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .5, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>↺</button>
                      <button onClick={onDisconnectGoogle} title="Disconnect" style={{ fontSize: 11, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .35, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = .85} onMouseLeave={e => e.currentTarget.style.opacity = .35}>✕</button>
                    </div>
                  </div>
                  <div style={cardBody}>
                    {!calendarEvents ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 7 }}>
                        <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                        <span style={{ fontSize: 11, color: T.tFaint, fontFamily: "system-ui" }}>Loading calendar…</span>
                      </div>
                    ) : calendarEvents.length === 0 ? (
                      <p style={{ fontSize: 12, color: T.tFaint, fontFamily: "system-ui", margin: "12px 0", textAlign: "center" }}>Nothing today</p>
                    ) : calendarEvents.map((evt, i) => {
                      const now = isNow(evt);
                      const rowStyle = { display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: i < calendarEvents.length - 1 ? `1px solid ${T.brdS || T.brd}` : "none", textDecoration: "none", color: "inherit", borderRadius: 4 };
                      const inner = (
                        <>
                          <span style={{ fontSize: 10, fontFamily: "system-ui", color: now ? accentBlue : T.tFaint, fontWeight: now ? 700 : 400, flexShrink: 0, width: 52, textAlign: "right", paddingTop: 1 }}>{fmtEvtTime(evt)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {now && <span style={{ width: 5, height: 5, borderRadius: "50%", background: accentBlue, flexShrink: 0 }} />}
                              <span style={{ fontSize: 12, color: now ? T.text : T.tSoft, fontWeight: now ? 700 : 400, fontFamily: "system-ui", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.summary || "(no title)"}</span>
                            </div>
                          </div>
                        </>
                      );
                      return evt.htmlLink
                        ? <a key={evt.id || i} href={evt.htmlLink} target="_blank" rel="noopener noreferrer" style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = T.bgW || 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{inner}</a>
                        : <div key={evt.id || i} style={rowStyle}>{inner}</div>;
                    })}
                  </div>
                </div>
              )}

              {/* ── Gmail card ── */}
              {(gmailMessages !== null || (googleLoading && googleToken)) && (
                <div style={cardWrap}>
                  <div style={cardHead}>
                    <span style={headLabel}>✉️ Important &amp; Unread</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {googleLoading && <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${T.tFaint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />}
                      <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" title="Open Gmail"
                         style={{ fontSize: 11, color: T.tFaint, textDecoration: "none", opacity: .5, lineHeight: 1 }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>↗</a>
                    </div>
                  </div>
                  <div style={cardBody}>
                    {!gmailMessages ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 7 }}>
                        <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                        <span style={{ fontSize: 11, color: T.tFaint, fontFamily: "system-ui" }}>Loading mail…</span>
                      </div>
                    ) : gmailMessages.length === 0 ? (
                      <p style={{ fontSize: 12, color: T.tFaint, fontFamily: "system-ui", margin: "12px 0", textAlign: "center" }}>Inbox zero 🎉</p>
                    ) : gmailMessages.map((msg, i) => {
                      const subject = gmailHeader(msg, 'Subject') || '(no subject)';
                      const from = fmtFrom(gmailHeader(msg, 'From'));
                      const date = fmtTime(gmailHeader(msg, 'Date'));
                      const url = `https://mail.google.com/mail/u/0/#inbox/${msg.id}`;
                      return (
                        <a key={msg.id || i} href={url} target="_blank" rel="noopener noreferrer"
                          style={{ display: "block", padding: "6px 0", borderBottom: i < gmailMessages.length - 1 ? `1px solid ${T.brdS || T.brd}` : "none", textDecoration: "none", color: "inherit", borderRadius: 4 }}
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
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: "system-ui", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{from}</span>
                            <span style={{ fontSize: 10, color: T.tFaint, fontFamily: "system-ui", flexShrink: 0 }}>{date}</span>
                          </div>
                          <span style={{ fontSize: 11, color: T.tSoft, fontFamily: "system-ui", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.aiSummary || decodeSnippet(msg.snippet) || subject}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>{/* end cards row */}
            </div>

            {/* ── Gmail hover tooltip ── */}
            {hoverEmail && (
              <div style={{ position: "fixed", top: hoverEmail.top, left: hoverEmail.left, zIndex: 9999, background: T.card, border: `1px solid ${T.brd}`, borderRadius: 10, padding: "10px 14px", maxWidth: 320, boxShadow: "0 8px 28px rgba(0,0,0,0.22)", fontFamily: "system-ui", pointerEvents: "none" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.tSoft, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtFrom(hoverEmail.from)}</div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hoverEmail.subject}</div>
                {hoverEmail.snippet && <div style={{ fontSize: 11, color: T.tFaint, lineHeight: 1.5 }}>{hoverEmail.snippet}</div>}
              </div>
            )}

            {/* ── Add Event modal ── */}
            {showAddEvent && (
              <div style={{ position: "fixed", inset: 0, zIndex: 9990, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }} onClick={() => { setShowAddEvent(false); setAddEventText(''); setAddEventError(null); }}>
                <div style={{ background: T.card, border: `1px solid ${T.brd}`, borderRadius: 16, padding: "22px 22px 18px", width: "min(440px,92vw)", boxShadow: "0 16px 48px rgba(0,0,0,0.32)", fontFamily: "system-ui" }} onClick={e => e.stopPropagation()}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 10 }}>Add Event</div>
                  <textarea autoFocus rows={4}
                    placeholder='e.g. "Speech at BYHSI on Thu May 14 at 12:55pm – 2pm, remind me 30 mins and 1 hr before"'
                    value={addEventText}
                    onChange={e => setAddEventText(e.target.value)}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleAddEvent(); } }}
                    style={{ width: "100%", boxSizing: "border-box", borderRadius: 10, border: `1px solid ${T.brd}`, background: T.bgW || T.bg, color: T.text, fontSize: 13, padding: "10px 12px", resize: "none", fontFamily: "system-ui", outline: "none" }}
                  />
                  {addEventError && <div style={{ fontSize: 12, color: "#E07040", marginTop: 6 }}>{addEventError}</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                    <button onClick={() => { setShowAddEvent(false); setAddEventText(''); setAddEventError(null); }} style={{ padding: "7px 16px", borderRadius: 8, border: `1px solid ${T.brd}`, background: "none", color: T.tSoft, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cancel</button>
                    <button onClick={handleAddEvent} disabled={addEventLoading || !addEventText.trim()} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: accentBlue, color: "#fff", cursor: addEventLoading ? "wait" : "pointer", fontSize: 13, fontWeight: 700, opacity: (!addEventText.trim() || addEventLoading) ? 0.55 : 1 }}>
                      {addEventLoading ? "Adding…" : "Add Event"}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: T.tFaint, marginTop: 6, textAlign: "right" }}>Cmd/Ctrl+Enter to submit</div>
                </div>
              </div>
            )}
            </React.Fragment>
          );
        })()}

        {/* Actions drawer */}
        {actionsOpen && (
          <div style={{ position: "fixed", inset: `0 0 0 ${sidebarW}px`, zIndex: 7800, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,0.28)" }} onClick={() => setActionsOpen(false)}>
            <aside onClick={e => e.stopPropagation()} style={{ width: "min(540px,94vw)", height: "100%", background: T.card, borderLeft: `1px solid ${T.brd}`, boxShadow: "-18px 0 44px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", borderBottom: `1px solid ${T.brdS || T.brd}`, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 17, fontWeight: 950, fontFamily: "system-ui", color: T.text }}>
                  {suiteIcon("apps", 20)} More Actions
                </div>
                <button onClick={() => setActionsOpen(false)} style={{ width: 34, height: 34, borderRadius: 99, border: `1px solid ${T.brd}`, background: T.bgW, color: T.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {suiteIcon("close", 17)}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", minHeight: 0, flex: 1 }}>
                <div style={{ borderRight: `1px solid ${T.brdS || T.brd}`, padding: 8, display: "grid", alignContent: "start", gap: 4, background: T.bgW, overflow: "auto" }}>
                  {actionCategories.map(cat => {
                    const isActive = activeActionCategory?.id === cat.id;
                    return (
                      <button key={cat.id} onClick={() => setActionCategoryId(cat.id)}
                        style={{ height: 40, borderRadius: 12, border: isActive ? `1px solid ${T.primary || T.brd}` : "1px solid transparent", background: isActive ? (T.tonal || T.card) : "transparent", color: T.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, padding: "0 10px", fontWeight: 800, fontFamily: "system-ui", fontSize: 13, textAlign: "left" }}>
                        {suiteIcon(cat.icon, 17)} {cat.title}
                      </button>
                    );
                  })}
                </div>
                <div style={{ padding: 10, overflow: "auto", display: "grid", alignContent: "start", gap: 6 }}>
                  {(activeActionCategory?.actions || []).map(action => (
                    <button key={action.id || action.label} onClick={() => { if (action.disabled) return; setActionsOpen(false); action.run?.(); }} disabled={action.disabled}
                      style={{ minHeight: 46, borderRadius: 14, border: `1px solid ${T.brdS || T.brd}`, background: action.primary ? (T.primary || T.text) : T.bgW, color: action.primary ? (T.onPrimary || T.bg) : T.text, cursor: action.disabled ? "default" : "pointer", opacity: action.disabled ? 0.5 : 1, padding: "0 12px", display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 9, alignItems: "center", fontFamily: "system-ui", textAlign: "left" }}>
                      <span style={{ width: 28, height: 28, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: action.primary ? "rgba(255,255,255,0.15)" : (T.tonal || T.bgW), color: action.primary ? (T.onPrimary || "#fff") : (T.onTonal || T.tSoft), flexShrink: 0 }}>{suiteIcon(action.icon, 16)}</span>
                      <span style={{ fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{action.label}</span>
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

export { NerveCenterPanel };
