import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiParseCalendarEvent, gP, textOnColor } from '../../01-core.js';
import { cleanTheme, cleanToolbarButton, gvIconButton, gvTextButton, NC_FONT_STACK, NC_TYPE, suiteIcon, useViewportWidth } from '../ui-tokens.jsx';
import { NerveCenterPhoneSurface } from './NerveCenterPhoneSurface.jsx';
import { isNerveTaskShailaWork } from '../utils/shailosQueue.js';

function nerveSummarySource(item) {
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

function NerveCenterPanel({ T, sections = [], tasks = [], shailos = [], shailosCompleted = [], priorities = [], aiOpts = null, onAddTask, onAddMrsWTask, onOpenQueue, onOpenShailos, onOpenShailaAdd, onOpenPhone, onOnlineChange, onRecordConversation, onRecordCall, onCompleteTask, onDeleteTask, onEditTask, onOpenZen, onOpenGoogleSettings, sidebarW = 0, topOffset = 0, actionsOpen = false, setActionsOpen, actionCategoryId = "tasks", setActionCategoryId, calendarEvents = null, gmailMessages = null, googleLoading = false, googleError = null, googleToken = null, googleClientId = null, onConnectGoogle, onDisconnectGoogle, onLoadEmailDetail, onCreateCalendarEvent, googleWasConnected = false, onRefreshCalendar, paneWeights = { tasks: 1, shailos: 1, phone: 1 }, onPaneWeightsChange, googlePaneHeight = 244, onGooglePaneHeightChange, onPolishNerveItems }) {
  const viewportW = useViewportWidth();
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
  const [phoneStatusSummary, setPhoneStatusSummary] = useState({ online: false, tone: "offline", label: "DeskPhone offline", voicemailCount: 0 });
  const handlePhoneStatusSummary = useCallback((next) => {
    setPhoneStatusSummary(prev => (
      prev.online === next.online &&
      prev.tone === next.tone &&
      prev.label === next.label &&
      prev.voicemailCount === next.voicemailCount
    ) ? prev : next);
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
  const ncSectionIcon = (accent = C.accent) => ({ width: 26, height: 26, borderRadius: 13, background: "transparent", color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
  const ncSmallIconButton = (active = false, accent = C.muted) => gvIconButton({ width: 26, height: 26, background: active ? C.hover : "transparent", color: active ? accent : C.muted }, C);
  const phoneStatusColor = phoneStatusSummary.tone === "incoming" ? C.success : phoneStatusSummary.tone === "call" ? C.warning : phoneStatusSummary.online ? C.success : C.faint;

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

  const NC_LABEL = { now: "Now", today: "Soon", eventually: "Long" };
  const ncCorePills = ["now", "today", "eventually"]
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

  return (
    <div style={{ position: "fixed", inset: `${topOffset}px 0 0 ${sidebarW}px`, zIndex: 7600, background: C.bg, overflow: isStacked ? "hidden" : touchLayout ? "auto" : "hidden", overscrollBehavior: "contain", borderLeft: `1px solid ${C.divider}` }}>
      <div style={isStacked ? { height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" } : { minHeight: "100%", height: touchLayout ? "auto" : "100%", maxWidth: 1520, margin: "0 auto", padding: "clamp(20px,2.4vw,32px)", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: touchLayout ? 12 : 4 }}>

        {/* Panel tab bar — mobile/stacked only */}
        {isStacked && (
          <div style={{ display: "flex", background: C.bg, borderBottom: `1px solid ${C.divider}`, flexShrink: 0 }}>
            {[["Tasks", "task_alt", 0], ["Shailos", "rule", 1], ["Phone", "phone_in_talk", 2]].map(([lbl, ico, idx]) => (
              <button key={idx} onClick={() => goToPanel(idx)}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, height: 42, padding: "0 4px", border: "none", borderBottom: `2px solid ${idx === activeStackPanel ? C.accent : "transparent"}`, background: "none", cursor: "pointer", color: idx === activeStackPanel ? C.text : C.muted, fontSize: ncType.label, fontWeight: 500, fontFamily: NC_FONT_STACK, transition: "color 0.15s" }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={ncSectionIcon()}>{suiteIcon("task_alt", 16)}</span>
                  <span style={ncTitle}>Tasks</span>
                </div>
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
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
                  {onOpenZen && <button onClick={onOpenZen} title="Zen mode" aria-label="Zen mode" style={ncSmallIconButton()}>{suiteIcon("self_improvement", 14)}</button>}
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
                  <div key={t.id} data-nc-task-row="true" className="nc-action-row" style={{ display: "grid", gridTemplateColumns: touchLayout ? "3px minmax(0,1fr) 40px" : "3px minmax(0,1fr)", alignItems: "start", padding: "14px 18px 14px 0", gap: 14, minHeight: 56 }}>
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
                      <div className={touchLayout ? "" : "nc-hover-actions"} data-open={actionsOpen ? "true" : undefined} style={{ display: "flex", gap: 4, justifyContent: touchLayout ? "flex-start" : "flex-end", gridColumn: touchLayout ? "2 / 4" : "auto", marginTop: touchLayout ? -4 : 0, ...(touchLayout ? {} : { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 2, background: C.bg, borderRadius: 8, boxShadow: "0 1px 8px rgba(60,64,67,0.12)", padding: 2 }) }}>
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
                  style={{ width: "100%", height: 24, flex: "0 0 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 3, border: "none", borderTop: `1px solid ${C.divider}`, background: "transparent", color: C.faint, cursor: "pointer", fontSize: 11, fontFamily: NC_FONT_STACK, flexShrink: 0 }}>
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
                    style={{ width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: "3px minmax(0,1fr) auto", gap: 14, padding: "16px 20px 16px 0", border: "none", background: GOLD_BG, color: C.text, cursor: "pointer", alignItems: "start", minHeight: 60 }}>
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
                    <span style={{ color: "#2E7D32" }}>{suiteIcon("check_circle", 15)}</span>
                    <span style={{ fontSize: ncType.label, fontWeight: 500, color: C.muted, letterSpacing: 0, textTransform: "uppercase" }}>Recently resolved</span>
                  </div>
                  {shailosCompleted.map(s => {
                    const text = nerveDisplaySummary(s, "Resolved shaila");
                    return (
                      <div key={s.id} style={{ display: "grid", gridTemplateColumns: "3px minmax(0,1fr) auto", gap: 14, padding: "14px 20px 14px 0", alignItems: "start", opacity: 0.72, minHeight: 56 }}>
                        <span style={{ width: 3, alignSelf: "stretch", minHeight: 24, borderRadius: 2, background: "#2E7D32", flexShrink: 0 }} />
                        <span style={{ paddingLeft: 5, paddingTop: 1, fontSize: ncType.meta, fontWeight: "var(--nc-font-weight-normal, 400)", lineHeight: ncType.line, color: C.muted, wordBreak: "break-word", textDecoration: "line-through" }}>{text}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#2E7D32", background: "rgba(46,125,50,0.10)", border: "1px solid rgba(46,125,50,0.22)", borderRadius: 999, padding: "4px 9px", whiteSpace: "nowrap", flexShrink: 0, marginRight: 4, marginTop: 2 }}>Done</span>
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
                <span title={phoneStatusSummary.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, color: phoneStatusColor, fontSize: 12, fontWeight: 500 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: phoneStatusColor, flexShrink: 0 }} />
                  {(phoneStatusSummary.tone === "incoming" || phoneStatusSummary.tone === "call") && (
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{phoneStatusSummary.label}</span>
                  )}
                  {phoneStatusSummary.voicemailCount > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: C.danger }}>{suiteIcon("voicemail", 12)} {phoneStatusSummary.voicemailCount}</span>
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
              <NerveCenterPhoneSurface T={T} onOnlineChange={onOnlineChange} onStatusSummary={handlePhoneStatusSummary} compact onRecordConversation={onRecordConversation} onRecordCall={onRecordCall} onMoreHistory={onOpenPhone} />
            </div>
          </section>
        </div>

        {googleResizeHandle}

        {/* ── Google Calendar + Gmail strip ── resizable height, cards scroll internally */}
        {(() => {
          const accentBlue = C.accent;
          if (isStacked) return null;

          if (!googleClientId) {
            return (
              <div style={{ display: "flex", flex: "0 0 64px", minHeight: 0 }}>
                <button onClick={onOpenGoogleSettings}
                  style={{ width: "100%", borderRadius: 8, border: `1px dashed ${C.divider}`, background: C.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: C.muted, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.control, fontWeight: 500 }}
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
          const cardWrap = { background: C.bg, borderRadius: 8, border: `1px solid ${C.divider}`, flex: isStacked ? "1 1 0" : 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" };
          const cardHead = { minHeight: isStacked ? 28 : 36, padding: isStacked ? "3px 8px" : "11px 14px 8px", borderBottom: `1px solid ${C.divider}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 };
          const cardBody = { flex: "1 1 0", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: isStacked ? "2px 8px 6px" : "4px 14px 8px", overscrollBehavior: "contain", scrollbarGutter: "stable" };
          const headLabel = { fontSize: isStacked ? NC_TYPE.meta : NC_TYPE.label, fontWeight: 500, color: C.muted, fontFamily: NC_FONT_STACK, letterSpacing: 0, display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 };
          const selectedEmail = selectedEmailId ? (gmailMessages || []).find(msg => msg.id === selectedEmailId) : null;
          const selectedEmailDetail = selectedEmailId ? emailDetails[selectedEmailId] : null;
          const selectedEmailSource = selectedEmailDetail || selectedEmail;
          const selectedEmailBody = selectedEmailDetail?.fullBody || decodeSnippet(selectedEmail?.snippet || "");

          return (
            <React.Fragment>
            <div style={{ display: "flex", flexDirection: "column", flex: "0 0 auto", gap: 6, minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: isStacked ? "column" : "row", gap: 8, flex: isStacked ? "0 0 min(42vh, 330px)" : `0 0 ${googleH}px`, minHeight: 0, maxHeight: isStacked ? 330 : undefined }}>

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
                <div style={{ ...cardWrap, borderColor: "#E07040", flexDirection: "row", alignItems: "center", padding: "0 14px", gap: 10 }}>
                  <span style={{ fontSize: NC_TYPE.meta, color: "#E07040", fontFamily: NC_FONT_STACK, flex: 1 }}>{googleError}</span>
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
                <div style={cardWrap}>
                  <div style={cardHead}>
                    <span style={headLabel}>{suiteIcon("calendar_today", 13)} Today</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {googleLoading && <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${T.tFaint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />}
                      <button onClick={() => setShowAddEvent(true)} title="Add event"
                         style={{ fontSize: 16, color: T.tFaint, background: "none", border: "none", cursor: "pointer", lineHeight: 1, opacity: .5, padding: 0, display: "flex" }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>+</button>
                      <a href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer" title="Open Google Calendar"
                         style={{ fontSize: 14, color: T.tFaint, textDecoration: "none", lineHeight: 1, opacity: .5, display: "flex" }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>↗</a>
                      <button onClick={onRefreshCalendar || onConnectGoogle} title="Refresh" style={{ fontSize: 14, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .5, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>↺</button>
                      <button onClick={onDisconnectGoogle} title="Disconnect" style={{ fontSize: 14, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .35, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = .85} onMouseLeave={e => e.currentTarget.style.opacity = .35}>✕</button>
                    </div>
                  </div>
                  <div style={cardBody}>
                    {!calendarEvents ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 7 }}>
                        <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${T.tSoft}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />
                        <span style={{ fontSize: NC_TYPE.meta, color: T.tFaint, fontFamily: NC_FONT_STACK }}>Loading calendar…</span>
                      </div>
                    ) : calendarEvents.length === 0 ? (
                      <p style={{ fontSize: NC_TYPE.meta, color: T.tFaint, fontFamily: NC_FONT_STACK, margin: "12px 0", textAlign: "center" }}>Nothing today</p>
                    ) : calendarEvents.map((evt, i) => {
                      const now = isNow(evt);
                      const rowStyle = { display: "flex", gap: isStacked ? 7 : 10, alignItems: "flex-start", padding: isStacked ? "5px 2px" : "8px 4px", textDecoration: "none", color: "inherit", borderRadius: 4 };
                      const inner = (
                        <>
                          <span style={{ fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, color: now ? accentBlue : T.tFaint, fontWeight: now ? 500 : 400, flexShrink: 0, width: isStacked ? 54 : 66, textAlign: "right", paddingTop: 1 }}>{fmtEvtTime(evt)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {now && <span style={{ width: 5, height: 5, borderRadius: "50%", background: accentBlue, flexShrink: 0 }} />}
                              <span style={{ fontSize: NC_TYPE.control, color: now ? C.text : C.muted, fontWeight: now ? 500 : 400, fontFamily: NC_FONT_STACK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.summary || "(no title)"}</span>
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
                    <span style={headLabel}>{suiteIcon("mail", 13)} Mail</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {googleLoading && <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${T.tFaint}`, borderTopColor: "transparent", animation: "ot-spin 0.8s linear infinite" }} />}
                      <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" title="Open Gmail"
                         style={{ fontSize: 14, color: T.tFaint, textDecoration: "none", opacity: .5, lineHeight: 1 }}
                         onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>↗</a>
                      <button onClick={onRefreshCalendar || onConnectGoogle} title="Refresh mail and calendar" style={{ fontSize: 14, color: T.tFaint, background: "none", border: "none", cursor: "pointer", padding: 0, opacity: .5, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = .5}>↺</button>
                    </div>
                  </div>
                  <div style={cardBody}>
                    {!gmailMessages ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 7 }}>
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
                        <div
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
                            <span style={{ fontSize: NC_TYPE.meta, color: C.muted, fontFamily: NC_FONT_STACK, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.aiSummary || decodeSnippet(msg.snippet) || subject}</span>
                          </button>
                          <a href={url} target="_blank" rel="noopener noreferrer" title="Open in Gmail"
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
                              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: NC_TYPE.meta, color: C.muted }}>
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
                  {addEventError && <div style={{ fontSize: NC_TYPE.meta, color: "#E07040", marginTop: 6 }}>{addEventError}</div>}
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
            </React.Fragment>
          );
        })()}

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
