import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, gvIconButton, gvTextButton, NC_TYPE, suiteIcon, useViewportWidth } from '../ui-tokens.jsx';
import { db } from '../../01-core.js';

const DIALER_KEYS = ["1","2","3","4","5","6","7","8","9","*","0","#"];
const PHONE_FETCH_TIMEOUT_MS = 4500;

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneKeys(value) {
  const digits = phoneDigits(value);
  if (!digits) return [];
  const keys = [digits];
  if (digits.length === 11 && digits.startsWith("1")) keys.push(digits.slice(1));
  if (digits.length > 10) keys.push(digits.slice(-10));
  if (digits.length > 7) keys.push(digits.slice(-7));
  return [...new Set(keys.filter(Boolean))];
}

function phoneThreadKey(value) {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
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
    message?.normalizedPhone, message?.NormalizedPhone,
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
    ? [message?.normalizedPhone, message?.NormalizedPhone, message?.to, message?.recipient, message?.number, message?.phoneNumber, message?.To, message?.Recipient, message?.Number, message?.PhoneNumber]
    : [message?.normalizedPhone, message?.NormalizedPhone, message?.from, message?.sender, message?.address, message?.number, message?.phoneNumber, message?.From, message?.Sender, message?.Address, message?.Number, message?.PhoneNumber];
  return preferred.find(value => phoneDigits(value).length >= 4) || allMessageNumbers(message).find(value => phoneDigits(value).length >= 4) || "Unknown";
}

function messageBody(message) {
  return String(message?.body || message?.text || message?.message || message?.content || message?.Body || message?.Text || message?.Message || message?.Content || "").trim();
}

function eventTimeMs(value) {
  if (!value) return 0;
  const d = new Date(typeof value === "number" ? value : value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function messageTimeMs(message) {
  return eventTimeMs(message?.timestamp || message?.date || message?.time || message?.Timestamp || message?.Date || message?.Time);
}

function startOfCurrentWeek(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function isInCurrentWeek(date, now = new Date()) {
  return date >= startOfCurrentWeek(now) && date <= now;
}

function formatCompactDate(date, now = new Date()) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function isOutgoingMessage(message) {
  const typeNum = typeof (message?.type || message?.Type) === "number" ? (message.type || message.Type) : null;
  const dir = (typeof message?.type === "string" ? message.type : "") || message?.direction || message?.messageType || message?.folder || message?.Direction || message?.Type || "";
  const dirL = String(dir).toLowerCase();
  return typeNum === 2 || typeNum === 4 || typeNum === 5 || typeNum === 6 ||
    dirL.includes("sent") || dirL.includes("out") || dirL === "send" || dirL === "egress" ||
    message?.fromMe || message?.from_me || message?.isSent;
}

function isUnreadMessage(message) {
  return !!(message?.unread || message?.isUnread || message?.read === false || message?.status === "unread");
}

function linkedMessageParts(text, linkStyle = {}) {
  const raw = String(text || "");
  if (!raw) return "";
  const pattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  const parts = [];
  let last = 0;
  raw.replace(pattern, (match, _url, offset) => {
    if (offset > last) parts.push(raw.slice(last, offset));
    const trimmed = match.replace(/[),.;!?]+$/g, "");
    const trailing = match.slice(trimmed.length);
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parts.push(
      <a key={`url-${offset}`} href={href} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}
        style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2, fontWeight: 600, ...linkStyle }}>
        {trimmed}
      </a>
    );
    if (trailing) parts.push(trailing);
    last = offset + match.length;
    return match;
  });
  if (last < raw.length) parts.push(raw.slice(last));
  return parts;
}

async function fetchPhoneJson(url, timeoutMs = PHONE_FETCH_TIMEOUT_MS, extraHeaders = {}) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller?.signal, headers: extraHeaders });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return await response.json();
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function NerveCenterPhoneSurface({ T, user = null, onOnlineChange, onStatusSummary, onActivitySnapshot, compact = false, onRecordConversation, onRecordCall, onMoreHistory }) {
  // Dynamic API base: auto-detect when served from DeskPhone (port 8765), else use saved LAN URL or localhost
  const [remoteUrl, setRemoteUrl] = useState(() =>
    typeof localStorage !== "undefined" ? (localStorage.getItem("shamash_deskphone_url") || "") : ""
  );
  const [showRemoteConfig, setShowRemoteConfig] = useState(false);
  const [remoteInput, setRemoteInput] = useState("");
  const api = (typeof window !== "undefined" && window.location.port === "8765")
    ? window.location.origin
    : (remoteUrl.replace(/\/$/, "") || "http://127.0.0.1:8765");

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
  const [composeAnchorId, setComposeAnchorId] = useState(null);
  const [composeFocused, setComposeFocused] = useState(false);
  const [openPhoneActionId, setOpenPhoneActionId] = useState(null);
  const [expandedPhoneMessageId, setExpandedPhoneMessageId] = useState(null);
  const usingRelayRef = useRef(false);
  const [usingRelay, setUsingRelay] = useState(false);
  const [relayStatus, setRelayStatus] = useState(null);  // { enabled, key, relayUrl } from DeskPhone
  const [relayLanUrl, setRelayLanUrl] = useState(null);  // LAN IP embedded in relay state blob by DeskPhone
  const [showRelaySetup, setShowRelaySetup] = useState(false);
  const refreshInFlightRef = useRef(false);
  const expandedConversationEndRef = useRef(null);
  const composeBodyRef = useRef(null);
  const messagesSigRef = useRef("");
  const callsSigRef = useRef("");
  const contactsSigRef = useRef("");
  const C = cleanTheme(T);
  const RELAY_BASE = "/.netlify/functions/phone-relay";

  // Apply a phone-state payload (from either the direct LAN poll or the cloud-relay
  // listener) to component state. Signature refs short-circuit redundant re-renders,
  // so it's safe for the poll and the onSnapshot listener to both feed this.
  const applyPhoneState = useCallback((statusRes, messagesRes, callsRes, contactsRes) => {
    const nextStatus = statusRes;
    const parsed = messagesRes || [];
    const nextMessages = Array.isArray(parsed) ? parsed : (parsed?.messages || []);
    const callsParsed = callsRes || [];
    const nextCalls = Array.isArray(callsParsed) ? callsParsed : (callsParsed?.calls || nextStatus?.recentCalls || []);
    const contactsParsed = contactsRes || [];
    const nextContacts = Array.isArray(contactsParsed) ? contactsParsed : (contactsParsed?.contacts || []);
    setStatus(nextStatus);
    const msgSig = `${nextMessages.length}|${nextMessages[0]?.id ?? nextMessages[0]?.handle ?? ""}|${nextMessages[nextMessages.length - 1]?.id ?? nextMessages[nextMessages.length - 1]?.handle ?? ""}`;
    if (msgSig !== messagesSigRef.current) {
      messagesSigRef.current = msgSig;
      setMessages(nextMessages);
    }
    const callSig = `${nextCalls.length}|${nextCalls[0]?.id ?? nextCalls[0]?.number ?? ""}|${nextCalls[0]?.timestamp ?? nextCalls[0]?.time ?? ""}`;
    if (callSig !== callsSigRef.current) {
      callsSigRef.current = callSig;
      setCalls(nextCalls);
    }
    const contactsSig = `${nextContacts.length}|${nextContacts[0]?.id ?? nextContacts[0]?.displayName ?? ""}|${nextContacts[nextContacts.length - 1]?.id ?? nextContacts[nextContacts.length - 1]?.displayName ?? ""}`;
    if (contactsSig !== contactsSigRef.current) {
      contactsSigRef.current = contactsSig;
      setContacts(nextContacts);
    }
    onOnlineChange?.(true);
  }, [onOnlineChange]);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      setError("");
      let statusRes, messagesRes, callsRes, contactsRes;

      // Try the direct DeskPhone API first (short timeout so fallback is fast)
      let localOk = false;
      try {
        [statusRes, messagesRes, callsRes, contactsRes] = await Promise.all([
          fetchPhoneJson(`${api}/status`, 2500),
          fetchPhoneJson(`${api}/messages?limit=5000`, 2500),
          fetchPhoneJson(`${api}/calls`, 2500).catch(() => null),
          fetchPhoneJson(`${api}/contacts`, 2500).catch(() => null),
        ]);
        localOk = true;
        // Opportunistically grab relay setup info while we have local access
        fetchPhoneJson(`${api}/relay-status`, 2500).then(s => setRelayStatus(s)).catch(() => {});
      } catch { /* fall through to relay */ }

      if (!localOk) {
        // Relay fallback: read the single state blob the PC pushed.
        // Requires a Firebase ID token — phone data is private to the authenticated user.
        let relayIdToken = null;
        try { relayIdToken = user?.getIdToken ? await user.getIdToken() : null; } catch {}
        if (!relayIdToken) {
          throw new Error("relay:no_auth");
        }
        try {
          const relayState = await fetchPhoneJson(
            `${RELAY_BASE}?action=state`,
            PHONE_FETCH_TIMEOUT_MS,
            { Authorization: `Bearer ${relayIdToken}` },
          );
          statusRes   = relayState?.status   || null;
          messagesRes = relayState?.messages  || [];
          callsRes    = relayState?.calls     || [];
          contactsRes = relayState?.contacts  || [];
          if (relayState?.lanUrl) setRelayLanUrl(relayState.lanUrl);
          usingRelayRef.current = true;
          setUsingRelay(true);
        } catch (relayErr) {
          const msg = String(relayErr?.message || "");
          if (msg.includes("404")) throw new Error("relay:no_state");
          if (msg.includes("401")) throw new Error("relay:no_auth");
          if (msg.includes("403")) throw new Error("relay:denied");
          throw new Error("relay:fail:" + msg);
        }
      } else {
        usingRelayRef.current = false;
        setUsingRelay(false);
      }
      applyPhoneState(statusRes, messagesRes, callsRes, contactsRes);
    } catch (e) {
      setStatus(null); setMessages([]); setCalls([]);
      messagesSigRef.current = ""; callsSigRef.current = ""; contactsSigRef.current = "";
      const msg = String(e?.message || "");
      setError(msg === "relay:no_state"
        ? "Relay reachable — DeskPhone hasn't pushed yet. Is DeskPhone running with relay enabled?"
        : msg === "relay:no_auth"
          ? "Sign in to access DeskPhone remotely."
          : msg === "relay:denied"
            ? "Relay blocked by Firestore rules — set allow read, write: if true for phone-relay collection."
            : msg.startsWith("relay:fail:")
              ? "Cloud relay unreachable. Check Netlify deploy and env vars."
              : "Open DeskPhone to use calls and texts.");
      usingRelayRef.current = false;
      setUsingRelay(false);
      onOnlineChange?.(false);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [api, onOnlineChange, user, applyPhoneState]);

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

  const saveRemoteUrl = useCallback(() => {
    const val = remoteInput.trim().replace(/\/$/, "");
    setRemoteUrl(val);
    if (typeof localStorage !== "undefined")
      val ? localStorage.setItem("shamash_deskphone_url", val) : localStorage.removeItem("shamash_deskphone_url");
    setShowRemoteConfig(false);
  }, [remoteInput]);

  const clearRemoteUrl = useCallback(() => {
    setRemoteUrl(""); setRemoteInput("");
    if (typeof localStorage !== "undefined") localStorage.removeItem("shamash_deskphone_url");
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 6500); return () => clearInterval(id); }, [refresh]);

  // ── Real-time relay: when we're on the cloud relay (away from the PC's LAN),
  // subscribe to the phone-relay/state doc directly instead of relying only on the
  // 6.5 s poll. DeskPhone PushNow()'s the instant a text arrives, so this lands the
  // update on every signed-in device in ~1 s. The poll above stays as a safety net.
  //
  // A Firestore onSnapshot listener is TERMINAL after its error callback fires (it
  // never reconnects itself), so — exactly like Store.listenShailos — we tear down
  // and resubscribe on capped exponential backoff so a transport drop self-heals.
  useEffect(() => {
    if (!usingRelay || !db || !user) return;
    let stopped = false;
    let unsub = null;
    let retryTimer = null;
    let attempt = 0;

    const subscribe = () => {
      if (stopped) return;
      unsub = db.collection("phone-relay").doc("state").onSnapshot(snap => {
        attempt = 0; // a healthy snapshot resets the backoff
        const raw = snap.data()?.data;
        if (!raw) return;
        let blob;
        try { blob = JSON.parse(raw); } catch { return; }
        applyPhoneState(blob.status, blob.messages, blob.calls, blob.contacts);
        if (blob.lanUrl) setRelayLanUrl(blob.lanUrl);
      }, err => {
        console.warn("[Phone] relay listener error — resubscribing:", err);
        try { unsub && unsub(); } catch (_) {}
        unsub = null;
        if (stopped) return;
        const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
        attempt += 1;
        retryTimer = setTimeout(subscribe, delay);
      });
    };

    subscribe();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { unsub && unsub(); } catch (_) {}
    };
  }, [usingRelay, user, applyPhoneState]);

  const post = async (path, label) => {
    setBusy(label);
    try {
      if (usingRelayRef.current) {
        // Route command through the cloud relay — DeskPhone will execute it within 2 s.
        // Include Firebase ID token so the function can gate on auth.
        let cmdAuthHeaders = {};
        try {
          if (user?.getIdToken) {
            const tok = await user.getIdToken();
            cmdAuthHeaders["Authorization"] = `Bearer ${tok}`;
          }
        } catch {}
        await fetch(`${RELAY_BASE}?action=command`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...cmdAuthHeaders },
          body: JSON.stringify({ path }),
        });
        setError("");
        // Short wait then refresh so the UI reflects the command result
        await new Promise(r => setTimeout(r, 2500));
      } else {
        const res = await fetch(`${api}${path}`, { method: "POST" });
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
  const isOnCall = !!callState && !isIncoming && /^(active|dialing|oncall|callactive)$/i.test(callState.replace(/\s+/g, ""));
  const statusOnline = !!status;
  const deviceName = status?.deviceName || status?.DeviceName || status?.device || status?.Device || status?.phoneName || status?.PhoneName || "";
  const idleLabel = deviceName ? `Connected · ${deviceName}` : "Connected";
  const statusText = status ? (isIncoming ? "Incoming call" : isOnCall ? "On call" : callState ? "Call status changed" : idleLabel) : "DeskPhone offline";
  const callerName = status?.callerName || status?.CallerName || status?.callerDisplay || status?.CallerDisplay || status?.callerID || status?.CallerID || "";
  const callerNumber = status?.callerNumber || status?.CallerNumber || status?.incomingNumber || status?.IncomingNumber || status?.callNumber || status?.CallNumber || "";
  const callerDisplay = callerName || (callerNumber ? (lookupName(callerNumber) || callerNumber) : "");
  const vmCount = parseInt(status?.voicemailCount || status?.VoicemailCount || status?.voicemail?.count || 0, 10) || 0;

  const threads = useMemo(() => {
    const threadMap = new Map();
    (Array.isArray(messages) ? messages : []).forEach(m => {
      const who = messagePeerNumber(m);
      const threadKey = phoneThreadKey(who) || String(who || "Unknown").trim().toLowerCase();
      const directName = m.name || m.displayName || m.contactName || m.fromName || m.senderName || m.contact ||
        m.Name || m.DisplayName || m.ContactName || m.FromName || m.SenderName || m.Contact || "";
      const resolvedName = directName || lookupName(who) || who;
      const at = messageTimeMs(m);
      const existing = threadMap.get(threadKey) || {
        _key: threadKey,
        _who: who,
        _name: resolvedName,
        _messages: [],
        _latestMessage: null,
        _latestAt: 0,
        _unreadCount: 0,
      };
      existing._name = existing._name === who && resolvedName !== who ? resolvedName : existing._name;
      existing._who = phoneDigits(existing._who).length >= phoneDigits(who).length ? existing._who : who;
      existing._messages.push(m);
      if (at >= existing._latestAt) {
        existing._latestAt = at;
        existing._latestMessage = m;
      }
      if (isUnreadMessage(m)) existing._unreadCount += 1;
      threadMap.set(threadKey, existing);
    });
    return Array.from(threadMap.values())
      .map(thread => ({
        ...thread,
        _messages: thread._messages.sort((a, b) => messageTimeMs(a) - messageTimeMs(b)),
      }))
      .sort((a, b) => b._latestAt - a._latestAt)
      .slice(0, 10);
  }, [messages, lookupName]);
  const recentCalls = (Array.isArray(calls) ? calls : []).slice(0, 10);
  const hasMessages = threads.length > 0;
  const hasCalls = recentCalls.length > 0;
  const expandedConversationSig = useMemo(() => {
    if (!expandedPhoneMessageId) return "";
    const thread = threads.find(t => `msg-${t._key || t._who}` === expandedPhoneMessageId);
    const latest = thread?._messages?.[thread._messages.length - 1];
    return `${expandedPhoneMessageId}|${thread?._messages?.length || 0}|${messageTimeMs(latest)}|${latest?.id ?? latest?.handle ?? ""}`;
  }, [expandedPhoneMessageId, threads]);
  useEffect(() => {
    if (!expandedPhoneMessageId || !expandedConversationEndRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      expandedConversationEndRef.current?.scrollIntoView({ block: "end", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedPhoneMessageId, expandedConversationSig]);
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
    if (diff >= 0 && diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m`;
    if (diff >= 0 && diff < 86400000) return `${Math.round(diff / 3600000)}h`;
    if (isInCurrentWeek(d)) return d.toLocaleDateString(undefined, { weekday: "short" });
    return formatCompactDate(d);
  };
  const timeMs = val => {
    return eventTimeMs(val);
  };
  const activityItems = [
    ...threads.map((thread, idx) => ({ kind: "message", item: thread, idx, at: thread._latestAt })),
    ...recentCalls.map((c, idx) => ({ kind: "call", item: c, idx, at: timeMs(c.timestamp || c.date || c.time || c.startTime || c.StartTime) })),
  ].sort((a, b) => b.at - a.at).slice(0, compact ? 8 : 14);

  const callDirIcon = c => {
    // Numeric type codes: 1=incoming, 2=outgoing/dialed, 3=missed, 4=unknown
    const typeNum = typeof (c.type || c.callType || c.Type || c.CallType) === "number"
      ? (c.type || c.callType || c.Type || c.CallType)
      : null;
    if (c.missed || c.Missed || typeNum === 3) return { icon: "call_missed", color: C.danger };
    const dir = (c.direction || c.Direction || (typeof c.type === "string" ? c.type : "") || (typeof c.callType === "string" ? c.callType : "") || "").toLowerCase();
    if (dir.includes("miss")) return { icon: "call_missed", color: C.danger };
    // Check outgoing BEFORE checking incoming so "outgoing" (contains "in") doesn't misfire
    if (typeNum === 2 || dir.includes("out") || dir.includes("dial") || dir.includes("egress")) return { icon: "call_made", color: T.tSoft };
    if (typeNum === 1 || dir.includes("incoming") || dir.includes("inbound") || dir.includes("receiv") || dir === "in") return { icon: "call_received", color: T.tSoft };
    return { icon: "call", color: T.tSoft };
  };

  const callKindLabel = c => {
    const typeNum = typeof (c.type || c.callType || c.Type || c.CallType) === "number"
      ? (c.type || c.callType || c.Type || c.CallType)
      : null;
    if (c.missed || c.Missed || typeNum === 3) return "missed";
    const dir = (c.direction || c.Direction || (typeof c.type === "string" ? c.type : "") || (typeof c.callType === "string" ? c.callType : "") || "").toLowerCase();
    if (dir.includes("miss")) return "missed";
    if (typeNum === 2 || dir.includes("out") || dir.includes("dial") || dir.includes("egress")) return "outgoing";
    if (typeNum === 1 || dir.includes("incoming") || dir.includes("inbound") || dir.includes("receiv") || dir === "in") return "incoming";
    return "call";
  };

  const callNumber = c => c?.number || c?.phoneNumber || c?.from || c?.Number || c?.PhoneNumber || "";
  const callAtMs = c => timeMs(c?.timestamp || c?.date || c?.time || c?.startTime || c?.StartTime);
  const phoneKeyMatch = (a, b) => {
    const aKeys = phoneKeys(a);
    const bKeys = phoneKeys(b);
    return aKeys.some(key => bKeys.includes(key));
  };
  const isMissedCallResolved = c => {
    if (callKindLabel(c) !== "missed") return false;
    const num = callNumber(c);
    const missedAt = callAtMs(c);
    if (!num || !missedAt) return false;
    const laterHandledCall = recentCalls.some(other => {
      if (other === c || callKindLabel(other) === "missed") return false;
      return callAtMs(other) > missedAt && phoneKeyMatch(callNumber(other), num);
    });
    if (laterHandledCall) return true;
    return (Array.isArray(messages) ? messages : []).some(message =>
      isOutgoingMessage(message) &&
      messageTimeMs(message) > missedAt &&
      phoneKeyMatch(messagePeerNumber(message), num)
    );
  };
  const actionableMissedCalls = recentCalls.filter(c => callKindLabel(c) === "missed" && !isMissedCallResolved(c));

  const phoneActivitySnapshot = useMemo(() => ({
    online: statusOnline,
    status: statusText,
    unreadTexts: threads.reduce((sum, thread) => sum + (thread._unreadCount || 0), 0),
    missedCalls: actionableMissedCalls.length,
    voicemailCount: vmCount,
    texts: threads.slice(0, 6).map(thread => {
      const latest = thread._latestMessage || thread._messages?.[thread._messages.length - 1] || {};
      return {
        name: thread._name || thread._who || "Unknown",
        preview: messageBody(latest),
        time: fmtTime(thread._latestAt),
        unread: (thread._unreadCount || 0) > 0,
      };
    }),
    calls: recentCalls.slice(0, 8).map(c => {
      const num = callNumber(c);
      const kind = callKindLabel(c);
      return {
        name: lookupName(num) || c.name || c.displayName || c.Name || c.DisplayName || c.from || num || "Unknown",
        kind: kind === "missed" && isMissedCallResolved(c) ? "missed resolved" : kind,
        needsReturnCall: kind === "missed" && !isMissedCallResolved(c),
        time: fmtTime(c.timestamp || c.date || c.time || c.startTime || c.StartTime),
      };
    }),
  }), [statusOnline, statusText, threads, recentCalls, actionableMissedCalls.length, vmCount, lookupName, messages]);

  useEffect(() => {
    onActivitySnapshot?.(phoneActivitySnapshot);
  }, [onActivitySnapshot, phoneActivitySnapshot]);

  // Incoming SMS = sms icon; outgoing = outgoing_mail icon
  // Android SMS type codes: 1=inbox/received, 2=sent, 4=outbox/pending, 5=failed, 6=queued
  const msgDirIcon = m => {
    if (isOutgoingMessage(m)) return { icon: "outgoing_mail", color: T.tSoft };
    return { icon: "sms", color: T.tSoft };
  };

  // Compose helpers — open from row, open new, close
  const openCompose = (name, num, anchorId = null) => {
    setSelected({ name, number: num });
    setNumber(num);
    setBody("");
    setComposeAnchorId(anchorId);
    setComposeOpen(true);
    setComposeIsNew(false);
  };
  const openNewMessage = () => { setSelected(null); setBody(""); setComposeSearch(""); setComposeAnchorId(null); setComposeIsNew(true); setComposeOpen(true); };
  const closeCompose = () => { setComposeOpen(false); setComposeIsNew(false); setComposeSearch(""); setSelected(null); setComposeAnchorId(null); };
  useEffect(() => {
    if (!composeOpen || composeIsNew || !selected) return undefined;
    const frame = window.requestAnimationFrame(() => composeBodyRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [composeOpen, composeIsNew, selected?.number, composeAnchorId]);

  const renderComposeBox = (extraStyle = {}) => (
    <div style={{ background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, ...extraStyle }}>
      {composeIsNew && (
        <div style={{ position: "relative" }}>
          <input value={composeSearch} onChange={e => setComposeSearch(e.target.value)}
            onFocus={() => setComposeFocused(true)}
            onBlur={() => setTimeout(() => setComposeFocused(false), 160)}
            placeholder="Search contact or enter number..."
            autoFocus
            style={{ width: "100%", height: 36, boxSizing: "border-box", padding: "0 12px", borderRadius: 18, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, fontFamily: "system-ui", fontSize: 14, fontWeight: 400, outline: "none" }} />
          {composeFocused && suggestions.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 300 }}>
              <SuggestionList onPick={s => { setSelected({ name: s.name, number: s.num }); setNumber(s.num); setComposeSearch(s.name); setComposeIsNew(false); }} />
            </div>
          )}
        </div>
      )}
      {selected && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {suiteIcon("sms", 14)}
          <span style={{ fontSize: 13, color: C.muted, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{selected.name || selected.number}</span>
          <button onClick={closeCompose} style={gvIconButton({ width: 32, height: 32 }, C)}>{suiteIcon("close", 14)}</button>
        </div>
      )}
      {(!composeIsNew || selected) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 36px", gap: 6, alignItems: "flex-end" }}>
          <textarea ref={composeBodyRef} value={body} onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSms(); } }}
            placeholder="Message..." rows={2}
            style={{ boxSizing: "border-box", borderRadius: 8, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, padding: "8px 12px", fontSize: 14, fontFamily: "system-ui", resize: "none", outline: "none", width: "100%" }} />
          <button onClick={sendSms} disabled={!body.trim() || !!busy || (!selected && !number.trim())}
            style={{ width: 40, height: 40, borderRadius: 20, border: "none", background: body.trim() ? C.accent : "transparent", color: body.trim() ? "#fff" : C.faint, cursor: body.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s", flexShrink: 0 }}>
            {suiteIcon("send", 16)}
          </button>
        </div>
      )}
      {composeIsNew && !selected && (
        <button onClick={closeCompose} style={gvTextButton({ alignSelf: "flex-end", height: 32, fontSize: NC_TYPE.meta }, C)}>
          {suiteIcon("close", 13)} Cancel
        </button>
      )}
    </div>
  );

  // Small neutral action button (white/card background) — used on each row
  const AB = ({ icon, title, onClick }) => (
    <button onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onClick(); }} title={title}
      aria-label={title}
      style={gvTextButton({ minHeight: 32, height: 32, padding: "0 9px", fontSize: NC_TYPE.small, gap:6, border: "none", background: C.bgSoft }, C)}>
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

      {composeOpen && !composeAnchorId && renderComposeBox()}

      {/* ── Control bar: answer/hangup | record | new-msg | keypad toggle ── */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", minHeight: compact ? 30 : 44 }}>
        {isIncoming ? (
          <>
            <button onClick={() => post("/answer", "answer")} disabled={!!busy} title="Answer"
              style={gvTextButton({ border: "none", background: C.success, color: "#fff" }, C)}>
              {suiteIcon("phone_callback", 14)} Answer
            </button>
            <button onClick={() => post("/hangup", "decline")} disabled={!!busy} title="Decline"
              style={gvTextButton({ border: "none", background: C.danger, color: "#fff" }, C)}>
              {suiteIcon("call_end", 14)} Decline
            </button>
          </>
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
        {/* Remote connection config */}
        <button onClick={() => { setShowRemoteConfig(v => !v); setRemoteInput(remoteUrl); }}
          title={remoteUrl ? `Remote DeskPhone: ${remoteUrl}` : "Connect remote DeskPhone"}
          style={phoneIconButton(showRemoteConfig || !!remoteUrl)}>
          {suiteIcon("settings_ethernet", 15)}
        </button>
        {/* Cloud relay indicator + setup */}
        <button onClick={() => setShowRelaySetup(v => !v)}
          title={usingRelay ? "Live via cloud relay" : "Cloud relay setup"}
          style={{ ...phoneIconButton(showRelaySetup || usingRelay), ...(usingRelay ? { background: C.success, color: "#fff" } : {}) }}>
          {suiteIcon("cloud", 15)}
        </button>
      </div>

      {/* ── Remote DeskPhone config panel ── */}
      {showRemoteConfig && window.location.port !== "8765" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, background: C.bgSoft, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Remote DeskPhone URL</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={remoteInput}
              onChange={e => setRemoteInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveRemoteUrl()}
              placeholder="http://192.168.x.x:8765"
              style={{ flex: 1, height: 32, boxSizing: "border-box", padding: "0 10px", borderRadius: 6, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, fontFamily: "system-ui", fontSize: 13, outline: "none" }}
            />
            <button onClick={saveRemoteUrl} style={gvTextButton({ height: 32, fontSize: 12 }, C)}>Save</button>
            <button onClick={() => setShowRemoteConfig(false)} style={gvIconButton({ width: 32, height: 32 }, C)}>{suiteIcon("close", 13)}</button>
          </div>
          {remoteUrl && (
            <button onClick={clearRemoteUrl} style={gvTextButton({ height: 28, fontSize: 11 }, C)}>
              Clear (use localhost)
            </button>
          )}
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
            On your home network: navigate to <strong>http://[PC‑IP]:8765</strong> for zero‑config auto‑connect.
          </div>
        </div>
      )}

      {/* ── Cloud relay setup / status panel ── */}
      {showRelaySetup && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, background: C.bgSoft, borderRadius: 8, padding: "12px 14px" }}>
          {usingRelay ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.success }}>Connected via cloud relay</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                DeskPhone on your PC is relaying this session. Commands take ~2 s to execute. SMS only — no call audio.
              </div>
              {relayLanUrl && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                    Your PC is also reachable directly on this network:
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <code style={{ flex: 1, fontSize: 11, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 5, padding: "5px 8px", color: C.text, wordBreak: "break-all" }}>
                      {relayLanUrl}
                    </code>
                    <button
                      onClick={() => {
                        const val = relayLanUrl.replace(/\/$/, "");
                        setRemoteUrl(val);
                        if (typeof localStorage !== "undefined")
                          localStorage.setItem("shamash_deskphone_url", val);
                        setShowRelaySetup(false);
                      }}
                      style={gvTextButton({ height: 32, fontSize: 11 }, C)}
                      title="Switch to direct LAN connection — faster, no relay delay">
                      Use direct
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>Cloud relay lets any browser reach your home PC</div>
              {relayStatus ? (
                <>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                    Your relay key (auto-generated by DeskPhone — copy it once to Netlify):
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <code style={{ flex: 1, fontSize: 11, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 5, padding: "5px 8px", userSelect: "all", wordBreak: "break-all", color: C.text }}>
                      {relayStatus.key}
                    </code>
                    <button onClick={() => navigator.clipboard?.writeText(relayStatus.key)} style={gvTextButton({ height: 32, fontSize: 11 }, C)}>
                      {suiteIcon("content_copy", 12)} Copy
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
                    Go to <strong>netlify.com → Your site → Site configuration → Environment variables</strong>, add <code>PHONE_RELAY_SECRET</code> = the key above, then re-deploy. One-time setup.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: C.faint }}>
                  Open this panel while DeskPhone is running on your PC to see your relay key.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Dialer — only when keypad is open ── */}
      {showDialer && (
        <div style={{ display: "flex", flexDirection: "column", gap:6 }}>
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
        <div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", paddingRight: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.muted, letterSpacing: 0, marginBottom: 3, paddingLeft: 4, paddingTop: 1, position: "sticky", top: 0, background: C.bg, zIndex: 1 }}>Activity</div>
          {activityItems.map(entry => {
            if (entry.kind === "message") {
                const thread = entry.item;
                const m = thread._latestMessage || thread._messages?.[thread._messages.length - 1] || {};
                const idx = entry.idx;
                const { icon: msgIcon, color: msgColor } = msgDirIcon(m);
                const isUnread = thread._unreadCount > 0;
                const preview = messageBody(m);
                const time = fmtTime(thread._latestAt);
                const count = thread._messages?.length || 1;
                const actionId = `msg-${thread._key || thread._who}`;
                const actionsOpen = openPhoneActionId === actionId;
                const expanded = expandedPhoneMessageId === actionId;
                return (
                  <div key={`${thread._key || thread._who}-${idx}`} className="nc-action-row" style={{ ...phoneRowStyle, background: expanded ? C.hover : "transparent" }}>
                    <span style={{ width: 32, height: 32, borderRadius: 99, background: isUnread ? C.hover : C.bgSoft, display: "flex", alignItems: "center", justifyContent: "center", color: isUnread ? C.accent : msgColor, flexShrink: 0, marginTop: 2 }}>{suiteIcon(msgIcon, 15)}</span>
                    <button onClick={() => setExpandedPhoneMessageId(expanded ? null : actionId)} style={{ minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, color: T.text }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                        <span style={{ flex: 1, fontSize: 15, fontWeight: isUnread ? 600 : 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread._name}</span>
                        {time && <span style={{ fontSize: 13, color: C.muted, flexShrink: 0, fontWeight: 400 }}>{time}</span>}
                      </div>
                      {preview && !expanded && <span style={{ display: "block", fontSize: compact ? 13 : 14, color: C.muted, marginTop: 1, whiteSpace: compact ? "nowrap" : "normal", overflow: compact ? "hidden" : undefined, textOverflow: compact ? "ellipsis" : undefined, wordBreak: compact ? "normal" : "break-word", lineHeight: compact ? 1.35 : 1.5 }}>{preview}</span>}
                    </button>
                    {!expanded && (
                      <button onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionsOpen ? null : actionId); }} title={actionsOpen ? "Hide actions" : "Show actions"} aria-label={actionsOpen ? "Hide actions" : "Show actions"} style={phoneIconButton(actionsOpen)}>
                        {suiteIcon("more_horiz", 17)}
                      </button>
                    )}
                    {!expanded && actionsOpen && (
                      <div style={phoneActionGroupStyle}>
                        <AB icon="call" title="Call" onClick={() => { setOpenPhoneActionId(null); dialNum(thread._who); }} />
                        <AB icon="sms" title="Text" onClick={() => { setOpenPhoneActionId(null); openCompose(thread._name, thread._who, actionId); }} />
                      </div>
                    )}
                    {!expanded && composeOpen && composeAnchorId === actionId && !composeIsNew && (
                      <div style={{ gridColumn: "2 / 4", marginTop: 2 }}>
                        {renderComposeBox({ boxShadow: "none" })}
                      </div>
                    )}
                    {expanded && (
                      <div style={{ gridColumn: "2 / 4", fontSize: compact ? 13 : 14, lineHeight: 1.5, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "0 4px 4px 0" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                          <div style={{ flex: 1, minWidth: 0, color: C.muted }}>{count} message{count === 1 ? "" : "s"}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                            <button type="button" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); dialNum(thread._who); }} title="Call" aria-label="Call" style={phoneIconButton(false)}>
                              {suiteIcon("call", 15)}
                            </button>
                            <button type="button" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); openCompose(thread._name, thread._who, actionId); }} title="Reply" aria-label="Reply" style={phoneIconButton(false)}>
                              {suiteIcon("sms", 15)}
                            </button>
                            <button type="button" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); setExpandedPhoneMessageId(null); }} title="Close conversation" aria-label="Close conversation" style={phoneIconButton(false)}>
                              {suiteIcon("close", 16)}
                            </button>
                          </div>
                        </div>
                        {composeOpen && composeAnchorId === actionId && !composeIsNew && (
                          <div style={{ margin: "0 0 8px" }}>
                            {renderComposeBox({ boxShadow: "none" })}
                          </div>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {thread._messages.map((msg, msgIdx) => {
                            const outgoing = isOutgoingMessage(msg);
                            const msgText = messageBody(msg);
                            const msgTime = fmtTime(messageTimeMs(msg));
                            return (
                              <div key={`${thread._who}-${messageTimeMs(msg)}-${msgIdx}`} style={{ alignSelf: outgoing ? "flex-end" : "flex-start", maxWidth: "92%", minWidth: 0 }}>
                                <div style={{ borderRadius: 8, border: `1px solid ${outgoing ? "transparent" : C.divider}`, background: outgoing ? C.hover : C.bgSoft, color: C.text, padding: "7px 9px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                  {linkedMessageParts(msgText || "(no text)", { color: C.accent })}
                                </div>
                                {msgTime && <div style={{ fontSize: 11, color: C.faint, marginTop: 2, textAlign: outgoing ? "right" : "left" }}>{msgTime}</div>}
                              </div>
                            );
                          })}
                          <div
                            role="group"
                            aria-label="Conversation actions"
                            style={{
                              position: "sticky",
                              bottom: 6,
                              alignSelf: "flex-end",
                              zIndex: 2,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              padding:4,
                              border: `1px solid ${C.divider}`,
                              borderRadius: 99,
                              background: C.bg,
                              boxShadow: `0 2px 8px ${C.shadow || "rgba(15,23,42,0.18)"}`,
                            }}
                          >
                            <button
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={e => { e.stopPropagation(); dialNum(thread._who); }}
                              title="Call"
                              aria-label="Call"
                              style={phoneIconButton(false)}
                            >
                              {suiteIcon("call", 15)}
                            </button>
                            <button
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={e => { e.stopPropagation(); openCompose(thread._name, thread._who, actionId); }}
                              title="Reply"
                              aria-label="Reply"
                              style={phoneIconButton(false)}
                            >
                              {suiteIcon("sms", 15)}
                            </button>
                            <button
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={e => { e.stopPropagation(); setExpandedPhoneMessageId(null); }}
                              title="Close conversation"
                              aria-label="Close conversation"
                              style={phoneIconButton(false)}
                            >
                              {suiteIcon("close", 16)}
                            </button>
                          </div>
                          <div ref={expandedConversationEndRef} style={{ height: 1 }} />
                        </div>
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
                        <AB icon="sms" title="Text back" onClick={() => { setOpenPhoneActionId(null); openCompose(name, num, actionId); }} />
                      </div>
                    )}
                    {composeOpen && composeAnchorId === actionId && !composeIsNew && (
                      <div style={{ gridColumn: "2 / 4", marginTop: 2 }}>
                        {renderComposeBox({ boxShadow: "none" })}
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
