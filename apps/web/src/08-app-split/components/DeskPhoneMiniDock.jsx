import React, { useCallback, useEffect, useState } from 'react';
import { NC_FONT_STACK, suiteIcon } from '../ui-tokens.jsx';
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

  // Returns true only when DeskPhone's response confirmed success — callers use
  // this to decide whether typed input is safe to discard.
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
    // Keep the draft on failure so the typed message is never lost.
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

  return (
    <div style={{position:"fixed",right:"clamp(10px,2vw,18px)",bottom:"clamp(12px,2vh,18px)",zIndex:8550,fontFamily:NC_FONT_STACK,pointerEvents:"none"}}>
      {!open && (
        <button onClick={()=>setOpen(true)} title="Calls and texts" style={{pointerEvents:"auto",height:54,minWidth:54,borderRadius:16,border:`1px solid ${T.brd}`,background:T.primary || T.text,color:T.onPrimary || T.bg,boxShadow:T.shadowLg || "0 10px 32px rgba(0,0,0,0.22)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"0 14px",fontWeight:500,fontSize:14}}>
          {suiteIcon("phone_in_talk", 22)}
          <span style={{display:"flex",flexDirection:"column",alignItems:"flex-start",lineHeight:1.05}}>
            <span style={{fontSize:13}}>Calls/Text</span>
            <span style={{fontSize:12,opacity:.72}}>{status ? (callState || "ready") : "open"}</span>
          </span>
        </button>
      )}
      {open && (
        <div style={{pointerEvents:"auto",width:"min(360px,calc(100vw - 20px))",maxHeight:"calc(100vh - 86px)",overflow:"auto",background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.28)"}}>
          <div style={{height:48,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px",borderBottom:`1px solid ${T.brd}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              {suiteIcon("phone_in_talk", 20)}
              <div style={{minWidth:0}}>
                <div style={{fontSize:15,fontWeight:500,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Calls and texts</div>
                <div style={{fontSize:13,fontWeight:400,color:status ? T.success : T.tFaint,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{status ? (callState || "Ready") : "Open DeskPhone"}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={onOpenDeskPhone} title="Open full DeskPhone" style={{width:32,height:32,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("open_in_full", 17)}</button>
              <button onClick={()=>setOpen(false)} title="Minimize" style={{width:32,height:32,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("close", 17)}</button>
            </div>
          </div>
          <div style={{padding:12,display:"grid",gap:10}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={()=>post("/answer","answer")} disabled={!!busy} style={{height:38,borderRadius:12,border:"none",background:T.success,color:"#fff",cursor:"pointer",fontWeight:500,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("phone_callback",17)} Answer</button>
              <button onClick={()=>post("/hangup","hangup")} disabled={!!busy} style={{height:38,borderRadius:12,border:"none",background:T.danger,color:"#fff",cursor:"pointer",fontWeight:500,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("call_end",17)} Hang up</button>
            </div>
            <input value={number} onChange={e=>setNumber(e.target.value)} placeholder="Number" style={{height:38,boxSizing:"border-box",borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,padding:"0 11px",fontSize:14}}/>
            <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Text message" rows={3} style={{boxSizing:"border-box",borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,padding:"9px 11px",fontSize:14,resize:"vertical"}}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={dial} disabled={!number.trim() || !!busy} style={{height:38,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:500,fontSize:14,opacity:!number.trim() ? .5 : 1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("call",17)} Call</button>
              <button onClick={sendSms} disabled={!number.trim() || !body.trim() || !!busy} style={{height:38,borderRadius:12,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:500,fontSize:14,opacity:(!number.trim() || !body.trim()) ? .5 : 1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>{suiteIcon("send",17)} Send</button>
            </div>
            <div style={{display:"grid",gap:6}}>
              <div style={{fontSize:13,fontWeight:500,color:T.tFaint,textTransform:"uppercase",letterSpacing:0}}>Recent text threads</div>
              {threads.length ? threads.map((m, idx) => (
                <button key={`${m._who}-${idx}`} onClick={()=>{setNumber(m._who); setOpen(true);}} style={{textAlign:"left",borderRadius:12,border:`1px solid ${T.brdS || T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",padding:"8px 9px"}}>
                  <div style={{fontSize:14,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m._who}</div>
                  <div style={{fontSize:13,color:T.tSoft,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{m.body || m.text || m.message || m.content || "Message"}</div>
                </button>
              )) : <div style={{fontSize:13,color:T.tFaint,border:`1px solid ${T.brdS || T.brd}`,borderRadius:12,padding:8,background:T.bgW}}>No message threads loaded.</div>}
            </div>
            <div style={{display:"grid",gap:6}}>
              <div style={{fontSize:13,fontWeight:500,color:T.tFaint,textTransform:"uppercase",letterSpacing:0}}>Recent calls</div>
              {Array.isArray(recentCalls) && recentCalls.length ? recentCalls.slice(0,3).map((c, idx) => (
                <button key={idx} onClick={()=>setNumber(c.number || c.phoneNumber || c.from || "")} style={{textAlign:"left",borderRadius:12,border:`1px solid ${T.brdS || T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",padding:"8px 9px"}}>
                  <div style={{fontSize:14,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name || c.number || c.phoneNumber || c.from || "Call"}</div>
                  <div style={{fontSize:13,color:T.tSoft,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{c.direction || c.status || c.time || "Recent call"}</div>
                </button>
              )) : <div style={{fontSize:13,color:T.tFaint,border:`1px solid ${T.brdS || T.brd}`,borderRadius:12,padding:8,background:T.bgW}}>Recent calls will appear here when DeskPhone provides them.</div>}
            </div>
            {error && <div style={{fontSize:13,lineHeight:1.45,color:T.danger,background:"#FFE1E1",border:"1px solid #F0B5B5",borderRadius:12,padding:8}}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export { DeskPhoneMiniDock };
