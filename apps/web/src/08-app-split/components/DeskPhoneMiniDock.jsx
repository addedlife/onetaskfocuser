import React, { useCallback, useEffect, useState } from 'react';
import { cleanTheme, ELEV, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon } from '../ui-tokens.jsx';
import { NerveCenterPhoneSurface } from './NerveCenterPhoneSurface.jsx';

function DeskPhoneMiniDock({ T, onOnlineChange, onOpenDeskPhone }) {
  const api = "http://127.0.0.1:8765";
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [number, setNumber] = useState("");
  const [body, setBody] = useState("");
  const C = cleanTheme(T);

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
      const res = await fetch(`${api}${path}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      await refresh();
      if (!res.ok || data?.success === false || data?.ok === false || data?.result === "failed") {
        setError(data?.error || data?.message || data?.reason || `DeskPhone reported failure (${res.status}).`);
        return false;
      }
      setError("");
      return true;
    } catch {
      setError("DeskPhone did not answer.");
      onOnlineChange?.(false);
      return false;
    } finally {
      setBusy("");
    }
  };

  const sendSms = async () => {
    if (!number.trim() || !body.trim()) return;
    const ok = await post(`/send?to=${encodeURIComponent(number.trim())}&body=${encodeURIComponent(body.trim())}`, "send");
    if (ok) setBody("");
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

  const iconBtnS = {
    width: 32, height: 32, borderRadius: RADIUS.md, border: `1px solid ${C.divider}`,
    background: C.bgSoft, color: C.muted, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <div style={{ position: "fixed", right: "clamp(10px,2vw,18px)", bottom: "clamp(12px,2vh,18px)", zIndex: 8550, fontFamily: NC_FONT_STACK, pointerEvents: "none" }}>
      {!open && (
        <button onClick={() => setOpen(true)} title="Calls and texts" style={{
          pointerEvents: "auto", height: 54, minWidth: 54, borderRadius: RADIUS.md,
          border: `1px solid ${C.divider}`, background: C.accent, color: "#fff",
          boxShadow: ELEV.drawer, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: SP.sm, padding: `0 ${SP.lg}`, fontWeight: 500, fontSize: NC_TYPE.body,
        }}>
          {suiteIcon("phone_in_talk", 22)}
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.05 }}>
            <span style={{ fontSize: NC_TYPE.meta }}>Calls/Text</span>
            <span style={{ fontSize: NC_TYPE.small, opacity: 0.72 }}>{status ? (callState || "ready") : "open"}</span>
          </span>
        </button>
      )}
      {open && (
        <div style={{
          pointerEvents: "auto", width: "min(360px,calc(100vw - 20px))",
          maxHeight: "calc(100vh - 86px)", overflow: "auto",
          background: C.bg, border: `1px solid ${C.divider}`,
          borderRadius: RADIUS.md, boxShadow: ELEV.drawer,
        }}>
          <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${SP.md}`, borderBottom: `1px solid ${C.divider}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: SP.sm, minWidth: 0 }}>
              {suiteIcon("phone_in_talk", 20)}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Calls and texts</div>
                <div style={{ fontSize: NC_TYPE.meta, fontWeight: 400, color: status ? C.success : C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{status ? (callState || "Ready") : "Open DeskPhone"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: SP.xs }}>
              <button onClick={onOpenDeskPhone} title="Open full DeskPhone" style={iconBtnS}>{suiteIcon("open_in_full", 17)}</button>
              <button onClick={() => setOpen(false)} title="Minimize" style={iconBtnS}>{suiteIcon("close", 17)}</button>
            </div>
          </div>
          <div style={{ padding: SP.md, display: "grid", gap: SP.sm }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SP.sm }}>
              <button onClick={() => post("/answer", "answer")} disabled={!!busy} style={{ height: 38, borderRadius: RADIUS.md, border: "none", background: C.success, color: "#fff", cursor: "pointer", fontWeight: 500, fontSize: NC_TYPE.body, display: "flex", alignItems: "center", justifyContent: "center", gap: SP.xs }}>{suiteIcon("phone_callback", 17)} Answer</button>
              <button onClick={() => post("/hangup", "hangup")} disabled={!!busy} style={{ height: 38, borderRadius: RADIUS.md, border: "none", background: C.danger, color: "#fff", cursor: "pointer", fontWeight: 500, fontSize: NC_TYPE.body, display: "flex", alignItems: "center", justifyContent: "center", gap: SP.xs }}>{suiteIcon("call_end", 17)} Hang up</button>
            </div>
            <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Number" style={{ height: 38, boxSizing: "border-box", borderRadius: RADIUS.md, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: `0 ${SP.md}`, fontSize: NC_TYPE.body }} />
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Text message" rows={3} style={{ boxSizing: "border-box", borderRadius: RADIUS.md, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, padding: `${SP.sm} ${SP.md}`, fontSize: NC_TYPE.body, resize: "vertical" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SP.sm }}>
              <button onClick={dial} disabled={!number.trim() || !!busy} style={{ height: 38, borderRadius: RADIUS.md, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, cursor: "pointer", fontWeight: 500, fontSize: NC_TYPE.body, opacity: !number.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: SP.xs }}>{suiteIcon("call", 17)} Call</button>
              <button onClick={sendSms} disabled={!number.trim() || !body.trim() || !!busy} style={{ height: 38, borderRadius: RADIUS.md, border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontWeight: 500, fontSize: NC_TYPE.body, opacity: (!number.trim() || !body.trim()) ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: SP.xs }}>{suiteIcon("send", 17)} Send</button>
            </div>
            <div style={{ display: "grid", gap: SP.xs }}>
              <div style={{ fontSize: NC_TYPE.meta, fontWeight: 500, color: C.faint, textTransform: "uppercase", letterSpacing: 0 }}>Recent text threads</div>
              {threads.length ? threads.map((m, idx) => (
                <button key={`${m._who}-${idx}`} onClick={() => { setNumber(m._who); setOpen(true); }} style={{ textAlign: "left", borderRadius: RADIUS.md, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, cursor: "pointer", padding: `${SP.sm} ${SP.sm}` }}>
                  <div style={{ fontSize: NC_TYPE.body, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m._who}</div>
                  <div style={{ fontSize: NC_TYPE.meta, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{m.body || m.text || m.message || m.content || "Message"}</div>
                </button>
              )) : <div style={{ fontSize: NC_TYPE.meta, color: C.faint, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: SP.sm, background: C.bgSoft }}>No message threads loaded.</div>}
            </div>
            <div style={{ display: "grid", gap: SP.xs }}>
              <div style={{ fontSize: NC_TYPE.meta, fontWeight: 500, color: C.faint, textTransform: "uppercase", letterSpacing: 0 }}>Recent calls</div>
              {Array.isArray(recentCalls) && recentCalls.length ? recentCalls.slice(0, 3).map((c, idx) => (
                <button key={idx} onClick={() => setNumber(c.number || c.phoneNumber || c.from || "")} style={{ textAlign: "left", borderRadius: RADIUS.md, border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text, cursor: "pointer", padding: `${SP.sm} ${SP.sm}` }}>
                  <div style={{ fontSize: NC_TYPE.body, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || c.number || c.phoneNumber || c.from || "Call"}</div>
                  <div style={{ fontSize: NC_TYPE.meta, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{c.direction || c.status || c.time || "Recent call"}</div>
                </button>
              )) : <div style={{ fontSize: NC_TYPE.meta, color: C.faint, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: SP.sm, background: C.bgSoft }}>Recent calls will appear here when DeskPhone provides them.</div>}
            </div>
            {error && <div style={{ fontSize: NC_TYPE.meta, lineHeight: 1.45, color: C.danger, background: C.bgSoft, border: `1px solid ${C.danger}`, borderRadius: RADIUS.md, padding: SP.sm }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export { DeskPhoneMiniDock };
