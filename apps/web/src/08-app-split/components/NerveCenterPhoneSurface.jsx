import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, DUR, EASE, gvIconButton, gvTextButton, NC_FONT_STACK, NC_TYPE, suiteIcon, useViewportWidth } from '../ui-tokens.jsx';
import { db } from '../../01-core.js';

const DIALER_KEYS = ["1","2","3","4","5","6","7","8","9","*","0","#"];
const PHONE_FETCH_TIMEOUT_MS = 4500;
// How fresh the relayed phone state must be for the PC to count as "currently connected".
// DeskPhone heartbeats to the relay every ~5s, so a gap beyond this (≈6 missed beats)
// means the PC/DeskPhone is offline and new texts/calls are NOT arriving live.
const RELAY_LIVE_WINDOW_MS = 30000;

// Compact "27s" / "4m" / "2h" age label for the relay's last-connected time.
function relayAgeLabel(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// True on a real phone/tablet (Android, iPhone, iPad) — by user-agent and touch,
// NOT by window width, so a narrow desktop window is still treated as desktop.
// Mobile devices can't reach the PC's localhost, so they use the cloud relay only.
export function isMobilePhoneDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = `${navigator.userAgent || ""} ${navigator.platform || ""}`.toLowerCase();
  if (/android|iphone|ipod|ipad/.test(ua)) return true;
  // iPadOS 13+ reports as desktop Safari — detect by touch + Mac.
  if (/mac/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
  return !!coarse && (navigator.maxTouchPoints || 0) > 0;
}

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

// Cross-render cache of fetched picture-text previews (mediaId → data: URL) so a thread
// re-render or reopen doesn't refetch the same image.
const mediaCache = new Map();

// Renders one MMS image. On the LAN path the bytes arrive inline (attachment.dataUrl);
// on the cloud-relay path only a small mediaId comes through, so we fetch the resized
// preview from the phone-media/{mediaId} Firestore doc (gated by the signed-in user).
function PhoneMmsImage({ attachment, C }) {
  const inline = attachment?.dataUrl || "";
  const mediaId = attachment?.mediaId || "";
  const [src, setSrc] = useState(inline || (mediaId ? mediaCache.get(mediaId) || "" : ""));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (inline) { setSrc(inline); return; }
    if (!mediaId || !db) return;
    const cached = mediaCache.get(mediaId);
    if (cached) { setSrc(cached); return; }
    let cancelled = false;
    db.collection("phone-media").doc(mediaId).get()
      .then(snap => {
        if (cancelled) return;
        const url = snap.exists ? (snap.data()?.data || "") : "";
        if (url) { mediaCache.set(mediaId, url); setSrc(url); }
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [inline, mediaId]);

  if (src) {
    return <img src={src} alt="" loading="lazy"
      style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 6, marginTop: 4, display: "block", objectFit: "contain" }} />;
  }
  return <div style={{ fontSize: 12, color: C.faint, padding: "4px 0", display: "flex", alignItems: "center", gap: 4 }}>
    {suiteIcon("image", 14)} {failed ? "image unavailable" : "loading image…"}
  </div>;
}

function NerveCenterPhoneSurface({ T, user = null, onOnlineChange, onStatusSummary, onActivitySnapshot, compact = false, dense = false, onRecordConversation, onRecordCall, onMoreHistory }) {
  // Two transports reach the phone: DIRECT (DeskPhone's HTTP API — loopback or
  // same-origin when this page is served by DeskPhone itself) and RELAY (the
  // cloud blob, reachable from anywhere). The default "auto" mode probes direct
  // and falls back to relay BY REACHABILITY, not device type — so a desktop
  // browser away from home rides the relay, and sitting back down at the PC
  // flips back to direct automatically. isMobile only skips the pointless
  // probe (a phone can never reach the PC's loopback).
  const isMobile = useMemo(() => isMobilePhoneDevice(), []);
  const api = (typeof window !== "undefined" && window.location.port === "8765")
    ? window.location.origin
    : "http://127.0.0.1:8765";

  const viewportW = useViewportWidth();
  const touchActions = viewportW < 980;
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  // Manually resolved missed calls — stored in Firestore so every browser/device (Chrome,
  // Safari, phone) shares a single source of truth.  localStorage is the fast-init seed
  // only; Firestore is authoritative.  The onSnapshot listener keeps all sessions live.
  const [resolvedMissed, setResolvedMissed] = useState(() => {
    try { const a = JSON.parse(localStorage.getItem("nc_missed_resolved") || "[]"); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
  });

  // Firestore path: users/{uid}/appData/phoneState  { resolvedMissedCalls: string[] }
  const phoneStateDocRef = useMemo(() => {
    const uid = user?.uid;
    if (!db || !uid) return null;
    return db.collection("users").doc(uid).collection("appData").doc("phoneState");
  }, [user?.uid]);

  // Subscribe to Firestore doc — real-time across all browsers/devices.
  useEffect(() => {
    if (!phoneStateDocRef) return;
    let stopped = false;
    let unsub = null;
    let retryTimer = null;
    let attempt = 0;
    const subscribe = () => {
      if (stopped) return;
      unsub = phoneStateDocRef.onSnapshot(snap => {
        attempt = 0;
        if (snap.metadata.fromCache) return; // trust server only
        const arr = snap.data()?.resolvedMissedCalls;
        if (!Array.isArray(arr)) return;
        const next = new Set(arr);
        try { localStorage.setItem("nc_missed_resolved", JSON.stringify(arr.slice(-300))); } catch {}
        try { window.dispatchEvent(new CustomEvent("nc-missed-resolved-sync", { detail: arr })); } catch {}
        setResolvedMissed(next);
      }, err => {
        console.warn("[PhoneSurface] phoneState listener error — resubscribing:", err);
        try { unsub?.(); } catch (_) {}
        unsub = null;
        if (stopped) return;
        retryTimer = setTimeout(subscribe, Math.min(30000, 1000 * Math.pow(2, attempt++)));
      });
    };
    subscribe();
    // Also sync from other tabs (cross-tab broadcast without a Firestore write).
    const onSync = e => {
      if (!Array.isArray(e.detail)) return;
      setResolvedMissed(new Set(e.detail));
    };
    window.addEventListener("nc-missed-resolved-sync", onSync);
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { unsub?.(); } catch (_) {}
      window.removeEventListener("nc-missed-resolved-sync", onSync);
    };
  }, [phoneStateDocRef]);

  const toggleMissedResolved = useCallback((key, resolved) => {
    if (!key) return;
    setResolvedMissed(prev => {
      const next = new Set(prev);
      if (resolved) next.add(key); else next.delete(key);
      const arr = [...next].slice(-300);
      // Write to Firestore — this propagates to every browser/device via the listener above.
      if (phoneStateDocRef) {
        phoneStateDocRef.set({ resolvedMissedCalls: arr }, { merge: true }).catch(() => {});
      }
      try { localStorage.setItem("nc_missed_resolved", JSON.stringify(arr)); } catch {}
      try { window.dispatchEvent(new CustomEvent("nc-missed-resolved-sync", { detail: arr })); } catch {}
      return next;
    });
  }, [phoneStateDocRef]);
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
  // Server-stamped time the relay last received a push from the PC (relayReceivedAt in
  // the state blob). Drives the live/stale connection indicator on mobile.
  const [relayReceivedAt, setRelayReceivedAt] = useState(0);
  // Ticks so staleness re-evaluates over time even when no new data arrives (PC went away).
  const [nowTick, setNowTick] = useState(() => Date.now());
  const refreshInFlightRef = useRef(false);
  const expandedConversationEndRef = useRef(null);
  const composeBodyRef = useRef(null);
  const messagesSigRef = useRef("");
  const callsSigRef = useRef("");
  const contactsSigRef = useRef("");
  const C = cleanTheme(T);
  const RELAY_BASE = "/api/phone-relay";

  // ── Transport resolution (the ONE connection control) ─────────────────────
  // transportMode is the user override: 'auto' (default) | 'direct' | 'relay'.
  // transportRef caches the resolved path so auto doesn't probe every cycle:
  // an established 'direct' is trusted until a fetch fails; on 'relay' we
  // re-probe at most every 25 s so coming home flips back without clicks.
  const transportRef = useRef(null);
  const lastProbeAtRef = useRef(0);
  const [showTransportMenu, setShowTransportMenu] = useState(false);
  const [transportMode, setTransportModeState] = useState(() => {
    try { return localStorage.getItem("nc_phone_transport") || "auto"; } catch { return "auto"; }
  });
  const setTransportMode = useCallback(mode => {
    setTransportModeState(mode);
    try { localStorage.setItem("nc_phone_transport", mode); } catch {}
    transportRef.current = null;     // re-resolve on the next refresh
    lastProbeAtRef.current = 0;
  }, []);

  // Loopback is exempt from mixed-content blocking, so this probe is safe even
  // from the HTTPS production app.
  const probeDirect = useCallback(async () => {
    try { return !!(await fetchPhoneJson(`${api}/status`, 1500)); }
    catch { return false; }
  }, [api]);

  const resolveTransport = useCallback(async (force = false) => {
    if (transportMode === "direct" || transportMode === "relay") return transportMode;
    if (isMobile) return "relay";
    const now = Date.now();
    if (!force && transportRef.current === "direct") return "direct";
    if (!force && transportRef.current === "relay" && now - lastProbeAtRef.current < 25000) return "relay";
    lastProbeAtRef.current = now;
    return (await probeDirect()) ? "direct" : "relay";
  }, [transportMode, isMobile, probeDirect]);

  // ── Relay command acknowledgements ─────────────────────────────────────────
  // DeskPhone acknowledges every relayed command by id inside the state blob it
  // pushes (commandResults). post() awaits the ack for its command id, so success
  // means DeskPhone REALLY ran the command — not just that the cloud queued it.
  const recentAcksRef = useRef(new Map());   // command id → { ok, error, completedAt }
  const ackWaitersRef = useRef(new Map());   // command id → resolve(ack)
  const processCommandResults = useCallback((results) => {
    if (!Array.isArray(results)) return;
    results.forEach(r => {
      if (!r?.id || recentAcksRef.current.has(r.id)) return;
      recentAcksRef.current.set(r.id, r);
      while (recentAcksRef.current.size > 60) {
        recentAcksRef.current.delete(recentAcksRef.current.keys().next().value);
      }
      const waiter = ackWaitersRef.current.get(r.id);
      if (waiter) { ackWaitersRef.current.delete(r.id); waiter(r); }
    });
  }, []);
  const waitForAck = useCallback((id, timeoutMs) => new Promise(resolve => {
    const existing = recentAcksRef.current.get(id);
    if (existing) { resolve(existing); return; }
    const timer = setTimeout(() => { ackWaitersRef.current.delete(id); resolve(null); }, timeoutMs);
    ackWaitersRef.current.set(id, ack => { clearTimeout(timer); resolve(ack); });
  }), []);

  // Apply a phone-state payload (from either the direct LAN poll or the cloud-relay
  // listener) to component state. Signature refs short-circuit redundant re-renders,
  // so it's safe for the poll and the onSnapshot listener to both feed this.
  const applyPhoneState = useCallback((statusRes, messagesRes, callsRes, contactsRes, receivedAt = 0) => {
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
    // Record when the relay last heard from the PC. On the LAN path there's no relay
    // stamp (receivedAt=0) — that path's liveness is the just-completed fetch itself.
    if (receivedAt) setRelayReceivedAt(receivedAt);
  }, []);

  // forceProbe must be EXACTLY true (the Refresh button passes a click event).
  const refresh = useCallback(async (forceProbe) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    // Reads the single state blob DeskPhone pushed to the cloud. Private to the
    // signed-in user — gated by a Firebase ID token.
    const fetchViaRelay = async () => {
      let relayIdToken = null;
      try { relayIdToken = user?.getIdToken ? await user.getIdToken() : null; } catch {}
      if (!relayIdToken) throw new Error("relay:no_auth");
      try {
        const relayState = await fetchPhoneJson(
          `${RELAY_BASE}?action=state`,
          PHONE_FETCH_TIMEOUT_MS,
          { Authorization: `Bearer ${relayIdToken}` },
        );
        processCommandResults(relayState?.commandResults);
        return {
          statusRes:   relayState?.status   || null,
          messagesRes: relayState?.messages || [],
          callsRes:    relayState?.calls    || [],
          contactsRes: relayState?.contacts || [],
          receivedAt:  Number(relayState?.relayReceivedAt) || 0,
        };
      } catch (relayErr) {
        const msg = String(relayErr?.message || "");
        if (msg.includes("404")) throw new Error("relay:no_state");
        if (msg.includes("401")) throw new Error("relay:no_auth");
        if (msg.includes("403")) throw new Error("relay:denied");
        throw new Error("relay:fail:" + msg);
      }
    };

    const fetchDirect = async () => {
      const [statusRes, messagesRes, callsRes, contactsRes] = await Promise.all([
        fetchPhoneJson(`${api}/status`, 2500),
        fetchPhoneJson(`${api}/messages?limit=5000`, 2500),
        fetchPhoneJson(`${api}/calls`, 2500).catch(() => null),
        fetchPhoneJson(`${api}/contacts`, 2500).catch(() => null),
      ]);
      return { statusRes, messagesRes, callsRes, contactsRes, receivedAt: 0 };
    };

    try {
      setError("");
      let transport = await resolveTransport(forceProbe === true);
      let payload;
      if (transport === "direct") {
        try {
          payload = await fetchDirect();
        } catch (directErr) {
          if (transportMode !== "auto") throw directErr;
          // Auto failover: the PC vanished mid-session (left home, DeskPhone
          // closed) — fall through to the relay within the same cycle.
          transport = "relay";
          lastProbeAtRef.current = Date.now();
          payload = await fetchViaRelay();
        }
      } else {
        payload = await fetchViaRelay();
      }
      transportRef.current = transport;
      usingRelayRef.current = transport === "relay";
      setUsingRelay(transport === "relay");
      applyPhoneState(payload.statusRes, payload.messagesRes, payload.callsRes, payload.contactsRes, payload.receivedAt);
    } catch (e) {
      setStatus(null); setMessages([]); setCalls([]); setRelayReceivedAt(0);
      messagesSigRef.current = ""; callsSigRef.current = ""; contactsSigRef.current = "";
      transportRef.current = null;   // both paths failed — re-resolve from scratch next cycle
      const msg = String(e?.message || "");
      setError(
        msg === "relay:no_state"
          ? "Waiting for your PC — open DeskPhone so it can relay your texts."
          : msg === "relay:no_auth"
            ? "Sign in to see your phone here."
            : msg === "relay:denied"
              ? "Phone relay blocked by security rules."
              : msg.startsWith("relay:fail")
                ? "Cloud relay unreachable — try again in a moment."
                : "Can't reach DeskPhone — make sure it's running on your PC.");
      usingRelayRef.current = false;
      setUsingRelay(false);
      onOnlineChange?.(false);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [api, transportMode, resolveTransport, onOnlineChange, user, applyPhoneState, processCommandResults]);

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

  // On relay transport the onSnapshot listener (below) delivers updates in real time —
  // no REST poll needed, and polling would hit the Netlify function ~13k times/day for nothing.
  // On direct LAN transport there is no listener, so the poll stays.
  useEffect(() => {
    refresh();
    if (usingRelay) return;
    const id = setInterval(refresh, 6500);
    return () => clearInterval(id);
  }, [refresh, usingRelay]);

  // Waking the tab (or unlocking the laptop) re-resolves the best path right
  // away — back at the PC means direct, on the road means relay, no clicks.
  useEffect(() => {
    const onWake = () => { if (document.visibilityState !== "hidden") refresh(true); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [refresh]);

  // Re-evaluate relay freshness on a clock even when no new data arrives, so the
  // "Live" indicator flips to "PC offline" once the PC stops heartbeating.
  useEffect(() => {
    if (!usingRelay) return undefined;
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, [usingRelay]);

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
        // IGNORE cache emissions. The Firestore SDK replays a locally-cached copy of
        // the doc first (snap.metadata.fromCache) — which on a phone can be a STALE,
        // empty snapshot (e.g. cached before DeskPhone first pushed). Applying it would
        // destructively wipe the fresh data the REST poll just loaded, leaving a green
        // "connected" icon over an empty feed. Trust only server snapshots; the 6.5s
        // REST poll is the baseline. (Same hard-won lesson as Store.listenShailos.)
        if (snap.metadata.fromCache) return;
        const raw = snap.data()?.data;
        if (!raw) return;
        let blob;
        try { blob = JSON.parse(raw); } catch { return; }
        applyPhoneState(blob.status, blob.messages, blob.calls, blob.contacts, Number(blob.relayReceivedAt) || 0);
        processCommandResults(blob.commandResults);
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
  }, [usingRelay, user, applyPhoneState, processCommandResults]);

  // Returns true only when DeskPhone confirmed the command ran (or, on the LAN path,
  // when its HTTP response said so). Callers use this to decide whether user input
  // (e.g. a typed message) is safe to discard. NOTE: refresh() clears the error
  // banner, so failure paths refresh FIRST and set their error after.
  const post = async (path, label) => {
    setBusy(label);
    try {
      if (usingRelayRef.current) {
        // Route command through the cloud relay — DeskPhone drains it within 2 s.
        // Include Firebase ID token so the function can gate on auth.
        let cmdAuthHeaders = {};
        try {
          if (user?.getIdToken) {
            const tok = await user.getIdToken();
            cmdAuthHeaders["Authorization"] = `Bearer ${tok}`;
          }
        } catch {}
        const res = await fetch(`${RELAY_BASE}?action=command`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...cmdAuthHeaders },
          body: JSON.stringify({ path }),
        });
        if (!res.ok) {
          let msg = `Relay rejected the command (${res.status})`;
          try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
          setError(msg);
          return false;
        }
        const queued = await res.json().catch(() => ({}));
        if (queued?.id) {
          // Await DeskPhone's acknowledgement — it rides the state pushes we already
          // receive (~3 s round trip). No ack within 25 s means the PC is offline.
          const ack = await waitForAck(queued.id, 25000);
          await refresh();
          if (ack && !ack.ok) {
            setError(ack.error || "DeskPhone could not run the command.");
            return false;
          }
          if (!ack) {
            setError("No confirmation from DeskPhone — your PC looks offline. The command runs if it reconnects within 10 minutes, then expires.");
            return false;
          }
          setError("");
          return true;
        }
        // Relay without command ids (older function) — keep the legacy blind wait.
        setError("");
        await new Promise(r => setTimeout(r, 2500));
      } else {
        const res = await fetch(`${api}${path}`, { method: "POST" });
        if (!res.ok) {
          let msg = `DeskPhone error (${res.status})`;
          try { const d = await res.json(); if (d?.error || d?.message) msg = d.error || d.message; } catch {}
          await refresh();
          setError(msg);
          return false;
        }
        const data = await res.json().catch(() => ({}));
        if (data?.success === false || data?.ok === false || data?.result === "failed") {
          await refresh();
          setError(data?.error || data?.message || data?.reason || "DeskPhone reported failure.");
          return false;
        }
        setError("");
      }
      await refresh();
      return true;
    }
    catch {
      setError("DeskPhone did not answer.");
      transportRef.current = null;   // direct path died mid-command — re-resolve next cycle
      onOnlineChange?.(false);
      return false;
    }
    finally { setBusy(""); }
  };

  const dialNum = async (n) => { if (n?.trim()) await post(`/dial?n=${encodeURIComponent(n.trim())}`, "dial"); };
  const dial = () => dialNum(number);
  const sendSms = async () => {
    const to = selected?.number || number;
    if (!to?.trim() || !body.trim()) return;
    const ok = await post(`/send?to=${encodeURIComponent(to.trim())}&body=${encodeURIComponent(body.trim())}`, "send");
    // Only discard the draft once DeskPhone confirmed the send — on failure the
    // text stays in the compose box so nothing the user typed is ever lost.
    if (ok) { setBody(""); closeCompose(); }
  };

  // Normalize callState so "Idle", "None", "Available" etc. all collapse to "" (shows "Connected · device")
  const callStateRaw = status?.CallState || status?.callState || status?.CurrentCallState || status?.currentCallState || "";
  const callState = /^(idle|none|available|ready|standby|free|disconnected|inactive)$/i.test(callStateRaw.trim()) ? "" : callStateRaw.trim();
  const isIncoming = /ring|incoming/i.test(callState);
  const isOnCall = !!callState && !isIncoming && /^(active|dialing|oncall|callactive)$/i.test(callState.replace(/\s+/g, ""));
  const statusOnline = !!status;
  // Relay liveness: on mobile the green light means the PC is *currently* pushing — i.e.
  // the relay heard from it within RELAY_LIVE_WINDOW_MS. A stale stamp = PC/DeskPhone
  // closed, so incoming texts/calls are NOT reaching this device live. On the LAN path
  // there's no relay; liveness is simply whether the just-completed /status fetch worked.
  const relayAgeMs = relayReceivedAt > 0 ? Math.max(0, nowTick - relayReceivedAt) : 0;
  const relayStale = usingRelay && relayReceivedAt > 0 && relayAgeMs >= RELAY_LIVE_WINDOW_MS;
  const phoneLinkLive = usingRelay ? (statusOnline && relayReceivedAt > 0 && !relayStale) : statusOnline;
  const deviceName = status?.deviceName || status?.DeviceName || status?.device || status?.Device || status?.phoneName || status?.PhoneName || "";
  const idleLabel = deviceName ? `Connected · ${deviceName}` : "Connected";
  const statusText = !statusOnline
    ? "DeskPhone offline"
    : relayStale
      ? `PC offline · last seen ${relayAgeLabel(relayAgeMs)} ago`
      : (isIncoming ? "Incoming call" : isOnCall ? "On call" : callState ? "Call status changed" : idleLabel);

  // Report true liveness to the NerveCenter (not just "we have a blob"), and flip it to
  // offline as soon as the relay goes stale, so the dashboard tile can't claim "connected"
  // over data from a PC that closed an hour ago.
  useEffect(() => {
    onOnlineChange?.(phoneLinkLive);
  }, [onOnlineChange, phoneLinkLive]);
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
      .slice(0, 20);
  }, [messages, lookupName]);
  const recentCalls = (Array.isArray(calls) ? calls : []).slice(0, 20);
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
      online: phoneLinkLive,
      tone: relayStale ? "offline" : isIncoming ? "incoming" : isOnCall ? "call" : phoneLinkLive ? "online" : "offline",
      label: callerDisplay && (isIncoming || isOnCall) && !relayStale ? `${isIncoming ? "Incoming" : "On call"}: ${callerDisplay}` : statusText,
      voicemailCount: vmCount,
    });
  }, [onStatusSummary, phoneLinkLive, relayStale, isIncoming, isOnCall, callerDisplay, statusText, vmCount]);
  const phoneIconButton = (active = false) => gvIconButton({
    width: compact ? 28 : 32,
    height: compact ? 28 : 32,
    background: active ? C.hover : "transparent",
    color: active ? C.text : C.muted,
  }, C);
  const phoneRowStyle = {
    display: "grid",
    gridTemplateColumns: dense ? "16px minmax(0,1fr) 26px" : "20px minmax(0,1fr) 30px",
    gap: dense ? "1px 5px" : "4px 7px",
    alignItems: "start",
    padding: dense ? "1px 2px" : (compact ? "4px 2px" : "6px 4px"),
    borderRadius: dense ? 5 : 8,
    minHeight: dense ? 18 : (compact ? 30 : 36),
  };
  const phoneLeadIconStyle = (color, background = "transparent") => ({
    width: dense ? 15 : 18,
    height: dense ? 15 : 18,
    borderRadius: 99,
    background,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color,
    flexShrink: 0,
    lineHeight: 1,
    marginTop: 1,
  });
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
  ].sort((a, b) => b.at - a.at).slice(0, compact ? 12 : 20);

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
  const missedKey = c => {
    const num = (callNumber(c) || "").replace(/[^\d]/g, "").slice(-10);
    const at = callAtMs(c);
    return num && at ? `${num}:${at}` : "";
  };
  const isMissedCallResolved = useCallback(c => {
    if (callKindLabel(c) !== "missed") return false;
    const mKey = missedKey(c);
    if (mKey && resolvedMissed.has(mKey)) return true;
    const num = callNumber(c);
    const missedAt = callAtMs(c);
    if (!num || !missedAt) return false;
    // Check full calls array (not just the sliced recentCalls) so calls handled
    // earlier in a long history still count as resolving a missed call.
    const allCalls = Array.isArray(calls) ? calls : [];
    const laterHandledCall = allCalls.some(other => {
      if (other === c || callKindLabel(other) === "missed") return false;
      return callAtMs(other) > missedAt && phoneKeyMatch(callNumber(other), num);
    });
    if (laterHandledCall) return true;
    return (Array.isArray(messages) ? messages : []).some(message =>
      isOutgoingMessage(message) &&
      messageTimeMs(message) > missedAt &&
      phoneKeyMatch(messagePeerNumber(message), num)
    );
  }, [calls, messages, resolvedMissed]);
  const actionableMissedCalls = recentCalls.filter(c => callKindLabel(c) === "missed" && !isMissedCallResolved(c));

  const phoneActivitySnapshot = useMemo(() => ({
    online: phoneLinkLive,
    stale: relayStale,
    status: statusText,
    unreadTexts: threads.reduce((sum, thread) => sum + (thread._unreadCount || 0), 0),
    missedCalls: actionableMissedCalls.length,
    voicemailCount: vmCount,
    texts: threads.slice(0, 6).map(thread => {
      const latest = thread._latestMessage || thread._messages?.[thread._messages.length - 1] || {};
      const body = messageBody(latest);
      // Condense to ≤4 words so the summary line stays scannable.
      const words = body.replace(/\s+/g, " ").trim().split(" ");
      const shortPreview = words.length <= 4 ? body : words.slice(0, 4).join(" ") + "…";
      return {
        name: thread._name || thread._who || "Unknown",
        preview: shortPreview,
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
  }), [phoneLinkLive, relayStale, statusText, threads, recentCalls, actionableMissedCalls.length, vmCount, lookupName, messages, resolvedMissed]);

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

  // ── One phone screen everywhere ──────────────────────────────────────────
  // When this desktop browser reaches DeskPhone directly, the full phone view
  // embeds the exact UI DeskPhone itself serves (?standalone=deskphone) instead
  // of this summary surface — identical pixels in the webapp and on the PC.
  // All hooks above keep running, so the poll still detects the PC going away,
  // flips the transport to relay, and this falls back to the built-in surface
  // transparently. Compact/dense NerveCenter cards always keep the summary UI.
  // Chromium-only by design: a browser that blocks HTTP-loopback iframes from
  // an HTTPS page also fails the direct probe, so it never reaches this branch.
  if (!compact && !dense && !isMobile && !usingRelay && status) {
    return (
      <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, display: "flex",
        animation: `nc-phone-surface-fade ${DUR.base} ${EASE.standard}` }}>
        <iframe
          src={`${api}/?standalone=deskphone`}
          style={{ width: "100%", height: "100%", border: "none", borderRadius: 0, display: "block" }}
          title="DeskPhone"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dense ? 2 : (compact ? 6 : 12), minWidth: 0, flex: "1 1 auto", minHeight: 0, overflow: "hidden", color: C.text, animation: `nc-phone-surface-fade ${DUR.base} ${EASE.standard}` }}>

      {(isIncoming || isOnCall || vmCount > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, minHeight: dense ? 20 : (compact ? 28 : 36), padding: "0 2px" }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: isIncoming ? C.success : isOnCall ? C.warning : C.danger }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: compact ? 13 : 14, fontWeight: 500, color: isIncoming ? C.success : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {callerDisplay && (isIncoming || isOnCall) ? `${isIncoming ? "Incoming" : "On call"} · ${callerDisplay}` : `${vmCount} voicemail${vmCount === 1 ? "" : "s"}`}
          </span>
        </div>
      )}

      {/* ── PC-link status banner (any relay browser) — tells you whether your PC is
            actually connected right now, so you know live texts/calls are arriving. On the
            compact nerve-center card this is suppressed (the card's summary line already
            states online/offline); it only shows in the full phone view. ── */}
      {usingRelay && !compact && (
        relayStale ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, lineHeight: 1.4, color: C.warning, background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: 8, padding: "8px 10px" }}>
            <span style={{ marginTop: 1, flexShrink: 0, color: C.warning }}>{suiteIcon("cloud_off", 16)}</span>
            <span>Your PC looks offline — last update {relayAgeLabel(relayAgeMs)} ago. New texts &amp; calls won't arrive here until DeskPhone reconnects on your PC.</span>
          </div>
        ) : phoneLinkLive ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: C.success, padding: "0 2px" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: C.success }} />
            <span>Live · connected to your PC{deviceName ? ` · ${deviceName}` : ""}</span>
          </div>
        ) : null
      )}

      {composeOpen && !composeAnchorId && renderComposeBox()}

      {/* ── Control bar: answer/hangup | record | new-msg | keypad toggle ──
            On the compact card this whole row of PC-oriented controls is hidden so the
            activity feed gets the space; it returns only for a live/incoming call (where
            answer/hang-up matter). Full controls live in the expanded phone view. ── */}
      {(!compact || isIncoming || isOnCall) && (
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
        {/* Transport pill — the ONE connection control. Shows how this browser
            reaches the phone (direct on this PC, or cloud relay) and how live it
            is; click it to pin a path if Auto ever guesses wrong. */}
        <span style={{ position: "relative", flexShrink: 0 }}>
          <button onClick={() => setShowTransportMenu(v => !v)}
            title={
              (usingRelay
                ? (phoneLinkLive ? "Connected through the cloud relay"
                  : relayStale ? `PC offline — last update ${relayAgeLabel(relayAgeMs)} ago`
                    : "Waiting for your PC via the cloud relay")
                : (phoneLinkLive ? "Connected directly to DeskPhone on this PC" : "Looking for DeskPhone…"))
              + (transportMode === "auto" ? " · automatic" : " · pinned — click to change")
            }
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
              border: "none", background: "transparent", cursor: "pointer",
              color: phoneLinkLive ? C.success : relayStale ? C.warning : C.faint, padding: "0 4px" }}>
            {suiteIcon(usingRelay ? (phoneLinkLive ? "cloud" : "cloud_off") : "computer", 15)}
            <span>{phoneLinkLive ? (usingRelay ? "Live · cloud" : "This PC") : relayStale ? relayAgeLabel(relayAgeMs) : "…"}</span>
          </button>
          {showTransportMenu && (
            <div style={{ position: "absolute", right: 0, bottom: "calc(100% + 6px)", zIndex: 60, minWidth: 200,
              background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 10,
              boxShadow: "0 6px 24px rgba(0,0,0,.28)", padding: 6 }}>
              {[["auto", "Auto (recommended)", "Direct when this browser can reach your PC, cloud relay otherwise"],
                ["direct", "This PC only", "Always talk to DeskPhone on this machine"],
                ["relay", "Cloud relay only", "Always go through the cloud"]].map(([val, label, hint]) => (
                <button key={val} title={hint}
                  onClick={() => { setTransportMode(val); setShowTransportMenu(false); refresh(true); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    fontSize: 12, padding: "7px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                    background: transportMode === val ? C.bgSoft : "transparent",
                    color: C.text, fontWeight: transportMode === val ? 700 : 400 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0,
                    background: transportMode === val ? C.success : C.divider }} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </span>
      </div>
      )}

      {/* ── Dialer — only when keypad is open (never on the compact card) ── */}
      {showDialer && !compact && (
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
                    <span style={phoneLeadIconStyle(isUnread ? C.accent : msgColor, isUnread ? C.hover : "transparent")}>{suiteIcon(msgIcon, 14)}</span>
                    <button onClick={() => setExpandedPhoneMessageId(expanded ? null : actionId)} style={{ minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, color: T.text }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                        <span style={{ flex: 1, fontSize: NC_TYPE.control, lineHeight: NC_TYPE.line, fontWeight: isUnread ? 600 : 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread._name}</span>
                        {time && <span style={{ fontSize: NC_TYPE.meta, color: C.muted, flexShrink: 0, fontWeight: 400 }}>{time}</span>}
                      </div>
                      {preview && !expanded && <span style={{ display: "block", fontSize: NC_TYPE.meta, color: C.muted, marginTop: 0, whiteSpace: compact ? "nowrap" : "normal", overflow: compact ? "hidden" : undefined, textOverflow: compact ? "ellipsis" : undefined, wordBreak: compact ? "normal" : "break-word", lineHeight: NC_TYPE.line }}>{preview}</span>}
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
                      <div style={{ gridColumn: "2 / 4", fontSize: NC_TYPE.meta, lineHeight: NC_TYPE.line, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "0 4px 4px 0" }}>
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
                            // DeskPhone stamps in-flight/failed sends ("Sending", "Confirming",
                            // "Failed") and the blob carries it — surface it on outgoing bubbles
                            // so a failed send is visible remotely, not only on the PC.
                            const sendStatus = String(msg.sendStatus || msg.SendStatus || "").trim();
                            const sendFailed = /fail/i.test(sendStatus);
                            return (
                              <div key={`${thread._who}-${messageTimeMs(msg)}-${msgIdx}`} style={{ alignSelf: outgoing ? "flex-end" : "flex-start", maxWidth: "92%", minWidth: 0 }}>
                                <div style={{ borderRadius: 8, border: `1px solid ${outgoing ? (sendFailed ? C.danger : "transparent") : C.divider}`, background: outgoing ? C.hover : C.bgSoft, color: C.text, padding: "7px 9px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                  {msgText && linkedMessageParts(msgText, { color: C.accent })}
                                  {(msg.attachments || []).filter(a => a.isImage).map((a, ai) => (
                                    <PhoneMmsImage key={a.mediaId || ai} attachment={a} C={C} />
                                  ))}
                                  {!msgText && !(msg.attachments || []).some(a => a.isImage) && "(no text)"}
                                </div>
                                {(msgTime || (outgoing && sendStatus)) && (
                                  <div style={{ fontSize: 11, color: C.faint, marginTop: 2, textAlign: outgoing ? "right" : "left" }}>
                                    {outgoing && sendStatus && (
                                      <span style={{ color: sendFailed ? C.danger : C.faint, fontWeight: sendFailed ? 600 : 400 }}>
                                        {msg.sendStatusLabel || msg.SendStatusLabel || sendStatus}{msgTime ? " · " : ""}
                                      </span>
                                    )}
                                    {msgTime}
                                  </div>
                                )}
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
                const isMissed = callKindLabel(c) === "missed";
                const mKey = missedKey(c);
                const resolved = isMissed && isMissedCallResolved(c);
                const needsCallback = isMissed && !resolved;
                return (
                  <div key={`call-${idx}`} className="nc-action-row" style={{ ...phoneRowStyle, gridTemplateColumns: "20px minmax(0,1fr) auto", opacity: resolved ? 0.62 : 1 }}>
                    <span style={phoneLeadIconStyle(color)}>{suiteIcon(icon, 14)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                        <span style={{ flex: 1, fontSize: NC_TYPE.control, lineHeight: NC_TYPE.line, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                        {time && <span style={{ fontSize: NC_TYPE.meta, color: C.muted, flexShrink: 0, fontWeight: 400 }}>{time}</span>}
                      </div>
                      {needsCallback ? (
                        <span style={{ display: "inline-block", marginTop: 1, fontSize: NC_TYPE.small, lineHeight: 1.15, fontWeight: 700, color: C.danger, background: C.bgSoft, borderRadius: 99, padding: "1px 6px" }}>Needs callback</span>
                      ) : resolved ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 1, fontSize: NC_TYPE.small, lineHeight: 1.15, fontWeight: 600, color: C.success }}>{suiteIcon("check_circle", 11)} Resolved</span>
                      ) : (num && num !== name && <span style={{ display: "block", fontSize: NC_TYPE.meta, color: C.muted, marginTop: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: NC_TYPE.line }}>{num}</span>)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                      {/* Direct resolve/reopen toggle for missed calls — one tap, no menu. */}
                      {isMissed && mKey && (resolved
                        ? <button onClick={e => { e.stopPropagation(); toggleMissedResolved(mKey, false); }} title="Reopen missed call" aria-label="Reopen missed call" style={phoneIconButton(false)}>{suiteIcon("undo", 16)}</button>
                        : <button onClick={e => { e.stopPropagation(); toggleMissedResolved(mKey, true); }} title="Mark resolved" aria-label="Mark resolved" style={{ ...phoneIconButton(false), color: C.success }}>{suiteIcon("check_circle", 17)}</button>)}
                      <button onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionsOpen ? null : actionId); }} title={actionsOpen ? "Hide actions" : "Show actions"} aria-label={actionsOpen ? "Hide actions" : "Show actions"} style={phoneIconButton(actionsOpen)}>
                        {suiteIcon("more_horiz", 17)}
                      </button>
                    </div>
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

      {/* Compact card always shows a status dot — even with no texts/calls — so the phone's
          live/stale/offline state is visible at a glance instead of a blank card. */}
      {compact && !error && !(statusOnline && (hasMessages || hasCalls)) && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 4px", fontSize: 13, color: C.muted, fontFamily: NC_FONT_STACK, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: phoneLinkLive ? C.success : relayStale ? C.warning : C.faint }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{phoneLinkLive ? "Connected · no recent calls or texts" : relayStale ? `PC offline · ${relayAgeLabel(relayAgeMs)}` : "DeskPhone offline"}</span>
        </div>
      )}
      {!statusOnline && !error && !compact && <div style={{ fontSize: 13, color: C.muted, padding: "6px 2px" }}>Open DeskPhone to connect calls and texts.</div>}
      {error && <div style={{ fontSize: 13, color: C.danger, background: C.bgSoft, borderRadius: 8, padding: "8px 10px", marginTop: 2 }}>{error}</div>}
    </div>
  );
}

export { NerveCenterPhoneSurface };
