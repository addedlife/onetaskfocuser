import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, DUR, EASE, ELEV, ICON, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon, useViewportWidth } from '../ui-tokens.jsx';
import { ActionBtn, AssistChip, IconBtn, ListItem, denseListVars } from '../m3.jsx';
import { db } from '../../01-core.js';
import { subscribeOwner } from '../phone-host-control.js';
import { derivePhoneLinkState, describePhoneLink, formatAgeShort, messageListSignature, mergeMessageFeeds, mergeCallFeeds } from '../phone-link.js';
import {
  addPendingSms, updatePendingSms, getPendingSms, subscribePendingSms,
  reconcilePendingSms, unmatchedPendingSms, collapseHostDoubles, smsBodyKey, smsPhoneKey,
} from '../utils/pending-sms.js';

const DIALER_KEYS = ["1","2","3","4","5","6","7","8","9","*","0","#"];
const PHONE_FETCH_TIMEOUT_MS = 4500;
// All liveness/staleness windows and age labels live in phone-link.js — the
// shared state machine both phone surfaces derive from.

// True on a real phone/tablet (Android, iPhone, iPad) — by user-agent and touch,
// NOT by window width, so a narrow desktop window is still treated as desktop.
// Mobile devices use the cloud relay; loopback is only useful when the host
// runs on this same browser device.
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

// Relay-only fetch: authenticates with the Firebase bearer token passed in
// extraHeaders. (The old `host` pairing-auth parameter left with the loopback path.)
async function fetchPhoneJson(url, timeoutMs = PHONE_FETCH_TIMEOUT_MS, extraHeaders = {}) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      cache: "no-store", signal: controller?.signal, headers: extraHeaders,
    });
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
      style={{ maxWidth: "100%", maxHeight: 280, borderRadius: RADIUS.xs, marginTop: 4, display: "block", objectFit: "contain" }} />;
  }
  return <div style={{ fontSize: 12, color: C.faint, padding: "4px 0", display: "flex", alignItems: "center", gap: 4 }}>
    {suiteIcon("image", 14)} {failed ? "image unavailable" : "loading image…"}
  </div>;
}

function NerveCenterPhoneSurface({ T, user = null, onOnlineChange, onStatusSummary, onActivitySnapshot, compact = false, dense = false, onRecordConversation, onRecordCall, onMoreHistory }) {
  // ONE simple rule (no LAN discovery, no proxies — that experiment was dizzying):
  // if a phone host is running on THIS device (loopback answers), talk to it
  // directly; otherwise read the cloud relay, which is fed by whichever host
  // holds the phone's Bluetooth link. DeskPhone stays available as a fallback,
  // but the daily product path is the tablet phone link.
  const isMobile = useMemo(() => isMobilePhoneDevice(), []);
  const phoneDiag = useMemo(() => {
    try { return /[?&]phonediag=1/.test(window.location.search); } catch { return false; }
  }, []);
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
  // Optimistic outgoing texts (shared module state) — render instantly as
  // "Sending…" bubbles and vanish once the host reports its own copy.
  const [pendingEchoes, setPendingEchoes] = useState(() => getPendingSms());
  useEffect(() => subscribePendingSms(list => setPendingEchoes(list)), []);
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
  // Cloud-only client: the relay is THE transport, not one of two (see the
  // pure-cloud note below). Kept as a const so the shared state machine and the
  // diag overlay still name their mode explicitly.
  const usingRelay = true;
  // Server-stamped time the relay last received a push from a live phone host.
  // Drives the live/stale connection indicator on relay devices.
  const [relayReceivedAt, setRelayReceivedAt] = useState(0);
  // Owner control doc — the preferred host plus the ACTIVE host's heartbeat.
  // `present` is false until a rebuilt host first writes it, so liveness cleanly
  // falls back to the state-doc stamp during rollout.
  const [owner, setOwner] = useState({ preferred: 'tablet', host: '', t: 0, connected: false, present: false, hosts: {} });
  // Ticks so staleness re-evaluates over time even when no new data arrives.
  const [nowTick, setNowTick] = useState(() => Date.now());
  // When the last successful fetch completed — drives loopback-path liveness
  // (a dead local host has no heartbeat doc to go stale).
  const lastFetchOkAtRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  // True while the visible error came from the transport layer (a failed relay
  // fetch). Live data arriving via the Firestore listener proves the link works,
  // so it may clear THESE errors — but never a command failure the user must see.
  const errorIsTransportRef = useRef(false);
  const expandedConversationEndRef = useRef(null);
  const composeBodyRef = useRef(null);
  const messagesSigRef = useRef("");
  const callsSigRef = useRef("");
  const contactsSigRef = useRef("");
  // Session-scoped retention caches for the handoff union-merge (phone-link.js).
  const messagesCacheRef = useRef([]);
  const callsCacheRef = useRef([]);
  // Optimistic hang-up: suppress a lagging host "Active" callState after the
  // user pressed Hang up, until the host reports a NEW state (ticket 0kti1vt).
  const callSuppressRef = useRef(null);
  const C = cleanTheme(T);
  const RELAY_BASE = "/api/phone-relay";

  // ── Transport resolution — fully automatic, no user modes ─────────────────
  // The web app is a PURE CLOUD CLIENT (owner decision 7/10/26): every browser
  // reads the one relay state blob fed by whichever host holds the phone, and
  // queues commands through the one cloud mailbox — identical behavior on the
  // PC, iPad, tablet, and phone, no loopback probing, no dual transports. The
  // local surface for the PC-holds-the-phone case is DeskPhone's own window.
  const failStreakRef = useRef(0);

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
    const incomingMessages = Array.isArray(parsed) ? parsed : (parsed?.messages || []);
    const callsParsed = callsRes || [];
    const incomingCalls = Array.isArray(callsParsed) ? callsParsed : (callsParsed?.calls || nextStatus?.recentCalls || []);
    const contactsParsed = contactsRes || [];
    const nextContacts = Array.isArray(contactsParsed) ? contactsParsed : (contactsParsed?.contacts || []);
    setStatus(nextStatus);
    // Retention merge (phone-link.js): a freshly handed-to host re-syncs its
    // store from the phone over minutes — union its (small) list with what we
    // already showed so history never wipes-and-refills across a handoff.
    const nextMessages = mergeMessageFeeds(messagesCacheRef.current, incomingMessages);
    messagesCacheRef.current = nextMessages;
    const nextCalls = mergeCallFeeds(callsCacheRef.current, incomingCalls);
    callsCacheRef.current = nextCalls;
    // Full-list signature (id + send status + read state of EVERY message) —
    // the old length+endpoints check missed a mid-list Confirming→Sent flip,
    // so a send could stay visually "Confirming" long after it confirmed.
    const msgSig = messageListSignature(nextMessages);
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
    // Record when the relay last heard from the active host. On the local path there's no relay
    // stamp (receivedAt=0) — that path's liveness is the just-completed fetch itself.
    if (receivedAt) setRelayReceivedAt(receivedAt);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    // Reads the single state blob the active phone host pushed to the cloud. Private to the
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

    try {
      const payload = await fetchViaRelay();
      failStreakRef.current = 0;
      lastFetchOkAtRef.current = Date.now();
      setNowTick(Date.now());   // re-derive liveness immediately on fresh data
      errorIsTransportRef.current = false;
      setError("");
      applyPhoneState(payload.statusRes, payload.messagesRes, payload.callsRes, payload.contactsRes, payload.receivedAt);
    } catch (e) {
      const msg = String(e?.message || "");
      failStreakRef.current += 1;
      const hardFail = failStreakRef.current >= 3 || !messagesSigRef.current;
      // NEVER-BLANK RULE: the last-known feed stays on screen no matter how
      // long the outage — data with an honest age label always beats a screen
      // that empties and refills (that vanish/reappear cycle IS the "glitchy"
      // feeling). The state machine flips the status line to Offline on its
      // own as the heartbeat/fetch freshness lapses.
      if (hardFail) onOnlineChange?.(false);
      const setTransportError = text => { errorIsTransportRef.current = true; setError(text); };
      if (msg === "relay:no_state") setTransportError("Waiting for a phone host — start Shamash Phone Link on the tablet or DeskPhone on the PC.");
      else if (msg === "relay:no_auth") setTransportError("Sign in to see your phone here.");
      else if (msg === "relay:denied") setTransportError("Phone relay blocked by security rules.");
      else if (hardFail && !messagesSigRef.current) setTransportError("Can't reach the phone link — make sure a phone host (tablet or PC) is running.");
      // With data on screen, transient failures stay QUIET — the status line
      // already reads Connecting/Offline; a red banner over a visible feed is
      // two contradictory truths at once (owner ticket 7/9).
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [onOnlineChange, user, applyPhoneState, processCommandResults]);

  // Build phone-number → name map from contacts, covering many possible field names from the phone host API
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

  // One fetch on mount seeds the surface; from then on the onSnapshot listener
  // (below) delivers updates in real time — no REST poll, no idle function hits.
  useEffect(() => { refresh(); }, [refresh]);

  // Waking the tab (or unlocking the laptop) refreshes right away — no clicks.
  useEffect(() => {
    const onWake = () => { if (document.visibilityState !== "hidden") refresh(true); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [refresh]);

  // Re-evaluate freshness on a clock even when no new data arrives, so the
  // "Live" indicator flips offline once the heartbeat (relay) or the last
  // successful fetch (loopback) lapses. Always on — both paths need it now.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Owner control doc — one small doc, one listener. Feeds the plain-language
  // status line (Connected/Connecting/Offline) and the tablet-vs-PC label.
  useEffect(() => {
    const unsub = subscribeOwner(setOwner);
    return () => { try { unsub && unsub(); } catch (_) {} };
  }, []);

  // ── Real-time relay: when we're on the cloud relay,
  // subscribe to the phone-relay/state doc directly instead of relying only on the
  // 6.5 s poll. The active host pushes the instant a text arrives, so this lands the
  // update on every signed-in device in ~1 s. The poll above stays as a safety net.
  //
  // A Firestore onSnapshot listener is TERMINAL after its error callback fires (it
  // never reconnects itself), so — exactly like Store.listenShailos — we tear down
  // and resubscribe on capped exponential backoff so a transport drop self-heals.
  useEffect(() => {
    if (!db || !user) return;
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
        // A server snapshot IS a working transport. Without this, a few failed
        // REST fetches at mount left a "Can't reach the phone link" banner
        // sitting over a live feed forever (owner ticket 7/12 — tablet browser).
        failStreakRef.current = 0;
        lastFetchOkAtRef.current = Date.now();
        if (errorIsTransportRef.current) {
          errorIsTransportRef.current = false;
          setError("");
        }
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
  }, [user, applyPhoneState, processCommandResults]);

  // Returns true only when the active phone host confirmed the command ran (or, on the LAN path,
  // when its HTTP response said so). Callers use this to decide whether user input
  // (e.g. a typed message) is safe to discard. NOTE: refresh() clears the error
  // banner, so failure paths refresh FIRST and set their error after.
  //
  // opts.background: don't hold the whole surface busy and don't write the
  // global error banner — report failures through opts.onError instead. Sends
  // use this so the compose UI never freezes while a command round-trips
  // (owner ticket: "the text just freezes for 5 seconds").
  const post = async (path, label, opts = {}) => {
    // Command failures are NOT transport errors — the listener must never
    // auto-clear them, the user needs to see the command didn't run.
    const fail = msg => { if (opts.background) opts.onError?.(msg); else { errorIsTransportRef.current = false; setError(msg); } };
    if (!opts.background) setBusy(label);
    try {
      // Route command through the cloud relay — the active host drains it.
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
        fail(msg);
        return false;
      }
      const queued = await res.json().catch(() => ({}));
      if (queued?.id) {
        // Await the host acknowledgement — it rides the state pushes we already
        // receive. No ack within 25 s means no live host accepted the command.
        const ack = await waitForAck(queued.id, 25000);
        await refresh();
        if (ack && !ack.ok) {
          fail(ack.error || "The phone host could not run the command.");
          return false;
        }
        if (!ack) {
          fail("No confirmation from the phone host. The command will expire if the phone link stays offline.");
          return false;
        }
        if (!opts.background) setError("");
        return true;
      }
      // Relay without command ids (older function) — keep the legacy blind wait.
      if (!opts.background) setError("");
      await new Promise(r => setTimeout(r, 2500));
      await refresh();
      return true;
    }
    catch {
      fail("The phone host did not answer.");
      onOnlineChange?.(false);
      return false;
    }
    finally { if (!opts.background) setBusy(""); }
  };

  // The ONE reconnect control: ask the active phone host to re-establish the
  // Bluetooth link (the relay whitelist maps /refresh to a full re-sync + push).
  const reconnectPhone = async () => {
    await post("/refresh", "reconnect");
    await refresh(true);
  };

  const dialNum = async (n) => { if (n?.trim()) await post(`/dial?n=${encodeURIComponent(n.trim())}`, "dial"); };
  const dial = () => dialNum(number);

  // Fire-and-track send: the echo bubble carries the outcome ("Sending…" →
  // sent, or "Failed" + Retry), so the composer never blocks and nothing the
  // user typed is ever lost — a failed text lives on in the thread, retryable.
  const sendSmsInBackground = (to, text, existingEchoId = null) => {
    let echoId = existingEchoId;
    if (echoId) updatePendingSms(echoId, { status: "sending", error: "", at: Date.now() });
    else echoId = addPendingSms({ to, body: text }).id;
    // `cid` rides to the host, which stamps it as the message's own id — the
    // blob copy then matches this echo EXACTLY (no fuzzy dedupe needed).
    post(`/send?to=${encodeURIComponent(to)}&body=${encodeURIComponent(text)}&cid=${encodeURIComponent(echoId)}`, "send", {
      background: true,
      onError: msg => updatePendingSms(echoId, { status: "failed", error: msg || "Failed" }),
    }).then(ok => { if (ok) updatePendingSms(echoId, { status: "sent" }); });
  };

  const sendSms = () => {
    const to = (selected?.number || number).trim();
    const text = body.trim();
    if (!to || !text) return;
    // Owner ticket: the sent text and its sending status appear in the thread
    // IMMEDIATELY — no frozen compose box while the relay round-trips.
    setBody("");
    closeCompose();
    sendSmsInBackground(to, text);
  };

  // Normalize callState so "Idle", "None", "Available" etc. all collapse to "" (shows "Connected · device")
  const callStateRaw = status?.CallState || status?.callState || status?.CurrentCallState || status?.currentCallState || "";
  const callState = /^(idle|none|available|ready|standby|free|disconnected|inactive)$/i.test(callStateRaw.trim()) ? "" : callStateRaw.trim();
  // Hang-up suppression (owner ticket 0kti1vt): the host's callState can lag the
  // phone by minutes when the call was ended ON the phone itself, so the card
  // kept showing "On call". Pressing Hang up now optimistically clears the call
  // UI; the suppression self-lifts the moment the host reports any NEW state
  // (fresh call, ring, or clean idle), or after 90 s regardless.
  const suppressedCall = !!(callSuppressRef.current
    && callSuppressRef.current.raw === callStateRaw
    && nowTick < callSuppressRef.current.until);
  const isIncoming = !suppressedCall && /ring|incoming/i.test(callState);
  const isOnCall = !suppressedCall && !!callState && !isIncoming && /^(active|dialing|oncall|callactive)$/i.test(callState.replace(/\s+/g, ""));
  const statusOnline = !!status;
  // A raw Bluetooth address ("7E4B46E95FBA") is plumbing, not a phone name — never show it.
  const deviceNameRaw = status?.deviceName || status?.DeviceName || status?.device || status?.Device || status?.phoneName || status?.PhoneName || "";
  const deviceName = /^[0-9a-f]{12}$/i.test(String(deviceNameRaw).trim().replace(/[:\-]/g, "")) ? "" : deviceNameRaw;
  const idleLabel = deviceName ? `Connected · ${deviceName}` : "Connected";
  const hasFeedData = (Array.isArray(messages) && messages.length > 0) || (Array.isArray(calls) && calls.length > 0);

  // ── The one status truth ──────────────────────────────────────────────────
  // All liveness/staleness/wording comes from the shared state machine in
  // phone-link.js — the DeskPhone web page derives from the SAME machine, so
  // the two surfaces can no longer disagree about whether the link is up.
  const link = derivePhoneLinkState({
    now: nowTick,
    usingRelay,
    statusOnline,
    hasData: hasFeedData,
    owner,
    relayReceivedAt,
  });
  const relayStale = link.stale;
  const phoneLinkLive = link.live;
  // Which machine holds the phone right now — the owner doc is authoritative
  // when present; else infer from the state blob.
  const activeHostLabel = link.activeHostLabel
    || (status?.hostPlatform === "android" ? "ActiveTab" : status?.hostPlatform === "ios" ? "iPad" : statusOnline ? "PC" : "");
  const linkText = describePhoneLink(link, { deviceName, hostFallbackLabel: activeHostLabel });
  const statusText = !phoneLinkLive
    ? linkText.label
    : (isIncoming ? "Incoming call" : isOnCall ? "On call" : callState ? "Call status changed" : idleLabel);
  const linkDotColor = linkText.tone === "ok" ? C.success : linkText.tone === "warn" ? C.warning : C.faint;
  const linkStatusLabel = linkText.label;
  const linkOffline = linkText.showReconnect;

  // Report true liveness to the NerveCenter (not just "we have a blob"), and flip it to
  // offline as soon as the relay goes stale, so the dashboard tile can't claim "connected"
  // over data from a host that closed an hour ago.
  useEffect(() => {
    onOnlineChange?.(phoneLinkLive);
  }, [onOnlineChange, phoneLinkLive]);
  const callerName = status?.callerName || status?.CallerName || status?.callerDisplay || status?.CallerDisplay || status?.callerID || status?.CallerID || "";
  const callerNumber = status?.callerNumber || status?.CallerNumber || status?.incomingNumber || status?.IncomingNumber || status?.callNumber || status?.CallNumber || "";
  const callerDisplay = callerName || (callerNumber ? (lookupName(callerNumber) || callerNumber) : "");
  const vmCount = parseInt(status?.voicemailCount || status?.VoicemailCount || status?.voicemail?.count || 0, 10) || 0;

  // Host-reported outgoing messages in match shape — used to drop echoes the
  // host now covers (its own bubble or the phone's sent-folder copy).
  const hostOutgoing = useMemo(() => (
    (Array.isArray(messages) ? messages : [])
      .filter(isOutgoingMessage)
      .map(m => ({
        cid: String(m?.id ?? m?.localId ?? m?.LocalId ?? ""),
        key: smsPhoneKey(messagePeerNumber(m)),
        bodyKey: smsBodyKey(messageBody(m)),
        timeMs: messageTimeMs(m),
      }))
  ), [messages]);
  useEffect(() => { reconcilePendingSms(hostOutgoing); }, [hostOutgoing]);

  // Feed for the thread builder: host messages, with the hosts' own stuck
  // "Confirming" doubles collapsed, plus any not-yet-covered echo bubbles.
  const messagesForThreads = useMemo(() => {
    const base = collapseHostDoubles(Array.isArray(messages) ? messages : [], {
      groupKey: m => smsPhoneKey(messagePeerNumber(m)),
      bodyKey: m => smsBodyKey(messageBody(m)),
      timeMs: m => messageTimeMs(m),
      isOutgoing: isOutgoingMessage,
      isPending: m => /send|confirm|queue/i.test(String(m?.sendStatus || m?.SendStatus || "")),
    });
    const echoMessages = unmatchedPendingSms(pendingEchoes, hostOutgoing).map(e => ({
      id: `echo-${e.id}`,
      _echoId: e.id,
      to: e.to,
      normalizedPhone: e.key,
      direction: "sent",
      isSent: true,
      body: e.body,
      timestamp: e.at,
      sendStatus: e.status === "failed" ? "Failed" : e.status === "sent" ? "" : "Sending",
      sendStatusLabel: e.status === "failed" ? (e.error || "Failed") : e.status === "sent" ? "" : "Sending…",
    }));
    return echoMessages.length ? [...base, ...echoMessages] : base;
  }, [messages, pendingEchoes, hostOutgoing]);

  const threads = useMemo(() => {
    const threadMap = new Map();
    (Array.isArray(messagesForThreads) ? messagesForThreads : []).forEach(m => {
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
  }, [messagesForThreads, lookupName]);
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
  // Card-density REAL M3 icon button (md-icon-button via m3.jsx IconBtn) —
  // replaces the old raw `<button style={phoneIconButton()}>` lookalikes.
  const PhoneIconBtn = ({ icon, iconSize = 15, active = false, color, ...rest }) => (
    <IconBtn icon={icon} size={compact ? 28 : 32} iconSize={iconSize}
      color={color || (active ? C.text : C.muted)} active={active} activeBg={C.hover} {...rest} />
  );
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
    borderRadius: RADIUS.pill,
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
  const callDirIcon = c => {
    // Numeric type codes: 1=incoming, 2=outgoing/dialed, 3=missed, 4=unknown
    const typeNum = typeof (c.type || c.callType || c.Type || c.CallType) === "number"
      ? (c.type || c.callType || c.Type || c.CallType)
      : null;
    if (c.missed || c.Missed || typeNum === 3) return { icon: "call_missed", color: C.danger };
    const dir = (c.direction || c.Direction || (typeof c.type === "string" ? c.type : "") || (typeof c.callType === "string" ? c.callType : "") || "").toLowerCase();
    if (dir.includes("miss")) return { icon: "call_missed", color: C.danger };
    // Check outgoing BEFORE checking incoming so "outgoing" (contains "in") doesn't misfire
    if (typeNum === 2 || dir.includes("out") || dir.includes("dial") || dir.includes("egress")) return { icon: "call_made", color: C.muted };
    if (typeNum === 1 || dir.includes("incoming") || dir.includes("inbound") || dir.includes("receiv") || dir === "in") return { icon: "call_received", color: C.muted };
    return { icon: "call", color: C.muted };
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

  // Unresolved missed calls are pinned to the top of the feed — the timestamp
  // sort plus the compact 12-item cap could otherwise crowd them out entirely
  // (owner bug report: "missed calls gone from NerveCenter").
  const activityItems = (() => {
    const pinned = [];
    const rest = [];
    recentCalls.forEach((c, idx) => {
      const entry = { kind: "call", item: c, idx, at: callAtMs(c) || 0 };
      (callKindLabel(c) === "missed" && !isMissedCallResolved(c) ? pinned : rest).push(entry);
    });
    threads.forEach((thread, idx) => rest.push({ kind: "message", item: thread, idx, at: thread._latestAt }));
    pinned.sort((a, b) => b.at - a.at);
    rest.sort((a, b) => b.at - a.at);
    // Generous caps — the card is a fixed-height scroll area, so more items FILL
    // tall screens instead of ending the list mid-card over dead whitespace
    // (buglog: "autopopulate to fill the available screen").
    return [...pinned, ...rest].slice(0, Math.max(compact ? 30 : 40, pinned.length));
  })();

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
    if (isOutgoingMessage(m)) return { icon: "outgoing_mail", color: C.muted };
    return { icon: "sms", color: C.muted };
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
    <div style={{ background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, padding: `${SP.sm} ${SP.md}`, display: "flex", flexDirection: "column", gap: SP.sm, ...extraStyle }}>
      {composeIsNew && (
        <div style={{ position: "relative" }}>
          <input value={composeSearch} onChange={e => setComposeSearch(e.target.value)}
            onFocus={() => setComposeFocused(true)}
            onBlur={() => setTimeout(() => setComposeFocused(false), 160)}
            placeholder="Search contact or enter number..."
            autoFocus
            style={{ width: "100%", height: 36, boxSizing: "border-box", padding: `0 ${SP.md}`, borderRadius: RADIUS.pill, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, fontFamily: "system-ui", fontSize: NC_TYPE.body, fontWeight: 400, outline: "none" }} />
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
          <IconBtn icon="close" size={32} iconSize={14} color={C.muted} onClick={closeCompose} title="Close" aria-label="Close" />
        </div>
      )}
      {(!composeIsNew || selected) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 36px", gap: 6, alignItems: "flex-end" }}>
          <textarea ref={composeBodyRef} value={body} onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSms(); } }}
            placeholder="Message..." rows={2}
            style={{ boxSizing: "border-box", borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, padding: `${SP.sm} ${SP.md}`, fontSize: NC_TYPE.body, fontFamily: "system-ui", resize: "none", outline: "none", width: "100%" }} />
          <button onClick={sendSms} disabled={!body.trim() || !!busy || (!selected && !number.trim())}
            style={{ width: 40, height: 40, borderRadius: RADIUS.pill, border: "none", background: body.trim() ? C.accent : "transparent", color: body.trim() ? "#fff" : C.faint, cursor: body.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: `background ${DUR.fast} ${EASE.standard}`, flexShrink: 0 }}>
            {suiteIcon("send", 16)}
          </button>
        </div>
      )}
      {composeIsNew && !selected && (
        <ActionBtn variant="outlined" icon="close" iconSize={13} height={32} labelSize={NC_TYPE.meta} onClick={closeCompose} style={{ alignSelf: "flex-end" }}>Cancel</ActionBtn>
      )}
    </div>
  );

  // Small neutral action button (white/card background) — used on each row
  const AB = ({ icon, title, onClick }) => (
    <ActionBtn variant="tonal" icon={icon} iconSize={14} height={32} labelSize={NC_TYPE.small}
      title={title} aria-label={title}
      onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onClick(); }}>
      {title.replace(" back", "")}
    </ActionBtn>
  );

  // Suggestion list — shared between dialer and compose-new modes
  const SuggestionList = ({ onPick, style = {} }) => suggestions.length === 0 ? null : (
    <div style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, overflow: "hidden", boxShadow: ELEV[3], ...style }}>
      {suggestions.map((s, i) => (
        <button key={i} onMouseDown={e => e.preventDefault()} onClick={() => onPick(s)}
          style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer" }}>
          <span style={{ width: 28, height: 28, borderRadius: RADIUS.pill, background: C.hover, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, flexShrink: 0 }}>{suiteIcon("person", ICON.sm)}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: NC_TYPE.control, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            <span style={{ display: "block", fontSize: NC_TYPE.meta, color: C.muted }}>{s.num}</span>
          </span>
        </button>
      ))}
    </div>
  );

  // (The old "embed DeskPhone's own UI over loopback" branch is gone — the web
  // app is a pure cloud client; DeskPhone's window is its own local surface.)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dense ? 2 : (compact ? 6 : 12), minWidth: 0, flex: "1 1 auto", minHeight: 0, overflow: "hidden", color: C.text, animation: `nc-phone-surface-fade ${DUR.base} ${EASE.standard}` }}>

      {(isIncoming || isOnCall || vmCount > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, minHeight: dense ? 20 : (compact ? 28 : 36), padding: "0 2px" }}>
          <span style={{ width: 8, height: 8, borderRadius: RADIUS.pill, flexShrink: 0, background: isIncoming ? C.success : isOnCall ? C.warning : C.danger }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: compact ? 13 : 14, fontWeight: 500, color: isIncoming ? C.success : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {callerDisplay && (isIncoming || isOnCall) ? `${isIncoming ? "Incoming" : "On call"} · ${callerDisplay}` : `${vmCount} voicemail${vmCount === 1 ? "" : "s"}`}
          </span>
        </div>
      )}

      {/* ── Always-visible phone-link status (owner ticket: "there's no status
            indicator that says what it's doing"). One dot + one plain-English line;
            the Reconnect chip appears only when it's actually offline. Suppressed on
            the compact card, which carries its own status dot lower down. ── */}
      {!compact && (
        <div style={{ display: "flex", alignItems: "center", gap: SP.sm, minHeight: 30, padding: "0 2px" }}>
          <span style={{ width: 8, height: 8, borderRadius: RADIUS.pill, flexShrink: 0, background: linkDotColor,
            // Handover in flight: the dot blinks until the new host's heartbeat confirms.
            animation: link.switching ? "nc-host-blink 1.1s ease-in-out infinite" : "none" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: NC_TYPE.control, fontWeight: 600, color: phoneLinkLive ? C.success : relayStale ? C.warning : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {linkStatusLabel}
          </span>
          {linkOffline && (
            <AssistChip label="Reconnect" title="Reconnect the phone link" onClick={reconnectPhone} disabled={!!busy}>
              <span slot="icon" className="material-symbols-rounded">refresh</span>
            </AssistChip>
          )}
        </div>
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
            <ActionBtn variant="filled" icon="phone_callback" iconSize={14} containerColor={C.success} labelColor="#fff"
              onClick={() => post("/answer", "answer")} disabled={!!busy} title="Answer">Answer</ActionBtn>
            <ActionBtn variant="filled" icon="call_end" iconSize={14} containerColor={C.danger} labelColor="#fff"
              onClick={() => { callSuppressRef.current = { raw: callStateRaw, until: Date.now() + 90000 }; setNowTick(Date.now()); post("/hangup", "decline"); }} disabled={!!busy} title="Decline">Decline</ActionBtn>
          </>
        ) : isOnCall ? (
          <ActionBtn variant="filled" icon="call_end" iconSize={14} containerColor={C.danger} labelColor="#fff"
            onClick={() => { callSuppressRef.current = { raw: callStateRaw, until: Date.now() + 90000 }; setNowTick(Date.now()); post("/hangup", "hangup"); }} disabled={!!busy} title="Hang up">Hang up</ActionBtn>
        ) : null}
        <div style={{ flex: 1 }} />
        {/* Reconnect now lives in the always-visible status line above (offline-only
            Reconnect chip) — no more unlabeled "reverse circle" here. */}
        {/* Record general */}
        <PhoneIconBtn icon="mic" onClick={onRecordConversation} title="Record anything — tasks, shailos, notes, got-backs" aria-label="Record" />
        {/* Record active call */}
        {isOnCall && (
          <IconBtn variant="filled" icon="fiber_manual_record" size={36} iconSize={14} color="#fff" containerColor={C.danger}
            onClick={onRecordCall} title="Record this call and extract tasks/shailos" aria-label="Record this call" />
        )}
        {/* New message button */}
        <PhoneIconBtn icon="edit" active={composeOpen && composeIsNew} onClick={openNewMessage} title="New message" aria-label="New message" />
        {/* Keypad toggle */}
        <PhoneIconBtn icon="dialpad" active={showDialer} onClick={() => setShowDialer(v => !v)} title="Keypad" aria-label="Keypad" />
        {/* (Status now lives in the always-visible plain-language line above.) */}
      </div>
      )}

      {/* ── Dialer — only when keypad is open (never on the compact card) ── */}
      {showDialer && !compact && (
        <div style={{ display: "flex", flexDirection: "column", gap:6 }}>
          {/* Number input */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.faint, pointerEvents: "none", lineHeight: 1, display: "flex" }}>{suiteIcon("search", 15)}</span>
            <input value={number} onChange={e => setNumber(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 160)}
              onKeyDown={e => e.key === "Enter" && dial()}
              placeholder="Name or number"
              style={{ width: "100%", height: 40, boxSizing: "border-box", padding: "0 46px 0 32px", borderRadius: RADIUS.pill, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, fontFamily: "system-ui", fontSize: NC_TYPE.body, fontWeight: 400, outline: "none" }} />
            <IconBtn variant="filled" icon="call" size={32} iconSize={14}
              color={number.trim() ? "#fff" : C.faint}
              containerColor={number.trim() ? C.success : "transparent"}
              onClick={dial} disabled={!number.trim() || !!busy} title="Call" aria-label="Call"
              style={{ position: "absolute", right: 4, top: 4 }} />
          </div>
          {/* Contact suggestions below input */}
          {inputFocused && suggestions.length > 0 && (
            <SuggestionList onPick={s => { setNumber(s.num); setSelected({ name: s.name, number: s.num }); setInputFocused(false); }} />
          )}
          {/* Numeric keypad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
            {DIALER_KEYS.map(k => (
              <button key={k} onClick={() => setNumber(prev => prev + k)}
                style={{ height: 40, borderRadius: RADIUS.xs, border: `1px solid ${C.divider}`, background: C.bg, color: C.text, cursor: "pointer", fontSize: NC_TYPE.title, fontWeight: 400, fontFamily: "system-ui" }}>
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Unified phone activity feed ── */}
      {statusOnline && (hasMessages || hasCalls) && (
        <div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", paddingRight: 1, ...denseListVars({ dense, primary: C.text, secondary: C.muted, hover: C.text }) }}>
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
                // Collapsed, no inline action/compose → genuine md-list-item (matches the
                // Mail/Calendar/Tasks rows). The moment the row expands / opens actions /
                // composes, fall through to the existing grid layout (untouched) so the
                // intricate conversation + compose machinery keeps working exactly as-is.
                const composeHere = composeOpen && composeAnchorId === actionId && !composeIsNew;
                if (!expanded && !actionsOpen && !composeHere) {
                  return (
                    <ListItem key={`${thread._key || thread._who}-${idx}`} type="button" onClick={() => setExpandedPhoneMessageId(actionId)} style={{ borderRadius: RADIUS.sm }}>
                      <span slot="start" style={phoneLeadIconStyle(isUnread ? C.accent : msgColor, isUnread ? C.hover : "transparent")}>{suiteIcon(msgIcon, 14)}</span>
                      {/* Message BODY is the read target (full headline size); sender drops
                          to the smaller supporting line — buglog "need a magnifier" ticket. */}
                      <span slot="headline" style={{ fontWeight: isUnread ? 600 : 450, color: C.text, whiteSpace: "normal", wordBreak: "break-word", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{preview || thread._name}</span>
                      {preview && <span slot="supporting-text" style={{ color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread._name}</span>}
                      {time && <span slot="trailing-supporting-text" style={{ color: C.muted }}>{time}</span>}
                      <span slot="end"><IconBtn icon="more_horiz" size={32} iconSize={17} color={C.muted} title="Show actions" aria-label="Show actions" onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionId); }} /></span>
                    </ListItem>
                  );
                }
                return (
                  <div key={`${thread._key || thread._who}-${idx}`} className="nc-action-row" style={{ ...phoneRowStyle, background: expanded ? C.hover : "transparent" }}>
                    <span style={phoneLeadIconStyle(isUnread ? C.accent : msgColor, isUnread ? C.hover : "transparent")}>{suiteIcon(msgIcon, 14)}</span>
                    <button onClick={() => setExpandedPhoneMessageId(expanded ? null : actionId)} style={{ minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, color: C.text }}>
                      {/* Collapsed: body reads at full size, sender on the small line under it.
                          Expanded: the name headlines the open conversation as before. */}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                        <span style={{ flex: 1, fontSize: NC_TYPE.control, lineHeight: NC_TYPE.line, fontWeight: isUnread ? 600 : (expanded ? 500 : 450), color: C.text, ...(expanded ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : { whiteSpace: compact ? "nowrap" : "normal", overflow: compact ? "hidden" : undefined, textOverflow: compact ? "ellipsis" : undefined, wordBreak: compact ? "normal" : "break-word" }) }}>{expanded ? thread._name : (preview || thread._name)}</span>
                        {time && <span style={{ fontSize: NC_TYPE.meta, color: C.muted, flexShrink: 0, fontWeight: 400 }}>{time}</span>}
                      </div>
                      {preview && !expanded && <span style={{ display: "block", fontSize: NC_TYPE.meta, color: C.muted, marginTop: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: NC_TYPE.line }}>{thread._name}</span>}
                    </button>
                    {!expanded && (
                      <PhoneIconBtn icon="more_horiz" iconSize={17} active={actionsOpen}
                        onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionsOpen ? null : actionId); }}
                        title={actionsOpen ? "Hide actions" : "Show actions"} aria-label={actionsOpen ? "Hide actions" : "Show actions"} />
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
                            <PhoneIconBtn icon="call" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); dialNum(thread._who); }} title="Call" aria-label="Call" />
                            <PhoneIconBtn icon="sms" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); openCompose(thread._name, thread._who, actionId); }} title="Reply" aria-label="Reply" />
                            <PhoneIconBtn icon="close" iconSize={16} onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); setExpandedPhoneMessageId(null); }} title="Close conversation" aria-label="Close conversation" />
                          </div>
                        </div>
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
                            // In-flight for over a minute = treat as failed (owner ticket):
                            // offer the same retry instead of a bubble stuck on "Sending".
                            const sendStuck = !sendFailed && /send|confirm|queue/i.test(sendStatus) && (Date.now() - messageTimeMs(msg)) > 60000;
                            return (
                              <div key={`${thread._who}-${messageTimeMs(msg)}-${msgIdx}`} style={{ alignSelf: outgoing ? "flex-end" : "flex-start", maxWidth: "92%", minWidth: 0 }}>
                                <div style={{ borderRadius: RADIUS.sm, border: `1px solid ${outgoing ? (sendFailed ? C.danger : "transparent") : C.divider}`, background: outgoing ? C.hover : C.bgSoft, color: C.text, padding: "7px 9px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                  {msgText && linkedMessageParts(msgText, { color: C.accent })}
                                  {(msg.attachments || []).filter(a => a.isImage).map((a, ai) => (
                                    <PhoneMmsImage key={a.mediaId || ai} attachment={a} C={C} />
                                  ))}
                                  {!msgText && !(msg.attachments || []).some(a => a.isImage) && "(no text)"}
                                </div>
                                {(msgTime || (outgoing && sendStatus)) && (
                                  <div style={{ fontSize: NC_TYPE.small, color: C.faint, marginTop: 2, textAlign: outgoing ? "right" : "left", display: "flex", alignItems: "center", gap: 4, justifyContent: outgoing ? "flex-end" : "flex-start" }}>
                                    {outgoing && sendStatus && (
                                      <span style={{ color: (sendFailed || sendStuck) ? C.danger : C.faint, fontWeight: (sendFailed || sendStuck) ? 600 : 400 }}>
                                        {sendStuck ? "Not confirmed" : (msg.sendStatusLabel || msg.SendStatusLabel || sendStatus)}{msgTime ? " · " : ""}
                                      </span>
                                    )}
                                    {msgTime}
                                    {outgoing && (sendFailed || sendStuck) && (
                                      <ActionBtn variant="text" icon="refresh" iconSize={12} height={24} labelSize={NC_TYPE.small} labelColor={C.danger}
                                        title="Retry send" disabled={!!busy}
                                        onClick={e => { e.stopPropagation(); if (msgText) sendSmsInBackground(thread._who, msgText, msg._echoId || null); }}>
                                        Retry
                                      </ActionBtn>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {/* Reply composes INLINE below the newest text (owner ticket) —
                              not at the top of the conversation. */}
                          {composeOpen && composeAnchorId === actionId && !composeIsNew && (
                            <div style={{ margin: "2px 0 0" }}>
                              {renderComposeBox({ boxShadow: "none" })}
                            </div>
                          )}
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
                              gap: SP.xs,
                              padding: SP.xs,
                              border: `1px solid ${C.divider}`,
                              borderRadius: RADIUS.pill,
                              background: C.bg,
                              boxShadow: `0 2px 8px ${C.shadow || "rgba(15,23,42,0.18)"}`,
                            }}
                          >
                            <PhoneIconBtn icon="call" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); dialNum(thread._who); }} title="Call" aria-label="Call" />
                            <PhoneIconBtn icon="sms" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); openCompose(thread._name, thread._who, actionId); }} title="Reply" aria-label="Reply" />
                            <PhoneIconBtn icon="close" iconSize={16} onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); setExpandedPhoneMessageId(null); }} title="Close conversation" aria-label="Close conversation" />
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
                const composeHere = composeOpen && composeAnchorId === actionId && !composeIsNew;
                if (!actionsOpen && !composeHere) {
                  return (
                    <ListItem key={`call-${idx}`} type="button" onClick={() => setOpenPhoneActionId(actionId)} style={{ borderRadius: RADIUS.sm, opacity: resolved ? 0.62 : 1 }}>
                      <span slot="start" style={phoneLeadIconStyle(color)}>{suiteIcon(icon, 14)}</span>
                      <span slot="headline" style={{ fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      {needsCallback ? (
                        <span slot="supporting-text" style={{ fontWeight: 700, color: C.danger }}>Needs callback</span>
                      ) : resolved ? (
                        <span slot="supporting-text" style={{ display: "inline-flex", alignItems: "center", gap: 3, color: C.success }}>{suiteIcon("check_circle", 11)} Resolved</span>
                      ) : (num && num !== name ? <span slot="supporting-text" style={{ color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{num}</span> : null)}
                      {time && <span slot="trailing-supporting-text" style={{ color: C.muted }}>{time}</span>}
                      <span slot="end" style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        {isMissed && mKey && (resolved
                          ? <IconBtn icon="undo" size={32} iconSize={16} color={C.muted} title="Reopen missed call" aria-label="Reopen missed call" onClick={e => { e.stopPropagation(); toggleMissedResolved(mKey, false); }} />
                          : <IconBtn icon="check_circle" size={32} iconSize={17} color={C.success} title="Mark resolved" aria-label="Mark resolved" onClick={e => { e.stopPropagation(); toggleMissedResolved(mKey, true); }} />)}
                        <IconBtn icon="more_horiz" size={32} iconSize={17} color={C.muted} title="Show actions" aria-label="Show actions" onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionId); }} />
                      </span>
                    </ListItem>
                  );
                }
                return (
                  <div key={`call-${idx}`} className="nc-action-row" style={{ ...phoneRowStyle, gridTemplateColumns: "20px minmax(0,1fr) auto", opacity: resolved ? 0.62 : 1 }}>
                    <span style={phoneLeadIconStyle(color)}>{suiteIcon(icon, 14)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                        <span style={{ flex: 1, fontSize: NC_TYPE.control, lineHeight: NC_TYPE.line, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                        {time && <span style={{ fontSize: NC_TYPE.meta, color: C.muted, flexShrink: 0, fontWeight: 400 }}>{time}</span>}
                      </div>
                      {needsCallback ? (
                        <span style={{ display: "inline-block", marginTop: 1, fontSize: NC_TYPE.small, lineHeight: 1.15, fontWeight: 700, color: C.danger, background: C.bgSoft, borderRadius: RADIUS.pill, padding: `1px ${SP.xs}` }}>Needs callback</span>
                      ) : resolved ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 1, fontSize: NC_TYPE.small, lineHeight: 1.15, fontWeight: 600, color: C.success }}>{suiteIcon("check_circle", 11)} Resolved</span>
                      ) : (num && num !== name && <span style={{ display: "block", fontSize: NC_TYPE.meta, color: C.muted, marginTop: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: NC_TYPE.line }}>{num}</span>)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                      {/* Direct resolve/reopen toggle for missed calls — one tap, no menu. */}
                      {isMissed && mKey && (resolved
                        ? <PhoneIconBtn icon="undo" iconSize={16} onClick={e => { e.stopPropagation(); toggleMissedResolved(mKey, false); }} title="Reopen missed call" aria-label="Reopen missed call" />
                        : <PhoneIconBtn icon="check_circle" iconSize={17} color={C.success} onClick={e => { e.stopPropagation(); toggleMissedResolved(mKey, true); }} title="Mark resolved" aria-label="Mark resolved" />)}
                      <PhoneIconBtn icon="more_horiz" iconSize={17} active={actionsOpen}
                        onClick={e => { e.stopPropagation(); setOpenPhoneActionId(actionsOpen ? null : actionId); }}
                        title={actionsOpen ? "Hide actions" : "Show actions"} aria-label={actionsOpen ? "Hide actions" : "Show actions"} />
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
              <ActionBtn variant="outlined" icon="history" iconSize={13} height={32} labelSize={NC_TYPE.meta} onClick={onMoreHistory}>More history</ActionBtn>
            </div>
          )}
        </div>
      )}

      {/* Compact card always shows a status dot — even with no texts/calls — so the phone's
          live/stale/offline state is visible at a glance instead of a blank card. */}
      {compact && !error && !(statusOnline && (hasMessages || hasCalls)) && (
        <div style={{ display: "flex", alignItems: "center", gap: SP.xs, padding: `${SP.xs} ${SP.xs}`, fontSize: NC_TYPE.meta, color: C.muted, fontFamily: NC_FONT_STACK, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: RADIUS.pill, flexShrink: 0, background: phoneLinkLive ? C.success : relayStale ? C.warning : C.faint }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{phoneLinkLive ? "Connected · no recent calls or texts" : relayStale ? `Host offline · ${formatAgeShort(link.ageMs)}` : "Phone host offline"}</span>
        </div>
      )}
      {!statusOnline && !error && !compact && <div style={{ fontSize: NC_TYPE.meta, color: C.muted, padding: `${SP.xs} 2px` }}>Start Shamash Phone Link on the tablet to connect calls and texts. DeskPhone can still be opened on the PC as a fallback.</div>}
      {error && <div style={{ fontSize: NC_TYPE.meta, color: C.danger, background: C.bgSoft, borderRadius: RADIUS.sm, padding: `${SP.sm} ${SP.sm}`, marginTop: 2 }}>{error}</div>}

      {/* ?phonediag=1 — raw state-machine readout so a "the indicator is lying"
          report takes minutes to diagnose instead of guesswork. Debug-only. */}
      {phoneDiag && !compact && !dense && (
        <pre style={{ position: "fixed", right: 8, bottom: 8, zIndex: 9999, maxWidth: 360, maxHeight: "45vh", overflow: "auto", background: "rgba(0,0,0,0.85)", color: "#7CFC9A", fontSize: 10, lineHeight: 1.35, padding: 8, borderRadius: 6, margin: 0 }}>
          {JSON.stringify({
            transport: "relay",
            link,
            owner,
            relayReceivedAgo: relayReceivedAt ? formatAgeShort(nowTick - relayReceivedAt) : "never",
            lastFetchOkAgo: lastFetchOkAtRef.current ? formatAgeShort(nowTick - lastFetchOkAtRef.current) : "never",
            messages: Array.isArray(messages) ? messages.length : 0,
            calls: Array.isArray(calls) ? calls.length : 0,
            pendingEchoes: pendingEchoes.map(e => ({ id: e.id, status: e.status, to: e.to })),
            busy, error,
          }, null, 1)}
        </pre>
      )}
    </div>
  );
}

export { NerveCenterPhoneSurface };
