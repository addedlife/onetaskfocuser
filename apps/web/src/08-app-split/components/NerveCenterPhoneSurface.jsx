import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { cleanTheme, gvIconButton, gvTextButton, NC_TYPE, suiteIcon, useViewportWidth } from '../ui-tokens.jsx';

const DIALER_KEYS = ["1","2","3","4","5","6","7","8","9","*","0","#"];
const HOST_PAIRING_TOKEN_KEY = "deskphone_web_pairing_token";

function getHostPairingToken() {
  try {
    return localStorage.getItem(HOST_PAIRING_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setHostPairingToken(token) {
  try {
    localStorage.setItem(HOST_PAIRING_TOKEN_KEY, token);
  } catch {
    // Local storage may be disabled.
  }
}

let hostPairingPrompt = null;

async function promptForHostPairingToken() {
  if (!hostPairingPrompt) {
    hostPairingPrompt = Promise.resolve().then(() => {
      const token = window.prompt("Enter the DeskPhone web pairing token from the DeskPhone Log tab.");
      if (token?.trim()) {
        setHostPairingToken(token.trim());
        return token.trim();
      }
      return "";
    }).finally(() => {
      hostPairingPrompt = null;
    });
  }
  return hostPairingPrompt;
}

async function fetchHostApi(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getHostPairingToken();
  if (token) headers["X-DeskPhone-Token"] = token;

  let response = await fetch(url, { ...options, headers });
  if (response.status !== 401) return response;

  const nextToken = await promptForHostPairingToken();
  if (!nextToken) return response;
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "X-DeskPhone-Token": nextToken },
  });
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneKeys(value) {
  const digits = phoneDigits(value);
  if (!digits) return [];
  if (digits.length === 10) return [digits, `1${digits}`];
  if (digits.length === 11 && digits.startsWith("1")) return [digits.slice(1), digits];
  return [digits];
}

function allContactPhones(contact) {
  const direct = [
    contact?.primaryPhone, contact?.PrimaryPhone,
    contact?.phone, contact?.phoneNumber, contact?.number, contact?.Phone, contact?.PhoneNumber,
    contact?.mobilePhone, contact?.MobilePhone, contact?.mobile, contact?.Mobile,
    contact?.PhoneHome, contact?.PhoneMobile, contact?.PhoneWork,
    contact?.phoneHome, contact?.phoneMobile, contact?.phoneWork,
    contact?.Telephone, contact?.TelephoneNumber, contact?.CellPhone,
    contact?.WorkPhone, contact?.HomePhone, contact?.ContactPhone,
    contact?.formattedPhone, contact?.FormattedPhone,
  ];
  const arrays = [
    contact?.phones, contact?.Phones,
    contact?.phoneNumbers, contact?.PhoneNumbers,
    contact?.numbers, contact?.Numbers,
  ].flatMap(value => Array.isArray(value) ? value : []);
  return [...direct, ...arrays].map(value => String(value || "").trim()).filter(Boolean);
}

function allMessageNumbers(message) {
  return [
    message?.from, message?.sender, message?.address, message?.phoneNumber, message?.number,
    message?.to, message?.recipient, message?.From, message?.Sender, message?.Address,
    message?.PhoneNumber, message?.Number, message?.To, message?.Recipient,
  ].filter(Boolean);
}

function messagePeerNumber(message) {
  const typeNum = typeof (message?.type || message?.Type) === "number" ? (message.type || message.Type) : null;
  const dir = String(message?.direction || message?.messageType || message?.folder || message?.Direction || message?.Type || "").toLowerCase();
  const sent = typeNum === 2 || dir.includes("sent") || dir.includes("out") || message?.fromMe || message?.from_me || message?.isSent;
  const preferred = sent
    ? [message?.to, message?.recipient, message?.number, message?.phoneNumber, message?.To, message?.Recipient, message?.Number, message?.PhoneNumber]
    : [message?.from, message?.sender, message?.address, message?.number, message?.phoneNumber, message?.From, message?.Sender, message?.Address, message?.Number, message?.PhoneNumber];
  return preferred.find(value => phoneDigits(value).length >= 4) || allMessageNumbers(message).find(value => phoneDigits(value).length >= 4) || "Unknown";
}

function NerveCenterPhoneSurface({ T, onOnlineChange, onStatusSummary, compact = false, onRecordConversation, onRecordCall, onMoreHistory }) {
  const api = "http://127.0.0.1:8765";
  const viewportW = useViewportWidth();
  const touchActions = viewportW < 980;
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [number, setNumber] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);       // { name, number } — who we're composing to
  const [showDialer, setShowDialer] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);    // is compose area visible?
  const [composeIsNew, setComposeIsNew] = useState(false);  // opened as "new message" (has contact search)
  const [composeSearch, setComposeSearch] = useState("");   // contact search in new-compose mode
  const [composeFocused, setComposeFocused] = useState(false);
  const [openPhoneActionId, setOpenPhoneActionId] = useState(null);
  const C = cleanTheme(T);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [statusRes, messagesRes, callsRes, contactsRes] = await Promise.all([
        fetchHostApi(`${api}/status`, { cache: "no-store" }),
        fetchHostApi(`${api}/messages?limit=5000`, { cache: "no-store" }),
        fetchHostApi(`${api}/calls`, { cache: "no-store" }).catch(() => null),
        fetchHostApi(`${api}/contacts`, { cache: "no-store" }).catch(() => null),
      ]);
      const nextStatus = await statusRes.json();
      const parsed = await messagesRes.json().catch(() => []);
      const nextMessages = Array.isArray(parsed) ? parsed : (parsed?.messages || []);
      const callsParsed = callsRes ? await callsRes.json().catch(() => []) : [];
      const nextCalls = Array.isArray(callsParsed) ? callsParsed : (callsParsed?.calls || nextStatus?.recentCalls || []);
      const contactsParsed = contactsRes ? await contactsRes.json().catch(() => []) : [];
      const nextContacts = Array.isArray(contactsParsed) ? contactsParsed : (contactsParsed?.contacts || []);
      setStatus(nextStatus); setMessages(nextMessages); setCalls(nextCalls); setContacts(nextContacts);
      onOnlineChange?.(true);
    } catch {
      setStatus(null); setMessages([]); setCalls([]);
      setError("Open DeskPhone to use calls and texts.");
      onOnlineChange?.(false);
    }
  }, [onOnlineChange]);

  // Build phone-number → name map from contacts, covering many possible field names from the DeskPhone API
  const contactMap = useMemo(() => {
    const map = new Map();
    contacts.forEach(c => {
      const name = c.name || c.Name || c.displayName || c.DisplayName || c.fullName || c.FullName || "";
      if (!name) return;
      allContactPhones(c).forEach(p => phoneKeys(p).forEach(key => map.set(key, name)));
    });
    return map;
  }, [contacts]);

  // Secondary name map built from call history — calls often carry name directly on the object
  const callNameMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(calls) ? calls : []).forEach(c => {
      const name = c.name || c.Name || c.displayName || c.DisplayName || c.callerName || c.CallerName || "";
      if (!name) return;
      const num = c.number || c.phoneNumber || c.from || c.Number || c.PhoneNumber || "";
      if (!num) return;
      phoneKeys(num).forEach(key => map.set(key, name));
    });
    return map;
  }, [calls]);

  // Third name source: names embedded directly on message objects (DeskPhone often puts them there)
  const msgNameMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(messages) ? messages : []).forEach(m => {
      const name = m.name || m.displayName || m.contactName || m.fromName || m.senderName || m.contact ||
        m.Name || m.DisplayName || m.ContactName || m.FromName || m.SenderName || m.Contact || "";
      if (!name) return;
      allMessageNumbers(m).forEach(num => {
        if (!num || num === "Unknown") return;
        phoneKeys(num).forEach(key => map.set(key, name));
      });
    });
    return map;
  }, [messages]);

  const lookupName = useCallback(num => {
    if (!num) return null;
    for (const key of phoneKeys(num)) {
      const hit = contactMap.get(key) || callNameMap.get(key) || msgNameMap.get(key);
      if (hit) return hit;
    }
    return null;
  }, [contactMap, callNameMap, msgNameMap]);

  // Live contact suggestions — used for both dialer and new-compose contact search
  const suggestions = useMemo(() => {
    const q = (composeIsNew ? composeSearch : number).trim().toLowerCase();
    if (!q || contacts.length === 0) return [];
    const qDigits = q.replace(/\D/g, "");
    return contacts.filter(c => {
      const name = (c.name || c.Name || c.displayName || c.DisplayName || "").toLowerCase();
      const nums = allContactPhones(c);
      return name.includes(q) || (qDigits.length >= 1 && nums.some(p => phoneDigits(p).includes(qDigits)));
    }).slice(0, 6).map(c => ({
      name: c.name || c.Name || c.displayName || c.DisplayName || "",
      num: allContactPhones(c)[0] || "",
    }));
  }, [contacts, number, composeSearch, composeIsNew]);

  useEffect(() => { refresh(); const id = setInterval(refresh, 6500); return () => clearInterval(id); }, [refresh]);

  const post = async (path, label) => {
    setBusy(label);
    try {
      const res = await fetchHostApi(`${api}${path}`, { method: "POST" });
      if (!res.ok) {
        let msg = `DeskPhone error (${res.status})`;
        try { const d = await res.json(); if (d?.error || d?.message) msg = d.error || d.message; } catch {}
        setError(msg);
      } else {
        const data = await res.json().catch(() => ({}));
        if (data?.success === false || data?.ok === false) {
          setError(data?.error || data?.message || data?.reason || "DeskPhone reported failure.");
        } else {
          setError("");
        }
      }
      await refresh();
    }
    catch { setError("DeskPhone did not answer."); onOnlineChange?.(false); }
    finally { setBusy(""); }
  };

  const dialNum = async (n) => { if (n?.trim()) await post(`/dial?n=${encodeURIComponent(n.trim())}`, "dial"); };
  const dial = () => dialNum(number);
  const sendSms = async () => {
    const to = selected?.number || number;
    if (!to?.trim() || !body.trim()) return;
    await post(`/send?to=${encodeURIComponent(to.trim())}&body=${encodeURIComponent(body.trim())}`, "send");
    setBody(""); closeCompose();
  };

  // Normalize callState so "Idle", "None", "Available" etc. all collapse to "" (shows "Connected · device")
  const callStateRaw = status?.CallState || status?.callState || status?.CurrentCallState || status?.currentCallState || "";
  const callState = /^(idle|none|available|ready|standby|free|disconnected|inactive)$/i.test(callStateRaw.trim()) ? "" : callStateRaw.trim();
  const isIncoming = /ring|incoming/i.test(callState);
  const isOnCall = !!callState && !isIncoming && /active|connected|call/i.test(callState);
  const statusOnline = !!status;
  const deviceName = status?.deviceName || status?.DeviceName || status?.device || status?.Device || status?.phoneName || status?.PhoneName || "";
  const idleLabel = deviceName ? `Connected · ${deviceName}` : "Connected";
  const statusText = status ? (callState || idleLabel) : "DeskPhone offline";
  const callerName = status?.callerName || status?.CallerName || status?.callerDisplay || status?.CallerDisplay || status?.callerID || status?.CallerID || "";
  const callerNumber = status?.callerNumber || status?.CallerNumber || status?.incomingNumber || status?.IncomingNumber || "";
  const callerDisplay = callerName || (callerNumber ? (lookupName(callerNumber) || callerNumber) : "");
  const vmCount = parseInt(status?.voicemailCount || status?.VoicemailCount || status?.voicemail?.count || 0, 10) || 0;

  const threadMap = new Map();
  messages.forEach(m => {
    const who = messagePeerNumber(m);
    // directName: name embedded right on the message object by DeskPhone
    const directName = m.name || m.displayName || m.contactName || m.fromName || m.senderName || m.contact ||
      m.Name || m.DisplayName || m.ContactName || m.FromName || m.SenderName || m.Contact || "";
    const resolvedName = directName || lookupName(who) || who;
    if (!threadMap.has(who)) threadMap.set(who, { ...m, _who: who, _name: resolvedName });
  });
  const threads = Array.from(threadMap.values()).slice(0, 10);
  const recentCalls = (Array.isArray(calls) ? calls : []).slice(0, 10);
  const hasMessages = threads.length > 0;
  const hasCalls = recentCalls.length > 0;
  useEffect(() => {
    onStatusSummary?.({
      online: statusOnline,
      tone: isIncoming ? "incoming" : isOnCall ? "call" : statusOnline ? "online" : "offline",
      label: callerDisplay && (isIncoming || isOnCall) ? `${isIncoming ? "Incoming" : "On call"}: ${callerDisplay}` : statusText,
      voicemailCount: vmCount,
    });
  }, [onStatusSummary, statusOnline, isIncoming, isOnCall, callerDisplay, statusText, vmCount]);
  const phoneIconButton = (active = false) => gvIconButton({
    width: compact ? 32 : 36,
    height: compact ? 32 : 36,
    background: active ? C.hover : "transparent",
    color: active ? C.text : C.muted,
  }, C);
  const phoneRowStyle = {
    display: "grid",
    gridTemplateColumns: "32px minmax(0,1fr) 34px",
    gap: "6px 9px",
    alignItems: "start",
    padding: compact ? "7px 2px" : "10px 4px",
    borderRadius: 8,
    minHeight: compact ? 48 : 56,
  };
  const phoneActionGroupStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 4,
    gridColumn: "2 / 4",
    marginTop: -4,
  };

  const fmtTime = val => {
    if (!val) return "";
    const d = new Date(typeof val === "number" ? val : val);
    if (isNaN(d.getTime())) return typeof val === "string" ? val.slice(0, 8) : "";
    const diff = Date.now() - d.getTime();
    if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
    return d.toLocaleDateString(undefined, { weekday: "short" });
  };
  const timeMs = val => {
    if (!val) return 0;
    const d = new Date(typeof val === "number" ? val : val);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  };
  const activityItems = [
    ...threads.map((m, idx) => ({ kind: "message", item: m, idx, at: timeMs(m.timestamp || m.date || m.time) })),
    ...recentCalls.map((c, idx) => ({ kind: "call", item: c, idx, at: timeMs(c.timestamp || c.date || c.time || c.startTime || c.StartTime) })),
  ].sort((a, b) => b.at - a.at).slice(0, compact ? 8 : 14);

  const callDirIcon = c => {
    // Numeric type codes: 1=incoming, 2=outgoing/dialed, 3=missed, 4=unknown
    const typeNum = typeof (c.type || c.callType || c.Type || c.CallType) === "number"
      ? (c.type || c.callType || c.Type || c.CallType)
      : null;
    if (c.missed || c.Missed || typeNum === 3) return { icon: "call_missed", color: C.danger };
    const dir = (c.direction || c.Direction || (typeof c.type === "string" ? c.type : "") || (typeof c.callType === "string" ? c.callType : "") || "").toLowerCase();
    if (dir.includes("miss")) return { icon: "call_missed", color: "#BA2A2A" };
    // Check outgoing BEFORE checking incoming so "outgoing" (contains "in") doesn't misfire
    if (typeNum === 2 || dir.includes("out") || dir.includes("dial") || dir.includes("egress")) return { icon: "call_made", color: T.tSoft };
    if (typeNum === 1 || dir.includes("incoming") || dir.includes("inbound") || dir.includes("receiv") || dir === "in") return { icon: "call_received", color: T.tSoft };
    return { icon: "call", color: T.tSoft };
  };

  // Incoming SMS = sms icon; outgoing = outgoing_mail icon
  // Android SMS type codes: 1=inbox/received, 2=sent, 4=outbox/pending, 5=failed, 6=queued
  const msgDirIcon = m => {
    const typeNum = typeof (m.type || m.Type) === "number" ? (m.type || m.Type) : null;
    const dir = (typeof m.type === "string" ? m.type : "") || m.direction || m.messageType || m.folder || m.Direction || m.Type || "";
    const dirL = String(dir).toLowerCase();
    if (typeNum === 2 || typeNum === 4 || typeNum === 5 || typeNum === 6) return { icon: "outgoing_mail", color: T.tSoft };
    if (dirL.includes("sent") || dirL.includes("out") || dirL === "send" || dirL === "egress" || m.fromMe || m.from_me || m.isSent) return { icon: "outgoing_mail", color: T.tSoft };
    return { icon: "sms", color: T.tSoft };
  };

  // Compose helpers — open from row, open new, close
  const openCompose = (name, num) => { setSelected({ name, number: num }); setNumber(num); setBody(""); setComposeOpen(true); setComposeIsNew(false); };
  const openNewMessage = () => { setSelected(null); setBody(""); setComposeSearch(""); setComposeIsNew(true); setComposeOpen(true); };
  const closeCompose = () => { setComposeOpen(false); setComposeIsNew(false); setComposeSearch(""); setSelected(null); };

  // Small neutral action button (white/card background) — used on each row
  const AB = ({ icon, title, onClick }) => (
    <button onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onClick(); }} title={title}
      aria-label={title}
      style={gvTextButton({ minHeight: 32, height: 32, padding: "0 9px", fontSize: NC_TYPE.small, gap: 5, border: "none", background: C.bgSoft }, C)}>
      {suiteIcon(icon, 14)}
      <span>{title.replace(" back", "")}</span>
    </button>
  );

  // Suggestion list — shared between dialer and compose-new modes
  const SuggestionList = ({ onPick, style = {} }) => suggestions.length === 0 ? null : (
    <div style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, overflow: "hidden", boxShadow: "0 6px 20px rgba(60,64,67,0.18)", ...style }}>
      {suggestions.map((s, i) => (
        <button key={i} onMouseDown={e => e.preventDefault()} onClick={() => onPick(s)}
          style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer" }}>
          <span style={{ width: 28, height: 28, borderRadius: 99, background: C.hover, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, flexShrink: 0 }}>{suiteIcon("person", 13)}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: NC_TYPE.control, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            <span style={{ display: "block", fontSize: NC_TYPE.meta, color: C.muted }}>{s.num}</span>
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 12, minWidth: 0, flex: "1 1 auto", minHeight: 0, overflow: "hidden", color: C.text }}>

      {(isIncoming || isOnCall || vmCount > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, minHeight: compact ? 28 : 36, padding: "0 2px" }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: isIncoming ? C.success : isOnCall ? C.warning : C.danger }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: compact ? 13 : 14, fontWeight: 500, color: isIncoming ? C.success : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {callerDisplay && (isIncoming || isOnCall) ? `${isIncoming ? "Incoming" : "On call"} · ${callerDisplay}` : `${vmCount} voicemail${vmCount === 1 ? "" : "s"}`}
          </span>
        </div>
      )}

      {/* ── Compose area — at TOP, above lists ── */}
      {composeOpen && (
        <div style={{ background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* New message mode: contact search */}
          {composeIsNew && (
            <div style={{ position: "relative" }}>
              <input value={composeSearch} onChange={e => setComposeSearch(e.target.value)}
                onFocus={() => setComposeFocused(true)}
                onBlur={() => setTimeout(() => setComposeFocused(false), 160)}
                placeholder="Search contact or enter number…"
                autoFocus
                style={{ width: "100%", height: 36, boxSizing: "border-box", padding: "0 12px", borderRadius: 18, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, fontFamily: "system-ui", fontSize: 14, fontWeight: 400, outline: "none" }} />
              {composeFocused && suggestions.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 300 }}>
                  <SuggestionList onPick={s => { setSelected({ name: s.name, number: s.num }); setNumber(s.num); setComposeSearch(s.name); setComposeIsNew(false); }} />
                </div>
              )}
            </div>
          )}
          {/* Header: who we're writing to (once contact is known) */}
          {selected && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              {suiteIcon("sms", 14)}
              <span style={{ fontSize: 13, color: C.muted, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{selected.name || selected.number}</span>
              <button onClick={closeCompose} style={gvIconButton({ width: 32, height: 32 }, C)}>{suiteIcon("close", 14)}</button>
            </div>
          )}
          {/* Textarea + send — shown once a contact is selected or in non-new mode */}
          {(!composeIsNew || selected) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 36px", gap: 6, alignItems: "flex-end" }}>
              <textarea value={body} onChange={e => setBody(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSms(); } }}
                placeholder="Message…" rows={2}
                style={{ boxSizing: "border-box", borderRadius: 8, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, padding: "8px 12px", fontSize: 14, fontFamily: "system-ui", resize: "none", outline: "none", width: "100%" }} />
              <button onClick={sendSms} disabled={!body.trim() || !!busy || (!selected && !number.trim())}
                style={{ width: 40, height: 40, borderRadius: 20, border: "none", background: body.trim() ? C.accent : "transparent", color: body.trim() ? "#fff" : C.faint, cursor: body.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s", flexShrink: 0 }}>
                {suiteIcon("send", 16)}
              </button>
            </div>
          )}
          {/* Close button when searching but no contact picked yet */}
          {composeIsNew && !selected && (
            <button onClick={closeCompose} style={gvTextButton({ alignSelf: "flex-end", height: 32, fontSize: NC_TYPE.meta }, C)}>
              {suiteIcon("close", 13)} Cancel
            </button>
          )}
        </div>
      )}

      {/* ── Control bar: answer/hangup | record | new-msg | keypad toggle ── */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", minHeight: compact ? 30 : 44 }}>
        {isIncoming ? (
          <button onClick={() => post("/answer", "answer")} disabled={!!busy} title="Answer"
            style={gvTextButton({ border: "none", background: C.success, color: "#fff" }, C)}>
            {suiteIcon("phone_callback", 14)} Answer
          </button>
        ) : isOnCall ? (
          <button onClick={() => post("/hangup", "hangup")} disabled={!!busy} title="Hang up"
            style={gvTextButton({ border: "none", background: C.danger, color: "#fff" }, C)}>
            {suiteIcon("call_end", 14)} Hang up
          </button>
        ) : null}
        <div style={{ flex: 1 }} />
        <button onClick={refresh} disabled={!!busy} title="Refresh phone" style={phoneIconButton(false)}>{suiteIcon("refresh", 15)}</button>
        {/* Record general */}
        <button onClick={onRecordConversation} title="Record anything — tasks, shailos, notes, got-backs"
          style={phoneIconButton(false)}>
          {suiteIcon("mic", 15)}
        </button>
        {/* Record active call */}
        {isOnCall && (
          <button onClick={onRecordCall} title="Record this call and extract tasks/shailos"
            style={gvIconButton({ width: 36, height: 36, background: C.danger, color: "#fff" }, C)}>
            {suiteIcon("fiber_manual_record", 14)}
          </button>
        )}
        {/* New message button */}
        <button onClick={openNewMessage} title="New message"
          style={phoneIconButton(composeOpen && composeIsNew)}>
          {suiteIcon("edit", 15)}
        </button>
        {/* Keypad toggle */}
        <button onClick={() => setShowDialer(v => !v)} title="Keypad"
          style={phoneIconButton(showDialer)}>
          {suiteIcon("dialpad", 15)}
        </button>
      </div>

      {/* ── Dialer — only when keypad is open ── */}
      {showDialer && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {/* Number input */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.tFaint, pointerEvents: "none", lineHeight: 1, display: "flex" }}>{suiteIcon("search", 15)}</span>
            <input value={number} onChange={e => setNumber(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 160)}
              onKeyDown={e => e.key === "Enter" && dial()}
              placeholder="Name or number"
              style={{ width: "100%", height: 40, boxSizing: "border-box", padding: "0 46px 0 32px", borderRadius: 20, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, fontFamily: "system-ui", fontSize: 14, fontWeight: 400, outline: "none" }} />
            <button onClick={dial} disabled={!number.trim() || !!busy} title="Call"
              style={{ position: "absolute", right: 4, top: 4, width: 32, height: 32, borderRadius: 99, border: "none", background: number.trim() ? C.success : "transparent", color: number.trim() ? "#fff" : C.faint, cursor: number.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {suiteIcon("call", 14)}
            </button>
          </div>
          {/* Contact suggestions below input */}
          {inputFocused && suggestions.length > 0 && (
            <SuggestionList onPick={s => { setNumber(s.num); setSelected({ name: s.name, number: s.num }); setInputFocused(false); }} />
          )}
          {/* Numeric keypad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
            {DIALER_KEYS.map(k => (
              <button key={k} onClick={() => setNumber(prev => prev + k)}
                style={{ height: 40, borderRadius: 4, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, cursor: "pointer", fontSize: 15, fontWeight: 400, fontFamily: "system-ui" }}>
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Unified phone activity feed ── */}
      {statusOnline && (hasMessages || hasCalls) && (
        <div style={{ flex: compact ? "0 1 auto" : "1 1 0", minHeight: 0, maxHeight: compact ? 360 : undefined, overflowY: "auto", paddingRight: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.muted, letterSpacing: 0, marginBottom: 3, paddingLeft: 4, paddingTop: 1, position: "sticky", top: 0, background: C.bg, zIndex: 1 }}>Activity</div>
          {activityItems.map(entry => {
            if (entry.kind === "message") {
                const m = entry.item;
                const idx = entry.idx;
                const { icon: msgIcon, color: msgColor } = msgDirIcon(m);
                const isUnread = !!(m.unread || m.isUnread || m.read === false || m.status === "unread");
                const preview = m.body || m.text || m.message || m.content || "";
                const time = fmtTime(m.timestamp || m.date || m.time);
                const actionId = `msg-${m._who}-${idx}`;
                const actionsOpen = openPhoneActionId === actionId;
                return (
                  <div key={`${m._who}-${idx}`} className="nc-action-row" style={phoneRowStyle}>
                    <span style={{ width: 32, height: 32, borderRadius: 99, background: isUnread ? C.hover : C.bgSoft, display: "flex", alignItems: "center", justifyContent: "center", color: isUnread ? C.accent : msgColor, flexShrink: 0, marginTop: 2 }}>{suiteIcon(msgIcon, 15)}</span>
                    <button onClick={() => openCompose(m._name, m._who)} style={{ minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, color: T.text }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                        <span style={{ flex: 1, fontSize: 15, fontWeight: isUnread ? 600 : 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m._name}</span>
                        {time && <span style={{ fontSize: 13, color: C.muted, flexShrink: 0, fontWeight: 400 }}>{time}</span>}
                      </div>
                      {preview && <span style={{ display: "block", fontSize: compact ? 13 : 14, color: C.muted, marginTop: 1, whiteSpace: compact ? "nowrap" : "normal", overflow: compact ? "hidden" : undefined, textOverflow: compact ? "ellipsis" : undefined, wordBreak: compact ? "normal" : "break-word", lineHeight: compact ? 1.35 : 1.5 }}>{preview}</span>}
                    </button>
                    <button onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionsOpen ? null : actionId); }} title={actionsOpen ? "Hide actions" : "Show actions"} aria-label={actionsOpen ? "Hide actions" : "Show actions"} style={phoneIconButton(actionsOpen)}>
                      {suiteIcon("more_horiz", 17)}
                    </button>
                    {actionsOpen && (
                      <div style={phoneActionGroupStyle}>
                        <AB icon="call" title="Call" onClick={() => { setOpenPhoneActionId(null); dialNum(m._who); }} />
                        <AB icon="sms" title="Text" onClick={() => { setOpenPhoneActionId(null); openCompose(m._name, m._who); }} />
                      </div>
                    )}
                  </div>
                );
              }
              const c = entry.item;
              const idx = entry.idx;
                const num = c.number || c.phoneNumber || c.from || c.Number || c.PhoneNumber || "";
                const name = lookupName(num) || c.name || c.displayName || c.Name || c.DisplayName || c.from || num || "Unknown";
                const { icon, color } = callDirIcon(c);
                const time = fmtTime(c.timestamp || c.date || c.time || c.startTime || c.StartTime);
                const actionId = `call-${idx}`;
                const actionsOpen = openPhoneActionId === actionId;
                return (
                  <div key={`call-${idx}`} className="nc-action-row" style={phoneRowStyle}>
                    <span style={{ width: 32, height: 32, borderRadius: 99, background: C.bgSoft, display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0, marginTop: 2 }}>{suiteIcon(icon, 15)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                        <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                        {time && <span style={{ fontSize: 13, color: C.muted, flexShrink: 0, fontWeight: 400 }}>{time}</span>}
                      </div>
                      {num && num !== name && <span style={{ display: "block", fontSize: 14, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{num}</span>}
                    </div>
                    <button onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionsOpen ? null : actionId); }} title={actionsOpen ? "Hide actions" : "Show actions"} aria-label={actionsOpen ? "Hide actions" : "Show actions"} style={phoneIconButton(actionsOpen)}>
                      {suiteIcon("more_horiz", 17)}
                    </button>
                    {actionsOpen && (
                      <div style={phoneActionGroupStyle}>
                        <AB icon="call" title="Call back" onClick={() => { setOpenPhoneActionId(null); dialNum(num); }} />
                        <AB icon="sms" title="Text back" onClick={() => { setOpenPhoneActionId(null); openCompose(name, num); }} />
                      </div>
                    )}
                  </div>
                );
              })}
          {onMoreHistory && (
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 2px" }}>
              <button onClick={onMoreHistory} style={gvTextButton({ height: 32, fontSize: NC_TYPE.meta }, C)}>
                {suiteIcon("history", 13)} More history
              </button>
            </div>
          )}
        </div>
      )}

      {!statusOnline && !error && <div style={{ fontSize: 13, color: C.muted, padding: "6px 2px" }}>Open DeskPhone to connect calls and texts.</div>}
      {error && <div style={{ fontSize: 13, color: C.danger, background: C.bgSoft, borderRadius: 8, padding: "8px 10px", marginTop: 2 }}>{error}</div>}
    </div>
  );
}

export { NerveCenterPhoneSurface };
