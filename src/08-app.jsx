// === 08-app.js ===

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Store, canonicalUid, gP, DEF_PRI, DEF_AGE_THRESHOLDS, SCHEMES, TIPS, PROMPTS, PALETTE, dayKey, tipOfDay, textOnColor, pBg, uid, getMrsWPriority, optTasks, aiOptTasks, aiOptTasksWithAnalysis, applyTaskAging, isTaskAged, getTaskAgeHours, callAI, suggestFirstStep, aiParseBrainDump, aiParseConversation, aiSummarizeAnswer, gG, fmtMs, db, _lum, priText, textOnPastel } from './01-core.js';
import { IC } from './02-icons.jsx';
import { VoiceInput } from './03-voice.jsx';
import { Ripple, Confetti, playCompletionSound, AutoFitText, Toast, AgeBadge, EnergyBadge, ContextBadges, MrsWBadge, BlockedBadge, TabBtn, ZenMode, ZenDumpReview, JustStartTimer, BodyDoubleTimer, BrainDump, OverwhelmBanner, BlockReflectModal, ShailaManager, PostItStack, ShailaMiniPill } from './04-components.jsx';
import { BulkAdd, TaskBD, BlockedModal, ContextTagPicker, ListManager } from './05-modals.jsx';
import { ShelfView, SubtaskGroup } from './06-shelf.jsx';
import { SettingsModal } from './07-settings.jsx';
import { savePendingRecording, deletePendingRecording, updatePendingRecordingError, transcribePendingRecording, listPendingRecordings, PENDING_EVENT, formatPendingAge } from './09-transcription-pen.js';

const suiteIcon = (name, size = 20) => (
  <span className="material-symbols-rounded" style={{ fontSize: size }}>{name}</span>
);

function buildDeskPhoneThemeQuery(palette, theme = {}) {
  const qs = new URLSearchParams({ palette });
  const keys = ["bg", "bgW", "card", "text", "tSoft", "tFaint", "brd", "brdS", "primary", "onPrimary", "tonal", "onTonal"];
  keys.forEach(key => {
    const value = theme?.[key];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
      qs.set(key, value.trim());
    }
  });
  return qs.toString();
}

function getInitialSuiteView() {
  try {
    const params = new URLSearchParams(window.location.search);
    const view = (params.get("suite") || params.get("view") || "").toLowerCase();
    return ["switchboard", "focus", "shailos"].includes(view) ? view : "focus";
  } catch {
    return "focus";
  }
}

function AppSuiteChrome({ T, active, onSelect, taskCount = 0, shailaCount = 0, phoneOnline = false }) {
  const apps = [
    { id: "switchboard", label: "Switchboard", icon: "dashboard_customize", meta: "today" },
    { id: "focus", label: "Tasks", icon: "task_alt", meta: taskCount ? `${taskCount} open` : "focus" },
    { id: "shailos", label: "Questions", icon: "rule", meta: shailaCount ? `${shailaCount} open` : "answers" },
    { id: "deskphone", label: "Phone", icon: "smartphone", meta: phoneOnline ? "ready" : "open" },
  ];
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,height:64,zIndex:8600,display:"flex",alignItems:"center",justifyContent:"center",padding:"8px clamp(10px,2vw,18px)",boxSizing:"border-box",background:`color-mix(in srgb, ${T.card} 94%, transparent)`,borderBottom:`1px solid ${T.brd}`,boxShadow:T.shadow || "0 2px 14px rgba(0,0,0,0.10)",backdropFilter:"blur(18px)"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:4,width:"min(780px,100%)",padding:3,borderRadius:16,background:T.bgW,border:`1px solid ${T.brdS || T.brd}`}}>
        {apps.map(app => {
          const isActive = active === app.id;
          return (
            <button key={app.id} onClick={() => onSelect(app.id)} title={app.label}
              style={{minWidth:0,height:42,border:"none",borderRadius:12,cursor:"pointer",background:isActive?(T.tonal || T.primary || T.bgW):"transparent",color:isActive?(T.onTonal || T.onPrimary || T.text):T.tSoft,fontFamily:"system-ui",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"0 8px",fontWeight:800,boxShadow:isActive?"inset 0 0 0 1px rgba(255,255,255,0.18)":"none"}}>
              {suiteIcon(app.icon, 20)}
              <span style={{display:"flex",flexDirection:"column",alignItems:"flex-start",minWidth:0,lineHeight:1.05}}>
                <span style={{fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{app.label}</span>
                <span style={{fontSize:9,fontWeight:700,opacity:.68,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{app.meta}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwitchboardPhoneSurface({ T, onOnlineChange, compact = false, onOpenPhone }) {
  const api = "http://127.0.0.1:8765";
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [number, setNumber] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [statusRes, messagesRes] = await Promise.all([
        fetch(`${api}/status`, { cache: "no-store" }),
        fetch(`${api}/messages`, { cache: "no-store" }),
      ]);
      const nextStatus = await statusRes.json();
      const parsed = await messagesRes.json().catch(() => []);
      const nextMessages = Array.isArray(parsed) ? parsed : (parsed?.messages || []);
      const nextCalls = Array.isArray(nextStatus?.recentCalls) ? nextStatus.recentCalls : [];
      setStatus(nextStatus);
      setMessages(nextMessages);
      setCalls(nextCalls);
      onOnlineChange?.(true);
    } catch {
      setStatus(null);
      setMessages([]);
      setCalls([]);
      setError("Open DeskPhone to use calls and texts.");
      onOnlineChange?.(false);
    }
  }, [onOnlineChange]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 6500);
    return () => clearInterval(id);
  }, [refresh]);

  const post = async (path, label) => {
    setBusy(label);
    try {
      await fetch(`${api}${path}`, { method: "POST" });
      await refresh();
    } catch {
      setError("DeskPhone did not answer.");
      onOnlineChange?.(false);
    } finally {
      setBusy("");
    }
  };

  const cleanNumber = number.trim();
  const sendSms = async () => {
    if (!cleanNumber || !body.trim()) return;
    await post(`/send?to=${encodeURIComponent(cleanNumber)}&body=${encodeURIComponent(body.trim())}`, "send");
    setBody("");
  };
  const dial = async () => {
    if (!cleanNumber) return;
    await post(`/dial?n=${encodeURIComponent(cleanNumber)}`, "dial");
  };

  const recentMessages = messages.slice(0, compact ? 3 : 6);
  const recentCalls = calls.slice(0, compact ? 3 : 6);
  const suggestedNumbers = Array.from(new Set([
    ...messages.map(m => m.from || m.sender || m.address || m.phoneNumber || m.number),
    ...calls.map(c => c.number || c.phoneNumber || c.from || c.name || c.displayName),
  ].filter(Boolean))).slice(0, 5);
  const callState = status?.CallState || status?.callState || status?.CurrentCallState || status?.currentCallState || "";
  const statusLine = status ? (callState || "Ready") : "Offline";

  return (
    <div style={{display:"grid",gap:12,minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,color:T.tSoft,fontSize:12,fontWeight:850}}>
          <span style={{color:status ? "#0B8043" : T.tFaint,display:"flex",alignItems:"center"}}>{suiteIcon(status ? "signal_cellular_alt" : "signal_cellular_off", 17)}</span>
          <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{statusLine}</span>
        </div>
        {onOpenPhone && (
          <button onClick={onOpenPhone} title="Open DeskPhone" style={{height:30,borderRadius:11,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,fontSize:11,display:"flex",alignItems:"center",gap:5,padding:"0 9px"}}>
            {suiteIcon("open_in_new", 15)} Open
          </button>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:8,alignItems:"center"}}>
        <input value={number} onChange={e=>setNumber(e.target.value)} placeholder="Name or number" style={{minWidth:0,height:42,boxSizing:"border-box",padding:"0 12px",borderRadius:14,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontFamily:"system-ui",fontWeight:700}}/>
        <button onClick={dial} disabled={!cleanNumber || !!busy} title="Call" style={{width:42,height:42,borderRadius:14,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",opacity:!cleanNumber ? .45 : 1,display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("call",19)}</button>
        <button onClick={()=>post("/answer","answer")} disabled={!!busy} title="Answer" style={{width:42,height:42,borderRadius:14,border:"none",background:"#0B8043",color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("phone_callback",19)}</button>
      </div>
      {!!suggestedNumbers.length && (
        <div style={{display:"flex",gap:6,overflow:"hidden",flexWrap:"wrap"}}>
          {suggestedNumbers.map(n => (
            <button key={n} onClick={()=>setNumber(n)} style={{maxWidth:150,height:28,borderRadius:999,border:`1px solid ${T.brdS || T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",padding:"0 9px",fontSize:11,fontWeight:800,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n}</button>
          ))}
        </div>
      )}
      <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Text message" rows={compact ? 2 : 3} style={{width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:14,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontFamily:"system-ui",resize:"vertical",minHeight:compact?68:88}}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        <button onClick={sendSms} disabled={!cleanNumber || !body.trim() || !!busy} style={{height:38,borderRadius:13,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:900,opacity:(!cleanNumber || !body.trim()) ? .45 : 1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("send",17)} Send</button>
        <button onClick={()=>post("/hangup","hangup")} disabled={!!busy} style={{height:38,borderRadius:13,border:"none",background:"#BA2A2A",color:"#fff",cursor:"pointer",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("call_end",17)} End</button>
        <button onClick={refresh} disabled={!!busy} style={{height:38,borderRadius:13,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("refresh",17)} Sync</button>
      </div>
      {error && <div style={{fontSize:12,lineHeight:1.35,color:T.tSoft,background:T.bgW,border:`1px solid ${T.brd}`,borderRadius:12,padding:"8px 10px"}}>{error}</div>}
      <div style={{display:"grid",gridTemplateColumns:compact ? "1fr" : "1fr 1fr",gap:10,minWidth:0}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:10,fontWeight:900,color:T.tFaint,textTransform:"uppercase",letterSpacing:.7,marginBottom:6}}>Texts</div>
          {recentMessages.length ? recentMessages.map((m, idx) => {
            const from = m.from || m.sender || m.address || m.phoneNumber || m.number || "Message";
            const text = m.body || m.text || m.message || m.content || "";
            return (
              <button key={m.id || m.handle || idx} onClick={()=>setNumber(from)} style={{width:"100%",textAlign:"left",border:"none",borderBottom:idx===recentMessages.length-1?"none":`1px solid ${T.brdS || T.brd}`,background:"transparent",padding:"7px 0",cursor:"pointer",color:T.text}}>
                <div style={{fontSize:12,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{from}</div>
                <div style={{fontSize:11,color:T.tSoft,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{text || "Open thread"}</div>
              </button>
            );
          }) : <div style={{fontSize:12,color:T.tFaint}}>No recent texts loaded.</div>}
        </div>
        <div style={{minWidth:0}}>
          <div style={{fontSize:10,fontWeight:900,color:T.tFaint,textTransform:"uppercase",letterSpacing:.7,marginBottom:6}}>Calls</div>
          {recentCalls.length ? recentCalls.map((c, idx) => {
            const n = c.number || c.phoneNumber || c.name || c.displayName || "Call";
            return (
              <button key={c.id || idx} onClick={()=>setNumber(n)} style={{width:"100%",textAlign:"left",border:"none",borderBottom:idx===recentCalls.length-1?"none":`1px solid ${T.brdS || T.brd}`,background:"transparent",padding:"7px 0",cursor:"pointer",color:T.text}}>
                <div style={{fontSize:12,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n}</div>
                <div style={{fontSize:11,color:T.tSoft,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{c.type || c.when || "Recent call"}</div>
              </button>
            );
          }) : <div style={{fontSize:12,color:T.tFaint}}>{status ? "No recent calls loaded." : "Waiting for DeskPhone."}</div>}
        </div>
      </div>
    </div>
  );
}

function SwitchboardPanel({ T, sections = [], stats = {}, tasks = [], shailos = [], priorities = [], onAddTask, onOpenTasks, onOpenQueue, onOpenZen, onOpenBrainDump, onOpenBulkAdd, onOpenShatter, onOpenShailos, onOpenShailaAdd, onOpenShailaFollowup, onRecordConversation, onRecordCall, onRecordShaila, onOpenPhone, onOnlineChange, onClose }) {
  const [taskDraft, setTaskDraft] = useState("");
  const [taskPriority, setTaskPriority] = useState(priorities.find(p=>p.id==="now")?.id || priorities[0]?.id || "now");
  const visiblePriorities = priorities.filter(p => !p.deleted).slice(0, 6);
  const addDraft = () => {
    const text = taskDraft.trim();
    if (!text) return;
    onAddTask?.(text, taskPriority);
    setTaskDraft("");
  };
  const actionCard = (label, icon, run, tone) => (
    <button onClick={run} style={{height:42,borderRadius:14,border:`1px solid ${tone || T.brd}`,background:tone ? `${tone}18` : T.bgW,color:tone ? (priText?.(tone) || T.text) : T.text,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7,fontWeight:900,fontFamily:"system-ui",fontSize:12,minWidth:0}}>
      {suiteIcon(icon, 17)} <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</span>
    </button>
  );
  return (
    <div style={{position:"fixed",inset:"64px 0 0",zIndex:7600,background:T.bg,overflow:"auto",borderTop:`1px solid ${T.brdS || T.brd}`}}>
      <div style={{maxWidth:1260,margin:"0 auto",padding:"clamp(16px,2.6vw,28px)",boxSizing:"border-box"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,marginBottom:18}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,color:T.text,fontFamily:"system-ui",fontWeight:900,fontSize:22}}>
              {suiteIcon("dashboard_customize", 25)}
              Switchboard
            </div>
            <div style={{marginTop:5,color:T.tSoft,fontFamily:"system-ui",fontSize:13,lineHeight:1.45}}>
              Tasks, questions, calls, and texts in one work surface.
            </div>
          </div>
          <button onClick={onClose} title="Back to tasks" style={{height:38,padding:"0 13px",borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",display:"flex",alignItems:"center",gap:7,fontFamily:"system-ui",fontWeight:800}}>
            {suiteIcon("task_alt", 18)} Tasks
          </button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:18}}>
          {[
            ["Open tasks", stats.tasks ?? 0, "task_alt"],
            ["Active shailos", stats.shailos ?? 0, "rule"],
            ["Phone", stats.phoneOnline ? "Ready" : "Open", "smartphone"],
          ].map(([label, value, icon]) => (
            <div key={label} style={{background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              <span style={{width:34,height:34,borderRadius:12,background:T.tonal || T.bgW,color:T.onTonal || T.text,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{suiteIcon(icon, 19)}</span>
              <div style={{minWidth:0}}>
                <div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",fontWeight:800,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
                <div style={{fontSize:16,color:T.text,fontFamily:"system-ui",fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{value}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:14,alignItems:"start"}}>
          <section style={{background:T.card,border:`1px solid ${T.brd}`,borderRadius:18,padding:15,minWidth:0,boxShadow:T.shadow || "none"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:9,minWidth:0}}>
                <span style={{width:34,height:34,borderRadius:13,background:T.tonal || T.bgW,color:T.onTonal || T.text,display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("task_alt",19)}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:950,color:T.text,fontFamily:"system-ui"}}>Tasks</div>
                  <div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>{stats.tasks || 0} open</div>
                </div>
              </div>
              <button onClick={onOpenQueue} style={{height:32,borderRadius:11,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,fontSize:11}}>More</button>
            </div>
            <div style={{display:"grid",gap:8,marginBottom:12}}>
              {tasks.length ? tasks.slice(0,3).map(t => {
                const pri = gP(priorities, t.priority);
                return (
                  <button key={t.id} onClick={onOpenTasks} style={{width:"100%",minHeight:54,textAlign:"left",borderRadius:14,border:`1px solid ${T.brdS || T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",display:"grid",gridTemplateColumns:"5px minmax(0,1fr)",gap:10,padding:"9px 10px",overflow:"hidden"}}>
                    <span style={{width:5,borderRadius:8,background:pri.color,height:"100%"}}/>
                    <span style={{minWidth:0}}>
                      <span style={{display:"block",fontSize:13,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.text}</span>
                      <span style={{display:"block",fontSize:10.5,color:T.tSoft,fontWeight:800,marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{pri.label || t.priority}</span>
                    </span>
                  </button>
                );
              }) : <div style={{fontSize:13,color:T.tFaint,background:T.bgW,border:`1px solid ${T.brd}`,borderRadius:14,padding:12}}>No open tasks in this list.</div>}
            </div>
            <div style={{display:"grid",gap:8}}>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {visiblePriorities.map(p => (
                  <button key={p.id} onClick={()=>setTaskPriority(p.id)} title={p.label} style={{height:30,borderRadius:999,border:`1px solid ${p.id===taskPriority?p.color:T.brd}`,background:p.id===taskPriority?`${p.color}24`:T.bgW,color:p.id===taskPriority?(priText?.(p.color) || T.text):T.tSoft,cursor:"pointer",fontSize:11,fontWeight:950,padding:"0 10px",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:8,height:8,borderRadius:99,background:p.color}}/> {p.label}
                  </button>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 42px",gap:8}}>
                <input value={taskDraft} onChange={e=>setTaskDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addDraft();}}} placeholder="Add a task" style={{height:42,minWidth:0,boxSizing:"border-box",borderRadius:14,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,padding:"0 12px",fontWeight:800,fontFamily:"system-ui"}}/>
                <button onClick={addDraft} disabled={!taskDraft.trim()} style={{height:42,border:"none",borderRadius:14,background:gP(priorities, taskPriority).color,color:textOnColor(gP(priorities, taskPriority).color),cursor:"pointer",opacity:taskDraft.trim()?1:.45,display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("add",21)}</button>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
              {actionCard("Zen", "self_improvement", onOpenZen)}
              {actionCard("Brain dump", "psychology", onOpenBrainDump)}
              {actionCard("Shatter", "account_tree", onOpenShatter)}
              {actionCard("Paste list", "playlist_add", onOpenBulkAdd)}
            </div>
          </section>

          <section style={{background:T.card,border:`1px solid ${T.brd}`,borderRadius:18,padding:15,minWidth:0,boxShadow:T.shadow || "none"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:9,minWidth:0}}>
                <span style={{width:34,height:34,borderRadius:13,background:T.tonal || T.bgW,color:T.onTonal || T.text,display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("rule",19)}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:950,color:T.text,fontFamily:"system-ui"}}>Shailos</div>
                  <div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>{stats.shailos || 0} open</div>
                </div>
              </div>
              <button onClick={onOpenShailos} style={{height:32,borderRadius:11,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,fontSize:11}}>More</button>
            </div>
            <div style={{display:"grid",gap:8,marginBottom:12}}>
              {shailos.length ? shailos.slice(0,3).map(s => (
                <button key={s.id} onClick={onOpenShailos} style={{width:"100%",minHeight:54,textAlign:"left",borderRadius:14,border:`1px solid ${T.brdS || T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",padding:"9px 10px",overflow:"hidden"}}>
                  <div style={{fontSize:13,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.text || s.shaila || "Open shaila"}</div>
                  <div style={{fontSize:10.5,color:T.tSoft,fontWeight:800,marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.isGetBackStep ? "Follow up" : "Pending answer"}</div>
                </button>
              )) : <div style={{fontSize:13,color:T.tFaint,background:T.bgW,border:`1px solid ${T.brd}`,borderRadius:14,padding:12}}>No pending shailos on the main list.</div>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {actionCard("Add shaila", "add_circle", onOpenShailaAdd)}
              {actionCard("Follow up", "fact_check", onOpenShailaFollowup)}
              {actionCard("Record", "record_voice_over", onRecordShaila)}
              {actionCard("Check sync", "sync", sections.find(s=>s.id==="shaila")?.actions?.find(a=>a.id==="reconcile")?.run)}
            </div>
          </section>

          <section style={{background:T.card,border:`1px solid ${T.brd}`,borderRadius:18,padding:15,minWidth:0,boxShadow:T.shadow || "none"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:9,minWidth:0}}>
                <span style={{width:34,height:34,borderRadius:13,background:T.tonal || T.bgW,color:T.onTonal || T.text,display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("phone_in_talk",19)}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:950,color:T.text,fontFamily:"system-ui"}}>Calls and texts</div>
                  <div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>{stats.phoneOnline ? "Ready" : "Waiting for DeskPhone"}</div>
                </div>
              </div>
              <button onClick={onOpenPhone} style={{height:32,borderRadius:11,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,fontSize:11}}>Open</button>
            </div>
            <SwitchboardPhoneSurface T={T} onOnlineChange={onOnlineChange} onOpenPhone={onOpenPhone} compact />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
              {actionCard("Record call", "phone_in_talk", onRecordCall)}
              {actionCard("Record note", "mic", onRecordConversation)}
            </div>
          </section>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10,marginTop:14}}>
          {sections.map(section => (
            <section key={section.id || section.title} style={{background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,padding:12,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
                <span style={{width:34,height:34,borderRadius:12,background:T.bgW,color:T.tSoft,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{suiteIcon(section.icon, 19)}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontFamily:"system-ui",fontSize:14,fontWeight:900,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{section.title}</div>
                  <div style={{fontFamily:"system-ui",fontSize:11,color:T.tFaint,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{section.meta}</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
                {section.actions.map(action => (
                  <button key={action.id || action.label} onClick={action.run} disabled={action.disabled}
                    style={{minHeight:40,textAlign:"left",borderRadius:12,border:`1px solid ${T.brdS || T.brd}`,background:action.primary?(T.primary || T.text):T.bgW,color:action.primary?(T.onPrimary || T.bg):T.text,cursor:action.disabled?"default":"pointer",opacity:action.disabled ? .55 : 1,padding:"7px 9px",display:"grid",gridTemplateColumns:"24px minmax(0,1fr)",gap:7,alignItems:"center",fontFamily:"system-ui"}}>
                    <span style={{width:24,height:24,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",background:action.primary?"rgba(255,255,255,0.18)":(T.tonal || T.card),color:action.primary?(T.onPrimary || "#fff"):(T.onTonal || T.tSoft),flexShrink:0}}>{suiteIcon(action.icon, 16)}</span>
                    <span style={{minWidth:0}}>
                      <span style={{display:"block",fontSize:12,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{action.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function SuiteShailosPanel({ T, action, onClose }) {
  return (
    <div style={{position:"fixed",inset:"64px 0 0",zIndex:7600,overflow:"hidden",background:T.card,borderTop:`1px solid ${T.brd}`,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.25)",display:"flex",flexDirection:"column"}}>
      <div style={{height:52,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",borderBottom:`1px solid ${T.brd}`,background:T.card,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          {suiteIcon("rule", 21)}
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:800,color:T.text,fontFamily:"system-ui"}}>Shailos Tracker</div>
            <div style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>Questions, answers, and follow-up</div>
          </div>
        </div>
        <button onClick={onClose} title="Back to tasks" style={{width:36,height:36,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("close", 19)}</button>
      </div>
      <iframe src={action ? `/shailos/?action=${action}` : "/shailos/"} title="Shailos Tracker" style={{flex:1,border:"none",width:"100%",background:T.bg}}/>
    </div>
  );
}

function DeskPhoneSuitePanel({ T, onOnlineChange, schemeId = "claude", onLaunch }) {
  const api = "http://127.0.0.1:8765";
  const stageRef = useRef(null);
  const lastThemeRef = useRef("");
  const dockTokenRef = useRef(`dock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [docked, setDocked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const statusRes = await fetch(`${api}/status`, { cache: "no-store" });
      const nextStatus = await statusRes.json();
      setStatus(nextStatus);
      onOnlineChange?.(true);
    } catch {
      setStatus(null);
      setError("DeskPhone is not ready yet.");
      onOnlineChange?.(false);
    }
  }, [onOnlineChange]);

  const post = useCallback(async (path, label) => {
    if (label) setBusy(label);
    try {
      await fetch(`${api}${path}`, { method: "POST" });
      await refresh();
    } catch {
      setError("DeskPhone did not accept the command.");
      onOnlineChange?.(false);
    } finally {
      setBusy("");
    }
  }, [refresh, onOnlineChange]);

  const themePalette = schemeId === "navyGold" || schemeId === "materialDark" ? "navyGold" : schemeId === "material" ? "material" : "claude";
  const themeQuery = useMemo(() => buildDeskPhoneThemeQuery(themePalette, T), [themePalette, T]);
  const releaseStage = useCallback((updateState = true) => {
    const token = encodeURIComponent(dockTokenRef.current);
    fetch(`${api}/stage-exit?token=${token}`, { method: "POST" }).catch(()=>{});
    if (updateState) setDocked(false);
  }, []);

  const syncStage = useCallback(async () => {
    const availLeft = window.screen.availLeft ?? 0;
    const availTop = window.screen.availTop ?? 0;
    const availRight = availLeft + window.screen.availWidth;
    const availBottom = availTop + window.screen.availHeight;
    const gap = 16;
    const dockW = Math.round(Math.min(580, Math.max(480, window.screen.availWidth * 0.32)));
    const dockH = Math.round(Math.max(560, window.screen.availHeight - 96));
    const x = Math.round(Math.max(availLeft + gap, availRight - dockW - gap));
    const y = Math.round(Math.max(availTop + gap, Math.min(availTop + 64, availBottom - dockH - gap)));
    const qs = new URLSearchParams({
      x: String(x),
      y: String(y),
      w: String(dockW),
      h: String(dockH),
      chrome: "1",
      token: dockTokenRef.current,
    });
    setBusy("dock");
    try {
      await fetch(`${api}/stage?${qs}`, { method: "POST" });
      if (lastThemeRef.current !== themeQuery) {
        lastThemeRef.current = themeQuery;
        await fetch(`${api}/theme?${themeQuery}`, { method: "POST" }).catch(()=>{});
      }
      setDocked(true);
      await refresh();
    } catch {
      setError("DeskPhone did not dock.");
      onOnlineChange?.(false);
    } finally {
      setBusy("");
    }
  }, [refresh, themeQuery, onOnlineChange]);

  const pulseStage = useCallback(() => {
    const token = encodeURIComponent(dockTokenRef.current);
    fetch(`${api}/stage-pulse?token=${token}`, { method: "POST" }).catch(()=>{});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 7000);
    return () => {
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    if (!docked) return;
    const id = setInterval(pulseStage, 10000);
    const onPageExit = () => releaseStage(false);
    window.addEventListener("pagehide", onPageExit);
    window.addEventListener("beforeunload", onPageExit);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", onPageExit);
      window.removeEventListener("beforeunload", onPageExit);
      releaseStage(false);
    };
  }, [docked, pulseStage, releaseStage]);

  return (
    <div style={{position:"fixed",inset:"64px 0 0",zIndex:7600,overflow:"hidden",background:`linear-gradient(160deg, ${T.bg} 0%, ${T.bgW} 100%)`,borderTop:`1px solid ${T.brd}`,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.25)",display:"grid",gridTemplateRows:"auto 1fr",padding:"clamp(12px,2vw,18px)",boxSizing:"border-box",gap:12}}>
      <div style={{height:52,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"0 14px",border:`1px solid ${T.brd}`,borderRadius:16,background:T.card}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          {suiteIcon("smartphone", 22)}
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:900,color:T.text,fontFamily:"system-ui"}}>Phone</div>
            <div style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>{status ? `${status.build || "DeskPhone"} - ${status.hfp || "Phone"} - ${status.map || "Messages"}` : "Waiting for DeskPhone"}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>{if (!status) onLaunch?.(); syncStage(); setTimeout(syncStage, 900);}} title={status ? "Dock DeskPhone" : "Open DeskPhone"} style={{height:36,padding:"0 12px",borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,display:"flex",alignItems:"center",gap:6}}>{suiteIcon("open_in_new",17)} {status ? "Dock" : "Open"}</button>
          <button onClick={syncStage} disabled={!!busy} title="Move DeskPhone to the dock position" style={{height:36,padding:"0 12px",borderRadius:12,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:900,display:"flex",alignItems:"center",gap:6}}>{suiteIcon("fit_screen",17)} Position</button>
          <button onClick={()=>releaseStage()} disabled={!!busy} title="Release DeskPhone sizing" style={{width:36,height:36,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("close_fullscreen", 18)}</button>
          <button onClick={refresh} title="Refresh status" style={{width:36,height:36,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("refresh", 18)}</button>
        </div>
      </div>
      <div ref={stageRef} style={{position:"relative",minHeight:0,border:`1px solid ${T.brd}`,borderRadius:18,background:T.card,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.18)",overflow:"auto",padding:"clamp(16px,2.4vw,28px)",boxSizing:"border-box",display:"grid",gridTemplateColumns:"minmax(280px,420px) minmax(320px,1fr)",gap:18,alignItems:"start"}}>
        <div style={{display:"grid",gap:12}}>
          <div style={{fontSize:22,fontWeight:950,color:T.text,fontFamily:"system-ui",display:"flex",alignItems:"center",gap:10}}>{suiteIcon("phone_in_talk",28)} Phone</div>
          {error && <div style={{fontSize:12,lineHeight:1.4,color:"#BA2A2A",background:"#FFE1E1",border:"1px solid #F0B5B5",borderRadius:12,padding:10}}>{error}</div>}
          <div style={{display:"grid",gap:8}}>
            <button onClick={()=>{if (!status) onLaunch?.(); syncStage(); setTimeout(syncStage, 900);}} style={{height:44,borderRadius:14,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:950,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{suiteIcon("desktop_windows",19)} Dock DeskPhone</button>
            <button onClick={()=>releaseStage()} style={{height:40,borderRadius:13,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{suiteIcon("open_in_full",18)} Release</button>
          </div>
        </div>
        <SwitchboardPhoneSurface T={T} onOnlineChange={onOnlineChange} />
      </div>
    </div>
  );
}

function DeskPhoneMiniDock({ T, onOnlineChange, onOpenDeskPhone }) {
  const api = "http://127.0.0.1:8765";
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [number, setNumber] = useState("");
  const [body, setBody] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [statusRes, messagesRes] = await Promise.all([
        fetch(`${api}/status`, { cache: "no-store" }),
        fetch(`${api}/messages`, { cache: "no-store" }),
      ]);
      const nextStatus = await statusRes.json();
      let nextMessages = [];
      try {
        const parsed = await messagesRes.json();
        nextMessages = Array.isArray(parsed) ? parsed : (parsed?.messages || []);
      } catch { nextMessages = []; }
      setStatus(nextStatus);
      setMessages(nextMessages);
      setError("");
      onOnlineChange?.(true);
    } catch {
      setStatus(null);
      setMessages([]);
      setError("Open DeskPhone to use phone controls.");
      onOnlineChange?.(false);
    }
  }, [onOnlineChange]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 7000);
    return () => clearInterval(id);
  }, [refresh]);

  const post = async (path, label) => {
    setBusy(label);
    try {
      await fetch(`${api}${path}`, { method: "POST" });
      await refresh();
    } catch {
      setError("DeskPhone did not answer.");
      onOnlineChange?.(false);
    } finally {
      setBusy("");
    }
  };

  const sendSms = async () => {
    if (!number.trim() || !body.trim()) return;
    await post(`/send?to=${encodeURIComponent(number.trim())}&body=${encodeURIComponent(body.trim())}`, "send");
    setBody("");
  };

  const dial = async () => {
    if (!number.trim()) return;
    await post(`/dial?n=${encodeURIComponent(number.trim())}`, "dial");
  };

  const callState = status?.CallState || status?.callState || status?.CurrentCallState || status?.currentCallState || status?.Call || status?.call || "";
  const recentCalls = status?.RecentCalls || status?.recentCalls || status?.Calls || status?.calls || [];
  const threadMap = new Map();
  messages.forEach((m, idx) => {
    const who = m.from || m.sender || m.address || m.phoneNumber || m.number || m.to || "Unknown";
    if (!threadMap.has(who)) threadMap.set(who, {...m, _who: who, _idx: idx});
  });
  const threads = Array.from(threadMap.values()).slice(0, 4);

  return (
    <div style={{position:"fixed",right:"clamp(10px,2vw,18px)",bottom:"clamp(12px,2vh,18px)",zIndex:8550,fontFamily:"system-ui",pointerEvents:"none"}}>
      {!open && (
        <button onClick={()=>setOpen(true)} title="Calls and texts" style={{pointerEvents:"auto",height:54,minWidth:54,borderRadius:16,border:`1px solid ${T.brd}`,background:T.primary || T.text,color:T.onPrimary || T.bg,boxShadow:T.shadowLg || "0 10px 32px rgba(0,0,0,0.22)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"0 14px",fontWeight:900}}>
          {suiteIcon("phone_in_talk", 22)}
          <span style={{display:"flex",flexDirection:"column",alignItems:"flex-start",lineHeight:1.05}}>
            <span style={{fontSize:12}}>Calls/Text</span>
            <span style={{fontSize:9,opacity:.72}}>{status ? (callState || "ready") : "open"}</span>
          </span>
        </button>
      )}
      {open && (
        <div style={{pointerEvents:"auto",width:"min(360px,calc(100vw - 20px))",maxHeight:"calc(100vh - 86px)",overflow:"auto",background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.28)"}}>
          <div style={{height:48,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px",borderBottom:`1px solid ${T.brd}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              {suiteIcon("phone_in_talk", 20)}
              <div style={{minWidth:0}}>
                <div style={{fontSize:13,fontWeight:900,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Calls and texts</div>
                <div style={{fontSize:10,fontWeight:750,color:status ? "#0B8043" : T.tFaint,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{status ? (callState || "Ready") : "Open DeskPhone"}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={onOpenDeskPhone} title="Open full DeskPhone" style={{width:32,height:32,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("open_in_full", 17)}</button>
              <button onClick={()=>setOpen(false)} title="Minimize" style={{width:32,height:32,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("close", 17)}</button>
            </div>
          </div>
          <div style={{padding:12,display:"grid",gap:10}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={()=>post("/answer","answer")} disabled={!!busy} style={{height:38,borderRadius:12,border:"none",background:"#0B8043",color:"#fff",cursor:"pointer",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("phone_callback",17)} Answer</button>
              <button onClick={()=>post("/hangup","hangup")} disabled={!!busy} style={{height:38,borderRadius:12,border:"none",background:"#BA2A2A",color:"#fff",cursor:"pointer",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("call_end",17)} Hang up</button>
            </div>
            <input value={number} onChange={e=>setNumber(e.target.value)} placeholder="Number" style={{height:38,boxSizing:"border-box",borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,padding:"0 11px",fontSize:13}}/>
            <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Text message" rows={3} style={{boxSizing:"border-box",borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,padding:"9px 11px",fontSize:13,resize:"vertical"}}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={dial} disabled={!number.trim() || !!busy} style={{height:38,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900,opacity:!number.trim() ? .5 : 1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("call",17)} Call</button>
              <button onClick={sendSms} disabled={!number.trim() || !body.trim() || !!busy} style={{height:38,borderRadius:12,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:900,opacity:(!number.trim() || !body.trim()) ? .5 : 1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("send",17)} Send</button>
            </div>
            <div style={{display:"grid",gap:6}}>
              <div style={{fontSize:10,fontWeight:900,color:T.tFaint,textTransform:"uppercase",letterSpacing:.7}}>Recent text threads</div>
              {threads.length ? threads.map((m, idx) => (
                <button key={`${m._who}-${idx}`} onClick={()=>{setNumber(m._who); setOpen(true);}} style={{textAlign:"left",borderRadius:12,border:`1px solid ${T.brdS || T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",padding:"8px 9px"}}>
                  <div style={{fontSize:12,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m._who}</div>
                  <div style={{fontSize:11,color:T.tSoft,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{m.body || m.text || m.message || m.content || "Message"}</div>
                </button>
              )) : <div style={{fontSize:12,color:T.tFaint,border:`1px solid ${T.brdS || T.brd}`,borderRadius:12,padding:9,background:T.bgW}}>No message threads loaded.</div>}
            </div>
            <div style={{display:"grid",gap:6}}>
              <div style={{fontSize:10,fontWeight:900,color:T.tFaint,textTransform:"uppercase",letterSpacing:.7}}>Recent calls</div>
              {Array.isArray(recentCalls) && recentCalls.length ? recentCalls.slice(0,3).map((c, idx) => (
                <button key={idx} onClick={()=>setNumber(c.number || c.phoneNumber || c.from || "")} style={{textAlign:"left",borderRadius:12,border:`1px solid ${T.brdS || T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",padding:"8px 9px"}}>
                  <div style={{fontSize:12,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name || c.number || c.phoneNumber || c.from || "Call"}</div>
                  <div style={{fontSize:11,color:T.tSoft,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{c.direction || c.status || c.time || "Recent call"}</div>
                </button>
              )) : <div style={{fontSize:12,color:T.tFaint,border:`1px solid ${T.brdS || T.brd}`,borderRadius:12,padding:9,background:T.bgW}}>Recent calls will appear here when DeskPhone provides them.</div>}
            </div>
            {error && <div style={{fontSize:12,lineHeight:1.35,color:"#BA2A2A",background:"#FFE1E1",border:"1px solid #F0B5B5",borderRadius:12,padding:9}}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function App({ user, onSignOut }) {
  Store.setUid(canonicalUid(user));
  // ─── State ───────────────────────────────────────────────────────────────
  const [AS, setAS] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [selPri, setSelPri] = useState(null);
  const [tab, setTab] = useState("focus");
  const [suiteView, setSuiteView] = useState(getInitialSuiteView);
  const [deskPhoneOnline, setDeskPhoneOnline] = useState(false);
  const deskPhoneLaunchAtRef = useRef(0);
  const lastDeskPhoneThemeRef = useRef("");
  const [legacyPrompt, setLegacyPrompt] = useState(null);
  const [justComp, setJustComp] = useState(false);
  const [showRip, setShowRip] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editTx, setEditTx] = useState("");
  const [zen, setZen] = useState(false);
  const [justOpt, setJustOpt] = useState(false);
  const [showSet, setShowSet] = useState(false);
  const [showLM, setShowLM] = useState(false);
  const [showListMgr, setShowListMgr] = useState(false);
  // tipIdx/dailyTip removed — replaced by carousel (tipViewIdx)
  const [delConf, setDelConf] = useState(null);
  const [navExp, setNavExp] = useState(false);
  const [chgPri, setChgPri] = useState(null);         // task id being re-prioritized
  const [chgPriScope, setChgPriScope] = useState('one'); // 'one' = just this step, 'group' = all siblings
  const [showBulk, setShowBulk] = useState(false);
  const [showBD, setShowBD] = useState(null);
  const [celeb, setCeleb] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [openGroups, setOpenGroups] = useState(new Set());
  const [groupAdding, setGroupAdding] = useState(null);
  const [optLoading, setOptLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [blockedModal, setBlockedModal] = useState(null);
  const [ctxPicker, setCtxPicker] = useState(null);
  const [firstStepModal, setFirstStepModal] = useState(null); // {task, step, loading, edited}
  const [energyModal, setEnergyModal] = useState(false);
  const [showBodyDouble, setShowBodyDouble] = useState(false);
  const [bdMinimized, setBdMinimized] = useState(false);
  const [jsMinimized, setJsMinimized] = useState(false);
  const [showBrainDump, setShowBrainDump] = useState(false);
  const [showShailos, setShowShailos] = useState(false);
  const [lpMenu, setLpMenu] = useState(false);
  const [shailosAction, setShailosAction] = useState(null); // null | "record-shaila" | "record-call"
  const [justStartId, setJustStartId] = useState(null);
  const [tipCat, setTipCat] = useState("All");
  const [showOverwhelm, setShowOverwhelm] = useState(false);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [mrsWPriLive, setMrsWPriLive] = useState(null); // live Mrs. W priority
  const [blockedResume, setBlockedResume] = useState(null); // task id to show nudge for
  const [staleNudge, setStaleNudge] = useState(null);       // task object that's been waiting 7+ days
  // Insights tab state
  const [tipViewIdx, setTipViewIdx] = useState(() => tipOfDay(dayKey())); // init to today's daily tip
  const [aiInsight, setAiInsight] = useState(null);       // AI-generated insight string
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const [chartRange, setChartRange] = useState('week'); // 'day'|'week'|'month'|'alltime'
  const [chartSecondary, setChartSecondary] = useState('dow'); // 'dow'|'speed'|'trend'|'cumulative'
  // AI Chat dialog state
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatHistory, setAiChatHistory] = useState([]);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatLoading, setAiChatLoading] = useState(false);
  // Queue overflow menu (removed — merged into gear settings modal)
  // Drawer menus on main entry screen
  const [showAides, setShowAides] = useState(false);     // start/sustain aides (body double, just start)
  const [showEntryTools, setShowEntryTools] = useState(false); // task entry tools (bulk, brain dump)
  // Completed post-it stack
  const [postItOpen, setPostItOpen] = useState(false);  // animated stack expanded state
  const [optConfirm, setOptConfirm] = useState(null); // {insight, optimized} — "already optimal" confirmation
  const [showVoice, setShowVoice] = useState(false); // voice input triggered from priority mic
  const [searchQ, setSearchQ] = useState(""); // queue search
  const [qAddPri, setQAddPri] = useState(null); // queue quick-add priority
  const [qAddText, setQAddText] = useState(""); // queue quick-add text
  const [isPrioritizing] = useState(false); // legacy — kept for safety, unused
  const tasksRef = useRef([]);               // always-current tasks for async AI calls
  const asRef       = useRef(null);             // mirror of AS — always current, used by beforeunload flush
  const shailosRef  = useRef([]);               // mirror of latest shailos — for combined backup
  const justLoaded = useRef(false);           // true for one render cycle after initial load — skip auto-save
  const lastSavedModified = useRef(0);       // _lsModified of last save/load — sync comparison baseline
  const adoptedRemote = useRef(false);       // true when onSnapshot adopted remote data — skip next save
  const [zenDumpParsed, setZenDumpParsed] = useState([]);   // AI-parsed brain dump tasks
  const [zenDumpParsing, setZenDumpParsing] = useState(false);
  const [showZenReview, setShowZenReview] = useState(false);
  const [entryEnergy, setEntryEnergy] = useState(null); // energy level for new task: null | "high" | "low"
  const [clockTime, setClockTime] = useState(() => new Date());
  const [queueToast, setQueueToast] = useState(null); // {color, tmr} for "Added to queue" notice
  const [queueToastKey, setQueueToastKey] = useState(0);
  const queueToastTmr = useRef(null);
  const toastTmrRef   = useRef(null);
  const [deletedUndo, setDeletedUndo] = useState(null); // {task, listId} for undo
  const deletedTmr = useRef(null);
  const [parkedUndo, setParkedUndo] = useState(null); // {task, listId} for undo park
  const parkedTmr = useRef(null);
  // ─── New feature state ───────────────────────────────────────────────────
  const [compFlash, setCompFlash] = useState(false);      // brief ✓ overlay on card
  const [showStreak, setShowStreak] = useState(false);    // "On a roll!" celebration
  const [showBlockReflect, setShowBlockReflect] = useState(false); // what's in the way modal
  const [showShailaManager, setShowShailaManager] = useState(false); // shaila log panel
  const [minTick, setMinTick] = useState(0);              // ticks every 60s for snooze auto-wake
  const sessionCompCount = useRef(0);                     // session completions (no re-render needed)
  const pendingShailaIds = useRef(new Set());              // shailaIds assigned but not yet in state (prevents listener dupes)
  const [serverKeyAvailable, setServerKeyAvailable] = useState(false); // true = Netlify AI is configured
  const [aiConfig, setAiConfig] = useState(null);
  const [pendingRecordings, setPendingRecordings] = useState([]);
  const [pendingRetryId, setPendingRetryId] = useState(null);
  const [pendingTranscripts, setPendingTranscripts] = useState({});
  const [fbOffline, setFbOffline] = useState(false);      // Firebase unreachable on load — warn user
  // ─── Conversation Capture ────────────────────────────────────────────────
  const [showConvCapture, setShowConvCapture] = useState(false);
  const [convCallMode, setConvCallMode] = useState(false); // true = getDisplayMedia (phone call)

  const inRef = useRef(null);
  const edRef = useRef(null);
  const idleTmr = useRef(null);
  const navTmr = useRef(null);
  const priTmr = useRef(null);
  const inputTmr = useRef(null);
  const inter = useRef(false);
  const appRef = useRef(null);
  const saveTmr = useRef(null);
  const autoOptTmr = useRef(null);
  const mrsWTmr = useRef(null);
  const blockedTmr = useRef({});
  const chatEndRef = useRef(null);

  const [ph] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);

  const defS = {
    lists: [{id:"default", name:"My Tasks", tasks:[]}],
    activeListId: "default",
    priorities: [
      {id:"now",        label:"Now",        color:"#E09AB8", weight:3},
      {id:"today",      label:"Today",      color:"#E0B472", weight:2},
      {id:"eventually", label:"Eventually", color:"#7EB0DE", weight:1},
    ],
    colorScheme: "claude",
    zenEnabled: false,
    aiModel: "",
    completionSound: true,
    overwhelmThreshold: 7,
    ageThresholds: {...DEF_AGE_THRESHOLDS},
    mrsWWindows: {monThu:{start:"08:30",end:"13:00"}, fri:{start:"08:30",end:"10:00"}},
    autoOptimize: false,
    currentEnergy: null, // "high" | "low" | null
  };

  // ─── Load / Save ─────────────────────────────────────────────────────────
  useEffect(() => {
    Store.load().then(s => {
      if (s && s.lists) {
        if (!s.priorities) s.priorities = defS.priorities.map(p=>({...p}));
        if (!s.colorScheme) s.colorScheme = "claude";
        if (s.zenEnabled === undefined) s.zenEnabled = false;
        if (s.aiModel === undefined) s.aiModel = s.aiTextModel || s.aiAudioModel || s.aiResearchModel || "";
        delete s.geminiKey;
        delete s.soferaiKey;
        delete s.aiProvider;
        delete s.aiTextModel;
        delete s.aiAudioProvider;
        delete s.aiAudioModel;
        delete s.aiResearchProvider;
        delete s.aiResearchModel;
        if (!s.ageThresholds) s.ageThresholds = {...DEF_AGE_THRESHOLDS};
        if (!s.mrsWWindows) s.mrsWWindows = defS.mrsWWindows;
        if (s.completionSound === undefined) s.completionSound = true;
        if (!s.overwhelmThreshold) s.overwhelmThreshold = 7;
        // Permanent: strip "home" custom priority on every load AND directly patch Firestore settings doc.
        // Direct patch bypasses the debounced save (which gets skipped when _listenV5 sets adoptedRemote=true),
        // so the Firestore settings doc is fixed immediately and future snapshots arrive clean.
        const homeEntry = s.priorities?.find(p => !["now","today","eventually","shaila"].includes(p.id) && !p.isShaila && (p.label||"").toLowerCase() === "home");
        if (homeEntry) {
          s.priorities = s.priorities.filter(p => p.id !== homeEntry.id);
          s.lists = s.lists.map(l => ({...l, tasks: (l.tasks||[]).map(t => t.priority === homeEntry.id ? {...t, priority: "eventually"} : t)}));
          console.log("[migration] Stripped 'home' priority from array, patching Firestore settings doc");
          // Directly patch the V5 settings doc in Firestore — fire and forget
          if (Store._v5) {
            const settRef = Store.settingsDoc();
            if (settRef) {
              settRef.get({ source: "server" })
                .then(snap => {
                  if (!snap.exists) return null;
                  const newPriorities = (snap.data().priorities || []).filter(p => p.id !== homeEntry.id);
                  return settRef.update({ priorities: newPriorities, _lastModified: Date.now() });
                })
                .catch(() => {});
            }
          }
        }
        // Auto-dedup shaila tasks on load (clean up any lingering duplicates)
        s.lists = s.lists.map(l => {
          const seenSId = new Set(), seenText = new Set();
          let removed = 0;
          const deduped = (l.tasks||[]).filter(t => {
            if (t.completed) return true;
            if (t.shailaId && !t.parentTask) {
              // Only dedup standalone shaila tasks — subtasks in a group share a shailaId by design
              if (seenSId.has(t.shailaId)) { removed++; return false; }
              seenSId.add(t.shailaId);
            }
            if (t.priority === "shaila" && !t.parentTask) {
              const k = t.text.trim().toLowerCase();
              if (seenText.has(k)) { removed++; return false; }
              seenText.add(k);
            }
            return true;
          });
          if (removed) console.log(`[load-dedup] Removed ${removed} duplicate shaila tasks from list "${l.name||l.id}"`);
          return removed ? {...l, tasks: deduped} : l;
        });
        // Mark justLoaded so the save-effect skips the immediate echo-back to Firebase
        justLoaded.current = true;
        lastSavedModified.current = s._lsModified || 0; // baseline for sync comparison
        setAS(s); setLoaded(true); return;
      }
      // If Firebase failed (not just empty), warn the user — their data might be recoverable
      if (Store._fbLoadStatus === 'error') setFbOffline(true);
      
      // USE OFFLINE CACHE ONLY IF FIREBASE IS UNREACHABLE
      const localData = Store.ll();
      if (Store._fbLoadStatus === 'error' && localData && localData.lists && localData.lists.some(l => l.tasks?.length > 0)) {
         console.warn("Firebase was unreachable! Fusing with offline local cache.");
         const fused = {...defS, ...localData, _lsModified: Date.now()};
         lastSavedModified.current = fused._lsModified;
         setAS(fused);
         setLoaded(true);
         return;
      }

      // New account (Firebase confirmed empty) or Firebase offline fallback
      setAS(defS); setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded || !AS) return;
    // Skip the very first save that fires because `loaded` just flipped to true.
    // We just loaded this data FROM Firebase — writing it straight back would risk
    // overwriting data that was externally pushed (e.g. from merge.html) between
    // the time the page started loading and the time Firebase responded.
    if (justLoaded.current) { justLoaded.current = false; return; }
    // Skip saves triggered by adopting remote data (onSnapshot / visibility sync).
    // Without this guard, adopting remote data would stamp a new _lsModified and
    // re-save, causing the other device to adopt, re-stamp, re-save — infinite loop.
    if (adoptedRemote.current) { adoptedRemote.current = false; asRef.current = AS; return; }
    // ── Centralized _lsModified stamping ──
    // Every mutation flows through this effect before reaching Firebase.
    // By stamping here instead of in 30+ individual setAS() calls, no mutation
    // can forget to bump the timestamp — which previously caused settings,
    // list ops, undo, and priority changes to be invisible to cross-device sync.
    const now = Date.now();
    const toSave = { ...AS, _lsModified: now };
    lastSavedModified.current = now;
    asRef.current = toSave;                    // keep ref current for beforeunload flush
    Store.ls(toSave);                          // Refresh optional offline cache
    Store.autoFileBackup(toSave, shailosRef.current); // Weekly combined backup
    clearTimeout(saveTmr.current);
    saveTmr.current = setTimeout(() => Store.saveToFB(toSave), 1500); // debounced Firebase write
    return () => clearTimeout(saveTmr.current);
  }, [AS, loaded]);

  // (beforeunload/pagehide flushing is consolidated in the effect below with the periodic sync)

  // ─── Shared Gemini gateway config ─────────────────────────────────────────
  useEffect(() => {
    fetch("/.netlify/functions/app-config")
      .then(r => r.json())
      .then(d => {
        const cfg = d.ai || null;
        setAiConfig(cfg);
        setServerKeyAvailable(!!(cfg?.available?.gemini || d.geminiKey));
      })
      .catch(() => {});
  }, []);

  const refreshPendingRecordings = useCallback(() => {
    listPendingRecordings()
      .then(setPendingRecordings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshPendingRecordings();
    window.addEventListener(PENDING_EVENT, refreshPendingRecordings);
    return () => window.removeEventListener(PENDING_EVENT, refreshPendingRecordings);
  }, [refreshPendingRecordings]);


  // ─── Auto-aging: nudge stale tasks up one priority tier on load ─────────────
  useEffect(() => {
    if (!loaded || !pris.length) return;
    // First: undo any auto-aging on subtasks (subtasks should not age independently)
    const origTasks = AS.lists[0]?.tasks || [];
    let subtaskUndone = false;
    const tasksBeforeAging = origTasks.map(t => {
      if (t.parentTask && t.autoAged && t.agedFromPriId) {
        subtaskUndone = true;
        return { ...t, priority: t.agedFromPriId, autoAged: false, agedFromPriId: undefined, agedFromLabel: undefined, prioritySetAt: undefined };
      }
      return t;
    });
    const { tasks: aged, anyChanged } = applyTaskAging(tasksBeforeAging, pris);
    // Only write if something actually changed — subtask de-aging OR regular aging.
    // Without this guard, every page load would create a phantom Firebase save.
    if (!anyChanged && !subtaskUndone) return;
    if (!anyChanged) { uT(() => tasksBeforeAging); return; }
    const count = aged.filter(t => t.autoAged && !origTasks.find(o => o.id===t.id && o.autoAged)).length;
    uT(() => aged);
    if (count > 0) showToast(`↑ ${count} task${count!==1?"s":""} nudged up — been sitting too long`, 8000);
  }, [loaded]); // eslint-disable-line

  // ─── Listen for shailos iframe "close" message ───────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.data === 'shailos:close') { setShowShailos(false); setShailosAction(null); }
      if (e.data === 'shailos:open-conv-capture') {
        setShowShailos(false); setShailosAction(null);
        setConvCallMode(true); setShowConvCapture(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ─── Shaila ↔ Task real-time sync ───────────────────────────────────────
  // Uses setAS directly (not uT) so it can check ALL lists for existing shailaId links.
  // uT only sees active list, which caused duplicates when shaila tasks existed in other lists.
  useEffect(() => {
    if (!loaded || !db) return;
    const unsub = Store.listenShailos((shailos) => {
      shailosRef.current = shailos; // keep ref current for combined backup
      setAS(prev => {
        if (!prev?.lists) return prev;
        // Gather ALL tasks across ALL lists
        const allTasks = prev.lists.flatMap(l => (l.tasks || []).map(t => ({...t, _listId: l.id})));

        // Build lookup: shailaId → [tasks] (multiple subtasks can share one shailaId)
        const tasksByShailaId = {};
        allTasks.forEach(t => {
          if (t.shailaId) {
            if (!tasksByShailaId[t.shailaId]) tasksByShailaId[t.shailaId] = [];
            tasksByShailaId[t.shailaId].push(t);
            pendingShailaIds.current.delete(t.shailaId); // safely in state now
          }
        });

        // Text lookup for standalone shaila-priority tasks (fallback dedup — subtasks excluded)
        const shailaTextSet = new Set(
          allTasks.filter(t => t.priority === "shaila" && !t.completed && !t.parentTask)
            .map(t => t.text.trim().toLowerCase())
        );

        const shailaIdSet = new Set(shailos.map(s => s.id));
        const toAdd = [];
        const toCompleteIds = new Set();
        const toDeleteIds = new Set();

        const addedShailaIds = new Set(); // prevent dupes within this batch
        shailos.forEach(s => {
          const linkedTasks = tasksByShailaId[s.id] || [];
          // Skip shailaIds that were just pre-assigned but haven't made it into state yet
          if (pendingShailaIds.current.has(s.id)) return;
          if (addedShailaIds.has(s.id)) return; // already adding in this batch
          if (!linkedTasks.length && s.status !== "answered" && s.status !== "got_back") {
            // Use synopsis as concise title; fall back to content
            const parentText = s.synopsis || s.content || s.parsedShaila || "New shaila";
            if (shailaTextSet.has(parentText.trim().toLowerCase())) return; // text dedup
            addedShailaIds.add(s.id);
            const baseTime = Date.now();
            const shortDesc = parentText.substring(0, 40);
            toAdd.push({
              id: uid(), text: `Research – ${shortDesc}`,
              completed: false, priority: "shaila", createdAt: baseTime,
              shailaId: s.id, parentTask: parentText, stepIndex: 1, totalSteps: 2,
            });
            toAdd.push({
              id: uid(), text: `Get back – ${shortDesc}`,
              completed: false, priority: "shaila", createdAt: baseTime,
              shailaId: s.id, isGetBackStep: true,
              parentTask: parentText, stepIndex: 2, totalSteps: 2,
            });
          } else if (linkedTasks.length) {
            const isGroup = linkedTasks.some(t => t.parentTask);
            if (s.status === "answered") {
              // Complete research step (step 1) only; leave "get back" step pending
              const step1 = isGroup
                ? linkedTasks.find(t => !t.isGetBackStep && !t.completed)
                : linkedTasks.find(t => !t.completed); // backward compat: single task
              if (step1) toCompleteIds.add(step1.id);
            } else if (s.status === "got_back") {
              // Complete all remaining linked tasks
              linkedTasks.filter(t => !t.completed).forEach(t => toCompleteIds.add(t.id));
            }
          }
        });

        // Detect deletions: tasks with shailaId no longer in shailos collection
        allTasks.forEach(t => {
          if (t.shailaId && !t.completed && !shailaIdSet.has(t.shailaId)) {
            toDeleteIds.add(t.id);
          }
        });

        if (!toAdd.length && !toCompleteIds.size && !toDeleteIds.size) return prev;

        if (toAdd.length) {
          // Register new shailaIds as pending BEFORE state update so the next
          // _listenV5 snapshot (which fires right after save) doesn't re-create them.
          const newIds = [...new Set(toAdd.map(t => t.shailaId).filter(Boolean))];
          newIds.forEach(id => pendingShailaIds.current.add(id));
          setTimeout(() => newIds.forEach(id => pendingShailaIds.current.delete(id)), 5000);
          const newShailaCount = Math.ceil(toAdd.length / 2);
          showToast(`📋 ${newShailaCount} new shaila${newShailaCount!==1?"s":""} from transcriber`, 5000);
        }
        if (toCompleteIds.size) showToast(`✅ ${toCompleteIds.size} shaila${toCompleteIds.size!==1?"s":""} answered`, 5000);
        if (toDeleteIds.size) showToast(`🗑️ ${toDeleteIds.size} shaila task${toDeleteIds.size!==1?"s":""} removed`, 5000);

        // Apply changes across ALL lists (complete/delete where they live, add to active list)
        const activeId = prev.lists.find(l => l.id === prev.activeListId) ? prev.activeListId : prev.lists[0]?.id;
        const newLists = prev.lists.map(l => {
          let tasks = l.tasks || [];
          // Complete/delete in whichever list the task lives
          if (toCompleteIds.size) tasks = tasks.map(t => toCompleteIds.has(t.id) ? {...t, completed:true, completedAt:Date.now()} : t);
          if (toDeleteIds.size) tasks = tasks.filter(t => !toDeleteIds.has(t.id));
          // Add new tasks to active list, then sort so shailas surface to top immediately
          if (toAdd.length && l.id === activeId) tasks = optTasks([...tasks, ...toAdd], pris);
          return tasks !== l.tasks ? {...l, tasks} : l;
        });
        return {...prev, lists: newLists};
      });
    });
    return unsub;
  }, [loaded]); // eslint-disable-line

  // ─── Real-time cross-window sync ─────────────────────────────────────────
  // V5: listens to the tasks COLLECTION + settings doc (per-document changes)
  // V4: listens to the single blob document (legacy fallback)
  useEffect(() => {
    if (!loaded || !db) return;

    if (Store._v5) {
      // V5: per-task collection listener — each task change is surgical
      const unsub = Store._listenV5((newState) => {
        // Strip home priority from any state arriving from Firestore — defense against stale settings doc
        const he = newState.priorities?.find(p => !["now","today","eventually","shaila"].includes(p.id) && !p.isShaila && (p.label||"").toLowerCase() === "home");
        if (he) {
          newState = { ...newState, priorities: newState.priorities.filter(p => p.id !== he.id) };
        }
        adoptedRemote.current = true;
        lastSavedModified.current = newState._lsModified || Date.now();
        Store.ls(newState);
        setAS(newState);
      });
      return () => unsub();
    }

    // V4 fallback: single-document listener
    const ref = Store.docRef(); if (!ref) return;
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const fbState = snap.data()?.state;
      if (!fbState) return;
      const fbTs = fbState._lsModified || 0;
      if (fbTs > lastSavedModified.current) {
        adoptedRemote.current = true;
        lastSavedModified.current = fbTs;
        Store._fbLoadedTs = fbTs;
        Store.ls(fbState);
        setAS(fbState);
      }
    }, () => {});
    return () => unsub();
  }, [loaded]); // eslint-disable-line

  // ─── Visibility-change sync ──────────────────────────────────────────────
  // iOS Safari kills WebSocket listeners in the background. Force a server
  // fetch when the app comes back into view. In V5 mode, reload from per-task
  // collections; in V4, from the blob document.
  useEffect(() => {
    if (!loaded || !db) return;
    async function syncFromServer() {
      // V5: collection listener handles reconnection automatically.
      // Do NOT reload from server here — _loadV5() stamps a fresh timestamp
      // that makes empty results look "newer", wiping real data.
      if (Store._v5) return;
      // V4 fallback
      const ref = Store.docRef();
      if (!ref) return;
      try {
        const snap = await ref.get({ source: "server" });
        if (!snap.exists) return;
        const fbState = snap.data()?.state;
        if (!fbState) return;
        const fbTs = fbState._lsModified || 0;
        if (fbTs > lastSavedModified.current) {
          adoptedRemote.current = true;
          lastSavedModified.current = fbTs;
          Store._fbLoadedTs = fbTs;
          Store.ls(fbState);
          setAS(fbState);
        }
      } catch(e) {}
    }
    function onVisibility() {
      if (document.visibilityState === "visible") syncFromServer();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", syncFromServer);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", syncFromServer);
    };
  }, [loaded]); // eslint-disable-line

  // ─── Tab-close flush + periodic Firebase sync ───────────────────────────
  // beforeunload/pagehide: save to localStorage ONLY — NEVER to Firebase.
  // This is the structural fix for stale-data corruption. Every single data
  // loss incident was caused by a stale tab's beforeunload flushing old data
  // to Firebase. localStorage is safe because it only affects this device.
  // The debounced save (above) and periodic sync (below) handle Firebase writes
  // during normal operation when we have time to do it safely via transaction.
  useEffect(() => {
    if (!loaded) return;
    function flushLocal() {
      const cur = asRef.current;
      if (cur) {
        Store.flushToLocalOnly(cur);
        Store.autoFileBackup(cur, shailosRef.current, true).catch(() => {}); // best-effort on close
      }
    }
    window.addEventListener("beforeunload", flushLocal);
    window.addEventListener("pagehide", flushLocal);
    // Periodic Firebase sync — catches anything the debounce missed
    // (e.g. user idle for 15s after a change that was debounced then cancelled)
    const iv = setInterval(() => {
      const cur = asRef.current;
      if (cur && (cur._lsModified || 0) > Store._lastSavedFbModified) {
        Store.saveToFB(cur);
      }
    }, 15000);
    return () => {
      window.removeEventListener("beforeunload", flushLocal);
      window.removeEventListener("pagehide", flushLocal);
      clearInterval(iv);
    };
  }, [loaded]);

  // ─── Derived state ───────────────────────────────────────────────────────
  // All app AI calls go through the central Netlify AI gateway.
  const selectedProvider = "gemini";
  const selectedProviderAvailable = aiConfig ? !!aiConfig?.available?.gemini : serverKeyAvailable;
  const selectedModel = AS?.aiModel || aiConfig?.model || aiConfig?.textModel || "";
  const rawAiOpts = AS ? {
    provider: selectedProvider,
    model: selectedModel,
    source: "server",
  } : null;
  const hasAI = !!(rawAiOpts && selectedProviderAvailable);
  const aiOpts = hasAI ? rawAiOpts : null;
  async function retryHeldTranscription(rec) {
    if (!aiOpts || pendingRetryId) return;
    setPendingRetryId(rec.id);
    try {
      const txt = await transcribePendingRecording(
        rec.id,
        aiOpts,
        "Transcribe this audio exactly and faithfully. The speaker may use Yeshivish English, Hebrew, Yiddish, and halachic terms. Do not summarize or classify. Return only the transcript.",
        { maxOutputTokens: 8192 }
      );
      setPendingTranscripts(p => ({ ...p, [rec.id]: txt }));
      await updatePendingRecordingError(rec.id, "");
    } catch(e) {
      await updatePendingRecordingError(rec.id, e.message || String(e)).catch(() => {});
    } finally {
      setPendingRetryId(null);
      refreshPendingRecordings();
    }
  }

  async function deleteHeldTranscription(rec) {
    if (pendingRetryId === rec.id) return;
    await deletePendingRecording(rec.id);
    setPendingTranscripts(p => {
      const next = { ...p };
      delete next[rec.id];
      return next;
    });
    refreshPendingRecordings();
  }

  const sc = SCHEMES[AS?.colorScheme] || AS?.customSchemes?.[AS?.colorScheme] || SCHEMES.claude;
  // Detect dark theme by checking bg luminance
  const isDark = (()=>{const h=sc.bg||"#EDE5D8";const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);return(r*299+g*587+b*114)/1000<128;})();
  const T = {...sc, isDark, glow:!!sc.glow, shadow: isDark?"0 2px 12px rgba(0,0,0,0.3)":"0 2px 12px rgba(0,0,0,0.06)", shadowLg: isDark?"0 6px 24px rgba(0,0,0,0.4)":"0 6px 24px rgba(0,0,0,0.09)"};
  const deskPhoneThemePalette = AS?.colorScheme === "material"
    ? "material"
    : isDark
      ? "navyGold"
      : "claude";
  const deskPhoneThemeSyncEnabled = AS?.deskPhoneThemeSync !== false;
  const deskPhoneThemeQuery = useMemo(() => buildDeskPhoneThemeQuery(deskPhoneThemePalette, T), [deskPhoneThemePalette, T]);
  // Share theme with Shaila sub-app via localStorage
  try { localStorage.setItem('onetask_theme', JSON.stringify(sc)); } catch(e) {}
  // Share the selected AI route with the Shaila sub-app; both still call the same server gateway.
  try { if (aiOpts) localStorage.setItem('onetask_ai_config', JSON.stringify(aiOpts)); } catch(e) {}
  const softBorderC = isDark ? "#7A78A8" : "#B8A88E";
  const pris = (AS?.priorities || DEF_PRI).filter(p => !p.deleted);
  const aList = AS ? AS.lists.find(l => l.id === AS.activeListId) || AS.lists[0] : null;
  const tasks = aList?.tasks || [];
  tasksRef.current = tasks; // keep ref fresh for async AI calls
  const actT = tasks.filter(t => !t.completed);
  const compT = tasks.filter(t => t.completed);
  const allComp = AS ? AS.lists.flatMap(l => l.tasks.filter(t => t.completed)) : [];
  const ap = pris.filter(p => !p.deleted);

  // Shaila number map: shailaId → 1-based number by createdAt (stable, for queue + mini pill)
  const shailaNumberMap = useMemo(() => {
    const shailaPriIds = new Set(pris.filter(p => p.isShaila || p.id === "shaila").map(p => p.id));
    const allShailaTasks = (AS?.lists || []).flatMap(l =>
      (l.tasks || []).filter(t => shailaPriIds.has(t.priority) && !t.isGetBackStep && !t.completed)
    ).sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    const m = {};
    allShailaTasks.forEach((t, i) => { if (t.shailaId) m[t.shailaId] = i + 1; });
    return m;
  }, [AS?.lists, pris]);

  // Shaila status map: shailaId → "researching"|"have_answer"|"got_back"
  // Derived from task fields so SubtaskGroup can show the right pill color
  const shailaStatusMap = useMemo(() => {
    const shailaPriIds = new Set(pris.filter(p => p.isShaila || p.id === "shaila").map(p => p.id));
    const allT = (AS?.lists || []).flatMap(l => l.tasks || []);
    const m = {};
    allT.filter(t => shailaPriIds.has(t.priority) && !t.isGetBackStep && t.shailaId).forEach(t => {
      // Check if got-back step is completed
      const gb = allT.find(x => x.shailaId === t.shailaId && x.isGetBackStep);
      if (t.gotBackToAsker || gb?.completed) { m[t.shailaId] = "got_back"; }
      else if (t.shailaAnswer?.trim()) { m[t.shailaId] = "have_answer"; }
      else { m[t.shailaId] = "researching"; }
    });
    return m;
  }, [AS?.lists, pris]);

  // Energy-filtered + snooze-filtered queue
  const curEnergy = AS?.currentEnergy;
  const displayedActT = useMemo(() => {
    const now = Date.now();
    const unsnooze = actT.filter(t => !t.snoozedUntil || t.snoozedUntil <= now);
    if (!curEnergy) return unsnooze;
    return unsnooze.filter(t => !t.energy || t.energy === curEnergy);
  }, [actT, curEnergy, minTick]);

  // Overwhelm: focus mode is now OPT-IN (not auto-triggered)
  // C06: subtask groups count as 1 item for effective count
  const parentGroups = [...new Set(actT.filter(t=>t.parentTask).map(t=>t.parentTask))];
  const standaloneCount = actT.filter(t => !t.parentTask).length;
  const effectiveCount = standaloneCount + parentGroups.length; // groups count as 1
  const overwhelmThreshold = AS?.overwhelmThreshold || 7;
  const isOverwhelmed = focusModeActive; // now opt-in only
  const queueT = isOverwhelmed ? displayedActT.slice(0, 3) : displayedActT;
  const snoozedT = useMemo(() => {
    const now = Date.now();
    return actT.filter(t => t.snoozedUntil && t.snoozedUntil > now);
  }, [actT, minTick]);
  // Queue filter: for groups, show only the first subtask as a position marker (rendered as SubtaskGroup)
  const seenGroupsInQueue = new Set();
  const queueTFiltered = queueT.filter(t => {
    if (!t.parentTask) {
      // Regular task: filter by search
      if (!searchQ.trim()) return true;
      return t.text.toLowerCase().includes(searchQ.toLowerCase());
    }
    // Subtask: show only the first one per group (as position marker for SubtaskGroup)
    if (seenGroupsInQueue.has(t.parentTask)) return false;
    // Check if this group matches search
    if (searchQ.trim()) {
      const groupSubs = actT.filter(s => s.parentTask === t.parentTask);
      const matches = t.parentTask.toLowerCase().includes(searchQ.toLowerCase()) ||
                      groupSubs.some(s => s.text.toLowerCase().includes(searchQ.toLowerCase()));
      if (!matches) return false;
    }
    seenGroupsInQueue.add(t.parentTask);
    return true;
  });
  const curT = displayedActT[0] || null;

  // Priority picker: pre-compute whether the task being re-prioritized is a subtask.
  // Kept outside JSX so Babel standalone doesn't have to parse it inside an expression.
  const chgPriTask      = chgPri ? actT.find(t => t.id === chgPri) : null;
  const chgPriIsSubtask = !!chgPriTask?.parentTask;

  // Today's completion count
  const todayCompCount = useMemo(() => {
    const s = new Date(); s.setHours(0,0,0,0);
    return compT.filter(t => t.completedAt && t.completedAt >= s.getTime()).length;
  }, [compT]);

  // ─── Mrs. W live priority refresh (S11) ──────────────────────────────────
  useEffect(() => {
    const refresh = () => setMrsWPriLive(getMrsWPriority(pris, AS?.mrsWWindows));
    refresh();
    mrsWTmr.current = setInterval(refresh, 60000);
    return () => clearInterval(mrsWTmr.current);
  }, [pris, AS?.mrsWWindows]);

  // ─── Clock tick ──────────────────────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ─── Minute tick (snooze auto-wake) ──────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setMinTick(t => t + 1), 60000);
    return () => clearInterval(iv);
  }, []);

  // ─── One-time shaila restore (via ?restoreShailos=1 URL param) ─────────
  useEffect(() => {
    if (!loaded || !AS) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("restoreShailos") !== "1") return;
    const shailaPri = pris.find(p => p.isShaila)?.id || "shaila";
    const shailaTexts = [
      'Shaila: Mrs. Shapira - 1 Do/should bnei Torah avoid seed oils (cottonseed etc.), which are considered kitniyos in E"Y, for Pesach in America as well?',
      'Shaila: Mrs. Shapira - 2 What is the status of quinoa which has an Ashkenazi hechsher here but not in E"Y?',
      'Shaila: Mrs. Shapira - 3 Is the idea of drinking wine as opposed to grape juice at the Seder because of the chashash that yayin mevushal isn\'t fit for melachim the case?',
      'Shaila: Mrs. Shapira - 4 Would there even be a hiddur in drinking non-mevushal wine as opposed to non-mevushal grape juice?',
      'Shaila: Mrs. Shapira - 5 What about mevushal wine, is there any hiddur in that at all?',
      'Shaila: Mrs. Shapira - 6 Should she cancel the non-mevushal grape juice order and just get regular grape juice instead, or is the issue with her sister\'s Shabbos observance and touching the non-mevushal grape juice not a problem at all for the non-mevushal grape juice?',
      'Shaila: Mrs. Shapira - 7 Can she use eggs in the Pesach "kitchen" (her basement) from her chametz fridge?',
      'Shaila: Mrs. Shapira - 8 Can she use chicken, which is in the plastic package and in a bag (although the bag is not sealed) from her chametz fridge, if she wipes off the package?',
      'Shaila: Uriel Gross. Double oven used simultaneously one kfp one not?',
    ];
    // Only add if not already present (prevent duplicates on re-run)
    const existing = new Set(tasks.map(t => t.text));
    const toAdd = shailaTexts.filter(t => !existing.has(t));
    if (toAdd.length > 0) {
      // Build the new state directly and FORCE immediate save to Firebase.
      // The normal save path uses a 1500ms debounce — too slow for a one-shot
      // restore. A race with onSnapshot could overwrite the shailos before
      // the debounce fires. So we save synchronously here.
      const newTasks = [...tasks, ...toAdd.map(text => ({
        id: uid(), text, priority: shailaPri, completed: false,
        createdAt: Date.now(), weight: 999,
      }))];
      const newAS = { ...AS };
      const li = newAS.lists.findIndex(l => l.id === newAS.activeListId);
      if (li >= 0) newAS.lists[li] = { ...newAS.lists[li], tasks: newTasks };
      newAS._lsModified = Date.now();
      lastSavedModified.current = newAS._lsModified;
      setAS(newAS);
      Store.ls(newAS);
      Store.saveToFB(newAS);  // immediate — no debounce
      console.log("[restoreShailos] Force-saved", toAdd.length, "shailos to Firebase");
    }
    // Remove the URL param so it doesn't re-trigger
    params.delete("restoreShailos");
    const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  }, [loaded]);

  // ─── Blocked task resume nudge ────────────────────────────────────────────
  useEffect(() => {
    actT.filter(t => t.blocked && t.blockedUntil).forEach(t => {
      if (blockedTmr.current[t.id]) return; // already scheduled
      const remaining = Math.max(0, t.blockedUntil - Date.now());
      blockedTmr.current[t.id] = setTimeout(() => {
        setBlockedResume(t.id);
        delete blockedTmr.current[t.id];
      }, remaining);
    });
    // Clean up timers for tasks no longer blocked
    Object.keys(blockedTmr.current).forEach(id => {
      if (!actT.find(t => t.id === id && t.blocked)) {
        clearTimeout(blockedTmr.current[id]);
        delete blockedTmr.current[id];
      }
    });
  }, [actT]);

  // ─── Stale task nudge — fires once per session, 3s after load ───────────
  useEffect(() => {
    if (!loaded || !pris.length) return;
    const now = Date.now();
    const WEEK   = 7  * 86400000;
    const RESNOOZE = 3 * 86400000; // don't re-nudge same task for 3 days after "Later"
    const candidate = actT
      .filter(t =>
        !t.completed && !t.blocked && !t.parentTask &&
        (now - (t.createdAt || 0)) > WEEK &&
        (!t.staleNudgedAt || (now - t.staleNudgedAt) > RESNOOZE)
      )
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0]; // oldest first
    if (candidate) {
      const tmr = setTimeout(() => setStaleNudge(candidate), 3000);
      return () => clearTimeout(tmr);
    }
  }, [loaded]); // eslint-disable-line

  // Auto-optimize interval removed — AI prioritizes every 5 events instead

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function uT(fn) { setAS(p => { const activeId = p.lists.find(l => l.id === p.activeListId) ? p.activeListId : p.lists[0]?.id; return {...p, activeListId: activeId, lists: p.lists.map(l => l.id === activeId ? {...l, tasks: fn(l.tasks)} : l)}; }); }
  function doOpt(t) { return optTasks(t, pris); }
  function flashOpt() { setJustOpt(true); setTimeout(() => setJustOpt(false), 800); }
  const zenOn = AS?.zenEnabled === true;

  function showToast(msg, dur=10000, color) {
    clearTimeout(toastTmrRef.current);
    setToast({msg, color});
    toastTmrRef.current = setTimeout(() => setToast(null), dur);
  }
  function dismissToast() {
    clearTimeout(toastTmrRef.current);
    setToast(null);
  }

  // ─── Manual launchpad AI prioritization ──────────────────────────────────
  async function launchpadOptimize() {
    if (!hasAI || optLoading) return;
    setOptLoading(true);
    try {
      const {optimized, alreadyOptimal, insight, pinOverride} = await aiOptTasksWithAnalysis(tasksRef.current, pris, aiOpts);
      if (pinOverride) {
        uT(() => optimized); // apply normal reorder (pins respected) first
        setOptConfirm({kind:"pinOverride", ...pinOverride, normalInsight: insight});
      } else if (alreadyOptimal) {
        setOptConfirm({kind:"optimal", insight, optimized});
      } else {
        uT(() => optimized);
        showToast(insight || "Queue reordered ✦", 3500);
      }
    } catch(e) { showToast("Couldn't reach AI — try again", 2500); }
    setOptLoading(false);
  }

  // ─── Zen brain dump capture ───────────────────────────────────────────────
  async function captureZenDump(text) {
    if (!text.trim()) return;
    const activePris = pris.filter(p=>!p.deleted).sort((a,b)=>a.weight-b.weight);
    const lowestPri = activePris[0]?.id || 'eventually';
    const fallback = () => {
      let lines = text.split('\n').filter(l=>l.trim());
      if (lines.length <= 1) {
        lines = text.split(/(?<=[.!?])\s+|;\s*/).map(l=>l.trim()).filter(Boolean);
        if (lines.length <= 1) lines = [text.trim()];
      }
      setZenDumpParsed(p=>[...p,...lines.map(l=>({id:uid(),text:l,priority:lowestPri}))]);
    };
    if (!hasAI) { fallback(); return; }
    setZenDumpParsing(true);
    try {
      const parsed = await aiParseBrainDump(text, pris, aiOpts);
      if (parsed.length > 0) {
        setZenDumpParsed(p=>[...p,...parsed]);
      } else {
        fallback();
      }
    } catch(e) { fallback(); }
    setZenDumpParsing(false);
  }

  // ─── Priority selector dismiss (B10, B11) ────────────────────────────────
  useEffect(() => {
    if (!selPri) return;
    clearTimeout(priTmr.current);
    priTmr.current = setTimeout(() => { if (!newTask.trim() && !showVoice) setSelPri(null); }, 5000);
    return () => clearTimeout(priTmr.current);
  }, [selPri, newTask, showVoice]);

  // B10/B11 fix: dismiss only on tap outside input area, preserve text
  useEffect(() => {
    if (!selPri) return;
    const h = e => {
      if (showVoiceRef.current) return; // voice panel open — never dismiss via click-outside
      const area = document.querySelector('[data-input-area]');
      if (area && area.contains(e.target)) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // B11 fix: DON'T erase task text - just close selector
      setSelPri(null);
      // Only clear text if it's truly empty
    };
    const t = setTimeout(() => document.addEventListener('click', h), 100);
    return () => { clearTimeout(t); document.removeEventListener('click', h); };
  }, [selPri]);

  // ─── Zen mode (B6 fix) ───────────────────────────────────────────────────
  const zenOnRef = useRef(zenOn);
  useEffect(() => { zenOnRef.current = zenOn; }, [zenOn]);
  const showVoiceRef = useRef(showVoice);
  useEffect(() => { showVoiceRef.current = showVoice; }, [showVoice]);

  const resetIdle = useCallback(() => {
    clearTimeout(idleTmr.current);
    if (!zenOnRef.current || !curT || zen || tab !== "focus" || showVoiceRef.current) return;
    idleTmr.current = setTimeout(() => {
      setZen(z => {
        if (!z && curT && tab === "focus" && zenOnRef.current && !showVoiceRef.current) return true;
        return z;
      });
    }, 5000);
  }, [curT?.id, zen, tab]);

  useEffect(() => {
    if (zen || tab !== "focus") return;
    const el = appRef.current;
    if (!el) return;
    const f = () => resetIdle();
    el.addEventListener("keydown", f);
    el.addEventListener("touchstart", f);
    el.addEventListener("click", f);
    resetIdle();
    return () => {
      el.removeEventListener("keydown", f);
      el.removeEventListener("touchstart", f);
      el.removeEventListener("click", f);
      clearTimeout(idleTmr.current);
    };
  }, [resetIdle, zen, tab]);

  const pauseZ = () => { inter.current = true; clearTimeout(idleTmr.current); };
  const resumeZ = () => { inter.current = false; resetIdle(); };
  const exitZen = useCallback(() => { setZen(false); setTimeout(resetIdle, 100); }, [resetIdle]);

  // BUG FIX: If zen is active but curT becomes null (last task completed), auto-exit zen
  useEffect(() => { if (zen && !curT) exitZen(); }, [zen, curT?.id]); // eslint-disable-line
  // Show brain dump review when zen exits and there are captured items
  useEffect(() => { if (!zen && (zenDumpParsed.length > 0 || zenDumpParsing)) setShowZenReview(true); }, [zen]); // eslint-disable-line
  const expandNav = () => { clearTimeout(navTmr.current); setNavExp(true); navTmr.current = setTimeout(() => setNavExp(false), 5000); };

  // ─── Task actions ─────────────────────────────────────────────────────────
  function addTask(e) {
    if (e?.preventDefault) e.preventDefault();
    const tx = newTask.trim();
    if (!tx || !selPri) return;
    const newT = {id:uid(), text:tx, completed:false, priority:selPri, createdAt:Date.now()};
    if (entryEnergy) newT.energy = entryEnergy;
    // Pre-assign shailaId BEFORE adding to state (prevents race with onSnapshot listener)
    if (selPri === "shaila") {
      const col = Store.shailosCol();
      if (col) {
        newT.shailaId = col.doc().id;
        pendingShailaIds.current.add(newT.shailaId);
      }
    }
    uT(ts => doOpt([...ts, newT]));
    setNewTask(""); setSelPri(null); setEntryEnergy(null); flashOpt();
    // Flow 2: shaila-priority task → create shaila doc with the pre-assigned ID
    if (newT.shailaId) {
      Store.createShailaFromTask(newT);
      // Clear from pending after a short delay (state will have updated by then)
      setTimeout(() => pendingShailaIds.current.delete(newT.shailaId), 3000);
    }
    // Show "Added to queue" toast in priority color
    clearTimeout(queueToastTmr.current);
    const priColor = gP(pris, newT.priority).color;
    setQueueToast(priColor);
    setQueueToastKey(k => k + 1);
    queueToastTmr.current = setTimeout(() => setQueueToast(null), 5000);
  }

  function addVT(text, pri) {
    if (!text.trim()) return;
    const isShaila = pris.find(p => p.id === pri && p.isShaila) || pri === "shaila";
    if (isShaila) {
      // Shaila tasks get a 2-step subtask group: research answer + get back to asker
      const col = Store.shailosCol();
      const shailaId = col ? col.doc().id : null;
      if (shailaId) pendingShailaIds.current.add(shailaId);
      const parentText = text.trim();
      const baseTime = Date.now();
      const shortDesc = parentText.substring(0, 40);
      const step1 = {
        id: uid(), text: `Research – ${shortDesc}`, completed: false, priority: pri,
        createdAt: baseTime, shailaId: shailaId,
        parentTask: parentText, stepIndex: 1, totalSteps: 2,
      };
      const step2 = {
        id: uid(), text: `Get back – ${shortDesc}`, completed: false, priority: pri,
        createdAt: baseTime, shailaId: shailaId, isGetBackStep: true,
        parentTask: parentText, stepIndex: 2, totalSteps: 2,
      };
      uT(ts => doOpt([...ts, step1, step2]));
      if (shailaId) {
        Store.createShailaFromTask({...step1, text: parentText});
        setTimeout(() => pendingShailaIds.current.delete(shailaId), 3000);
      }
      flashOpt();
      return;
    }
    const newT = {id:uid(), text:text.trim(), completed:false, priority:pri, createdAt:Date.now()};
    uT(ts => doOpt([...ts, newT]));
    flashOpt();
  }

  function compTask(id, goodEnough=false, isLegacy=false) {
    if (!isLegacy) {
      setJustComp(true); setShowRip(true); setCompFlash(true);
      if (AS?.completionSound) playCompletionSound();
      sessionCompCount.current++;
    }
    const cnt = sessionCompCount.current;
    setTimeout(() => {
      uT(ts => {
        const task = ts.find(t => t.id === id);
        // Flow 4: shaila task completed → update shaila doc status
        if (task?.shailaId) {
          if (task.isGetBackStep) {
            Store.markShailaStatus(task.shailaId, "got_back");
          } else {
            Store.markShailaAnswered(task.shailaId, task.text);
          }
        }
        const u = ts.map(t => t.id===id ? {...t, completed:true, completedAt:isLegacy?null:Date.now(), goodEnough} : t);
        if (task?.parentTask) {
          const r = u.filter(t => t.parentTask === task.parentTask && !t.completed);
          if (r.length === 0) { setCeleb(true); setTimeout(() => setCeleb(false), 3000); }
        }
        return u;
      });
      if (!isLegacy) {
        setJustComp(false); setShowRip(false); setCompFlash(false);
        // Show streak celebration every 3 completions in a session
        if (cnt > 0 && cnt % 3 === 0) {
          setShowStreak(true);
          setTimeout(() => setShowStreak(false), 2600);
        }
      }
    }, isLegacy ? 0 : 600);
    // C06: don't setZen(false) here — zen mode stays active, shows next task
  }

  // Good Enough completion (S10)
  function goodEnoughTask(id) { compTask(id, true); }
  function legacyCompTask(id) { compTask(id, false, true); showToast("Logged ✓ (no timestamp)", 2000); }

  function uncompTask(id) { uT(ts => doOpt(ts.map(t => t.id===id ? {...t, completed:false, completedAt:undefined, goodEnough:undefined} : t))); }
  const [shailaDelPrompt, setShailaDelPrompt] = useState(null); // {shailaId, taskText}
  const [shailaReconcile, setShailaReconcile] = useState(null); // {missingTasks, missingShailos, statusMismatches}
  const [reconcileLoading, setReconcileLoading] = useState(false);

  // ─── Full backup & restore ──────────────────────────────────────────────
  const [backupLoading, setBackupLoading] = useState(false);

  async function doFullBackup() {
    setBackupLoading(true);
    const result = await Store.fullBackup(AS);
    setBackupLoading(false);
    if (result) showToast(`💾 Backup saved — ${result.tasks} tasks, ${result.shailos} shailos`, 5000);
    else showToast("Backup failed — check console", 5000, "#C06060");
  }

  function doLoadBackup() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const parsed = Store.parseBackup(text);
      if (!parsed) { showToast("Invalid backup file", 4000, "#C06060"); return; }

      // Check if backup is older than most recent task/shaila
      const backupDate = parsed.backupDate ? new Date(parsed.backupDate) : null;
      const newestTask = tasks.reduce((max, t) => Math.max(max, t.createdAt || 0, t.completedAt || 0), 0);
      const newestData = Math.max(newestTask, AS?._lsModified || 0);
      let warning = "";
      if (backupDate && newestData && backupDate.getTime() < newestData) {
        const bkStr = backupDate.toLocaleDateString();
        const curStr = new Date(newestData).toLocaleDateString();
        warning = `\n\n⚠️ This backup is from ${bkStr}, but your current data was last modified ${curStr}. Restoring will OVERWRITE newer changes.`;
      }

      const taskCount = parsed.appState?.lists?.reduce((n, l) => n + (l.tasks?.length || 0), 0) || 0;
      const shailaCount = parsed.shailos?.length || 0;
      const ok = window.confirm(
        `Restore from backup?\n\n` +
        `• ${taskCount} tasks\n• ${shailaCount} shaila records\n` +
        `• From: ${parsed.backupDate ? new Date(parsed.backupDate).toLocaleString() : "unknown date"}` +
        warning +
        `\n\nThis will replace your current tasks and restore shailos. Continue?`
      );
      if (!ok) return;

      // Restore tasks (replace AS)
      if (parsed.appState) {
        parsed.appState._lsModified = Date.now();
        setAS(parsed.appState);
      }
      // Restore shailos to Firebase
      if (parsed.shailos?.length) {
        const count = await Store.restoreShailos(parsed.shailos);
        showToast(`✅ Restored ${taskCount} tasks and ${count} shailos from backup`, 6000);
      } else {
        showToast(`✅ Restored ${taskCount} tasks from backup`, 5000);
      }
    };
    input.click();
  }

  async function runShailaReconcile() {
    setReconcileLoading(true);
    // Pass ALL tasks across ALL lists, not just active list
    const allTasks = AS ? AS.lists.flatMap(l => l.tasks || []) : tasks;
    const result = await Store.reconcileShailos(allTasks);
    setReconcileLoading(false);
    const total = result.missingTasks.length + result.missingShailos.length + result.statusMismatches.length;
    if (total === 0) {
      showToast("✅ Shailos are in sync — nothing to fix", 4000);
    } else {
      setShailaReconcile(result);
    }
  }

  function delTask(id) {
    const task = tasks.find(t => t.id === id);
    uT(ts => ts.filter(t => t.id !== id));
    if (task) {
      clearTimeout(deletedTmr.current);
      setDeletedUndo({task, listId: AS.activeListId});
      deletedTmr.current = setTimeout(() => setDeletedUndo(null), 6000);
      // If shaila task with a linked shaila doc, prompt user
      if (task.shailaId && task.priority === "shaila") {
        setShailaDelPrompt({ shailaId: task.shailaId, taskText: task.text });
      }
    }
  }
  function parkTask(id) {
    const tasks = AS?.lists.find(l=>l.id===AS.activeListId)?.tasks || [];
    const task = tasks.find(t => t.id === id);
    const tom = new Date(); tom.setDate(tom.getDate() + 1); tom.setHours(9, 0, 0, 0);
    uT(ts => ts.map(t => t.id === id ? {...t, snoozedUntil: tom.getTime()} : t));
    if (task) {
      clearTimeout(parkedTmr.current);
      setParkedUndo({task, listId: AS.activeListId});
      parkedTmr.current = setTimeout(() => setParkedUndo(null), 6000);
    }
  }

  function wakeTask(id) {
    uT(ts => ts.map(t => t.id === id ? {...t, snoozedUntil: undefined} : t));
  }

  function saveShailaField(id, field, value) {
    setAS(p => ({...p, lists: p.lists.map(l => ({...l, tasks: l.tasks.map(t => t.id===id ? {...t, [field]: value} : t)}))}));
    // When an answer is saved, generate a 6-word AI summary and store it alongside
    if (field === "shailaAnswer" && value.trim() && hasAI) {
      aiSummarizeAnswer(value, aiOpts).then(summary => {
        if (summary) setAS(p => ({...p, lists: p.lists.map(l => ({...l, tasks: l.tasks.map(t => t.id===id ? {...t, answerSummary: summary} : t)}))}));
      }).catch(() => {});
    }
  }

  function handleShailaGotBack(id, value) {
    saveShailaField(id, "gotBackToAsker", value);
    // Also sync to the linked Firebase shaila doc
    const task = (AS?.lists || []).flatMap(l => l.tasks).find(t => t.id === id);
    if (task?.shailaId) {
      Store.markShailaStatus(task.shailaId, value ? "got_back" : "answered");
    }
  }

  function handleAddManualShaila({text, shailaAnswer, askedBy, answeredBy}) {
    if (!text?.trim()) return;
    const shailaPriId = pris.find(p => p.isShaila)?.id || "shaila";
    const baseTime = Date.now();
    const parentText = text.trim();
    const snip = parentText.length > 38 ? parentText.slice(0, 38) + "…" : parentText;
    const askerSuffix = askedBy?.trim() ? ` (${askedBy.trim()})` : "";
    const newTasks = [
      {
        id: uid(), text: `Research: ${snip}`, priority: shailaPriId,
        shailaAnswer: shailaAnswer || "",
        askedBy: askedBy || "", answeredBy: answeredBy || "",
        createdAt: baseTime,
        blocked: false, completed: false, energy: null, pinned: false,
        parentTask: parentText, stepIndex: 1, totalSteps: 2,
      },
      {
        id: uid(), text: `Get back about: ${snip}${askerSuffix}`, priority: shailaPriId,
        createdAt: baseTime + 1,
        blocked: false, completed: false, energy: null, pinned: false,
        parentTask: parentText, stepIndex: 2, totalSteps: 2,
        isGetBackStep: true,
      },
    ];
    setAS(p => ({...p, lists: p.lists.map(l =>
      l.id === p.activeListId ? {...l, tasks: [...l.tasks, ...newTasks]} : l
    )}));
  }

  function addShailas(items) {
    const shailaPriId = pris.find(p => p.isShaila)?.id || "shaila";
    const newTasks = [];
    items.forEach(item => {
      const parentText = item.shaila;
      const snip = parentText.length > 38 ? parentText.slice(0, 38) + "…" : parentText;
      const askerSuffix = item.askedBy?.trim() ? ` (${item.askedBy.trim()})` : "";
      const baseTime = Date.now();
      newTasks.push({
        id: item.id, text: `Research: ${snip}`, priority: shailaPriId,
        shailaAnswer: item.answer || "",
        askedBy: item.askedBy || "", answeredBy: item.answeredBy || "",
        createdAt: baseTime,
        blocked: false, completed: false, energy: null, pinned: false,
        parentTask: parentText, stepIndex: 1, totalSteps: 2,
      });
      newTasks.push({
        id: uid(), text: `Get back about: ${snip}${askerSuffix}`, priority: shailaPriId,
        createdAt: baseTime,
        blocked: false, completed: false, energy: null, pinned: false,
        parentTask: parentText, stepIndex: 2, totalSteps: 2,
        isGetBackStep: true,
      });
    });
    setAS(p => ({...p, lists: p.lists.map(l =>
      l.id === p.activeListId ? {...l, tasks: [...l.tasks, ...newTasks]} : l
    )}));
    setShowVoice(false);
  }

  // ─── Undo auto-aging on a task ───────────────────────────────────────────
  function undoAging(id) {
    uT(ts => ts.map(t => t.id !== id ? t : {
      ...t, priority: t.agedFromPriId || t.priority,
      autoAged: false, agedFromPriId: undefined, agedFromLabel: undefined, prioritySetAt: undefined
    }));
  }

  // ─── AI first step: open modal, fetch suggestion ─────────────────────────
  async function openFirstStep(task) {
    setFirstStepModal({task, step: null, loading: true, edited: ""});
    try {
      const step = await suggestFirstStep(task.text, aiOpts);
      setFirstStepModal(m => m ? {...m, loading: false, step, edited: step || ""} : null);
    } catch(e) {
      setFirstStepModal(m => m ? {...m, loading: false, step: null, edited: ""} : null);
    }
  }

  // ─── Create the confirmed first step as a Now task ───────────────────────
  function confirmFirstStep() {
    if (!firstStepModal?.edited?.trim()) return;
    const nowPri = [...pris].filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight)[0];
    if (!nowPri) return;
    uT(ts => [{id:uid(), text:firstStepModal.edited.trim(), priority:nowPri.id, createdAt:Date.now(), prioritySetAt:Date.now(), completed:false}, ...ts]);
    showToast("First step added as Now ✦", 5000);
    setFirstStepModal(null);
  }

  function delGroup(parentTaskName) { uT(ts => ts.filter(t => t.parentTask !== parentTaskName && !(t.text === parentTaskName && ts.some(s => s.parentTask === t.text)))); }
  function cloneTask(t) { uT(ts => doOpt([...ts, {id:uid(), text:t.text, completed:false, priority:t.priority, createdAt:Date.now()}])); flashOpt(); }

  function moveTop(id) {
    uT(ts => {
      const a = ts.filter(t => !t.completed), c = ts.filter(t => t.completed);
      const tg = a.find(t => t.id === id); if (!tg) return ts;
      if (tg.parentTask) {
        // Move whole group to top
        const groupTasks = a.filter(t => t.parentTask === tg.parentTask).map(t => ({...t, pinned:true}));
        const rest = a.filter(t => t.parentTask !== tg.parentTask);
        return [...groupTasks, ...rest, ...c];
      }
      // Check if this task is a group parent (has subtasks)
      const subs = a.filter(t => t.parentTask === tg.text);
      if (subs.length) {
        const rest = a.filter(t => t.id !== id && t.parentTask !== tg.text);
        return [{...tg, pinned:true}, ...subs.map(t=>({...t,pinned:true})), ...rest, ...c];
      }
      const rest = a.filter(t => t.id !== id);
      return [{...tg, pinned:true}, ...rest, ...c];
    });
  }

  function unpinTask(id) { uT(ts => ts.map(t => t.id===id ? {...t, pinned:false} : t)); }

  function handleDrop(tid) {
    if (!dragId || dragId === tid) return;
    uT(ts => {
      const a = ts.filter(t => !t.completed), c = ts.filter(t => t.completed);
      const dragTask = a.find(t => t.id===dragId);
      const dropTask = a.find(t => t.id===tid);
      if (!dragTask || !dropTask) return ts;
      // If dragging a group, move ALL its subtasks together as a block
      const movingIds = dragTask.parentTask
        ? new Set(a.filter(t => t.parentTask===dragTask.parentTask).map(t=>t.id))
        : new Set([dragId]);
      const moving = a.filter(t => movingIds.has(t.id)).map(t=>({...t, pinned:true}));
      // Drop anchor: use the first subtask of drop target's group, or the task itself
      const anchorId = dropTask.parentTask
        ? a.find(t => t.parentTask===dropTask.parentTask)?.id
        : tid;
      const rest = a.filter(t => !movingIds.has(t.id));
      const ai = rest.findIndex(t => t.id===anchorId);
      if (ai < 0) rest.push(...moving);
      else rest.splice(ai, 0, ...moving);
      return [...rest, ...c];
    });
    setDragId(null);
  }

  // Block task — durationMs controls when the "still blocked?" nudge fires
  function blockTask(id, note, durationMs) {
    setBlockedModal(null);
    const now = Date.now();
    uT(ts => {
      const task = ts.find(t => t.id===id); if (!task) return ts;
      const active = ts.filter(t => !t.completed);
      const comp = ts.filter(t => t.completed);
      const others = active.filter(t => t.id !== id);
      const blocked = {...task, blocked:true, blockedAt:now, blockedUntil:now+durationMs, blockedDuration:durationMs, blockedNote:note, priority:task._origPriority||task.priority, _origPriority:task.priority};
      return [...others, blocked, ...comp];
    });
  }

  // Resume blocked task (F8)
  function resumeBlocked(id) {
    setBlockedResume(null);
    uT(ts => doOpt(ts.map(t => t.id===id ? {...t, blocked:false, blockedAt:undefined, blockedNote:undefined, priority:t._origPriority||t.priority, _origPriority:undefined} : t)));
  }

  // Mrs. W task (S11)
  function addMrsWTask(text, pri) {
    if (!text.trim()) return;
    uT(ts => doOpt([...ts, {id:uid(), text:text.trim(), completed:false, priority:pri||mrsWPriLive||"eventually", createdAt:Date.now(), mrsW:true}]));
    flashOpt();
  }

  // AI optimize
  async function manOpt() {
    if (hasAI && actT.length >= 3) {
      setOptLoading(true);
      const optimized = await aiOptTasks(tasks, pris, aiOpts);
      uT(() => optimized);
      setOptLoading(false);
    } else {
      uT(ts => doOpt(ts));
    }
    flashOpt();
  }

  function startEd(t) { setEditId(t.id); setEditTx(t.text); setTimeout(() => edRef.current?.focus(), 50); }
  function saveEd(id) { const tx = editTx.trim(); if (!tx) { setEditId(null); return; } uT(ts => ts.map(t => t.id===id ? {...t, text:tx} : t)); setEditId(null); }
  function chgPriority(tid, np, scope) {
    uT(ts => {
      const task = ts.find(t => t.id === tid);
      if (scope === 'group' && task?.parentTask) {
        // Change all uncompleted siblings to the new priority
        return doOpt(ts.map(t => t.parentTask === task.parentTask && !t.completed ? {...t, priority:np} : t));
      }
      return doOpt(ts.map(t => t.id===tid ? {...t, priority:np} : t));
    });
    setChgPri(null);
    setChgPriScope('one');
  }

  // Park all remaining (uncompleted) steps of a subtask group at the lowest priority.
  // The current step stays as-is; siblings get bumped down so they stop competing.
  function parkRestOfGroup(task) {
    if (!task?.parentTask) return;
    const lowestPri = [...pris].filter(p => !p.deleted).sort((a,b) => a.weight - b.weight)[0]?.id || 'eventually';
    uT(ts => doOpt(ts.map(t =>
      t.parentTask === task.parentTask && !t.completed && t.id !== task.id
        ? {...t, priority: lowestPri}
        : t
    )));
    showToast('Remaining steps parked — get back to them when ready', 3000);
  }
  function addList() { const n = prompt("New list name:"); if (!n?.trim()) return; const id = uid(); setAS(p => ({...p, lists:[...p.lists,{id,name:n.trim(),tasks:[]}], activeListId:id})); }
  function renList(id) { const l = AS.lists.find(x=>x.id===id); if (!l) return; const n = prompt("Rename:", l.name); if (!n?.trim()) return; setAS(p => ({...p, lists:p.lists.map(x=>x.id===id?{...x,name:n.trim()}:x)})); }
  function doDelList(id) { setDelConf(null); if (AS.lists.length<=1) return; setAS(p => { const nl=p.lists.filter(l=>l.id!==id); return {...p,lists:nl,activeListId:p.activeListId===id?nl[0].id:p.activeListId}; }); }
  function switchList(id) { setAS(p => ({...p, activeListId:id})); setShowLM(false); }
  function addPri(label, color) {
    const id="pri_"+uid();
    // Custom priorities rank below Eventually(1) by default — weight 0 so they never outrank builtins
    // unless the user manually drags/edits them up
    const customWeights = pris.filter(p=>!p.deleted&&!["shaila","now","today","eventually"].includes(p.id)&&!p.isShaila).map(p=>p.weight);
    const w = customWeights.length > 0 ? Math.max(...customWeights) - 0.1 : 0.5;
    setAS(p=>({...p,priorities:[...p.priorities,{id,label,color,weight:w}]}));
  }
  function remPri(id) { if(id==="shaila")return; if(ap.length<=1)return; setAS(p=>({...p,priorities:p.priorities.map(x=>x.id===id?{...x,deleted:true}:x)})); }
  function bulkAdd(items) { uT(ts => doOpt([...ts, ...items.map(i=>({id:uid(),text:i.text,completed:false,priority:i.priority,createdAt:Date.now()}))])); setShowBulk(false); flashOpt(); }

  // B12 fix: steps stored with just the step text, parentTask stored separately
  function confirmBD(pt, sts) {
    const pp = showBD?.priority || ap[1]?.id || ap[0]?.id;
    uT(ts => doOpt([
      ...ts.filter(t => showBD?.id ? t.id !== showBD.id : true),
      ...sts.map((text, i) => ({
        id: uid(),
        text: text, // B12: no "Step N of parent:" prefix
        completed: false,
        priority: pp,
        createdAt: Date.now(),
        parentTask: pt,
        stepIndex: i + 1,
        totalSteps: sts.length
      }))
    ]));
    setShowBD(null); flashOpt();
  }

  // Add a single subtask to an existing group (or create a new group on any task)
  function addSubtask(parentTaskName, text, priority) {
    const siblings = actT.filter(t => t.parentTask === parentTaskName);
    const newIdx = siblings.length + 1;
    const pri = priority || siblings[0]?.priority || ap[1]?.id || ap[0]?.id;
    const newSub = { id: uid(), text: text.trim(), completed: false, priority: pri, createdAt: Date.now(), parentTask: parentTaskName, stepIndex: newIdx, totalSteps: newIdx };
    // Update totalSteps on all siblings
    uT(ts => doOpt([...ts.map(t => t.parentTask === parentTaskName ? {...t, totalSteps: newIdx} : t), newSub]));
    flashOpt();
  }

  // Convert a regular task into a crystal group (start manual subtask mode)
  function startManualGroup(task) {
    // Turn task into first crystal, keep same text as parent label
    uT(ts => doOpt(ts.map(t => t.id === task.id ? {...t, parentTask: task.text, stepIndex: 1, totalSteps: 1} : t)));
    flashOpt();
  }

  // Remove duplicate unparented tasks — keeps the first occurrence of each text,
  // drops any later copies. Completed tasks and subtasks are left alone.
  function deduplicateTasks() {
    uT(ts => {
      const seenText = new Set();
      const seenShailaId = new Set();
      let removed = 0;
      const deduped = ts.filter(t => {
        if (t.parentTask || t.completed) return true;
        // Dedup by shailaId (most important — prevents listener dupes)
        if (t.shailaId) {
          if (seenShailaId.has(t.shailaId)) { removed++; return false; }
          seenShailaId.add(t.shailaId);
        }
        // Also dedup by text
        const k = t.text.trim().toLowerCase();
        if (seenText.has(k)) { removed++; return false; }
        seenText.add(k);
        return true;
      });
      if (removed) showToast(`✓ Removed ${removed} duplicate${removed === 1 ? "" : "s"}`, 3000);
      else showToast("✓ No duplicates found", 3000);
      return deduped;
    });
  }

  const metrics = useMemo(() => {
    const c = allComp.filter(t => t.completedAt && t.createdAt);
    if (!c.length) return null;
    const byP = {};
    pris.forEach(p => { byP[p.id] = {ts:[], c:p.color, l:p.label}; });
    let tot = 0;
    c.forEach(t => { const ms = t.completedAt - t.createdAt; tot += ms; if (byP[t.priority]) byP[t.priority].ts.push(ms); });
    const pS = Object.entries(byP).filter(([,v])=>v.ts.length>0).map(([k,v])=>({id:k,l:v.l,c:v.c,n:v.ts.length,a:fmtMs(v.ts.reduce((a,b)=>a+b,0)/v.ts.length)}));
    const byH = {};
    c.forEach(t => { const h = new Date(t.completedAt).getHours(); byH[h]=(byH[h]||0)+1; });
    const bH = Object.entries(byH).sort((a,b)=>b[1]-a[1])[0];
    // B8 fix: midnight = 12:00 AM not 0:00 AM
    const pT = bH ? (parseInt(bH[0])===0?"12:00 AM":parseInt(bH[0])<12?`${bH[0]}:00 AM`:parseInt(bH[0])===12?"12:00 PM":`${parseInt(bH[0])-12}:00 PM`) : null;
    const byD = {};
    c.forEach(t => { const d = new Date(t.completedAt).toLocaleDateString("en-US",{weekday:"long"}); byD[d]=(byD[d]||0)+1; });
    const bD = Object.entries(byD).sort((a,b)=>b[1]-a[1])[0];
    const ds = new Set(c.map(t=>new Date(t.completedAt).toDateString()));
    let sk = 0; const td = new Date();
    for (let i=0; i<365; i++) { const d=new Date(td); d.setDate(d.getDate()-i); if(ds.has(d.toDateString()))sk++;else break; }
    const goodEnoughCount = c.filter(t => t.goodEnough).length;
    return {total:c.length, avg:fmtMs(tot/c.length), pS, bD, pT, sk, cL:c.sort((a,b)=>b.completedAt-a.completedAt), goodEnoughCount};
  }, [allComp, pris]);

  // Chart data derived from metrics.cL — used by the visual charts in the Insights tab
  const chartData = useMemo(() => {
    if (!metrics) return null;
    const cL = metrics.cL;
    const now = Date.now();
    const DAY = 86400000;
    const fmtH = h => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`;

    // 24h: by hour-of-day, completions in the last 24 hours
    const h24 = Array.from({length:24}, (_,i) => ({h:i, n:0, label:fmtH(i)}));
    cL.filter(t => now - t.completedAt < DAY).forEach(t => { h24[new Date(t.completedAt).getHours()].n++; });

    // 7d: by calendar date, last 7 days
    const days7 = Array.from({length:7}, (_,i) => {
      const d = new Date(now - (6-i)*DAY);
      return {date:d.toDateString(), label:d.toLocaleDateString('en-US',{weekday:'short'}).slice(0,2), n:0};
    });
    cL.filter(t => now - t.completedAt < 7*DAY).forEach(t => {
      const entry = days7.find(d => d.date === new Date(t.completedAt).toDateString());
      if (entry) entry.n++;
    });

    // 30d: by calendar date, last 30 days
    const days30 = Array.from({length:30}, (_,i) => {
      const d = new Date(now - (29-i)*DAY);
      return {date:d.toDateString(), label:i%5===0?String(d.getDate()):'', n:0, dow:d.getDay()};
    });
    cL.filter(t => now - t.completedAt < 30*DAY).forEach(t => {
      const entry = days30.find(d => d.date === new Date(t.completedAt).toDateString());
      if (entry) entry.n++;
    });

    // All-time: by hour-of-day across all completions
    const allHours = Array.from({length:24}, (_,i) => ({h:i, n:0, label:fmtH(i)}));
    cL.forEach(t => { allHours[new Date(t.completedAt).getHours()].n++; });

    // Priority breakdown for donut (from metrics.pS, already computed)
    const donut = metrics.pS.filter(p => p.n > 0);

    // Day-of-week pattern (all-time)
    const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dow = Array.from({length:7}, (_,i) => ({h:i, n:0, label:DOW_NAMES[i]}));
    cL.forEach(t => { dow[new Date(t.completedAt).getDay()].n++; });

    // Completion speed buckets (creation → completion)
    const speedBuckets = [
      {label:'< 1h',  max:3600000,      n:0},
      {label:'< 1d',  max:86400000,     n:0},
      {label:'< 1w',  max:7*86400000,   n:0},
      {label:'< 1mo', max:30*86400000,  n:0},
      {label:'1mo+',  max:Infinity,     n:0},
    ];
    cL.filter(t => t.createdAt).forEach(t => {
      const ms = t.completedAt - t.createdAt;
      const b = speedBuckets.find(b => ms < b.max);
      if (b) b.n++;
    });

    // 30-day trend (by day, same as days30 — used for line chart)
    const trend30 = days30.map(d => ({...d})); // copy

    // Cumulative completions over time (last 90 days)
    const cum90raw = Array.from({length:90}, (_,i) => {
      const d = new Date(now - (89-i)*DAY);
      return {date:d.toDateString(), label: i%15===0 ? `${d.getMonth()+1}/${d.getDate()}` : '', n:0, cum:0};
    });
    cL.filter(t => now - t.completedAt < 90*DAY).forEach(t => {
      const entry = cum90raw.find(d => d.date === new Date(t.completedAt).toDateString());
      if (entry) entry.n++;
    });
    let running = 0;
    cum90raw.forEach(d => { running += d.n; d.cum = running; });
    // Normalise for chart: use cum as the bar height
    const cum90 = cum90raw.map(d => ({...d, n: d.cum}));

    return {h24, days7, days30, allHours, donut, dow, speedBuckets, trend30, cum90};
  }, [metrics]);

  const advice = useMemo(() => {
    if (!metrics) return [];
    const a = [];
    if (metrics.pT) a.push(`Your peak hour is ${metrics.pT} — schedule your hardest tasks then.`);
    if (metrics.bD) a.push(`Best day: ${metrics.bD[0]}s (${metrics.bD[1]} tasks). Try to batch difficult work then.`);
    if (metrics.sk >= 3) a.push(`${metrics.sk}-day streak! That's real momentum.`);
    if (!metrics.sk) a.push("No completions today. Try the 5-minute rule: just start for five minutes.");
    if (metrics.goodEnoughCount > 0) a.push(`${metrics.goodEnoughCount} task${metrics.goodEnoughCount!==1?"s":""} marked "good enough" — that's smart ADHD energy management.`);
    if (!a.length) a.push("Keep going!");
    return a;
  }, [metrics]);

  // dailyTip removed — tipCarouselItem is now the single source of truth
  const dateStr = new Date().toLocaleDateString("en-US", {weekday:"long", month:"long", day:"numeric"});

  const TIP_CATS = ["All", ...new Set(TIPS.map(t => t.cat))];
  const filteredTips = tipCat === "All" ? TIPS : TIPS.filter(t => t.cat === tipCat);

  // Carousel helpers
  const tipCarouselList = filteredTips;
  const tipCarouselIdx = Math.min(tipViewIdx, tipCarouselList.length - 1);
  const tipCarouselItem = tipCarouselList[tipCarouselIdx] || TIPS[0];

  // Reset carousel index when category changes
  useEffect(() => { setTipViewIdx(0); }, [tipCat]);

  // AI insight generator
  const genAiInsight = async () => {
    if (!hasAI || !metrics) return;
    setAiInsightLoading(true);
    setAiInsight(null);
    const recentDone = metrics.cL.slice(0,10).map(t=>t.text).join("; ");
    const priTiers = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight).map(p=>p.label).join(" → ");
    const priBreakdownDetailed = metrics.pS.map(p=>`${p.l}: ${p.n} done, avg ${p.a}`).join("; ");
    const prompt = `You are a professional productivity analyst. Analyze this user's task completion data and provide a structured, data-driven summary.

CRITICAL RULES:
- NEVER compare completion times across priority tiers. "Eventually" tasks take longer than "Now" tasks BY DESIGN — different categories entirely. Treat each tier independently.
- Tone: professional and direct. Not critical or judgmental. Not overly enthusiastic or cheerleader-ish. Just clear, honest, useful.
- Surface real patterns from the data. If something is genuinely working well, note it factually.
- Each bullet must reference specific numbers or task names from the data.

Priority tiers (high urgency → low urgency): ${priTiers}
Each tier has fundamentally different expected timeframes — this is by design.

Data:
- Total completed: ${metrics.total} tasks
- Current streak: ${metrics.sk} days
- Peak hour: ${metrics.pT || "unknown"}
- Best day: ${metrics.bD ? metrics.bD[0] : "unknown"} (${metrics.bD ? metrics.bD[1] + " tasks" : ""})
- By priority tier (completed): ${priBreakdownDetailed}
- Overall avg completion time: ${metrics.avg}
- Good enough completions: ${metrics.goodEnoughCount || 0}
- Recent completions: ${recentDone}

REQUIRED OUTPUT FORMAT — use this exact structure, no preamble, no extra text:
• [First observation — a specific pattern grounded in the data]
• [Second observation — a different angle, e.g. timing, energy, or tier consistency]
• [Third observation — something actionable or forward-looking]
TAKEAWAY: [The single most useful thing to know. One sentence. Specific.]`;
    const result = await callAI(prompt, aiOpts);
    setAiInsight(result || "Complete more tasks to generate a personalized insight.");
    setAiInsightLoading(false);
  };

  // AI Chat — ask questions about task data
  const sendAiChat = async (msg) => {
    if (!hasAI || !metrics || !msg.trim()) return;
    const userMsg = msg.trim();
    setAiChatHistory(h => {
      const updated = [...h, {role:"user", text:userMsg}];
      return updated.slice(-60); // Archive limit: keep last 60 messages
    });
    setAiChatInput("");
    setAiChatLoading(true);
    const recentDone = metrics.cL.slice(0,20).map(t => `"${t.text}" (${t.priority}, ${t.completedAt?Math.round((t.completedAt-t.createdAt)/60000)+"min":"?"})`).join("; ");
    const priBreakdown = metrics.pS.map(p=>`${p.l}:${p.n} done, avg ${p.a}`).join("; ");
    const activeBreakdown = actT.map(t => `"${t.text}" [${gP(pris,t.priority).label}]${t.blocked?" BLOCKED":""}${t.pinned?" PINNED":""}`).join("; ");
    const prevChat = aiChatHistory.slice(-6).map(m => `${m.role}: ${m.text}`).join("\n");
    const priTiersChat = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight).map(p=>p.label).join(" → ");
    const sysPrompt = `You are a warm, expert ADHD productivity analyst. Give detailed, data-driven answers with specific numbers and patterns — always from a supportive, non-critical perspective.

CRITICAL RULES:
- NEVER compare completion times across priority tiers. "Eventually" tasks take longer than "Now" tasks BY DESIGN — they are a completely different category, like comparing a sprint to a marathon. Treat each tier independently and never present the difference as a problem.
- Never be critical, judgmental, or frame anything as a failure.
- Ground every insight in the user's actual data.
- Priority tiers (high urgency → low): ${priTiersChat}

Data snapshot:
- Total completed: ${metrics.total} tasks
- Active queue: ${actT.length} tasks (${actT.filter(t=>t.pinned).length} pinned, ${actT.filter(t=>t.blocked).length} blocked)
- Current streak: ${metrics.sk} days
- Peak completion hour: ${metrics.pT||"unknown"}
- Best completion day: ${metrics.bD ? metrics.bD[0]+" ("+metrics.bD[1]+" tasks)" : "unknown"}
- Priority breakdown completed: ${priBreakdown}
- Overall avg completion time: ${metrics.avg}
- Good enough completions: ${metrics.goodEnoughCount || 0} of ${metrics.total} (${metrics.total?Math.round((metrics.goodEnoughCount||0)/metrics.total*100):0}%)
- Active tasks: ${activeBreakdown}
- Recent completions: ${recentDone}

${prevChat ? "Previous chat:\n" + prevChat + "\n" : ""}User question: ${userMsg}

Give a thorough, analytical response (4-8 sentences) with specific numbers and actionable insights. No bullet points or headers.`;
    const result = await callAI(sysPrompt, aiOpts);
    setAiChatHistory(h => {
      const updated = [...h, {role:"ai", text:result || "I couldn't analyze that. Try a different question."}];
      return updated.slice(-60);
    });
    setAiChatLoading(false);
  };

  const chatBoxRef = useRef(null);

  // Autoscroll chat to bottom — scrolls the CHAT BOX only, never the page
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [aiChatHistory, aiChatLoading]);

  // Helper: change tab and close any open menus
  const switchTab = (t) => { setTab(t); setShowLM(false); setNavExp(false); setShowAides(false); setShowEntryTools(false); };

  const syncDeskPhoneTheme = useCallback(async (force = false) => {
    if (!deskPhoneThemeSyncEnabled) return false;
    if (!force && lastDeskPhoneThemeRef.current === deskPhoneThemeQuery) return true;
    try {
      const res = await fetch(`http://127.0.0.1:8765/theme?${deskPhoneThemeQuery}`, {
        method: "POST",
        cache: "no-store"
      });
      if (!res.ok) throw new Error("theme sync failed");
      lastDeskPhoneThemeRef.current = deskPhoneThemeQuery;
      setDeskPhoneOnline(true);
      return true;
    } catch {
      // DeskPhone may be closed; the next Open Phone action will launch it.
      setDeskPhoneOnline(false);
      return false;
    }
  }, [deskPhoneThemeQuery, deskPhoneThemeSyncEnabled]);
  useEffect(() => {
    syncDeskPhoneTheme();
  }, [syncDeskPhoneTheme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("deskphoneThemeRefresh")) return;
    syncDeskPhoneTheme(true);
    params.delete("deskphoneThemeRefresh");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`);
  }, [syncDeskPhoneTheme]);

  useEffect(() => {
    if (!deskPhoneThemeSyncEnabled) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8765/status", { cache: "no-store" });
        if (!res.ok) throw new Error("DeskPhone status failed");
        if (stopped) return;
        if (!deskPhoneOnline) {
          await syncDeskPhoneTheme(true);
        } else {
          setDeskPhoneOnline(true);
        }
      } catch {
        if (!stopped) setDeskPhoneOnline(false);
      }
    };
    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [deskPhoneOnline, deskPhoneThemeSyncEnabled, syncDeskPhoneTheme]);

  if (!AS) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui",color:"#999"}}>Loading...</div>;

  const isShailaPriority = (id) => id === "shaila" || !!pris.find(p => p.id === id && p.isShaila);
  const switchboardTaskList = actT.filter(t => !isShailaPriority(t.priority) && !t.isGetBackStep).slice(0, 6);
  const switchboardShailaList = actT.filter(t => isShailaPriority(t.priority) && !t.isGetBackStep && !t.completed).slice(0, 6);
  const shailaOpenCount = switchboardShailaList.length;
  const shellHidden = !!(zen && curT);
  const launchDeskPhone = (force = false) => {
    if (!force && deskPhoneOnline) return;
    const now = Date.now();
    if (now - deskPhoneLaunchAtRef.current < 15000) return;
    deskPhoneLaunchAtRef.current = now;
    try {
      const link = document.createElement("a");
      link.href = "deskphone://open";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      try { window.location.href = "deskphone://open"; } catch {}
    }
  };
  const bringDeskPhoneForward = async () => {
    if (!deskPhoneOnline) {
      launchDeskPhone(true);
      return;
    }
    try {
      const res = await fetch("http://127.0.0.1:8765/show", { method: "POST", cache: "no-store" });
      if (!res.ok) throw new Error("show failed");
      await syncDeskPhoneTheme(true);
      setDeskPhoneOnline(true);
    } catch {
      launchDeskPhone(true);
    }
  };
  const sendDeskPhoneCommand = async (path) => {
    try {
      const res = await fetch(`http://127.0.0.1:8765${path}`, { method: "POST", cache: "no-store" });
      if (!res.ok) throw new Error("phone command failed");
      setDeskPhoneOnline(true);
    } catch {
      launchDeskPhone(true);
    }
  };
  const openCommandView = (view) => {
    if (view === "deskphone") {
      bringDeskPhoneForward();
      return;
    }
    setSuiteView(view);
    if (view !== "shailos") setShailosAction(null);
    if (view === "focus") setShowShailos(false);
  };
  const askLegacyOpen = (target) => setLegacyPrompt(target);
  const openLegacyTarget = () => {
    const target = legacyPrompt;
    setLegacyPrompt(null);
    if (!target) return;
    if (target.id === "shailos") {
      setShailosAction(target.action || null);
      setShowShailos(true);
    } else if (target.id === "tasks") {
      openCommandView("focus");
    } else if (target.id === "deskphone") {
      openCommandView("deskphone");
    }
  };
  const openLegacyInCommandCenter = () => {
    const target = legacyPrompt;
    setLegacyPrompt(null);
    if (!target) return;
    if (target.id === "shailos") {
      setShailosAction(target.action || null);
      openCommandView("shailos");
    } else if (target.id === "tasks") {
      openCommandView("switchboard");
    } else if (target.id === "deskphone") {
      openCommandView("deskphone");
    }
  };
  const switchboardSections = [
    {
      id: "priority",
      title: "Priority",
      icon: "low_priority",
      meta: "Tasks, queue, and next action",
      actions: [
        {id:"current-task", label:"Current task", note:"Return to the main task card", icon:"task_alt", primary:true, run:()=>{openCommandView("focus"); switchTab("focus");}},
        {id:"new-task", label:"New task", note:"Pick priority and add one item", icon:"add_circle", run:()=>{openCommandView("focus"); switchTab("focus");}},
        {id:"queue", label:"Open queue", note:`${effectiveCount} item${effectiveCount===1?"":"s"} waiting`, icon:"view_list", run:()=>{openCommandView("focus"); switchTab("queue");}},
        {id:"prioritize", label:optLoading ? "Sorting..." : "Choose next", note:"Put the best next item first", icon:"auto_awesome", disabled:optLoading, run:launchpadOptimize},
        {id:"shatter", label:"Break into steps", note:"Make a big item smaller", icon:"account_tree", run:()=>setShowBD(true)},
        {id:"brain-dump", label:"Brain dump", note:"Drop in everything on your mind", icon:"psychology", run:()=>setShowBrainDump(true)},
        {id:"bulk-add", label:"Paste a list", note:"Add many items at once", icon:"playlist_add", run:()=>setShowBulk(true)},
      ],
    },
    {
      id: "shaila",
      title: "Shaila",
      icon: "rule",
      meta: "Questions, answers, and follow-up",
      actions: [
        {id:"questions", label:"Questions", note:`${shailaOpenCount} open`, icon:"rule", primary:true, run:()=>{setShailosAction(null); openCommandView("shailos");}},
        {id:"add-shaila", label:"Add shaila", note:"Create a question manually", icon:"add_circle", run:()=>{setShailosAction("add-manual"); openCommandView("shailos");}},
        {id:"question-followup", label:"Follow-up", note:"Review answers and got-back status", icon:"fact_check", run:()=>setShowShailaManager(true)},
        {id:"reconcile", label:reconcileLoading ? "Checking..." : "Check sync", note:"Make sure questions and tasks match", icon:"sync", disabled:reconcileLoading, run:runShailaReconcile},
        {id:"classic-shailos", label:"Classic question screen", note:"Open the older view", icon:"history", run:()=>askLegacyOpen({id:"shailos", label:"Classic question screen"})},
      ],
    },
    {
      id: "record",
      title: "Record",
      icon: "mic",
      meta: "Voice, call capture, and extraction",
      actions: [
        {id:"record-anything", label:"Record conversation", note:"Pull out tasks and questions", icon:"mic", primary:true, run:()=>{setConvCallMode(false); setShowConvCapture(true);}},
        {id:"record-call", label:"Call capture", note:"Record a call and extract follow-up", icon:"phone_in_talk", run:()=>{setConvCallMode(true); setShowConvCapture(true);}},
        {id:"voice-task", label:"Voice task", note:"Add by speaking through priority circles", icon:"keyboard_voice", run:()=>{openCommandView("focus"); switchTab("focus");}},
        {id:"record-shaila", label:"Record shaila", note:"Capture a question by voice", icon:"record_voice_over", run:()=>{setShailosAction("record-shaila"); openCommandView("shailos");}},
      ],
    },
    {
      id: "phone",
      title: "Phone",
      icon: "phone_in_talk",
      meta: "Calls, texts, and call notes",
      actions: [
        {id:"launch-phone", label:"Open phone", note:deskPhoneOnline ? "Ready" : "Start DeskPhone", icon:"smartphone", primary:true, run:bringDeskPhoneForward},
        {id:"answer-phone", label:"Answer", note:"Incoming call", icon:"phone_callback", run:()=>sendDeskPhoneCommand("/answer")},
        {id:"end-phone", label:"Hang up", note:"End active call", icon:"call_end", run:()=>sendDeskPhoneCommand("/hangup")},
        {id:"sync-phone", label:"Sync", note:"Refresh calls and texts", icon:"sync", run:()=>sendDeskPhoneCommand("/refresh")},
        {id:"record-phone-call", label:"Record phone call", note:"Capture call audio", icon:"phone_in_talk", run:()=>{setConvCallMode(true); setShowConvCapture(true);}},
      ],
    },
    {
      id: "focus",
      title: "Focus",
      icon: "self_improvement",
      meta: "Stay with one thing",
      actions: [
        {id:"zen", label:"Zen mode", note:"Fullscreen calm task view", icon:"self_improvement", primary:true, disabled:!curT, run:()=>{if(curT)setZen(true);}},
        {id:"body-double", label:"Body double", note:"Keep a work session going", icon:"person", run:()=>setShowBodyDouble(true)},
        {id:"insights", label:"Insights", note:"Progress and patterns", icon:"insights", run:()=>{openCommandView("focus"); switchTab("insights");}},
      ],
    },
    {
      id: "system",
      title: "System",
      icon: "settings",
      meta: "Preferences and backups",
      actions: [
        {id:"settings", label:"Preferences", note:"Theme, lists, and options", icon:"settings", primary:true, run:()=>setShowSet(true)},
        {id:"backup", label:backupLoading ? "Saving..." : "Save backup", note:"Download a copy", icon:"download", disabled:backupLoading, run:doFullBackup},
        {id:"restore", label:"Restore backup", note:"Load a saved copy", icon:"upload_file", run:doLoadBackup},
      ],
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div ref={appRef} style={{height:"100vh",overflow:"hidden",background:`linear-gradient(170deg,${T.grad[0]} 0%,${T.grad[1]} 50%,${T.grad[2]} 100%)`,fontFamily:"'Google Sans','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif",color:T.text,display:"flex",flexDirection:"column",alignItems:"center"}}>

      {/* Overlays */}
      {zen && curT && <ZenMode task={curT} pris={pris} T={T} onExit={exitZen} onDone={(isl)=>isl?legacyCompTask(curT.id):compTask(curT.id)}
        justStartId={justStartId} curTaskId={curT?.id} onDoneJustStart={()=>setJustStartId(null)} jsMinimized={jsMinimized} onRestoreJs={()=>setJsMinimized(false)}
        showBodyDouble={showBodyDouble} bdMinimized={bdMinimized} onRestoreBd={()=>setBdMinimized(false)} onCloseBd={()=>{setShowBodyDouble(false);setBdMinimized(false);}}
        onCapture={captureZenDump} zenDumpParsing={zenDumpParsing}
        onOpenShailos={()=>setSuiteView("shailos")}
      />}
      {showZenReview && (
        <ZenDumpReview
          tasks={zenDumpParsed} pris={pris} T={T} parsing={zenDumpParsing}
          onSubmit={(items) => {
            items.forEach(item => uT(ts => [...ts, {id:uid(),text:item.text,priority:item.priority,completed:false,createdAt:Date.now()}]));
            setZenDumpParsed([]); setShowZenReview(false);
          }}
          onDismiss={() => { setZenDumpParsed([]); setShowZenReview(false); }}
        />
      )}
      {celeb && <Confetti colors={ap.map(p=>p.color)}/>}
      {/* Queue "Added" toast — global, shows regardless of active tab */}
      {queueToast && (
        <div key={queueToastKey} style={{position:"fixed",bottom:"clamp(90px,14vh,130px)",left:"50%",transform:"translateX(-50%)",background:queueToast,color:"#fff",borderRadius:20,padding:"6px 16px",fontSize:12,fontWeight:700,fontFamily:"system-ui",whiteSpace:"nowrap",boxShadow:"0 3px 16px rgba(0,0,0,0.22)",animation:"ot-queue-toast 5s ease forwards",pointerEvents:"none",zIndex:9800}}>
          ✦ Added to queue
        </div>
      )}
      {optConfirm && (
        <div style={{position:"fixed",inset:0,zIndex:9900,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.38)"}}>
          <div style={{background:T.card,borderRadius:22,padding:"32px 36px",maxWidth:360,width:"88%",boxShadow:"0 14px 56px rgba(0,0,0,0.28)",textAlign:"center",animation:"ot-fade 0.2s"}}>
            {optConfirm.kind === "pinOverride" ? (
              <>
                <div style={{fontSize:28,marginBottom:14,lineHeight:1}}>📌</div>
                <p style={{fontSize:15,fontWeight:700,color:T.text,margin:"0 0 8px",fontFamily:"system-ui",letterSpacing:.2}}>Override a pin?</p>
                <p style={{fontSize:13,color:T.tSoft,margin:"0 0 6px",fontFamily:"system-ui",lineHeight:1.5}}>AI flagged <strong style={{color:T.text}}>{optConfirm.taskName}</strong> as urgent enough to jump above your pinned tasks.</p>
                <p style={{fontSize:12,color:T.tFaint,margin:"0 0 26px",fontFamily:"system-ui",lineHeight:1.5,fontStyle:"italic"}}>{optConfirm.reason}</p>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>{uT(()=>optConfirm.optimizedWithOverride);setOptConfirm(null);showToast("Moved above pins ✦",2500);}}
                    style={{padding:"9px 20px",borderRadius:11,border:"none",background:T.text,cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.bg||"#fff",fontWeight:700}}>
                    Yes, move above pins
                  </button>
                  <button onClick={()=>setOptConfirm(null)}
                    style={{padding:"9px 20px",borderRadius:11,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.tSoft,fontWeight:500}}>
                    Keep pins
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{fontSize:30,marginBottom:14,lineHeight:1}}>✦</div>
                <p style={{fontSize:15,fontWeight:700,color:T.text,margin:"0 0 10px",fontFamily:"system-ui",letterSpacing:.2}}>Queue already looks sharp</p>
                <p style={{fontSize:13,color:T.tSoft,margin:"0 0 26px",fontFamily:"system-ui",lineHeight:1.6}}>{optConfirm.insight || "The current order is already well-prioritized."}</p>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>{uT(()=>optConfirm.optimized);setOptConfirm(null);showToast("Reordered anyway ✦",2500);}}
                    style={{padding:"9px 22px",borderRadius:11,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.tSoft,fontWeight:500}}>
                    Reorder anyway
                  </button>
                  <button onClick={()=>setOptConfirm(null)}
                    style={{padding:"9px 24px",borderRadius:11,border:"none",background:T.text,cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.bg||"#fff",fontWeight:700}}>
                    Got it
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {firstStepModal && (
        <div style={{position:"fixed",inset:0,zIndex:9900,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.38)"}} onClick={()=>setFirstStepModal(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"28px 28px 24px",maxWidth:380,width:"90%",boxShadow:"0 14px 56px rgba(0,0,0,0.28)",animation:"ot-fade 0.2s"}}>
            <div style={{fontSize:22,marginBottom:6,lineHeight:1}}>✦</div>
            <p style={{fontSize:13,fontWeight:700,color:T.text,margin:"0 0 4px",fontFamily:"system-ui",letterSpacing:.2}}>First step</p>
            <p style={{fontSize:12,color:T.tFaint,margin:"0 0 16px",fontFamily:"inherit",fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{firstStepModal.task.text}</p>
            {firstStepModal.loading ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px 0 20px",color:T.tFaint,fontSize:12,fontFamily:"system-ui"}}>
                <div style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${T.tFaint}`,borderTopColor:"transparent",animation:"ot-spin 0.7s linear infinite"}}/>
                Thinking…
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  value={firstStepModal.edited}
                  onChange={e=>setFirstStepModal(m=>({...m,edited:e.target.value}))}
                  onKeyDown={e=>{if(e.key==="Enter")confirmFirstStep();if(e.key==="Escape")setFirstStepModal(null);}}
                  placeholder="Describe the first step…"
                  style={{width:"100%",fontSize:13,fontFamily:"inherit",border:`1px solid ${T.brd}`,borderRadius:12,padding:"9px 12px",outline:"none",color:T.text,background:T.bgW,boxSizing:"border-box",marginBottom:16}}
                />
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>setFirstStepModal(null)}
                    style={{padding:"9px 20px",borderRadius:11,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.tSoft,fontWeight:500}}>
                    Cancel
                  </button>
                  <button onClick={confirmFirstStep} disabled={!firstStepModal.edited?.trim()}
                    style={{padding:"9px 24px",borderRadius:11,border:"none",background:firstStepModal.edited?.trim()?T.text:"#aaa",cursor:firstStepModal.edited?.trim()?"pointer":"default",fontSize:13,fontFamily:"system-ui",color:T.bg||"#fff",fontWeight:700}}>
                    Create as Now ✦
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {toast && <Toast message={toast.msg} color={toast.color} onDismiss={dismissToast}/>}
      {deletedUndo && (
        <div style={{position:"fixed",bottom:"clamp(55px,9vh,80px)",left:"50%",transform:"translateX(-50%)",background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,padding:"8px 14px",fontSize:12,fontFamily:"system-ui",color:T.tSoft,whiteSpace:"nowrap",boxShadow:T.shadowLg,display:"flex",alignItems:"center",gap:10,zIndex:9800,animation:"ot-fade 0.2s"}}>
          <span style={{color:T.tFaint}}>Task deleted</span>
          <button onClick={()=>{clearTimeout(deletedTmr.current);setAS(p=>({...p,lists:p.lists.map(l=>l.id===deletedUndo.listId?{...l,tasks:[...l.tasks,deletedUndo.task]}:l)}));setDeletedUndo(null);}} style={{background:"none",border:`1px solid ${T.brd}`,borderRadius:8,padding:"3px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:T.text,fontFamily:"system-ui"}}>Undo</button>
        </div>
      )}
      {parkedUndo && (
        <div style={{position:"fixed",bottom:"clamp(55px,9vh,80px)",left:"50%",transform:"translateX(-50%)",background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,padding:"8px 14px",fontSize:12,fontFamily:"system-ui",color:T.tSoft,whiteSpace:"nowrap",boxShadow:T.shadowLg,display:"flex",alignItems:"center",gap:10,zIndex:9800,animation:"ot-fade 0.2s"}}>
          <span style={{color:T.tFaint}}>☀️ Parked until tomorrow</span>
          <button onClick={()=>{clearTimeout(parkedTmr.current);setAS(p=>({...p,lists:p.lists.map(l=>l.id===parkedUndo.listId?{...l,tasks:l.tasks.map(t=>t.id===parkedUndo.task.id?{...t,snoozedUntil:parkedUndo.task.snoozedUntil}:t)}:l)}));setParkedUndo(null);}} style={{background:"none",border:`1px solid ${T.brd}`,borderRadius:8,padding:"3px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:T.text,fontFamily:"system-ui"}}>Undo</button>
        </div>
      )}

      {/* Floating drawer menus */}
      {showEntryTools && (
        <div style={{position:"fixed",inset:0,zIndex:8000}} onClick={()=>setShowEntryTools(false)}>
          <div onClick={e=>e.stopPropagation()} style={{position:"absolute",bottom:"clamp(100px,18vh,160px)",left:"50%",transform:"translateX(-50%)",background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,boxShadow:T.shadowLg,padding:8,minWidth:200,animation:"ot-fade 0.15s"}}>
            <button onClick={()=>{setShowBrainDump(true);setShowEntryTools(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Brain s={13} c={T.tSoft}/> Brain Dump
            </button>
            <button onClick={()=>{setShowBulk(true);setShowEntryTools(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Plus s={13} c={T.tSoft}/> Bulk Add
            </button>
            <button onClick={()=>{setShowBD(true);setShowEntryTools(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Split s={13} c={T.tSoft}/> Shatter a task
            </button>
          </div>
        </div>
      )}
      {showAides && (
        <div style={{position:"fixed",inset:0,zIndex:8000}} onClick={()=>setShowAides(false)}>
          <div onClick={e=>e.stopPropagation()} style={{position:"absolute",bottom:"clamp(100px,18vh,160px)",left:"50%",transform:"translateX(-50%)",background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,boxShadow:T.shadowLg,padding:8,minWidth:200,animation:"ot-fade 0.15s"}}>
            <button onClick={()=>{if(curT)setJustStartId(justStartId===curT?.id?null:curT?.id);setShowAides(false);}} disabled={!curT} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:curT?"pointer":"default",fontSize:12,fontFamily:"system-ui",color:curT?T.tSoft:T.tFaint,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left",opacity:curT?1:.5}} onMouseEnter={e=>{if(curT)e.currentTarget.style.background=T.bgW;}} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Timer s={13} c={T.tSoft}/> Just Start (2 min)
            </button>
            <button onClick={()=>{setShowBodyDouble(true);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Person s={13} c={T.tSoft}/> Body Double
            </button>
            {curT && (
              <button onClick={()=>{setZen(true);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.Moon s={13} c={T.tSoft}/> Enter Zen Mode
              </button>
            )}
            <button onClick={()=>{goodEnoughTask(curT?.id);setShowAides(false);}} disabled={!curT} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:curT?"pointer":"default",fontSize:12,fontFamily:"system-ui",color:curT?T.tSoft:T.tFaint,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left",opacity:curT?1:.5}} onMouseEnter={e=>{if(curT)e.currentTarget.style.background=T.bgW;}} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:16,lineHeight:1}}>≈</span> Good Enough
            </button>
            {curT && (
              <button onClick={()=>{setBlockedModal(curT);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.Pause s={13} c={T.tSoft}/> Blocked
              </button>
            )}
            {curT && (
              <button onClick={()=>{setChgPri(curT.id);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.PriC s={13} c={T.tSoft}/> Change Priority
              </button>
            )}
            {curT && (
              <button onClick={()=>{delTask(curT.id);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:"#C94040",display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.Trash s={13} c="#C94040"/> Delete Task
              </button>
            )}
          </div>
        </div>
      )}

      {/* Firebase offline warning — shown when Firebase was unreachable on load */}
      {fbOffline && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:10000,background:"#C94040",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:"system-ui",fontSize:13,gap:12}}>
          <span>⚠️ Could not reach cloud storage — your tasks may still be safe in Firebase. Refresh to retry, or check your connection.</span>
          <button onClick={()=>setFbOffline(false)} style={{padding:"6px 14px",borderRadius:8,background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",cursor:"pointer",fontSize:12,color:"#fff",flexShrink:0}}>Dismiss</button>
        </div>
      )}


      {/* Modals */}
      {showBulk && <BulkAdd pris={pris} T={T} onAddAll={bulkAdd} onClose={()=>setShowBulk(false)}/>}
      {showBD !== null && <TaskBD task={showBD===true?null:showBD} pris={pris} T={T} onConfirm={confirmBD} onClose={()=>setShowBD(null)} aiOpts={aiOpts}/>}
      {showListMgr && <ListManager AS={AS} setAS={setAS} T={T} onClose={()=>setShowListMgr(false)}/>}
      {showBodyDouble && <BodyDoubleTimer T={T} minimized={bdMinimized} onMinimize={()=>setBdMinimized(true)} onRestore={()=>setBdMinimized(false)} onClose={()=>{setShowBodyDouble(false);setBdMinimized(false);}}/>}
      {/* Floating minimized pills */}
      {justStartId && jsMinimized && (
        <div onClick={()=>setJsMinimized(false)} style={{position:"fixed",bottom:16,right:16,zIndex:9200,background:curT?gP(pris,curT.priority).color:"#7EB0DE",borderRadius:20,padding:"6px 12px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",boxShadow:"0 2px 12px rgba(0,0,0,0.2)",animation:"ot-fade 0.2s"}}>
          <IC.Timer s={12} c="#fff"/>
          <span style={{fontSize:11,color:"#fff",fontFamily:"system-ui",fontWeight:700}}>Just Start</span>
        </div>
      )}
      {/* Voice input — root level so it survives tab switches */}
      {showVoice && selPri && (
        <VoiceInput
          onResult={t=>{addVT(t,selPri);setShowVoice(false);}}
          onClose={()=>setShowVoice(false)}
          onAddShailos={addShailas}
          onExistingShailaAnswers={(shailaTaskId, answer) => {
            // Mark the research step answered, save the answer field
            saveShailaField(shailaTaskId, "shailaAnswer", answer);
            // Also auto-complete the research step
            compTask(shailaTaskId, false, true);
            showToast("✅ Answer saved to existing shaila", 3000);
          }}
          existingShailos={actT.filter(t => t.priority === "shaila" && !t.isGetBackStep)}
          color={gP(pris,selPri).color}
          T={T}
          aiOpts={aiOpts}
        />
      )}
      {showBrainDump && <BrainDump T={T} pris={pris} onCapture={(text)=>{captureZenDump(text);setShowZenReview(true);setShowBrainDump(false);}} onClose={()=>setShowBrainDump(false)}/>}
      {/* Shaila Transcriber — full-screen iframe overlay */}
      {showShailos && (
        <div style={{position:"fixed",inset:0,zIndex:9000,background:T.bg,display:"flex",flexDirection:"column",animation:"ot-fade 0.2s"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:`1px solid ${T.brd}`,background:T.card,flexShrink:0}}>
            <span style={{fontSize:14,fontWeight:600,color:T.text,fontFamily:"system-ui"}}>Shaila Transcriber</span>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <button onClick={doFullBackup} disabled={backupLoading} title="Download full backup (tasks + shailos)" style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",fontFamily:"system-ui",fontWeight:500,opacity:backupLoading ? .5 : 1}}>{backupLoading?"⏳":"💾"} Backup</button>
              <button onClick={doLoadBackup} title="Restore from backup file" style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",fontFamily:"system-ui",fontWeight:500}}>📂 Restore</button>
              <button onClick={runShailaReconcile} disabled={reconcileLoading} title="Sync check" style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",fontFamily:"system-ui",fontWeight:500,opacity:reconcileLoading ? .5 : 1}}>{reconcileLoading?"⏳":"🔄"}</button>
              <button onClick={()=>{setShowShailos(false);setShailosAction(null);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tSoft,padding:4}}>✕</button>
            </div>
          </div>
          <iframe src={shailosAction ? `/shailos/?action=${shailosAction}` : "/shailos/"} style={{flex:1,border:"none",width:"100%"}} title="Shaila Transcriber"/>
        </div>
      )}
      {/* Shaila delete prompt — asks if user also wants to delete from transcriber record */}
      {shailaDelPrompt && (
        <div style={{position:"fixed",inset:0,zIndex:9500,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s"}} onClick={()=>setShailaDelPrompt(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:18,padding:"22px 20px",maxWidth:380,width:"90%",boxShadow:"0 12px 48px rgba(0,0,0,0.2)"}}>
            <h3 style={{fontSize:15,fontWeight:600,margin:"0 0 8px",color:T.text,fontFamily:"system-ui"}}>Also delete from Shaila record?</h3>
            <p style={{fontSize:13,color:T.tSoft,margin:"0 0 18px",lineHeight:1.5,fontFamily:"system-ui"}}>
              The task <strong>"{shailaDelPrompt.taskText?.substring(0,50)}"</strong> was removed from your queue. Delete it from the Shaila Transcriber record too?
            </p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setShailaDelPrompt(null);}} style={{flex:1,padding:11,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontFamily:"system-ui",fontSize:13,fontWeight:500}}>Keep record</button>
              <button onClick={()=>{Store.deleteShailaDoc(shailaDelPrompt.shailaId);setShailaDelPrompt(null);showToast("Shaila record deleted",3000);}} style={{flex:1,padding:11,borderRadius:12,border:"none",background:"#C06060",color:"#fff",cursor:"pointer",fontFamily:"system-ui",fontSize:13,fontWeight:600}}>Delete both</button>
            </div>
          </div>
        </div>
      )}
      {/* Shaila reconciliation modal — shows mismatches, lets user fix each one */}
      {shailaReconcile && (
        <div style={{position:"fixed",inset:0,zIndex:9500,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s"}} onClick={()=>setShailaReconcile(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:18,padding:"22px 20px",maxWidth:480,width:"90%",maxHeight:"80vh",overflowY:"auto",boxShadow:"0 12px 48px rgba(0,0,0,0.2)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{fontSize:15,fontWeight:600,margin:0,color:T.text,fontFamily:"system-ui"}}>🔄 Shaila Sync Check</h3>
              <button onClick={()=>setShailaReconcile(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tSoft}}>✕</button>
            </div>

            {/* Shailos in transcriber without a task */}
            {shailaReconcile.missingTasks.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <p style={{fontSize:12,fontWeight:700,color:T.tSoft,margin:0,fontFamily:"system-ui"}}>In Transcriber, no task in queue ({shailaReconcile.missingTasks.length}):</p>
                  <button onClick={()=>{
                    const newTasks = shailaReconcile.missingTasks.flatMap(s => {
                      const parentText = s.synopsis||s.content||s.parsedShaila||"New shaila";
                      const shortDesc = parentText.substring(0,40);
                      const baseTime = Date.now();
                      return [
                        {id:uid(), text:`Research – ${shortDesc}`, completed:false, priority:"shaila", createdAt:baseTime, shailaId:s.id, parentTask:parentText, stepIndex:1, totalSteps:2},
                        {id:uid(), text:`Get back – ${shortDesc}`, completed:false, priority:"shaila", createdAt:baseTime, shailaId:s.id, isGetBackStep:true, parentTask:parentText, stepIndex:2, totalSteps:2},
                      ];
                    });
                    uT(ts=>[...ts, ...newTasks]);
                    setShailaReconcile(prev=>({...prev, missingTasks:[]}));
                    showToast(`Added ${shailaReconcile.missingTasks.length} shaila${shailaReconcile.missingTasks.length!==1?"s":""} to queue`,3000);
                  }} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:"none",background:"#C8A84C",color:"#fff",cursor:"pointer",fontFamily:"system-ui",fontWeight:600,whiteSpace:"nowrap"}}>+ Add all ({shailaReconcile.missingTasks.length})</button>
                </div>
                <div style={{maxHeight:240,overflowY:"auto"}}>
                {shailaReconcile.missingTasks.map(s => (
                  <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:T.bgW,borderRadius:10,marginBottom:4}}>
                    <span style={{fontSize:13,color:T.text,fontFamily:"Georgia,serif",flex:1,marginRight:8}}>{s.synopsis || s.content?.substring(0,60) || "Shaila"}</span>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <button onClick={()=>{
                        const parentText = s.synopsis||s.content||s.parsedShaila||"New shaila";
                        const shortDesc = parentText.substring(0,40);
                        const baseTime = Date.now();
                        const newTasks = [
                          {id:uid(), text:`Research – ${shortDesc}`, completed:false, priority:"shaila", createdAt:baseTime, shailaId:s.id, parentTask:parentText, stepIndex:1, totalSteps:2},
                          {id:uid(), text:`Get back – ${shortDesc}`, completed:false, priority:"shaila", createdAt:baseTime, shailaId:s.id, isGetBackStep:true, parentTask:parentText, stepIndex:2, totalSteps:2},
                        ];
                        uT(ts=>[...ts, ...newTasks]);
                        setShailaReconcile(prev=>({...prev, missingTasks:prev.missingTasks.filter(x=>x.id!==s.id)}));
                        showToast("Added to queue",2000);
                      }} style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"none",background:"#C8A84C",color:"#fff",cursor:"pointer",fontFamily:"system-ui",fontWeight:600}}>+ Add</button>
                      <button onClick={()=>{
                        setShailaReconcile(prev=>({...prev, missingTasks:prev.missingTasks.filter(x=>x.id!==s.id)}));
                      }} style={{fontSize:11,padding:"5px 8px",borderRadius:8,border:`1px solid ${T.brd}`,background:"none",color:T.tFaint,cursor:"pointer",fontFamily:"system-ui"}}>Skip</button>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}

            {/* Tasks without a shaila record */}
            {shailaReconcile.missingShailos.length > 0 && (
              <div style={{marginBottom:16}}>
                <p style={{fontSize:12,fontWeight:700,color:T.tSoft,margin:"0 0 8px",fontFamily:"system-ui"}}>In task queue, no transcriber record:</p>
                {shailaReconcile.missingShailos.map(t => (
                  <div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:T.bgW,borderRadius:10,marginBottom:4}}>
                    <span style={{fontSize:13,color:T.text,fontFamily:"Georgia,serif",flex:1,marginRight:8}}>{t.text?.substring(0,60)}</span>
                    <button onClick={()=>{
                      Store.createShailaFromTask(t).then(shailaId=>{
                        if(shailaId) uT(ts=>ts.map(x=>x.id===t.id?{...x,shailaId}:x));
                        setShailaReconcile(prev=>({...prev, missingShailos:prev.missingShailos.filter(x=>x.id!==t.id)}));
                        showToast("Added to transcriber",2000);
                      });
                    }} style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"none",background:"#C8A84C",color:"#fff",cursor:"pointer",fontFamily:"system-ui",fontWeight:600,whiteSpace:"nowrap"}}>+ Add record</button>
                  </div>
                ))}
              </div>
            )}

            {/* Status mismatches */}
            {shailaReconcile.statusMismatches.length > 0 && (
              <div style={{marginBottom:16}}>
                <p style={{fontSize:12,fontWeight:700,color:T.tSoft,margin:"0 0 8px",fontFamily:"system-ui"}}>Status mismatch:</p>
                {shailaReconcile.statusMismatches.map(m => (
                  <div key={m.task.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:T.bgW,borderRadius:10,marginBottom:4}}>
                    <div style={{flex:1,marginRight:8}}>
                      <span style={{fontSize:13,color:T.text,fontFamily:"Georgia,serif"}}>{m.task.text?.substring(0,50)}</span>
                      <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginLeft:6}}>— answered in transcriber, still active in queue</span>
                    </div>
                    <button onClick={()=>{
                      uT(ts=>ts.map(x=>x.id===m.task.id?{...x,completed:true,completedAt:Date.now()}:x));
                      setShailaReconcile(prev=>({...prev, statusMismatches:prev.statusMismatches.filter(x=>x.task.id!==m.task.id)}));
                      showToast("Task completed",2000);
                    }} style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"none",background:"#4A8040",color:"#fff",cursor:"pointer",fontFamily:"system-ui",fontWeight:600,whiteSpace:"nowrap"}}>Complete ✓</button>
                  </div>
                ))}
              </div>
            )}

            {/* All fixed */}
            {shailaReconcile.missingTasks.length === 0 && shailaReconcile.missingShailos.length === 0 && shailaReconcile.statusMismatches.length === 0 && (
              <p style={{textAlign:"center",fontSize:14,color:T.tSoft,fontFamily:"system-ui",margin:"20px 0"}}>✅ All synced!</p>
            )}
          </div>
        </div>
      )}
      {blockedModal && <BlockedModal task={blockedModal} T={T} pris={pris} onBlock={blockTask} onClose={()=>setBlockedModal(null)}/>}
      {/* Context tags removed */}
      {showSet && <SettingsModal AS={AS} setAS={setAS} T={T} ap={ap} onClose={()=>setShowSet(false)} onSignOut={onSignOut}
        onOptimize={launchpadOptimize} optLoading={optLoading} hasAI={hasAI} aiConfig={aiConfig}
        onBulkAdd={()=>{setShowSet(false);setShowBulk(true);}} onShatter={()=>{setShowSet(false);setShowBD(true);}}
        onDedup={()=>{deduplicateTasks();}}
        curEnergy={curEnergy} onSetEnergy={e=>setAS(p=>({...p,currentEnergy:e}))}
        focusModeActive={focusModeActive} onToggleFocusMode={()=>setFocusModeActive(f=>!f)}
        effectiveCount={effectiveCount} overwhelmThreshold={overwhelmThreshold}
        deskPhoneThemeSync={deskPhoneThemeSyncEnabled}
        deskPhoneOnline={deskPhoneOnline}
        onToggleDeskPhoneThemeSync={() => {
          const next = !deskPhoneThemeSyncEnabled;
          setAS(p => ({...p, deskPhoneThemeSync: next}));
        }}
        onRefreshDeskPhoneTheme={async () => {
          const ok = await syncDeskPhoneTheme(true);
          showToast(ok ? "DeskPhone theme sync refreshed" : "DeskPhone is not answering", 3000, ok ? undefined : "#C06060");
          return ok;
        }}
      />}

      {pendingRecordings.length > 0 && (
        <div style={{position:"fixed",right:16,bottom:16,zIndex:9400,width:"min(380px,calc(100vw - 32px))",background:T.card,border:`1.5px solid ${T.brd}`,borderRadius:14,boxShadow:T.shadowLg,padding:12,fontFamily:"system-ui",animation:"ot-fade 0.2s"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
            <div>
              <div style={{fontSize:12,fontWeight:800,color:T.text,letterSpacing:.2}}>Transcription Holding Pen</div>
              <div style={{fontSize:10,color:T.tFaint,marginTop:2}}>Saved audio from any recorder in this app</div>
            </div>
            <span style={{fontSize:10,fontWeight:800,color:"#9A6A20",background:"#C8A84C22",border:"1px solid #C8A84C55",borderRadius:999,padding:"2px 7px",whiteSpace:"nowrap"}}>{pendingRecordings.length} saved</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:300,overflowY:"auto"}}>
            {pendingRecordings.slice(0,5).map(rec => {
              const busy = pendingRetryId === rec.id;
              const transcript = pendingTranscripts[rec.id] || "";
              const label = rec.label || String(rec.kind || "Recording").replace(/_/g, " ");
              return (
                <div key={rec.id} style={{background:T.bgW,border:`1px solid ${T.brdS}`,borderRadius:10,padding:9}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
                      <div style={{fontSize:10,color:T.tFaint,marginTop:1}}>{formatPendingAge(rec.createdAt)} · {(rec.size/1024/1024).toFixed(1)} MB</div>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={()=>retryHeldTranscription(rec)} disabled={!hasAI || !!pendingRetryId} style={{fontSize:10,padding:"5px 8px",borderRadius:7,border:"none",background:hasAI&&!pendingRetryId?"#5B7BE8":T.brdS,color:hasAI&&!pendingRetryId?"#fff":T.tFaint,cursor:hasAI&&!pendingRetryId?"pointer":"default",fontWeight:700}}>{busy?"Retrying...":"Retry"}</button>
                      <button onClick={()=>deleteHeldTranscription(rec)} disabled={busy} style={{fontSize:10,padding:"5px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:"none",color:T.tFaint,cursor:busy?"default":"pointer"}}>Delete</button>
                    </div>
                  </div>
                  {rec.error && <div style={{fontSize:10,color:"#C94040",marginTop:6,lineHeight:1.35,maxHeight:38,overflow:"hidden"}}>{rec.error}</div>}
                  {transcript && (
                    <div style={{marginTop:7}}>
                      <textarea value={transcript} readOnly rows={3} style={{width:"100%",boxSizing:"border-box",resize:"vertical",border:`1px solid ${T.brd}`,borderRadius:8,background:T.card,color:T.text,fontSize:11,lineHeight:1.45,padding:7,fontFamily:"Georgia,serif"}}/>
                      <button onClick={()=>navigator.clipboard?.writeText(transcript)} style={{marginTop:5,width:"100%",fontSize:10,padding:"5px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.card,color:T.tSoft,cursor:"pointer",fontWeight:700}}>Copy transcript</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Blocked resume nudge */}
      {blockedResume && actT.find(t=>t.id===blockedResume) && (
        <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.card,border:`1.5px solid ${T.brd}`,borderRadius:14,padding:"12px 16px",boxShadow:T.shadowLg,zIndex:9500,maxWidth:340,width:"90%",animation:"ot-fade 0.3s"}}>
          <p style={{fontSize:13,fontWeight:600,margin:"0 0 4px",fontFamily:"system-ui"}}>Ready to try again?</p>
          <p style={{fontSize:12,color:T.tSoft,margin:"0 0 10px",fontFamily:"system-ui"}}>{actT.find(t=>t.id===blockedResume)?.text}</p>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{
              // Snooze: push blockedUntil forward by the same duration originally chosen
              const task = actT.find(t=>t.id===blockedResume);
              const dur = task?.blockedDuration || 3*3600000;
              uT(ts=>ts.map(t=>t.id===blockedResume?{...t,blockedUntil:Date.now()+dur}:t));
              if(blockedTmr.current[blockedResume]){clearTimeout(blockedTmr.current[blockedResume]);delete blockedTmr.current[blockedResume];}
              setBlockedResume(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:11,fontFamily:"system-ui",color:T.tSoft}}>Later</button>
            <button onClick={()=>resumeBlocked(blockedResume)} style={{flex:1,padding:"7px",borderRadius:8,border:"none",background:ap[0]?.color,color:textOnColor(ap[0]?.color||"#5A9E7C"),cursor:"pointer",fontSize:11,fontFamily:"system-ui",fontWeight:600}}>Resume</button>
          </div>
        </div>
      )}

      {/* Stale task nudge — fires 3s after load for tasks waiting 7+ days */}
      {staleNudge && actT.find(t => t.id === staleNudge.id) && (
        <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.card,border:`1.5px solid ${T.brd}`,borderRadius:14,padding:"14px 16px",boxShadow:T.shadowLg,zIndex:9490,maxWidth:360,width:"90%",animation:"ot-fade 0.3s"}}>
          <p style={{fontSize:11,fontWeight:700,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 3px",textTransform:"uppercase",letterSpacing:.5}}>
            ⏳ Waiting {Math.floor((Date.now()-(staleNudge.createdAt||Date.now()))/86400000)} days
          </p>
          <p style={{fontSize:13,color:T.text,margin:"0 0 10px",fontFamily:"Georgia,serif",lineHeight:1.4}}>{staleNudge.text}</p>
          <p style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 10px"}}>Prioritize it now, or break it into smaller steps?</p>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>{
              uT(ts => ts.map(t => t.id===staleNudge.id ? {...t, staleNudgedAt:Date.now()} : t));
              setStaleNudge(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:11,fontFamily:"system-ui",color:T.tSoft,minWidth:60}}>Later</button>
            <button onClick={()=>{
              const topPri = [...pris].filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight)[0];
              if (topPri) chgPriority(staleNudge.id, topPri.id, 'one');
              setStaleNudge(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:"none",background:"#C49040",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"system-ui",minWidth:80}}>Make it Now</button>
            <button onClick={()=>{
              setShowBD(staleNudge);
              setStaleNudge(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:11,fontFamily:"system-ui",color:T.text,minWidth:90}}>Break it down</button>
          </div>
        </div>
      )}

      {/* Priority change picker */}
      {chgPri && (
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{setChgPri(null);setChgPriScope('one');}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:18,padding:"20px 24px",boxShadow:T.shadowLg,maxWidth:320,width:"90%"}}>
            {chgPriIsSubtask && (
              <div style={{display:"flex",gap:6,marginBottom:14,background:T.bg,borderRadius:10,padding:4}}>
                {[{v:'one',label:'This step only'},{v:'group',label:'All remaining steps'}].map(opt => (
                  <button key={opt.v} onClick={()=>setChgPriScope(opt.v)} style={{flex:1,padding:"6px 0",borderRadius:8,border:"none",background:chgPriScope===opt.v?T.card:"transparent",fontWeight:chgPriScope===opt.v?700:400,color:chgPriScope===opt.v?T.text:T.tFaint,fontSize:11,cursor:"pointer",fontFamily:"system-ui",boxShadow:chgPriScope===opt.v?"0 1px 4px rgba(0,0,0,0.1)":"none"}}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <p style={{fontSize:13,fontWeight:600,margin:"0 0 14px",fontFamily:"system-ui"}}>
              {chgPriIsSubtask && chgPriScope==='group' ? 'Change all remaining steps:' : 'Change priority:'}
            </p>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {ap.map(p => (
                <button key={p.id} onClick={()=>chgPriority(chgPri,p.id,chgPriIsSubtask?chgPriScope:'one')} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:10,border:`2px solid ${p.color}`,background:pBg(p.color),cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:T.text}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:p.color}}/>{p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {delConf && (
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setDelConf(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"32px 28px",maxWidth:340,textAlign:"center",boxShadow:T.shadowLg}}>
            <h3 style={{margin:"0 0 12px",fontSize:18,fontWeight:500}}>Delete list?</h3>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setDelConf(null)} style={{flex:1,padding:12,borderRadius:12,border:`1px solid ${T.brd}`,background:T.card,cursor:"pointer",fontFamily:"system-ui",fontSize:13,fontWeight:600,color:T.tSoft}}>Cancel</button>
              <button onClick={()=>doDelList(delConf)} style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#E07070",color:"#fff",cursor:"pointer",fontFamily:"system-ui",fontSize:13,fontWeight:600}}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Streak celebration overlay */}
      {showStreak && (
        <div style={{position:"fixed",top:"50%",left:"50%",zIndex:9990,pointerEvents:"none",animation:"ot-streak 2.6s forwards",textAlign:"center",fontFamily:"system-ui"}}>
          <div style={{fontSize:48,marginBottom:6}}>🔥</div>
          <div style={{fontSize:20,fontWeight:700,color:T.text,textShadow:"0 2px 12px rgba(0,0,0,0.12)"}}>On a roll!</div>
          <div style={{fontSize:13,color:T.tSoft,marginTop:4}}>{todayCompCount} done today</div>
        </div>
      )}

      {/* BlockReflectModal */}
      {showBlockReflect && curT && (
        <BlockReflectModal task={curT} T={T} aiOpts={aiOpts} onClose={()=>setShowBlockReflect(false)}/>
      )}

      {/* ShailaManager */}
      {showShailaManager && (
        <ShailaManager AS={AS} T={T} aiOpts={aiOpts} onSaveField={saveShailaField} onGotBack={handleShailaGotBack} onAddManual={handleAddManualShaila} onClose={()=>setShowShailaManager(false)}/>
      )}

      {/* ConvCapture — universal conversation recorder */}
      {showConvCapture && (
        <ConvCapture
          onClose={()=>{setShowConvCapture(false);setConvCallMode(false);}}
          onApply={addVT}
          tasks={tasksRef.current}
          shailos={shailosRef.current}
          pris={pris}
          aiOpts={aiOpts}
          T={T}
          callMode={convCallMode}
        />
      )}

      {/* Noise texture */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",opacity:.025,backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`}}/>

      {!shellHidden && legacyPrompt && (
        <div style={{position:"fixed",top:76,left:"50%",transform:"translateX(-50%)",zIndex:9100,width:"min(520px,calc(100vw - 24px))",background:T.card,border:`1px solid ${T.brd}`,borderRadius:18,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.24)",padding:12,fontFamily:"system-ui",display:"grid",gridTemplateColumns:"32px minmax(0,1fr) auto",gap:10,alignItems:"center"}}>
          <span style={{width:32,height:32,borderRadius:12,background:T.tonal || T.bgW,color:T.onTonal || T.text,display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("dashboard_customize", 18)}</span>
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,fontWeight:900,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Open this in Command Center?</div>
            <div style={{fontSize:11,fontWeight:700,color:T.tFaint,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{legacyPrompt.label || "Legacy app"} is still available if you want the old environment.</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={openLegacyInCommandCenter} style={{height:34,padding:"0 11px",borderRadius:11,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:900}}>Yes</button>
            <button onClick={openLegacyTarget} style={{height:34,padding:"0 11px",borderRadius:11,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:900}}>No</button>
          </div>
        </div>
      )}

      {!shellHidden && (
        <AppSuiteChrome
          T={T}
          active={suiteView}
          onSelect={openCommandView}
          taskCount={effectiveCount}
          shailaCount={shailaOpenCount}
          phoneOnline={deskPhoneOnline}
        />
      )}

      {!shellHidden && suiteView === "switchboard" && (
        <SwitchboardPanel
          T={T}
          sections={switchboardSections}
          stats={{tasks: effectiveCount, shailos: shailaOpenCount, phoneOnline: deskPhoneOnline}}
          tasks={switchboardTaskList}
          shailos={switchboardShailaList}
          priorities={ap}
          onAddTask={addVT}
          onOpenTasks={()=>{openCommandView("focus"); switchTab("focus");}}
          onOpenQueue={()=>{openCommandView("focus"); switchTab("queue");}}
          onOpenZen={()=>{if(curT)setZen(true); else {openCommandView("focus"); switchTab("focus");}}}
          onOpenBrainDump={()=>setShowBrainDump(true)}
          onOpenBulkAdd={()=>setShowBulk(true)}
          onOpenShatter={()=>setShowBD(true)}
          onOpenShailos={()=>{setShailosAction(null); openCommandView("shailos");}}
          onOpenShailaAdd={()=>{setShailosAction("add-manual"); openCommandView("shailos");}}
          onOpenShailaFollowup={()=>setShowShailaManager(true)}
          onRecordConversation={()=>{setConvCallMode(false); setShowConvCapture(true);}}
          onRecordCall={()=>{setConvCallMode(true); setShowConvCapture(true);}}
          onRecordShaila={()=>{setShailosAction("record-shaila"); openCommandView("shailos");}}
          onOpenPhone={bringDeskPhoneForward}
          onOnlineChange={setDeskPhoneOnline}
          onClose={()=>openCommandView("focus")}
        />
      )}

      {!shellHidden && suiteView === "shailos" && (
        <SuiteShailosPanel T={T} action={shailosAction} onClose={()=>setSuiteView("focus")}/>
      )}

      {!shellHidden && (
        <DeskPhoneMiniDock
          T={T}
          onOnlineChange={setDeskPhoneOnline}
          onOpenDeskPhone={bringDeskPhoneForward}
        />
      )}

      <div style={{width:"100%",maxWidth:"min(800px, 95vw)",padding:"0 clamp(16px,3vw,32px)",position:"relative",zIndex:1,height:shellHidden?"100vh":"calc(100vh - 64px)",marginTop:shellHidden?0:64,overflowY:tab==="focus"?"hidden":"auto",display:"flex",flexDirection:"column"}}>

        {/* ===== FOCUS TAB ===== */}
        {tab === "focus" && (
          <div style={{animation:"ot-fade 0.3s",display:"flex",alignItems:"center",justifyContent:"center",height:"100%",overflow:"hidden"}}>

            {/* ── Center spine ── */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"stretch",gap:"clamp(18px,3.5vh,36px)",width:"min(88vw,500px)"}}>

              {/* ── Above-card row: clock (left) + done checkmark (right) ── */}
              {curT ? (() => {
                const cp0 = gP(pris, curT.priority);
                const cardColor0 = cp0.isShaila ? "#2ECC71" : cp0.color;
                const CK = 28;
                return (
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"0 2px",height:CK}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                      <span style={{fontSize:CK,fontFamily:"system-ui",fontWeight:300,color:T.tSoft,letterSpacing:3,lineHeight:1,display:"block"}}>
                        {clockTime.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
                      </span>
                      {todayCompCount > 0 && <span style={{fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tFaint,letterSpacing:.3}}>✓ {todayCompCount} today</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      {AS.legacyCompleteUI && <button onClick={()=>legacyCompTask(curT.id)} title="Legacy complete (no timestamp)" style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",width:CK,height:CK,opacity:.35,transition:"opacity 0.2s"}} onMouseEnter={e=>e.currentTarget.style.opacity=0.9} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clock s={CK-4} c={cardColor0}/></button>}
                      <button onClick={()=>compTask(curT.id)} title="Done" style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",width:CK,height:CK,opacity:.55,transition:"opacity 0.2s"}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.55}>
                        <IC.Check s={CK} c={cardColor0}/>
                      </button>
                    </div>
                  </div>
                );
              })() : (
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"0 2px",height:28}}>
                  <span style={{fontSize:28,fontFamily:"system-ui",fontWeight:300,color:T.tSoft,letterSpacing:3,lineHeight:1,display:"block"}}>
                    {clockTime.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
                  </span>
                  <div style={{width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",opacity:.3}}><IC.Check s={28} c={T.brdS}/></div>
                </div>
              )}

              {/* Task card */}
              {curT ? (() => {
                const cp = gP(pris, curT.priority);
                const cardColor = cp.isShaila ? "#2ECC71" : cp.color;
                const _fc = textOnColor(cardColor);
                const _fc50 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.50)" : "rgba(255,255,255,0.55)";
                const _fc40 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.45)" : "rgba(255,255,255,0.45)";
                const _fcBg = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.18)";
                const _fcBgH = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.25)";
                const _fcBgL = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.12)";
                const _fcBrd = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.4)";
                const _fc70 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.65)" : "rgba(255,255,255,0.7)";
                const _fc60 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.55)" : "rgba(255,255,255,0.6)";
                return (
                  <>
                    {/* Card — full column width */}
                    <div style={{background:cardColor,borderRadius:"clamp(22px,4vw,32px)",padding:"clamp(28px,5vh,56px) clamp(24px,4vw,48px)",width:"100%",minHeight:"clamp(130px,20vh,260px)",textAlign:"center",boxShadow:`0 12px 50px ${cardColor}35`,transition:"all 0.4s",transform:justComp?"scale(0.94)":"scale(1)",opacity:justComp?.3:1,animation:"ot-fade 0.5s",position:"relative",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden",gap:8}}>
                      {showRip && <Ripple color={_fc}/>}
                      {/* Completion flash overlay */}
                      {compFlash && <div style={{position:"absolute",inset:0,borderRadius:"inherit",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10,animation:"ot-comp-flash 0.6s forwards",pointerEvents:"none",background:cardColor}}><span style={{fontSize:72,color:_fc,lineHeight:1}}>✓</span></div>}
                      <span style={{fontSize:11,color:_fc50,fontFamily:"system-ui",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"}}>{cp.label}</span>
                      {curT.mrsW && <span style={{fontSize:11,color:_fc40,fontFamily:"system-ui",fontWeight:600,letterSpacing:.5}}>Mrs. W</span>}
                      {editId === curT.id ? (
                        <div style={{display:"flex",gap:8,width:"100%"}} onFocus={pauseZ} onBlur={resumeZ}>
                          <input ref={edRef} value={editTx} onChange={e=>setEditTx(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEd(curT.id);if(e.key==="Escape")setEditId(null);}} style={{flex:1,fontSize:"clamp(16px,3vw,22px)",fontFamily:"Georgia,serif",border:`2px solid ${_fcBrd}`,borderRadius:14,padding:"10px 16px",outline:"none",color:_fc,background:_fcBgL}}/>
                          <button onClick={()=>saveEd(curT.id)} style={{background:_fcBg,color:_fc,border:"none",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui"}}>Save</button>
                        </div>
                      ) : (
                        <div onClick={()=>startEd(curT)} style={{cursor:"text",maxHeight:"100%",overflow:"hidden",width:"100%"}}>
                          <AutoFitText text={curT.text} maxSize={Math.min(48,window.innerWidth*0.08)} minSize={16} color={_fc} style={{maxHeight:"clamp(70px,18vh,200px)"}}/>
                          {curT.parentTask && <p style={{fontSize:"clamp(10px,1.5vw,13px)",color:_fc50,marginTop:8,fontFamily:"system-ui"}}>Step {curT.stepIndex||1} of {curT.totalSteps||"?"} of {curT.parentTask}</p>}
                          {curT.blockedNote && <p style={{fontSize:10,color:_fc40,marginTop:4,fontFamily:"system-ui",fontStyle:"italic"}}>Blocked: {curT.blockedNote}</p>}
                          {(() => {
                            if (!curT.createdAt) return null;
                            const d = Math.floor(getTaskAgeHours(curT) / 24);
                            if (d < 1) return null;
                            return <p style={{fontSize:10,color:_fc40,marginTop:4,fontFamily:"system-ui",fontWeight:500,letterSpacing:.3}}>{d === 1 ? "since yesterday" : `${d} days waiting`}</p>;
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Just Start timer if active */}
                    {justStartId === curT.id && !jsMinimized && <div style={{width:"100%"}}><JustStartTimer color={cp.color} T={T} onMinimize={()=>setJsMinimized(true)} onDone={()=>{setJustStartId(null);setJsMinimized(false);}}/></div>}

                    {/* Park + Reflect quick-action row */}
                    <div style={{display:"flex",gap:8,justifyContent:"center",width:"100%"}}>
                      <button onClick={()=>parkTask(curT.id)}
                        style={{flex:1,padding:"7px 0",fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tFaint,background:"none",border:`1px solid ${T.brd}`,borderRadius:10,cursor:"pointer",letterSpacing:.3,transition:"all 0.15s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brdS;e.currentTarget.style.color=T.tSoft;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.brd;e.currentTarget.style.color=T.tFaint;}}>
                        💤 Park til tomorrow
                      </button>
                      {getTaskAgeHours(curT) >= 72 && (
                        <button onClick={()=>setShowBlockReflect(true)}
                          style={{flex:1,padding:"7px 0",fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tFaint,background:"none",border:`1px solid ${T.brd}`,borderRadius:10,cursor:"pointer",letterSpacing:.3,transition:"all 0.15s"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brdS;e.currentTarget.style.color=T.tSoft;}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.brd;e.currentTarget.style.color=T.tFaint;}}>
                          🔍 What's in the way?
                        </button>
                      )}
                    </div>
                  </>
                );
              })() : (
                <div style={{width:"100%",textAlign:"center",animation:"ot-fade 0.4s",padding:"clamp(24px,5vh,48px) 0"}}>
                  <div style={{width:52,height:52,borderRadius:"50%",background:pBg("#9EBD8A"),display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",opacity:.6}}><IC.Check s={22} c="#9EBD8A"/></div>
                  <p style={{color:T.tSoft,fontSize:"clamp(13px,2vw,16px)",margin:0}}>{compT.length>0?"All clear.":"Add your first task."}</p>
                </div>
              )}

              {/* Priority circles — full column width, evenly spaced, dismiss on outside click */}
              <div style={{width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:"clamp(10px,2vh,20px)",paddingTop:"clamp(12px,2.5vh,28px)"}} onFocus={pauseZ} onBlur={resumeZ}
                ref={el=>{
                  if(!el)return;
                  el._outsideHandler=el._outsideHandler||((e)=>{if(selPri&&!el.contains(e.target)&&!e.target.closest('[data-voice-panel]')){setSelPri(null);setNewTask("");}});
                  document.removeEventListener("mousedown",el._outsideHandler);
                  document.addEventListener("mousedown",el._outsideHandler);
                }}>

                {/* Main circle row — Shaila + built-in priorities */}
                <div style={{display:"flex",justifyContent:"space-around",alignItems:"flex-end",width:"100%",paddingTop:4}}>
                  {ap.filter(p=>p.isShaila||["now","today","eventually"].includes(p.id)).map(p=>{
                    const a = selPri===p.id;
                    const shailaGreen="#2ECC71";
                    const clr = p.isShaila ? shailaGreen : p.color;
                    const sz = a ? "clamp(82px,13vw,104px)" : "clamp(70px,11vw,90px)";
                    // Glow effect for dark themes with glow:true — circles glow like celestial bodies
                    const glowShadow = T.glow
                      ? (a ? `0 0 30px ${clr}90, 0 0 60px ${clr}50, 0 0 100px ${clr}25` : `0 0 18px ${clr}70, 0 0 40px ${clr}30, 0 0 70px ${clr}15`)
                      : p.isShaila
                        ? (a?`0 0 28px ${shailaGreen}90,0 0 56px ${shailaGreen}40`:`0 0 16px ${shailaGreen}65,0 0 32px ${shailaGreen}30`)
                        : (a?`0 6px 28px ${clr}65`:`0 3px 12px ${clr}35`);
                    return (
                      <div key={p.id} style={{display:"flex",flexDirection:"column",alignItems:"center"}}
                        onMouseEnter={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=1;}}
                        onMouseLeave={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=a?1:0;}}>
                        <button className="mic-btn" onClick={()=>{setSelPri(p.id);setShowVoice(true);}} title="Voice input" style={{width:30,height:30,borderRadius:"50%",background:clr,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:a?1:0,transition:"opacity 0.2s",marginBottom:8,flexShrink:0}}><IC.Mic s={13} c="#fff"/></button>
                        <button onClick={()=>setSelPri(a?null:p.id)} title={p.label} style={{width:sz,height:sz,borderRadius:"50%",background:T.glow?`radial-gradient(circle at 35% 35%, ${clr}dd, ${clr}88, ${clr}44)`:clr,border:a?`3px solid ${softBorderC}`:"3px solid transparent",cursor:"pointer",transition:"all 0.25s",boxShadow:glowShadow,flexShrink:0}}/>
                        <span style={{fontSize:12,color:T.tFaint,fontFamily:"system-ui",fontWeight:600,textAlign:"center",marginTop:10,letterSpacing:.3}}>{p.isShaila?"Shaila":p.label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Custom priorities row — sorted by weight desc, smaller circles, below builtins */}
                {ap.filter(p=>!p.isShaila&&!["now","today","eventually"].includes(p.id)).length>0 && (
                  <div style={{display:"flex",justifyContent:"center",gap:"clamp(16px,3vw,28px)",alignItems:"flex-end",width:"100%",paddingTop:2,opacity:.85}}>
                    {[...ap.filter(p=>!p.isShaila&&!["now","today","eventually"].includes(p.id))].sort((a,b)=>b.weight-a.weight).map(p=>{
                      const a = selPri===p.id;
                      return (
                        <div key={p.id} style={{display:"flex",flexDirection:"column",alignItems:"center"}}
                          onMouseEnter={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=1;}}
                          onMouseLeave={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=a?1:0;}}>
                          <button className="mic-btn" onClick={()=>{setSelPri(p.id);setShowVoice(true);}} title="Voice input" style={{width:22,height:22,borderRadius:"50%",background:p.color,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:a?1:0,transition:"opacity 0.2s",marginBottom:6,flexShrink:0}}><IC.Mic s={10} c="#fff"/></button>
                          <button onClick={()=>setSelPri(a?null:p.id)} title={p.label} style={{width:a?"clamp(40px,6vw,52px)":"clamp(32px,5vw,44px)",height:a?"clamp(40px,6vw,52px)":"clamp(32px,5vw,44px)",borderRadius:"50%",background:p.color,border:a?`2px solid ${softBorderC}`:"2px solid transparent",cursor:"pointer",transition:"all 0.2s",boxShadow:a?`0 4px 16px ${p.color}60`:`0 2px 8px ${p.color}25`,flexShrink:0}}/>
                          <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",fontWeight:600,textAlign:"center",marginTop:7,letterSpacing:.3}}>{p.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}


                {/* Text input — full column width */}
                {selPri && (
                  <div data-input-area="true" style={{width:"100%",animation:"ot-fade 0.2s"}}>
                    <form onSubmit={addTask} style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                      <textarea ref={inRef} value={newTask} onChange={e=>{setNewTask(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";}} placeholder={selPri==="shaila"?"Who + what shaila?":ph} autoFocus onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addTask(e);}if(e.key==="Escape"){setSelPri(null);setNewTask("");}}} rows={1} style={{flex:1,padding:"clamp(10px,1.5vw,14px) clamp(12px,2vw,18px)",fontSize:"clamp(14px,2vw,16px)",border:`2px solid ${gP(pris,selPri).color}`,borderRadius:14,outline:"none",background:T.card,color:T.text,fontFamily:"Georgia,serif",resize:"none",overflow:"hidden",minHeight:44,lineHeight:1.4}}/>
                      <button type="button" onClick={()=>setEntryEnergy(e=>e===null?"high":e==="high"?"low":null)} title={entryEnergy?`Energy: ${entryEnergy}`:"Set energy"} style={{width:44,height:44,borderRadius:14,border:`1.5px solid ${entryEnergy?"#E07040":T.brd}`,background:entryEnergy==="high"?"#E0704018":entryEnergy==="low"?"#7EB0DE18":T.bgW,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,transition:"all 0.2s"}}>
                        {entryEnergy==="high"?"⚡":entryEnergy==="low"?"🌊":"·"}
                      </button>
                      <button type="button" onClick={addTask} style={{background:gP(pris,selPri).color,border:"none",borderRadius:14,width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}><IC.Plus s={16} c={textOnColor(gP(pris,selPri).color)}/></button>
                    </form>
                    {newTask.trim().length>3 && (
                      <button onClick={()=>{const txt=newTask.trim();if(!txt)return;setNewTask("");setSelPri(null);setShowBD({id:"__new__",text:txt,priority:selPri});}} style={{marginTop:6,width:"100%",padding:"6px 0",fontSize:11,fontFamily:"system-ui",fontWeight:700,color:priText(gP(pris,selPri).color),background:"none",border:`1px dashed ${gP(pris,selPri).color}60`,borderRadius:10,cursor:"pointer",letterSpacing:.5,opacity:.85}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.75}>
                        ✦ Shatter into crystals
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Queue shortcut — direct access from launchpad */}
              <div style={{textAlign:"center",paddingBottom:8}}>
                <button onClick={()=>switchTab("queue")} style={{background:"none",border:`1px solid ${T.brd}`,borderRadius:20,padding:"5px 16px",cursor:"pointer",fontFamily:"system-ui",fontSize:12,fontWeight:600,color:T.tFaint,letterSpacing:.5,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.color=T.text;e.currentTarget.style.borderColor=T.tSoft;}}
                  onMouseLeave={e=>{e.currentTarget.style.color=T.tFaint;e.currentTarget.style.borderColor=T.brd;}}>
                  Queue · {effectiveCount}
                </button>
              </div>

            </div>{/* end spine */}

            {/* ── Clean categorized menu — replaces side icon columns ── */}
            {(()=>{
              const spinnerIcon = <div style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.7s linear infinite"}}/>;
              const menuSections = [
                ...(curT ? [{ cat: "Current Task", items: [
                  {icon:<span style={{fontSize:14,lineHeight:1,color:T.tSoft,fontFamily:"Georgia,serif"}}>≈</span>, label:"Good enough", action:()=>goodEnoughTask(curT.id)},
                  {icon:<IC.Pause s={14} c={T.tSoft}/>, label:"Mark blocked", action:()=>setBlockedModal(curT)},
                  {icon:<IC.PriC s={14} c={T.tSoft}/>, label:"Change priority", action:()=>setChgPri(curT.id)},
                  ...(curT?.parentTask ? [{icon:<span style={{fontSize:12,lineHeight:1}}>🌿</span>, label:"Park rest", action:()=>parkRestOfGroup(curT)}] : []),
                  {icon:<IC.Trash s={14} c="#C06060"/>, label:"Delete", action:()=>delTask(curT.id)},
                ]}] : []),
                { cat: "Navigate", items: [
                  {icon:<IC.List s={14} c={T.tSoft}/>, label:`Queue (${effectiveCount})`, action:()=>switchTab("queue")},
                  {icon:<IC.Bulb s={14} c={T.tSoft}/>, label:"Insights", action:()=>switchTab("insights")},
                  {icon:<IC.Gear s={14} c={T.tSoft}/>, label:"Settings", action:()=>setShowSet(true)},
                ]},
                { cat: "Focus", items: [
                  {icon:<IC.Moon s={14} c={T.tSoft}/>, label:"Enter zen", action:()=>setZen(true)},
                  {icon:<IC.Moon s={14} c={zenOn?"#2ECC71":T.tFaint}/>, label:zenOn?"Auto-zen ✓":"Auto-zen ✗", action:()=>setAS(p=>({...p,zenEnabled:!p.zenEnabled}))},
                  {icon:<IC.Timer s={14} c={T.tSoft}/>, label:"Just Start timer", action:()=>{if(curT)setJustStartId(justStartId===curT?.id?null:curT?.id);}},
                  {icon:<IC.Person s={14} c={T.tSoft}/>, label:"Body double", action:()=>setShowBodyDouble(true)},
                ]},
                { cat: "Add & Organize", items: [
                  {icon: optLoading ? spinnerIcon : <IC.Sparkle s={14} c={T.tSoft}/>, label: optLoading?"Thinking…": hasAI?"AI Prioritize":"Prioritize", action: launchpadOptimize},
                  {icon:<IC.Brain s={14} c={T.tSoft}/>, label:"Brain dump", action:()=>setShowBrainDump(true)},
                  {icon:<IC.Plus s={14} c={T.tSoft}/>, label:"Bulk add", action:()=>setShowBulk(true)},
                  {icon:<IC.Split s={14} c={T.tSoft}/>, label:"Shatter task", action:()=>setShowBD(true)},
                ]},
                { cat: "Data", items: [
                  {icon:<span style={{fontSize:13,lineHeight:1}}>💾</span>, label: backupLoading?"Saving…":"Backup", action: doFullBackup},
                  {icon:<span style={{fontSize:13,lineHeight:1}}>📂</span>, label:"Restore", action: doLoadBackup},
                  {icon:<span style={{fontSize:13,lineHeight:1,color:T.tSoft}}>✡</span>, label:"Shaila log", action:()=>setShowShailaManager(true)},
                ]},
              ];

              return (
                <div style={{position:"fixed",top:"clamp(12px,2vh,20px)",left:"clamp(12px,2vw,20px)",zIndex:200}}>
                  <button onClick={()=>setLpMenu(p=>!p)} style={{width:36,height:36,borderRadius:10,background:T.glow?`${T.card}cc`:T.card,border:`1px solid ${T.brd}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:T.glow?`0 0 12px ${T.brd}80`:T.shadow,transition:"all 0.2s"}}
                    onMouseEnter={e=>{e.currentTarget.style.boxShadow=T.glow?`0 0 20px ${T.brd}`:"0 4px 16px rgba(0,0,0,0.12)";}}
                    onMouseLeave={e=>{e.currentTarget.style.boxShadow=T.glow?`0 0 12px ${T.brd}80`:T.shadow;}}>
                    <IC.List s={16} c={T.tSoft}/>
                  </button>
                  {lpMenu && (
                    <div style={{position:"fixed",top:"clamp(56px,calc(2vh + 44px),72px)",left:"clamp(12px,2vw,20px)",background:T.card,border:`1px solid ${T.brd}`,borderRadius:14,padding:"8px 0",minWidth:200,zIndex:9999,boxShadow:T.glow?`0 4px 30px ${T.bg}cc, 0 0 20px ${T.brd}60`:"0 8px 32px rgba(0,0,0,0.18)",animation:"ot-fade 0.15s",maxHeight:"calc(100vh - 80px)",overflowY:"auto"}}
                      onClick={()=>setLpMenu(false)}>
                      {menuSections.map((sec,si)=>(
                        <div key={si}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,color:T.tFaint,padding:"8px 16px 4px",fontFamily:"system-ui"}}>{sec.cat}</div>
                          {sec.items.map((item,ii)=>(
                            <button key={ii} onClick={item.action} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"7px 16px",background:"none",border:"none",cursor:"pointer",fontFamily:"system-ui",fontSize:13,color:T.text,textAlign:"left",transition:"background 0.1s"}}
                              onMouseEnter={e=>{e.currentTarget.style.background=T.bgW;}} onMouseLeave={e=>{e.currentTarget.style.background="none";}}>
                              <span style={{width:20,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{item.icon}</span>
                              {item.label}
                            </button>
                          ))}
                          {si < menuSections.length-1 && <div style={{height:1,background:T.brdS,margin:"4px 12px"}}/>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* PostIt stack — bottom left, high z so expanded cards float above icon columns */}
            {compT.length > 0 && (
              <div style={{position:"fixed",bottom:"clamp(24px,4vh,48px)",left:"clamp(16px,3vw,32px)",zIndex:9000}}>
                <PostItStack tasks={compT} pris={pris} T={T} open={postItOpen} onToggle={()=>setPostItOpen(p=>!p)} onUncomp={uncompTask} onClone={cloneTask}/>
              </div>
            )}

          </div>
        )}

        {/* ===== NON-FOCUS HEADER ===== */}
        {tab !== "focus" && (
          <>
            <header style={{textAlign:"center",paddingTop:40,paddingBottom:4,flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <h1 style={{fontSize:24,fontWeight:600,margin:0}}>OneTaskOnly</h1>
                <button onClick={()=>setShowSet(true)} style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.4}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.4}><IC.Gear s={15} c={T.tSoft}/></button>
              </div>
              <p style={{color:T.tFaint,fontSize:13,margin:"4px 0 0",fontStyle:"italic"}}>{gG()} — {dateStr}</p>
              <div style={{marginTop:6,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>@{user?.displayName || user?.email?.split("@")[0] || ""}</span>
                <button onClick={()=>setSuiteView("shailos")} style={{fontSize:11,color:T.accent||"#C8A84C",fontFamily:"system-ui",background:"none",border:"none",cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2,padding:0}}>Shailos</button>
                <button onClick={runShailaReconcile} disabled={reconcileLoading} title="Sync check — reconcile shailos between transcriber and tasks" style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",background:"none",border:`1px solid ${T.brd}`,borderRadius:8,cursor:"pointer",padding:"2px 6px",opacity:reconcileLoading ? .5 : 1}}>{reconcileLoading?"⏳":"🔄"}</button>
                <button onClick={async ()=>{
                  if(AS) await Store.autoFileBackup(AS, shailosRef.current, true).catch(()=>{});
                  if(onSignOut) onSignOut();
                }} style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",background:"none",border:"none",cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2,padding:0}}>sign out</button>
                <button onClick={async ()=>{
                  if(AS) await Store.autoFileBackup(AS, shailosRef.current, true).catch(()=>{});
                  window.close();
                }} title="Save backup and close window" style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",background:"none",border:`1px solid ${T.brd}`,borderRadius:8,cursor:"pointer",padding:"2px 8px"}}>save &amp; close</button>
              </div>
            </header>
            <div style={{display:"flex",gap:3,marginTop:16,background:T.bgW,borderRadius:16,padding:3,flexShrink:0,position:"relative"}}>
              <TabBtn T={T} active={false} onClick={()=>switchTab("focus")} icon={<IC.Focus s={13} c={T.tSoft}/>} label="Launchpad"/>
              <div style={{position:"relative",flex:1,display:"flex"}}>
                <TabBtn T={T} active={tab==="queue"} onClick={()=>switchTab("queue")} icon={<IC.List s={13} c={tab==="queue"?T.text:T.tSoft}/>} label={`Queue (${effectiveCount})`}/>
              </div>
              <TabBtn T={T} active={tab==="insights"} onClick={()=>switchTab("insights")} icon={<IC.Bulb s={13} c={tab==="insights"?T.text:T.tSoft}/>} label="Insights"/>
            </div>
          </>
        )}

        {/* ===== QUEUE TAB ===== */}
        {tab === "queue" && (
          <div style={{animation:"ot-fade 0.3s",marginTop:24,flex:1}}>
            {/* Queue header: task count + energy indicator + overflow menu */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,fontWeight:600,fontFamily:"system-ui",color:T.tSoft}}>{effectiveCount} task{effectiveCount!==1?"s":""}</span>
                {curEnergy && (
                  <span style={{fontSize:10,fontFamily:"system-ui",padding:"2px 8px",borderRadius:8,border:`1px solid ${curEnergy==="high"?"#E07040":"#7EB0DE"}`,color:curEnergy==="high"?"#B85030":"#4A7898",fontWeight:600}}>
                    {curEnergy==="high"?"⚡ High energy":"🌊 Low energy"}
                    <button onClick={()=>setAS(p=>({...p,currentEnergy:null}))} style={{marginLeft:4,background:"none",border:"none",cursor:"pointer",fontSize:11,color:T.tFaint,padding:0,lineHeight:1}}>✕</button>
                  </span>
                )}
                {effectiveCount > overwhelmThreshold && (
                  <span style={{fontSize:10,fontFamily:"system-ui",padding:"2px 8px",borderRadius:8,background:focusModeActive?"#E0B47240":"transparent",border:`1px solid ${focusModeActive?"#E0B47280":T.brd}`,color:focusModeActive?"#C08830":T.tSoft,fontWeight:600,cursor:"pointer"}} onClick={()=>setFocusModeActive(f=>!f)}>
                    😶 {focusModeActive ? "Focus mode on" : "Focus mode"}
                  </span>
                )}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {/* ✦ AI Prioritize — direct button */}
              <button
                onClick={launchpadOptimize}
                disabled={optLoading}
                title={hasAI ? "AI Prioritize queue" : "Prioritize queue"}
                style={{width:32,height:32,borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:optLoading?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:optLoading?0.5:1,flexShrink:0}}
              >
                {optLoading
                  ? <div style={{width:12,height:12,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.7s linear infinite"}}/>
                  : <IC.Sparkle s={14} c={T.tSoft}/>}
              </button>
              {/* ⚙ Settings — consolidated gear */}
              <button onClick={()=>setShowSet(true)} style={{width:32,height:32,borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Settings">
                <IC.Gear s={15} c={T.tSoft}/>
              </button>
              </div>{/* end right-side flex row */}
            </div>

            {/* Search bar */}
            <div style={{marginBottom:8,position:"relative"}}>
              <input
                value={searchQ}
                onChange={e=>setSearchQ(e.target.value)}
                placeholder="Search tasks..."
                style={{width:"100%",padding:"9px 14px",paddingRight:searchQ?36:14,fontSize:13,border:`1px solid ${T.brd}`,borderRadius:12,outline:"none",background:T.bgW,color:T.text,fontFamily:"system-ui"}}
              />
              {searchQ && (
                <button onClick={()=>setSearchQ("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:T.tFaint,padding:"2px 4px",lineHeight:1,fontFamily:"system-ui"}} title="Clear search">×</button>
              )}
            </div>

            {/* Quick-add row */}
            <div style={{marginBottom:14,background:T.card,border:`1px solid ${T.brd}`,borderRadius:12,padding:"8px 10px",display:"flex",flexDirection:"column",gap:8}}>
              {/* Priority pills */}
              <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",flexShrink:0}}>Add:</span>
                {[...ap].sort((a,b)=>{
                  const ab = !a.id.startsWith('pri_'), bb = !b.id.startsWith('pri_');
                  if (ab !== bb) return bb - ab; // built-ins first
                  return b.weight - a.weight;    // then by weight desc
                }).map((p, idx) => {
                  const sel = qAddPri === p.id;
                  const clr = p.isShaila ? "#2ECC71" : p.color;
                  // Big = all built-ins (shaila/now/today/eventually); Small = custom priorities (pri_xxx)
                  const isBig = !p.id.startsWith('pri_');
                  return (
                    <button key={p.id} onClick={()=>setQAddPri(sel?null:p.id)} title={p.label}
                      style={{padding:isBig?"5px 13px":"3px 9px",borderRadius:20,background:sel?clr:clr+"22",border:`1.5px solid ${clr}`,cursor:"pointer",fontSize:isBig?11:10,fontWeight:700,fontFamily:"system-ui",color:sel?textOnColor(clr):clr,flexShrink:0,transition:"all 0.15s",boxShadow:sel?`0 2px 8px ${clr}50`:"none"}}
                    >{p.label}</button>
                  );
                })}
              </div>
              {/* Text input — shown once priority selected */}
              {qAddPri && (
                <form onSubmit={e=>{e.preventDefault();const t=qAddText.trim();if(!t)return;const newQT={id:uid(),text:t,completed:false,priority:qAddPri,createdAt:Date.now()};uT(ts=>doOpt([...ts,newQT]));setQAddText("");setQAddPri(null);clearTimeout(queueToastTmr.current);const clr=gP(pris,newQT.priority).isShaila?"#2ECC71":gP(pris,newQT.priority).color;setQueueToast(clr);setQueueToastKey(k=>k+1);queueToastTmr.current=setTimeout(()=>setQueueToast(null),5000);triggerAIPrioritize();}} style={{display:"flex",gap:6,animation:"ot-fade 0.15s"}}>
                  <input autoFocus value={qAddText} onChange={e=>setQAddText(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Escape"){setQAddPri(null);setQAddText("");}}}
                    placeholder={qAddPri==="shaila"?"Who + what shaila?":"What needs doing?"}
                    style={{flex:1,padding:"7px 12px",fontSize:13,border:`1.5px solid ${gP(pris,qAddPri).isShaila?"#2ECC71":gP(pris,qAddPri).color}`,borderRadius:10,outline:"none",background:T.bgW,color:T.text,fontFamily:"Georgia,serif"}}/>
                  <button type="submit" style={{background:gP(pris,qAddPri).isShaila?"#2ECC71":gP(pris,qAddPri).color,border:"none",borderRadius:10,width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                    <IC.Plus s={14} c={textOnColor(gP(pris,qAddPri).isShaila?"#2ECC71":gP(pris,qAddPri).color)}/>
                  </button>
                </form>
              )}
            </div>




            {/* Queue: all tasks in one continuous card — groups inline, no gaps */}
            {queueTFiltered.length > 0 ? (
              <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,overflow:"hidden",boxShadow:T.shadow}}>
                {(() => {
                  let pos = 0;
                  return queueTFiltered.map((task, idx) => {
                    if (task.parentTask) {
                      // === GROUP ROW — same layout as regular task + ONE expand icon ===
                      const tp = gP(pris, task.priority);
                      const gSteps = actT.filter(t => t.parentTask === task.parentTask && !t.completed).sort((a,b)=>(a.stepIndex||0)-(b.stepIndex||0));
                      const gDone = actT.filter(t => t.parentTask === task.parentTask && t.completed).length;
                      const gTotal = gSteps.length + gDone;
                      const gPct = gTotal > 0 ? gDone / gTotal : 0;
                      const isOpen = openGroups.has(task.parentTask);
                      const isAddingHere = groupAdding === task.parentTask;
                      const isF = pos === 0;
                      const dispPos = pos + 1;
                      pos++;
                      const _qText = isF ? textOnPastel(AS.colorScheme, T.text) : T.tSoft;
                      return (
                        <React.Fragment key={`grp-${task.parentTask}`}>
                          {/* Header — identical layout to a regular task row */}
                          <div draggable onDragStart={()=>setDragId(task.id)} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(task.id)}
                            style={{display:"flex",alignItems:"center",gap:6,padding:"12px 10px",borderBottom:`1px solid ${T.brdS}`,borderLeft:`3px solid ${tp.color}`,background:isF?pBg(tp.color):"transparent",cursor:"grab"}}>
                            <span style={{cursor:"grab",padding:"2px",opacity:.35,flexShrink:0}}><IC.Grab s={12} c={T.tSoft}/></span>
                            <span style={{width:20,height:20,borderRadius:"50%",background:isF?tp.color:"transparent",border:isF?"none":`1.5px solid ${T.tFaint}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:isF?textOnColor(tp.color):T.tFaint,fontWeight:600,fontFamily:"system-ui",flexShrink:0}}>
                              {dispPos}
                            </span>
                            <span onClick={()=>setOpenGroups(prev=>{const n=new Set(prev);n.has(task.parentTask)?n.delete(task.parentTask):n.add(task.parentTask);return n;})}
                              style={{flex:1,fontSize:14,cursor:"pointer",fontWeight:isF?500:400,color:_qText,fontFamily:"Georgia,serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {task.shailaId && shailaNumberMap[task.shailaId] && <span style={{fontSize:10,color:"#C8A84C",fontWeight:700,fontFamily:"system-ui",marginRight:5}}>#{shailaNumberMap[task.shailaId]}</span>}
                              {task.parentTask}
                            </span>
                            {task.shailaId && (() => {
                              const hst = shailaStatusMap[task.shailaId];
                              if (!hst || hst === "researching") return null;
                              const gbStep = actT.find(t => t.shailaId === task.shailaId && t.isGetBackStep);
                              return <ShailaMiniPill status={hst} shailaNum={shailaNumberMap[task.shailaId]} onToggle={e=>{e?.stopPropagation();if(gbStep)handleShailaGotBack(gbStep.id,hst!=="got_back");}}/>;
                            })()}
                            <div style={{width:8,height:8,borderRadius:"50%",background:tp.color,flexShrink:0,opacity:.7}}/>
                            <div style={{display:"flex",gap:0,flexShrink:0}}>
                              <button onClick={e=>{e.stopPropagation();compTask(gSteps[0]?.id);}} title="Complete next step" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Check s={13} c={tp.color}/></button>
                              {AS.legacyCompleteUI && <button onClick={e=>{e.stopPropagation();legacyCompTask(gSteps[0]?.id);}} title="Legacy complete (no timestamp)" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clock s={12} c={tp.color}/></button>}
                              <button onClick={e=>{e.stopPropagation();moveTop(gSteps[0]?.id);}} title="To top" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.MoveTop s={12} c={T.tSoft}/></button>
                              <button onClick={e=>{e.stopPropagation();setChgPri(gSteps[0]?.id);}} title="Change priority" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.PriC s={12} c={T.tSoft}/></button>
                              <button onClick={e=>{e.stopPropagation();setOpenGroups(prev=>{const n=new Set(prev);n.add(task.parentTask);return n;});setGroupAdding(task.parentTask);}} title="Add step" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,fontSize:11}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}>✦+</button>
                              <button onClick={e=>{e.stopPropagation();gSteps.forEach(s=>delTask(s.id));}} title="Delete group" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.3}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.3}><IC.Trash s={12} c={T.tFaint}/></button>
                              {/* THE one extra icon — expand/collapse steps */}
                              <button onClick={e=>{e.stopPropagation();setOpenGroups(prev=>{const n=new Set(prev);n.has(task.parentTask)?n.delete(task.parentTask):n.add(task.parentTask);return n;});}} title={isOpen?"Hide steps":"Show steps"} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Chev d={isOpen?"up":"down"} s={12} c={T.tSoft}/></button>
                            </div>
                          </div>
                          {/* Subtle progress bar */}
                          <div style={{background:T.brd,height:2,overflow:"hidden"}}><div style={{width:`${gPct*100}%`,height:"100%",background:tp.color,transition:"width 0.4s"}}/></div>
                          {/* Expanded subtask rows */}
                          {isOpen && <>
                            {gSteps.map((st) => (
                              <div key={st.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px 7px 28px",borderBottom:`1px solid ${T.brdS}`,background:"transparent"}}>
                                <button onClick={e=>{e.stopPropagation();compTask(st.id);}} style={{width:18,height:18,borderRadius:"50%",border:`1.5px solid ${tp.color}`,background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Complete step"><IC.Check s={10} c={tp.color}/></button>
                                {editId === st.id ? (
                                  <input ref={edRef} value={editTx} onChange={e=>setEditTx(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEd(st.id);if(e.key==="Escape")setEditId(null);}} onBlur={()=>saveEd(st.id)} style={{flex:1,fontSize:13,fontFamily:"Georgia,serif",border:`1px solid ${tp.color}80`,borderRadius:6,padding:"3px 7px",outline:"none",color:T.text,background:T.bgW}}/>
                                ) : (
                                  <span onClick={()=>startEd(st)} style={{flex:1,fontSize:13,color:T.tSoft,cursor:"text",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                    {st.stepIndex && <span style={{fontSize:10,color:T.tFaint,marginRight:4,fontFamily:"system-ui"}}>#{st.stepIndex}</span>}{st.text}
                                  </span>
                                )}
                                {/* Mini got-back pill on the "Get back to asker" step */}
                                {st.isGetBackStep && st.shailaId && (() => {
                                  const shailaNum = shailaNumberMap[st.shailaId];
                                  // Determine status from sibling step (research step completion = have_answer)
                                  const siblings = actT.filter(t => t.shailaId === st.shailaId && !t.isGetBackStep);
                                  const researchDone = siblings.length === 0 || siblings.every(t => t.completed);
                                  const pillStatus = st.gotBackToAsker ? "got_back" : researchDone ? "have_answer" : "researching";
                                  return <ShailaMiniPill status={pillStatus} shailaNum={shailaNum} onToggle={()=>handleShailaGotBack(st.id, !st.gotBackToAsker)}/>;
                                })()}
                                <button onClick={e=>{e.stopPropagation();delTask(st.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.3}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.3}><IC.Trash s={11} c={T.tFaint}/></button>
                              </div>
                            ))}
                            {gDone > 0 && <div style={{padding:"3px 10px 3px 28px",fontSize:10,color:T.tFaint,fontFamily:"system-ui",borderBottom:`1px solid ${T.brdS}`}}>{gDone} step{gDone!==1?"s":""} completed ✓</div>}
                            {isAddingHere && (
                              <div style={{display:"flex",gap:6,padding:"6px 10px 6px 28px",alignItems:"center",borderBottom:`1px solid ${T.brdS}`}}>
                                <input autoFocus placeholder="New step…"
                                  onKeyDown={e=>{const tx=e.target.value.trim();if(e.key==="Enter"&&tx){addSubtask(task.parentTask,tx);e.target.value="";setGroupAdding(null);}if(e.key==="Escape")setGroupAdding(null);}}
                                  onBlur={e=>{const tx=e.target.value.trim();if(tx)addSubtask(task.parentTask,tx);setGroupAdding(null);}}
                                  style={{flex:1,fontSize:13,fontFamily:"Georgia,serif",border:`1px solid ${tp.color}80`,borderRadius:8,padding:"5px 10px",outline:"none",background:T.bgW,color:T.text}}/>
                              </div>
                            )}
                          </>}
                        </React.Fragment>
                      );
                    } else {
                      // === REGULAR TASK ROW ===
                      const tp = gP(pris, task.priority);
                      const aged = isTaskAged(task, pris, AS.ageThresholds);
                      const isF = pos === 0;
                      const dispPos = pos + 1;
                      pos++;
                      const _qText = isF ? textOnPastel(AS.colorScheme, T.text) : T.tSoft;
                      const _qSoft = isF ? textOnPastel(AS.colorScheme, T.tSoft) : T.tSoft;
                      return (
                        <div key={task.id} draggable onDragStart={()=>setDragId(task.id)} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(task.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"12px 10px",borderBottom:`1px solid ${T.brdS}`,borderLeft:`3px solid ${tp.color}`,background:isF?pBg(tp.color):(task.blocked?pBg("#E0B472"):"transparent"),cursor:"grab",opacity:task.blocked?.6:1}}>
                          <span style={{cursor:"grab",padding:"2px",opacity:.35,flexShrink:0}}><IC.Grab s={12} c={_qSoft}/></span>
                          <span style={{width:20,height:20,borderRadius:"50%",background:isF?tp.color:"transparent",border:isF?"none":`1.5px solid ${T.tFaint}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:isF?textOnColor(tp.color):T.tFaint,fontWeight:600,fontFamily:"system-ui",flexShrink:0}}>{dispPos}</span>
                          {editId === task.id ? (
                            <input ref={edRef} value={editTx} onChange={e=>setEditTx(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEd(task.id);if(e.key==="Escape")setEditId(null);}} onBlur={()=>saveEd(task.id)} style={{flex:1,fontSize:14,fontFamily:"Georgia,serif",border:`1px solid ${tp.color}80`,borderRadius:8,padding:"4px 8px",outline:"none",color:textOnPastel(AS.colorScheme, T.text),background:pBg(tp.color)}}/>
                          ) : (
                            <div style={{flex:1,display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                              <span onClick={()=>startEd(task)} style={{fontSize:14,cursor:"text",fontWeight:isF?500:400,color:_qText,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {task.pinned && <span style={{fontSize:10,marginRight:4,opacity:.5}}>📌</span>}
                                {task.text}
                              </span>
                              {task.blocked && task.blockedNote && (
                                <span style={{fontSize:10,fontStyle:"italic",color:"#A06820",fontFamily:"system-ui",opacity:.8}}>⏸ {task.blockedNote}</span>
                              )}
                              {(aged || task.autoAged || task.mrsW || task.blocked || task.energy) && (
                                <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:2,opacity:.8}}>
                                  {aged && <AgeBadge task={task} pris={pris} thresholds={AS.ageThresholds} T={T}/>}
                                  {task.autoAged && (
                                    <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontFamily:"system-ui",padding:"1px 6px 1px 5px",borderRadius:6,background:"#7EB0DE18",border:"1px solid #7EB0DE60",color:"#4A7898",fontWeight:600,lineHeight:1.4}}>
                                      ↑ {task.agedFromLabel||"Eventually"}
                                      <button onClick={e=>{e.stopPropagation();undoAging(task.id);}} title="Undo nudge" style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#4A789880",padding:0,lineHeight:1,marginLeft:1}}>✕</button>
                                    </span>
                                  )}
                                  {task.energy && <EnergyBadge energy={task.energy} T={T}/>}
                                  {task.mrsW && <MrsWBadge T={T}/>}
                                  {task.blocked && <BlockedBadge task={task} T={T}/>}
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{width:8,height:8,borderRadius:"50%",background:tp.color,flexShrink:0,opacity:.7}}/>
                          <div draggable={false} onPointerDown={e=>e.stopPropagation()} style={{display:"flex",gap:0,flexShrink:0}}>
                            <button onClick={e=>{e.stopPropagation();compTask(task.id);}} title="Mark done" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Check s={13} c={tp.color}/></button>
                            {AS.legacyCompleteUI && <button onClick={e=>{e.stopPropagation();legacyCompTask(task.id);}} title="Legacy complete (no timestamp)" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clock s={12} c={tp.color}/></button>}
                            <button onClick={e=>{e.stopPropagation();moveTop(task.id);}} title="Top" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.MoveTop s={12} c={T.tSoft}/></button>
                            {task.pinned && <button onClick={e=>{e.stopPropagation();unpinTask(task.id);}} title="Unpin" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,fontSize:10}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}>📍</button>}
                            <button onClick={e=>{e.stopPropagation();setChgPri(task.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.PriC s={12} c={T.tSoft}/></button>
                            <button onClick={e=>{e.stopPropagation();setShowBD(task);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} title="Shatter with AI" onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Split s={12} c={T.tSoft}/></button>
                            <button onClick={e=>{e.stopPropagation();openFirstStep(task);}} title="Suggest first step with AI" style={{background:"none",border:"none",cursor:hasAI?"pointer":"default",padding:3,opacity:hasAI?.35:.15,fontSize:11}} onMouseEnter={e=>{if(hasAI)e.currentTarget.style.opacity=1;}} onMouseLeave={e=>e.currentTarget.style.opacity=hasAI?.35:.15}>✦→</button>
                            <button onClick={e=>{e.stopPropagation();startManualGroup(task);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,fontSize:11}} title="Add subtasks manually" onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}>✦+</button>
                            <button onClick={e=>{e.stopPropagation();delTask(task.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.3}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.3}><IC.Trash s={12} c={T.tFaint}/></button>
                          </div>
                        </div>
                      );
                    }
                  });
                })()}
              </div>
            ) : (
              <div style={{background:T.card,borderRadius:16,padding:"40px 20px",border:`1px solid ${T.brd}`,textAlign:"center",boxShadow:T.shadow}}><p style={{color:T.tFaint,fontSize:14,margin:0}}>{searchQ.trim()?"No tasks match your search":"No tasks in queue"}</p></div>
            )}

            {/* Snoozed tasks — faded at bottom of queue */}
            {snoozedT.length > 0 && (
              <div style={{marginTop:16,opacity:0.55}}>
                <p style={{fontSize:9,fontWeight:700,letterSpacing:1.5,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 8px 4px",textTransform:"uppercase"}}>💤 Sleeping</p>
                <div style={{background:T.card,borderRadius:14,border:`1px solid ${T.brd}`,overflow:"hidden",boxShadow:T.shadow}}>
                  {snoozedT.map((t, i) => {
                    const d = new Date(t.snoozedUntil);
                    const tom = new Date(); tom.setDate(tom.getDate()+1);
                    const wakeLabel = d.toDateString() === tom.toDateString()
                      ? `tomorrow ${d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`
                      : d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) + " " + d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
                    const cp = gP(pris, t.priority);
                    return (
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:i<snoozedT.length-1?`1px solid ${T.brd}`:"none"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:cp.isShaila?"#2ECC71":cp.color,flexShrink:0,opacity:0.6}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <p style={{margin:0,fontSize:12,color:T.tSoft,fontFamily:"Georgia,serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.text}</p>
                          <p style={{margin:"2px 0 0",fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>wakes {wakeLabel}</p>
                        </div>
                        <button onClick={()=>wakeTask(t.id)}
                          style={{flexShrink:0,padding:"4px 10px",fontSize:10,fontFamily:"system-ui",fontWeight:600,color:T.tSoft,background:"none",border:`1px solid ${T.brd}`,borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brdS;e.currentTarget.style.color=T.text;}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.brd;e.currentTarget.style.color=T.tSoft;}}>
                          ↑ Wake now
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== SHELF TAB ===== */}
        {/* Shelf tab removed — completed tasks live in Insights */}

        {/* ===== INSIGHTS TAB — Redesigned ===== */}
        {tab === "insights" && (
          <div style={{animation:"ot-fade 0.3s",marginTop:24}}>

            {/* ── AI Insight card (requires AI key) ── */}
            {hasAI && (
              <div style={{background:T.card,borderRadius:18,border:`1px solid ${T.brd}`,padding:"18px 20px",marginBottom:18,boxShadow:T.shadow}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:0,fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>✦ AI Coach Insight</h3>
                  <button
                    onClick={genAiInsight}
                    disabled={aiInsightLoading || !metrics}
                    style={{fontSize:10,fontFamily:"system-ui",fontWeight:600,padding:"4px 10px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,cursor:metrics?("pointer"):"default",color:T.tSoft,opacity:aiInsightLoading ? .5 : 1}}
                  >
                    {aiInsightLoading ? "Thinking..." : aiInsight ? "↻ Refresh" : "Generate"}
                  </button>
                </div>
                {aiInsightLoading && (
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0"}}>
                    <span style={{display:"inline-block",width:14,height:14,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.8s linear infinite"}}/>
                    <span style={{fontSize:12,color:T.tFaint,fontFamily:"system-ui"}}>Analyzing your data...</span>
                  </div>
                )}
                {aiInsight && !aiInsightLoading && (() => {
                  const lines = aiInsight.split('\n').map(l => l.trim()).filter(Boolean);
                  const bullets = lines.filter(l => l.startsWith('•'));
                  const takeawayLine = lines.find(l => l.toUpperCase().startsWith('TAKEAWAY:'));
                  if (bullets.length === 0) {
                    return <p style={{fontSize:13,lineHeight:1.65,color:T.text,margin:"0 0 12px"}}>{aiInsight}</p>;
                  }
                  return (
                    <div style={{marginBottom:12}}>
                      <ul style={{margin:"0 0 10px",padding:0,listStyle:"none"}}>
                        {bullets.map((b,i) => (
                          <li key={i} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,lineHeight:1.6,color:T.text,marginBottom:5}}>
                            <span style={{color:T.tSoft,marginTop:3,flexShrink:0,fontSize:10}}>●</span>
                            <span>{b.replace(/^•\s*/,'')}</span>
                          </li>
                        ))}
                      </ul>
                      {takeawayLine && (
                        <div style={{borderTop:`1px solid ${T.brd}`,paddingTop:10,marginTop:2,display:"flex",gap:8,alignItems:"flex-start"}}>
                          <span style={{fontSize:9,fontWeight:700,color:T.tFaint,fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.2,paddingTop:3,flexShrink:0,whiteSpace:"nowrap"}}>Key Takeaway</span>
                          <span style={{fontSize:13,fontWeight:600,color:T.text,lineHeight:1.5}}>{takeawayLine.replace(/^TAKEAWAY:\s*/i,'')}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {!aiInsight && !aiInsightLoading && (
                  <p style={{fontSize:13,color:T.tFaint,margin:0,fontFamily:"system-ui"}}>{metrics ? "Tap Generate for a personalized insight based on your task history." : "Complete tasks to enable personalized insights."}</p>
                )}

                {/* Quick analysis buttons */}
                {aiInsight && metrics && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8,marginBottom:8}}>
                    {[
                      ["Completion time by tier","Within each priority tier, how consistent and fast am I? Any patterns worth knowing?"],
                      ["Task type patterns","What patterns do you see in my task types and topics?"],
                      ["Productivity trends","What are my productivity trends over time?"],
                      ["Recommendations","Based on all my data, what should I focus on?"]
                    ].map(([label, prompt]) => (
                      <button key={label} onClick={()=>{setAiChatOpen(true);sendAiChat(prompt);}} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tSoft,cursor:"pointer"}}>{label}</button>
                    ))}
                  </div>
                )}

                {/* Chat toggle */}
                {metrics && (
                  <button onClick={()=>setAiChatOpen(o=>!o)} style={{width:"100%",padding:"6px",fontSize:10,fontFamily:"system-ui",fontWeight:600,color:T.tSoft,background:"none",border:`1px solid ${T.brd}`,borderRadius:8,cursor:"pointer",marginTop:4}}>
                    {aiChatOpen ? "Close chat ▲" : "Ask questions about my data ▼"}
                  </button>
                )}

                {/* Chat dialog */}
                {aiChatOpen && (
                  <div style={{marginTop:10,borderTop:`1px solid ${T.brd}`,paddingTop:10}}>
                    {/* Chat history */}
                    <div ref={chatBoxRef} style={{maxHeight:300,overflowY:"auto",marginBottom:8}}>
                      {(aiChatHistory.length > 60 ? aiChatHistory.slice(-60) : aiChatHistory).map((m, i) => (
                        <div key={i} style={{marginBottom:8,display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                          <div style={{maxWidth:"85%",padding:"8px 12px",borderRadius:m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",background:m.role==="user"?T.text:T.bgW,color:m.role==="user"?(T.bg||"#fff"):(AS?.colorScheme==="midnight"?"#E0DCF0":T.text),fontSize:13,lineHeight:1.5,fontFamily:m.role==="user"?"system-ui":"inherit"}}>
                            {m.text}
                          </div>
                        </div>
                      ))}
                      {aiChatLoading && (
                        <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0"}}>
                          <span style={{display:"inline-block",width:12,height:12,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.8s linear infinite"}}/>
                          <span style={{fontSize:12,color:T.tFaint,fontFamily:"system-ui"}}>Analyzing...</span>
                        </div>
                      )}
                      <div ref={chatEndRef}/>
                    </div>
                    {/* Chat input */}
                    <div style={{display:"flex",gap:6}}>
                      <input
                        value={aiChatInput}
                        onChange={e=>setAiChatInput(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter"&&aiChatInput.trim())sendAiChat(aiChatInput);}}
                        placeholder="Ask about your patterns, times, priorities..."
                        style={{flex:1,padding:"8px 12px",fontSize:13,border:`1px solid ${T.brd}`,borderRadius:10,outline:"none",background:T.bgW,color:AS?.colorScheme==="midnight"?"#E0DCF0":T.text,fontFamily:"system-ui"}}
                      />
                      <button onClick={()=>aiChatInput.trim()&&sendAiChat(aiChatInput)} disabled={aiChatLoading||!aiChatInput.trim()} style={{padding:"8px 14px",borderRadius:10,border:"none",background:T.text,color:T.bg||"#fff",fontSize:12,fontWeight:700,fontFamily:"system-ui",cursor:"pointer",opacity:aiChatLoading||!aiChatInput.trim()?.4:1}}>Send</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Activity Charts ── */}
            {chartData && (() => {
              // ── Generic bar chart (pure SVG) ──
              const BarChart = ({bars, accentColor, showCount=true}) => {
                const max = Math.max(...bars.map(b => b.n), 1);
                const W = 320, H = 80, bw = W / bars.length;
                return (
                  <svg viewBox={`0 0 ${W} ${H+20}`} style={{width:"100%",display:"block",overflow:"visible"}}>
                    {bars.map((b, i) => {
                      const bh = Math.max((b.n/max)*H, b.n>0?3:0);
                      const highlight = b.n === max && b.n > 0;
                      return (
                        <g key={i}>
                          <rect x={i*bw+1} y={H-bh} width={bw-2} height={bh}
                            fill={highlight ? accentColor : accentColor+"88"} rx={2}/>
                          {showCount && b.n > 0 && (
                            <text x={i*bw+bw/2} y={H-bh-3} textAnchor="middle"
                              fontSize={7} fill={T.tFaint} fontFamily="system-ui">{b.n}</text>
                          )}
                          {b.label && (
                            <text x={i*bw+bw/2} y={H+14} textAnchor="middle"
                              fontSize={7.5} fill={T.tFaint} fontFamily="system-ui">{b.label}</text>
                          )}
                        </g>
                      );
                    })}
                    {/* zero baseline */}
                    <line x1={0} y1={H} x2={W} y2={H} stroke={T.brd} strokeWidth={1}/>
                  </svg>
                );
              };

              // ── Priority donut (pure SVG) ──
              const DonutChart = ({slices}) => {
                const total = slices.reduce((s,p) => s+p.n, 0);
                if (!total) return null;
                const R = 44, r = 28, cx = 60, cy = 60;
                let angle = -Math.PI/2;
                const paths = slices.map(p => {
                  const sweep = (p.n/total)*2*Math.PI;
                  const x1 = cx + R*Math.cos(angle), y1 = cy + R*Math.sin(angle);
                  const x2 = cx + R*Math.cos(angle+sweep), y2 = cy + R*Math.sin(angle+sweep);
                  const xi1 = cx + r*Math.cos(angle+sweep), yi1 = cy + r*Math.sin(angle+sweep);
                  const xi2 = cx + r*Math.cos(angle), yi2 = cy + r*Math.sin(angle);
                  const largeArc = sweep > Math.PI ? 1 : 0;
                  const d = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${r} ${r} 0 ${largeArc} 0 ${xi2} ${yi2} Z`;
                  const result = {d, color: p.c, n: p.n, label: p.l};
                  angle += sweep;
                  return result;
                });
                return (
                  <div style={{display:"flex",alignItems:"center",gap:16}}>
                    <svg viewBox="0 0 120 120" style={{width:100,height:100,flexShrink:0}}>
                      {paths.map((p,i) => <path key={i} d={p.d} fill={p.color}/>)}
                      <text x={cx} y={cy+4} textAnchor="middle" fontSize={13} fontWeight={600}
                        fill={T.text} fontFamily="system-ui">{total}</text>
                      <text x={cx} y={cy+15} textAnchor="middle" fontSize={7}
                        fill={T.tFaint} fontFamily="system-ui">total</text>
                    </svg>
                    <div style={{display:"flex",flexDirection:"column",gap:5,flex:1}}>
                      {paths.map((p,i) => (
                        <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
                          <div style={{width:9,height:9,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                          <span style={{fontSize:11,fontFamily:"system-ui",flex:1,color:T.tSoft}}>{p.label}</span>
                          <span style={{fontSize:11,fontWeight:600,fontFamily:"system-ui",color:T.text}}>{p.n}</span>
                          <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>{Math.round(p.n/total*100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              };

              // ── Line/area chart (for trend + cumulative) ──
              const AreaChart = ({points, accentColor, showLabels=true}) => {
                const max = Math.max(...points.map(p => p.n), 1);
                const W = 320, H = 80, n = points.length;
                const px = (i) => (i / (n-1)) * W;
                const py = (v) => H - (v/max)*H;
                const lineD = points.map((p,i) => `${i===0?'M':'L'}${px(i).toFixed(1)} ${py(p.n).toFixed(1)}`).join(' ');
                const areaD = `${lineD} L${W} ${H} L0 ${H} Z`;
                const rgb = T.isDark ? '126,176,222' : '80,120,204';
                return (
                  <svg viewBox={`0 0 ${W} ${H+20}`} style={{width:"100%",display:"block",overflow:"visible"}}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={`rgba(${rgb},0.35)`}/>
                        <stop offset="100%" stopColor={`rgba(${rgb},0.02)`}/>
                      </linearGradient>
                    </defs>
                    <path d={areaD} fill="url(#areaGrad)"/>
                    <path d={lineD} fill="none" stroke={accentColor} strokeWidth={2} strokeLinejoin="round"/>
                    {/* dots for high points */}
                    {points.map((p,i) => p.n===max && max>0 ? (
                      <circle key={i} cx={px(i)} cy={py(p.n)} r={3} fill={accentColor}/>
                    ) : null)}
                    <line x1={0} y1={H} x2={W} y2={H} stroke={T.brd} strokeWidth={1}/>
                    {showLabels && points.filter(p=>p.label).map((p,i) => (
                      <text key={i} x={px(points.indexOf(p))} y={H+14} textAnchor="middle"
                        fontSize={7.5} fill={T.tFaint} fontFamily="system-ui">{p.label}</text>
                    ))}
                  </svg>
                );
              };

              const accentColor = T.isDark ? '#7EB0DE' : '#5080CC';
              const rangeData = {
                day:     {bars: chartData.h24,    title: 'Last 24 hours', sub: 'completions by hour'},
                week:    {bars: chartData.days7,   title: 'Last 7 days',   sub: 'completions by day'},
                month:   {bars: chartData.days30,  title: 'Last 30 days',  sub: 'completions by day'},
                alltime: {bars: chartData.allHours, title: 'All time',     sub: 'completions by hour of day'},
              };
              const rd = rangeData[chartRange];
              const total = rd.bars.reduce((s,b) => s+b.n, 0);

              return (
                <div style={{background:T.card,borderRadius:18,border:`1px solid ${T.brd}`,padding:"18px 20px",marginBottom:18,boxShadow:T.shadow}}>
                  <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:"0 0 14px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>Activity</h3>

                  {/* Range tabs */}
                  <div style={{display:"flex",gap:4,marginBottom:16}}>
                    {[['day','24h'],['week','7 days'],['month','30 days'],['alltime','All time']].map(([k,lbl]) => (
                      <button key={k} onClick={()=>setChartRange(k)}
                        style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${chartRange===k?T.text:T.brd}`,
                          background:chartRange===k?T.text:"transparent",
                          color:chartRange===k?(SCHEMES[AS?.colorScheme]?.bg||"#fff"):T.tSoft,
                          fontSize:10,fontFamily:"system-ui",fontWeight:600,cursor:"pointer"}}>
                        {lbl}
                      </button>
                    ))}
                  </div>

                  {/* Bar chart */}
                  <div style={{marginBottom:4}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
                      <span style={{fontSize:11,fontFamily:"system-ui",color:T.tSoft}}>{rd.sub}</span>
                      <span style={{fontSize:18,fontWeight:700,color:T.text,fontFamily:"system-ui"}}>{total} <span style={{fontSize:11,fontWeight:400,color:T.tFaint}}>done</span></span>
                    </div>
                    <BarChart bars={rd.bars} accentColor={accentColor}/>
                  </div>

                  {/* Divider */}
                  <div style={{borderTop:`1px solid ${T.brd}`,margin:"18px 0"}}/>

                  {/* Priority donut */}
                  <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:"0 0 14px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>By Priority</h3>
                  <DonutChart slices={chartData.donut}/>

                  {/* Divider */}
                  <div style={{borderTop:`1px solid ${T.brd}`,margin:"18px 0"}}/>

                  {/* Secondary chart — switchable */}
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
                    {[['dow','Day of week'],['speed','Speed'],['trend','Trend'],['cumulative','Cumulative']].map(([k,lbl]) => (
                      <button key={k} onClick={()=>setChartSecondary(k)}
                        style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${chartSecondary===k?T.text:T.brd}`,
                          background:chartSecondary===k?T.text:"transparent",
                          color:chartSecondary===k?(SCHEMES[AS?.colorScheme]?.bg||"#fff"):T.tSoft,
                          fontSize:10,fontFamily:"system-ui",fontWeight:600,cursor:"pointer"}}>
                        {lbl}
                      </button>
                    ))}
                  </div>

                  {chartSecondary === 'dow' && (() => {
                    const peak = chartData.dow.reduce((a,b) => b.n>a.n?b:a, chartData.dow[0]);
                    return (
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
                          <span style={{fontSize:11,fontFamily:"system-ui",color:T.tSoft}}>all-time, by day of week</span>
                          <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>peak: {peak.label} ({peak.n})</span>
                        </div>
                        <BarChart bars={chartData.dow} accentColor={accentColor}/>
                      </div>
                    );
                  })()}

                  {chartSecondary === 'speed' && (() => {
                    const maxB = chartData.speedBuckets.reduce((a,b)=>b.n>a.n?b:a,chartData.speedBuckets[0]);
                    return (
                      <div>
                        <div style={{marginBottom:8}}>
                          <span style={{fontSize:11,fontFamily:"system-ui",color:T.tSoft}}>how quickly tasks get done (creation → completion)</span>
                        </div>
                        <BarChart bars={chartData.speedBuckets.map(b=>({...b,label:b.label}))} accentColor="#9BD4A0"/>
                        {maxB.n>0 && <p style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:8,marginBottom:0}}>Most tasks finish {maxB.label} after being created.</p>}
                      </div>
                    );
                  })()}

                  {chartSecondary === 'trend' && (
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
                        <span style={{fontSize:11,fontFamily:"system-ui",color:T.tSoft}}>daily completions, last 30 days</span>
                      </div>
                      <AreaChart points={chartData.trend30} accentColor={accentColor}/>
                    </div>
                  )}

                  {chartSecondary === 'cumulative' && (
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
                        <span style={{fontSize:11,fontFamily:"system-ui",color:T.tSoft}}>total tasks completed, last 90 days</span>
                        <span style={{fontSize:18,fontWeight:700,color:T.text,fontFamily:"system-ui"}}>{chartData.cum90[chartData.cum90.length-1]?.n} <span style={{fontSize:11,fontWeight:400,color:T.tFaint}}>total</span></span>
                      </div>
                      <AreaChart points={chartData.cum90} accentColor="#E09AB8" showLabels={true}/>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Tip Carousel ── */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <h2 style={{fontSize:16,fontWeight:600,margin:0}}>Tips</h2>
              <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>{tipCarouselIdx+1} / {tipCarouselList.length}</span>
            </div>

            {/* Category filter pills */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              {TIP_CATS.map(cat => (
                <button key={cat} onClick={()=>setTipCat(cat)} style={{padding:"4px 12px",borderRadius:10,border:`1px solid ${tipCat===cat?T.text:T.brd}`,background:tipCat===cat?T.text:"transparent",color:tipCat===cat?(SCHEMES[AS.colorScheme]?.bg||"#fff"):T.tSoft,fontSize:10,fontFamily:"system-ui",fontWeight:600,cursor:"pointer"}}>{cat}</button>
              ))}
            </div>

            {/* Single tip card */}
            <div style={{background:T.card,borderRadius:18,border:`1px solid ${T.brd}`,padding:"22px 20px",marginBottom:10,minHeight:120,animation:"ot-fade 0.2s",position:"relative"}}>
              <p style={{fontSize:15,lineHeight:1.65,color:T.text,margin:"0 0 14px"}}>{tipCarouselItem.t}</p>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {tipCarouselItem.s ? (
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(tipCarouselItem.s + " " + tipCarouselItem.t.slice(0,40))}`} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:T.tSoft,fontFamily:"system-ui",fontStyle:"italic",textDecoration:"underline",textDecorationColor:T.brd}}>
                      {tipCarouselItem.s}
                    </a>
                  ) : (
                    <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",fontStyle:"italic"}}>{tipCarouselItem.s}</span>
                  )}
                  <span style={{background:T.bgW,borderRadius:4,padding:"1px 6px",fontSize:11,fontFamily:"system-ui",fontWeight:700,color:T.tFaint,border:`1px solid ${T.brd}`}}>{tipCarouselItem.cat}</span>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button
                    onClick={()=>setTipViewIdx(i=>(i-1+tipCarouselList.length)%tipCarouselList.length)}
                    style={{padding:"6px 14px",borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:13,color:T.tSoft,fontFamily:"system-ui",lineHeight:1}}
                    title="Previous tip"
                  >←</button>
                  <button
                    onClick={()=>setTipViewIdx(i=>(i+1)%tipCarouselList.length)}
                    style={{padding:"6px 14px",borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:13,color:T.tSoft,fontFamily:"system-ui",lineHeight:1}}
                    title="Next tip"
                  >→</button>
                </div>
              </div>
            </div>

            {/* ── Stats (collapsible) ── */}
            {metrics ? (
              <details style={{marginTop:24}} open={false}>
                <summary style={{fontSize:13,fontWeight:600,fontFamily:"system-ui",cursor:"pointer",color:T.tSoft,listStyle:"none",display:"flex",alignItems:"center",gap:6,marginBottom:12,userSelect:"none"}}>
                  <span style={{fontSize:10,opacity:.6}}>▶</span> Your stats
                </summary>
                <div style={{paddingTop:8}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:26,fontWeight:600}}>{metrics.total}</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Completed</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Total tasks you've finished</div></div>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:26,fontWeight:600}}>{metrics.avg}</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Avg time</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Average time from creation to done</div></div>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:26,fontWeight:600}}>{metrics.sk}d</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Streak</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Consecutive days with completions</div></div>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:15,fontWeight:600}}>{metrics.pT||"—"}</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Peak hour</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Your most productive time of day</div></div>
                  </div>
                  {metrics.goodEnoughCount > 0 && (
                    <div style={{background:pBg("#9BD4A0"),borderRadius:12,padding:"12px 16px",border:"1px solid #9BD4A040",marginBottom:14,display:"flex",gap:10,alignItems:"center"}}>
                      <IC.GoodEnough s={16} c="#3A7242"/>
                      <div><p style={{fontSize:12,fontWeight:600,margin:0,color:"#3A7242",fontFamily:"system-ui"}}>{metrics.goodEnoughCount} "good enough" completions</p><p style={{fontSize:11,color:"#3A7242",margin:0,fontFamily:"system-ui"}}>That's pragmatic productivity at its finest.</p></div>
                    </div>
                  )}
                  <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,padding:16,marginBottom:14}}>
                    <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:"0 0 12px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>By Priority</h3>
                    {metrics.pS.map(p => (
                      <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${T.brdS}`}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:p.c,flexShrink:0}}/>
                        <span style={{flex:1,fontSize:13,fontFamily:"system-ui",fontWeight:500}}>{p.l}</span>
                        <span style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui"}}>{p.n} done</span>
                        <span style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui",minWidth:60,textAlign:"right"}}>avg {p.a}</span>
                      </div>
                    ))}
                  </div>
                  {/* Pattern insights (rule-based) */}
                  {advice.length > 0 && (
                    <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,padding:16,marginBottom:14}}>
                      <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:"0 0 12px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>Patterns</h3>
                      {advice.map((a,i) => <p key={i} style={{fontSize:13,lineHeight:1.6,margin:i<advice.length-1?"0 0 10px":0,padding:"9px 11px",background:T.bgW,borderRadius:10,fontFamily:"system-ui"}}>{a}</p>)}
                    </div>
                  )}
                  <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,overflow:"hidden",marginBottom:32}}>
                    <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:0,padding:"12px 14px 8px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>Completion Log</h3>
                    <div style={{maxHeight:280,overflowY:"auto"}}>
                      {metrics.cL.map(t => {
                        const tp = gP(pris, t.priority);
                        return (
                          <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderTop:`1px solid ${T.brdS}`}}>
                            <div style={{width:8,height:8,borderRadius:"50%",background:tp.color,flexShrink:0}}/>
                            <span style={{flex:1,fontSize:13,color:T.tSoft}}>
                              {t.goodEnough&&<span style={{fontSize:11,marginRight:4,opacity:.6}}>≈</span>}
                              {t.text}
                            </span>
                            <button onClick={()=>cloneTask(t)} title="Clone as new task" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clone s={12} c={T.tFaint}/></button>
                            <div style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",textAlign:"right",flexShrink:0}}>
                              <div>{new Date(t.createdAt).toLocaleDateString()}</div>
                              <div>→ {new Date(t.completedAt).toLocaleDateString()}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </details>
            ) : (
              <div style={{background:T.card,borderRadius:16,padding:"24px 20px",border:`1px solid ${T.brd}`,textAlign:"center",marginBottom:32}}><p style={{color:T.tFaint,fontSize:14,margin:0}}>Complete tasks to see your stats</p></div>
            )}
          </div>
        )}

        {tab !== "focus" && <footer style={{textAlign:"center",padding:"20px 0 36px",borderTop:`1px solid ${T.brdS}`,marginTop:16,flexShrink:0}}><p style={{color:T.tFaint,fontSize:12,fontStyle:"italic",margin:0}}>One thing at a time.</p></footer>}
      </div>

      {/* ── Floating capture buttons — always visible except during Zen ── */}
      {!zen && !["switchboard","deskphone"].includes(suiteView) && (()=>{
        const outC = T.isDark ? T.tFaint : T.tSoft;
        const icS = {width:19,height:19,stroke:outC,fill:"none",strokeWidth:1.8,strokeLinecap:"round",strokeLinejoin:"round",pointerEvents:"none"};
        const icSm = {width:14,height:14,stroke:outC,fill:"none",strokeWidth:1.8,strokeLinecap:"round",strokeLinejoin:"round",pointerEvents:"none"};
        // Large prominent buttons (universal voice capture)
        const bigS = {width:48,height:48,background:T.card+"cc",border:`1.5px solid ${outC}60`,borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",opacity:.8,boxShadow:T.shadow};
        const onEB = e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.borderColor=outC;e.currentTarget.style.transform="scale(1.08)";e.currentTarget.style.boxShadow=T.shadowLg;};
        const onLB = e=>{e.currentTarget.style.opacity=".8";e.currentTarget.style.borderColor=outC+"60";e.currentTarget.style.transform="scale(1)";e.currentTarget.style.boxShadow=T.shadow;};
        // Small secondary buttons (text-style)
        const smS = {background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:4,padding:"4px 6px",borderRadius:8,opacity:.5,transition:"opacity 0.15s",fontFamily:"system-ui",fontSize:11,color:outC,fontWeight:600};
        const onEs = e=>e.currentTarget.style.opacity="1";
        const onLs = e=>e.currentTarget.style.opacity=".5";
        return (
          <div style={{position:"fixed",bottom:86,right:20,zIndex:8400,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
            {/* Prominent: Record shaila + Record call (universal) */}
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <button onClick={()=>{setConvCallMode(false);setShowConvCapture(true);}} style={bigS} onMouseEnter={onEB} onMouseLeave={onLB} title="Record — extracts tasks, shailos & more">
                <svg {...icS} viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </button>
              <button onClick={()=>{setConvCallMode(true);setShowConvCapture(true);}} style={bigS} onMouseEnter={onEB} onMouseLeave={onLB} title="Capture call audio — share tab/window to record a phone call">
                <svg {...icS} viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.25a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg>
              </button>
            </div>
            {/* Secondary: Add manual + View records */}
            <div style={{display:"flex",gap:2,alignItems:"center",justifyContent:"flex-end"}}>
              <button onClick={()=>{setShailosAction("add-manual");setSuiteView("shailos");}} style={smS} onMouseEnter={onEs} onMouseLeave={onLs} title="Add shaila manually">
                <svg {...icSm} viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add
              </button>
              <span style={{color:outC,opacity:.25,fontSize:11}}>|</span>
              <button onClick={()=>{setShailosAction(null);setSuiteView("shailos");}} style={smS} onMouseEnter={onEs} onMouseLeave={onLs} title="View shaila records">
                <svg {...icSm} viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                Records
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


// ─── ConvCapture — Universal Conversation Recorder ───────────────────────────
// callMode=false (mic button): records your own voice via getUserMedia
// callMode=true  (phone button): captures system audio via getDisplayMedia
//   — user shares the tab/window playing the call; Web Speech is skipped
function ConvCapture({ onClose, onApply, tasks, shailos, pris, aiOpts, T, callMode=false }) {
  // callMode starts in 'ready' phase (waiting for user to share screen)
  const [phase, setPhase] = useState(callMode ? 'ready' : 'recording');
  const [liveText, setLiveText] = useState('');
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const phaseRef = useRef(callMode ? 'ready' : 'recording');
  const streamRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const mediaStopPRef = useRef(null);
  const segBufRef = useRef('');
  const liveRef = useRef('');
  const recogRef = useRef(null);
  const elapsedTmrRef = useRef(null);

  function goPhase(p) { phaseRef.current = p; setPhase(p); }

  function startMediaRecorder(stream) {
    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const mr = new MediaRecorder(stream, { mimeType });
    mediaRecRef.current = mr;
    mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    mr.start(200);
    elapsedTmrRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }

  // Mic mode: start recording immediately on mount
  useEffect(() => {
    if (callMode) return; // call mode waits for user gesture (startCallCapture)
    chunksRef.current = [];
    segBufRef.current = '';
    liveRef.current = '';

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      recogRef.current = r;
      r.continuous = true; r.interimResults = true; r.lang = 'en-US';
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) segBufRef.current = (segBufRef.current + ' ' + e.results[i][0].transcript).trim();
          else interim = e.results[i][0].transcript;
        }
        const full = (segBufRef.current + (interim ? ' ' + interim : '')).trim();
        liveRef.current = full;
        setLiveText(full);
      };
      r.onend = () => { if (phaseRef.current === 'recording') { try { r.start(); } catch(_) {} } };
      try { r.start(); } catch(_) {}
    }

    const t = setTimeout(async () => {
      if (phaseRef.current !== 'recording') return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (phaseRef.current !== 'recording') { stream.getTracks().forEach(t => t.stop()); return; }
        startMediaRecorder(stream);
      } catch(_) { setErr('Mic permission denied. Enable mic and try again.'); }
    }, 300);

    return () => {
      clearTimeout(t);
      clearInterval(elapsedTmrRef.current);
      if (recogRef.current) { try { recogRef.current.onend = null; recogRef.current.abort(); } catch(_) {} }
      if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') { try { mediaRecRef.current.stop(); } catch(_) {} }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
    };
  }, []); // eslint-disable-line

  // Call mode: triggered by user clicking "Start capturing"
  async function startCallCapture() {
    setErr('');
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
        video: { width: 1, height: 1 },
      });
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks.length) {
        displayStream.getTracks().forEach(t => t.stop());
        setErr('No audio captured. Make sure to check "Share tab audio" in the browser dialog.');
        return;
      }
      // Stop the video track immediately — we only need audio
      displayStream.getVideoTracks().forEach(t => t.stop());
      const audioStream = new MediaStream(audioTracks);
      chunksRef.current = [];
      startMediaRecorder(audioStream);
      goPhase('recording');
    } catch(e) {
      if (e.name !== 'NotAllowedError') setErr('Could not capture audio: ' + e.message);
    }
  }

  async function stopAndProcess() {
    clearInterval(elapsedTmrRef.current);
    const webSpeechText = liveRef.current || segBufRef.current || '';
    if (recogRef.current) { try { recogRef.current.onend = null; recogRef.current.abort(); } catch(_) {} recogRef.current = null; }
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      mediaStopPRef.current = new Promise(res => { mediaRecRef.current.onstop = res; });
      try { mediaRecRef.current.stop(); } catch(_) { mediaStopPRef.current = null; }
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    goPhase('processing');
    let pending = null;

    try {
      if (mediaStopPRef.current) { await mediaStopPRef.current; mediaStopPRef.current = null; }
      const webmBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      let transcript = webSpeechText;

      if (webmBlob.size >= 500 && aiOpts) {
        pending = await savePendingRecording(webmBlob, callMode ? 'conversation_call' : 'conversation_mic', {
          source: 'main',
          label: callMode ? 'Conversation call capture' : 'Conversation mic capture',
        });
        const geminiTranscript = await transcribePendingRecording(
          pending.id, aiOpts,
          `Transcribe this audio recording exactly verbatim. The speaker uses Yeshivish — Orthodox Jewish English with Hebrew and Yiddish terminology. Use these standard spellings: shaila/shailos, halacha, gemara, Shabbos, davening, daven, bracha, mutar, assur, kashrus, Rashi, Rambam, psak, teshuvah, beis din, shiur, kollel, bochur, yeshiva, Hashem, Baruch Hashem, kiddush, Yom Tov, Pesach, Sukkos, Shavuos, chavrusa, beis medrash, machlokes, pshat, tzaddik, tzedakah, chasuna, mazel tov, maariv, mincha, shacharis, tefillin, mezuzah, sukkah, mikvah, niddah, safeik, treif, fleishig, milchig, pareve, shidduch, simcha.\n\nReturn only the verbatim transcript. No summary, no rephrasing.`
        );
        if (geminiTranscript) transcript = geminiTranscript.trim() || transcript;
      }

      if (!transcript.trim()) {
        setErr(callMode ? 'No audio was captured from the call. Make sure audio was playing and you checked "Share tab audio".' : 'Nothing was captured. Check mic permissions and try again.');
        setItems([]);
        goPhase('review');
        return;
      }

      const parsed = await aiParseConversation(transcript, tasks, shailos, aiOpts);
      const allItems = [];
      const add = (cat, arr) => (arr || []).forEach(item => allItems.push({ id: uid(), cat, approved: true, ...item }));
      add('tasks', parsed.tasks);
      add('shailos', parsed.shailos);
      add('gotBacks', parsed.gotBacks);
      add('completions', parsed.completions);
      add('scheduleItems', parsed.scheduleItems);
      add('reminders', parsed.reminders);
      setItems(allItems);
      if (pending?.id) await deletePendingRecording(pending.id);
      goPhase('review');
    } catch(e) {
      if (typeof pending !== 'undefined' && pending?.id) {
        await updatePendingRecordingError(pending.id, e.message || String(e)).catch(() => {});
      }
      setErr('Could not process: ' + e.message);
      setItems([]);
      goPhase('review');
    }
  }

  function toggleApproved(id) { setItems(prev => prev.map(it => it.id === id ? {...it, approved: !it.approved} : it)); }
  function updateText(id, text) { setItems(prev => prev.map(it => it.id === id ? {...it, text} : it)); }
  function updatePriority(id, priority) { setItems(prev => prev.map(it => it.id === id ? {...it, priority} : it)); }

  function applyApproved() {
    items.filter(it => it.approved).forEach(it => {
      if (it.cat === 'tasks')         onApply(it.text, it.priority || 'eventually');
      else if (it.cat === 'shailos') onApply(it.synopsis || it.content || it.text || 'Shaila', 'shaila');
      else if (it.cat === 'scheduleItems') onApply(it.when ? `${it.text} (${it.when})` : it.text, 'today');
      else if (it.cat === 'reminders') onApply(it.text, 'eventually');
      // completions + gotBacks are info-only for now
    });
    onClose();
  }

  const approvedCount = items.filter(it => it.approved).length;
  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const fmtElapsed = `${mm}:${ss}`;

  const SECTIONS = [
    { cat: 'tasks',        color: '#5B7BE8', emoji: '✓',  label: 'New Tasks' },
    { cat: 'shailos',      color: '#C8A84C', emoji: '❓', label: 'Shailos' },
    { cat: 'gotBacks',     color: '#2ECC71', emoji: '📬', label: 'Got Back to Asker' },
    { cat: 'completions',  color: '#27AE60', emoji: '☑',  label: 'Mark Complete' },
    { cat: 'scheduleItems',color: '#9B59B6', emoji: '📅', label: 'Schedule' },
    { cat: 'reminders',    color: '#E67E22', emoji: '🔔', label: 'Reminders' },
  ];

  const overlayS = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
  const cardS    = { background: T.card, borderRadius: 16, maxWidth: 560, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', fontFamily: 'inherit' };
  const btnClose = { background: 'none', border: 'none', cursor: 'pointer', color: T.tFaint, fontSize: 22, lineHeight: 1, padding: 4, fontFamily: 'system-ui' };

  // ── Call mode: waiting for user to share screen ───────────────────────────
  if (phase === 'ready') return (
    <div style={overlayS} onClick={onClose}>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '22px 24px 18px', borderBottom: `1px solid ${T.brd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.t }}>Capture Call Audio</span>
            <button style={btnClose} onClick={onClose}>×</button>
          </div>
          <div style={{ fontSize: 13, color: T.tSoft, fontFamily: 'system-ui', lineHeight: 1.6, marginBottom: 14 }}>
            Click <strong>Start capturing</strong>, then in the browser dialog:<br/>
            1. Select the tab or window playing the call<br/>
            2. Check <em>"Share tab audio"</em> before clicking Share
          </div>
          {err && <div style={{ fontSize: 12, color: '#E74C3C', fontFamily: 'system-ui', marginBottom: 8 }}>{err}</div>}
        </div>
        <div style={{ padding: '18px 24px', display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={startCallCapture} style={{ background: '#5B7BE8', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'system-ui' }}>
            Start capturing
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${T.brd}`, borderRadius: 12, padding: '13px 18px', fontSize: 14, color: T.tSoft, cursor: 'pointer', fontFamily: 'system-ui' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'recording') return (
    <div style={overlayS} onClick={onClose}>
      <style>{`@keyframes conv-pulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '22px 24px 18px', borderBottom: `1px solid ${T.brd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.t }}>{callMode ? 'Capturing Call Audio' : 'Recording Conversation'}</span>
            <button style={btnClose} onClick={onClose}>×</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#E74C3C', animation: 'conv-pulse 1.4s ease infinite' }}/>
            <span style={{ fontSize: 13, color: T.tSoft, fontFamily: 'system-ui', fontVariantNumeric: 'tabular-nums' }}>{fmtElapsed}</span>
            <span style={{ fontSize: 12, color: T.tFaint, fontFamily: 'system-ui' }}>Speak freely — AI will extract everything</span>
          </div>
          {liveText && (
            <div style={{ fontSize: 12, color: T.tFaint, fontFamily: 'system-ui', lineHeight: 1.5, maxHeight: 72, overflowY: 'auto', background: T.bgW, borderRadius: 8, padding: '8px 12px', border: `1px solid ${T.brdS}` }}>
              {liveText}
            </div>
          )}
          {err && <div style={{ fontSize: 12, color: '#E74C3C', fontFamily: 'system-ui', marginTop: 8 }}>{err}</div>}
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={stopAndProcess} style={{ background: '#E74C3C', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 30px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'system-ui' }}>
            Stop &amp; Process
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${T.brd}`, borderRadius: 12, padding: '13px 18px', fontSize: 14, color: T.tSoft, cursor: 'pointer', fontFamily: 'system-ui' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'processing') return (
    <div style={overlayS}>
      <div style={{ ...cardS, alignItems: 'center', justifyContent: 'center', padding: '56px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 38, marginBottom: 16 }}>🎙️</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.t, marginBottom: 8, fontFamily: 'system-ui' }}>Processing conversation…</div>
        <div style={{ fontSize: 13, color: T.tFaint, fontFamily: 'system-ui' }}>Transcribing and extracting items</div>
      </div>
    </div>
  );

  // ── Review phase ──────────────────────────────────────────────────────────
  return (
    <div style={overlayS} onClick={onClose}>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${T.brd}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.t }}>Found in this conversation</div>
              <div style={{ fontSize: 12, color: T.tFaint, fontFamily: 'system-ui', marginTop: 3 }}>
                {items.length} item{items.length !== 1 ? 's' : ''} — check what to add
              </div>
            </div>
            <button style={btnClose} onClick={onClose}>×</button>
          </div>
          {err && <div style={{ fontSize: 12, color: '#E74C3C', fontFamily: 'system-ui', marginTop: 8 }}>{err}</div>}
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 24px 4px' }}>
          {items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '36px 0', color: T.tFaint, fontFamily: 'system-ui', fontSize: 14 }}>
              No actionable items found in this conversation.
            </div>
          )}
          {SECTIONS.map(({ cat, color, emoji, label }) => {
            const sItems = items.filter(it => it.cat === cat);
            if (!sItems.length) return null;
            return (
              <div key={cat} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <div style={{ width: 3, height: 18, background: color, borderRadius: 2, flexShrink: 0 }}/>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.t, fontFamily: 'system-ui', letterSpacing: '.3px' }}>{emoji} {label}</span>
                  <span style={{ fontSize: 11, background: color + '22', color: color, borderRadius: 10, padding: '1px 7px', fontFamily: 'system-ui', fontWeight: 600 }}>{sItems.length}</span>
                </div>
                {sItems.map(it => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 0', borderBottom: `1px solid ${T.brdS}` }}>
                    <input type="checkbox" checked={it.approved} onChange={() => toggleApproved(it.id)}
                      style={{ marginTop: 5, accentColor: color, flexShrink: 0, cursor: 'pointer', width: 14, height: 14 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        value={it.text || it.synopsis || ''}
                        onChange={e => updateText(it.id, e.target.value)}
                        style={{ width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${T.brdS}`, color: T.t, fontSize: 13, fontFamily: 'system-ui', padding: '2px 0', outline: 'none', boxSizing: 'border-box' }}
                      />
                      {cat === 'tasks' && (
                        <select value={it.priority || 'eventually'} onChange={e => updatePriority(it.id, e.target.value)}
                          style={{ marginTop: 5, fontSize: 11, background: T.bgW, border: `1px solid ${T.brd}`, borderRadius: 6, color: T.tSoft, padding: '2px 6px', cursor: 'pointer', fontFamily: 'system-ui' }}>
                          {pris.filter(p => !p.deleted).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                          <option value="shaila">Shaila</option>
                        </select>
                      )}
                      {cat === 'scheduleItems' && it.when && (
                        <div style={{ fontSize: 11, color: T.tFaint, fontFamily: 'system-ui', marginTop: 3 }}>When: {it.when}</div>
                      )}
                      {(cat === 'completions' || cat === 'gotBacks') && (
                        <div style={{ fontSize: 11, color: T.tFaint, fontFamily: 'system-ui', marginTop: 2, fontStyle: 'italic' }}>Info only — no action taken</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px 18px', borderTop: `1px solid ${T.brd}`, display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={applyApproved} disabled={approvedCount === 0}
            style={{ flex: 1, background: approvedCount > 0 ? '#5B7BE8' : T.brdS, color: approvedCount > 0 ? '#fff' : T.tFaint, border: 'none', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: approvedCount > 0 ? 'pointer' : 'default', fontFamily: 'system-ui', transition: 'background 0.15s' }}>
            Add {approvedCount > 0 ? approvedCount : 0} item{approvedCount !== 1 ? 's' : ''}
          </button>
          <button onClick={onClose}
            style={{ padding: '12px 18px', background: 'none', border: `1px solid ${T.brd}`, borderRadius: 10, fontSize: 14, color: T.tSoft, cursor: 'pointer', fontFamily: 'system-ui' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export { App };
