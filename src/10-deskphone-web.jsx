import React, { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_BRIDGE = "http://127.0.0.1:8765";
const HOST_CONNECTOR_KEY = "deskphone_web_host_url";
const LEGACY_BRIDGE_KEY = "deskphone_web_bridge_url";

function icon(name, size = 18) {
  return <span className="material-symbols-rounded" style={{ fontSize: size }}>{name}</span>;
}

function normalizeBridgeBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_BRIDGE;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function readBridgeBase() {
  try {
    return normalizeBridgeBase(
      localStorage.getItem(HOST_CONNECTOR_KEY) ||
      localStorage.getItem(LEGACY_BRIDGE_KEY) ||
      DEFAULT_BRIDGE
    );
  } catch {
    return DEFAULT_BRIDGE;
  }
}

async function fetchJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    cache: "no-store",
    ...options,
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.calls)) return payload.calls;
  if (Array.isArray(payload?.contacts)) return payload.contacts;
  if (Array.isArray(payload?.recentCalls)) return payload.recentCalls;
  return [];
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizePhone(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "me") return "";
  const withoutTel = text.replace(/^tel:/i, "").trim();
  const keepPlus = withoutTel.startsWith("+");
  const digits = withoutTel.replace(/[^\d]/g, "");
  if (!digits) return withoutTel;
  return `${keepPlus ? "+" : ""}${digits}`;
}

function numberKey(value) {
  return normalizePhone(value).toLowerCase() || String(value || "unknown").trim().toLowerCase();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeLabel(value) {
  const date = parseDate(value);
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  if (diff >= 0 && diff < 60_000) return "now";
  if (diff >= 0 && diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff >= 0 && diff < 86_400_000) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff >= 0 && diff < 604_800_000) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fullTimeLabel(value) {
  const date = parseDate(value);
  if (!date) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function secondsLabel(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getMessageParty(message) {
  const isSent = !!(message.isSent ?? message.IsSent);
  const sentTo = firstText(message.to, message.To, message.number, message.phoneNumber);
  const from = firstText(message.from, message.From, message.sender, message.address);
  const raw = isSent ? sentTo || from : from || firstText(message.number, message.phoneNumber, message.to);
  const number = normalizePhone(raw || sentTo || message.number);
  const displayName = firstText(
    message.contactName,
    message.displayName,
    message.name,
    number,
    raw,
    "Unknown"
  );
  return {
    number: number || displayName,
    displayName,
  };
}

function normalizeMessage(message, index) {
  const party = getMessageParty(message);
  const timestamp = message.timestamp || message.Timestamp || message.date || message.time || "";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return {
    id: firstText(message.id, message.localId, message.LocalId, message.handle, message.Handle) || `message-${index}`,
    handle: firstText(message.handle, message.Handle),
    number: party.number,
    displayName: party.displayName,
    body: firstText(message.body, message.Body, message.preview, message.text, message.message),
    preview: firstText(message.preview, message.Preview, message.body, message.Body, message.text),
    timestamp,
    isSent: !!(message.isSent ?? message.IsSent),
    isRead: !!(message.isRead ?? message.IsRead),
    isMms: !!(message.isMms ?? message.IsMms),
    attachments,
  };
}

function normalizeCall(call, index) {
  const number = normalizePhone(firstText(call.number, call.phoneNumber, call.from, call.address));
  const displayName = firstText(call.displayName, call.name, call.Name, call.DisplayName, number, "Unknown");
  const direction = firstText(call.direction, call.Direction, call.type, call.callType, call.directionLabel, call.status);
  const timestamp = call.timestamp || call.time || call.startTime || call.date || call.Time || "";
  const durationSeconds = Number(call.durationSeconds ?? call.duration ?? call.DurationSeconds ?? 0);
  return {
    id: firstText(call.id, call.Id) || `call-${index}-${number}-${timestamp}`,
    number: number || displayName,
    displayName,
    direction,
    timestamp,
    timeDisplay: firstText(call.timeDisplay, call.TimeDisplay) || fullTimeLabel(timestamp),
    duration: firstText(call.durationDisplay, call.DurationDisplay) || secondsLabel(durationSeconds),
    subtitle: firstText(call.subtitle, call.SubtitleDisplay, direction),
    isMissed: !!call.isMissed || /miss/i.test(direction),
  };
}

function normalizeContact(contact, index) {
  const phoneNumbers = Array.isArray(contact.phoneNumbers)
    ? contact.phoneNumbers
    : Array.isArray(contact.PhoneNumbers)
      ? contact.PhoneNumbers
      : [contact.primaryPhone, contact.phone, contact.number].filter(Boolean);
  const normalizedNumbers = phoneNumbers
    .map(normalizePhone)
    .filter(Boolean)
    .filter((value, i, arr) => arr.indexOf(value) === i);
  const displayName = firstText(contact.displayName, contact.DisplayName, contact.name, contact.Name, normalizedNumbers[0], "Unknown");
  return {
    id: firstText(contact.id, contact.Id) || `contact-${index}-${displayName}-${normalizedNumbers[0] || ""}`,
    displayName,
    phoneNumbers: normalizedNumbers,
    primaryPhone: normalizePhone(firstText(contact.primaryPhone, contact.PrimaryPhone, normalizedNumbers[0])),
    sourceDeviceAddress: firstText(contact.sourceDeviceAddress, contact.SourceDeviceAddress),
  };
}

function callIconName(direction) {
  const lower = String(direction || "").toLowerCase();
  if (lower.includes("miss")) return "call_missed";
  if (lower.includes("out") || lower.includes("dial")) return "call_made";
  if (lower.includes("in") || lower.includes("receiv")) return "call_received";
  return "call";
}

function contactInitial(name) {
  const letter = String(name || "?").trim().match(/[a-z0-9]/i)?.[0] || "?";
  return letter.toUpperCase();
}

function buildConversations(messages) {
  const byNumber = new Map();
  messages.forEach((message) => {
    const key = numberKey(message.number || message.displayName);
    const existing = byNumber.get(key) || {
      key,
      number: message.number,
      displayName: message.displayName,
      messages: [],
      unreadCount: 0,
      lastTimestamp: "",
      lastPreview: "",
    };
    existing.messages.push(message);
    existing.displayName = existing.displayName || message.displayName;
    existing.number = existing.number || message.number;
    if (!message.isSent && !message.isRead) existing.unreadCount += 1;
    const lastDate = parseDate(existing.lastTimestamp)?.getTime() || 0;
    const nextDate = parseDate(message.timestamp)?.getTime() || 0;
    if (nextDate >= lastDate) {
      existing.lastTimestamp = message.timestamp;
      existing.lastPreview = message.preview || message.body;
    }
    byNumber.set(key, existing);
  });
  return Array.from(byNumber.values())
    .map((conversation) => ({
      ...conversation,
      messages: conversation.messages.sort((a, b) => {
        const left = parseDate(a.timestamp)?.getTime() || 0;
        const right = parseDate(b.timestamp)?.getTime() || 0;
        return left - right;
      }),
    }))
    .sort((a, b) => {
      const left = parseDate(a.lastTimestamp)?.getTime() || 0;
      const right = parseDate(b.lastTimestamp)?.getTime() || 0;
      return right - left;
    });
}

export function DeskPhoneWebPanel({
  T = {},
  onOnlineChange,
  onClose,
  onLaunchNative,
  embedded = false,
}) {
  const [bridgeBase, setBridgeBase] = useState(readBridgeBase);
  const [draftBridge, setDraftBridge] = useState(() => readBridgeBase());
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [activeView, setActiveView] = useState("messages");
  const [selectedKey, setSelectedKey] = useState("");
  const [dialNumber, setDialNumber] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [statusResult, messagesResult, callsResult, contactsResult] = await Promise.allSettled([
        fetchJson(bridgeBase, "/status"),
        fetchJson(bridgeBase, "/messages"),
        fetchJson(bridgeBase, "/calls"),
        fetchJson(bridgeBase, "/contacts"),
      ]);

      if (statusResult.status !== "fulfilled") {
        throw statusResult.reason || new Error("Host control app offline");
      }

      const nextStatus = statusResult.value || {};
      const nextMessages = messagesResult.status === "fulfilled"
        ? arrayFromPayload(messagesResult.value).map(normalizeMessage)
        : [];
      const statusCalls = arrayFromPayload(nextStatus.recentCalls || nextStatus.calls || []);
      const nextCalls = callsResult.status === "fulfilled"
        ? arrayFromPayload(callsResult.value).map(normalizeCall)
        : statusCalls.map(normalizeCall);
      const nextContacts = contactsResult.status === "fulfilled"
        ? arrayFromPayload(contactsResult.value).map(normalizeContact)
        : [];

      setStatus(nextStatus);
      setMessages(nextMessages);
      setCalls(nextCalls);
      setContacts(nextContacts);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      onOnlineChange?.(true);
    } catch {
      setStatus(null);
      setMessages([]);
      setCalls([]);
      setContacts([]);
      setError(`Host control app is offline at ${bridgeBase}`);
      onOnlineChange?.(false);
    }
  }, [bridgeBase, onOnlineChange]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 6500);
    return () => window.clearInterval(id);
  }, [refresh]);

  const conversations = useMemo(() => buildConversations(messages), [messages]);
  const selectedConversation = useMemo(() => {
    if (!conversations.length) return null;
    return conversations.find((item) => item.key === selectedKey) || conversations[0];
  }, [conversations, selectedKey]);

  useEffect(() => {
    if (!selectedKey && conversations[0]) {
      setSelectedKey(conversations[0].key);
    }
  }, [conversations, selectedKey]);

  useEffect(() => {
    if (selectedConversation?.number) {
      setDialNumber(selectedConversation.number);
    }
  }, [selectedConversation?.number]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conversation) =>
      `${conversation.displayName} ${conversation.number} ${conversation.lastPreview}`.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((call) => !q || `${call.displayName} ${call.number} ${call.direction}`.toLowerCase().includes(q));
  }, [calls, search]);

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((contact) => !q || `${contact.displayName} ${contact.phoneNumbers.join(" ")}`.toLowerCase().includes(q));
  }, [contacts, search]);

  const selectedContact = useMemo(() => {
    const key = numberKey(dialNumber || selectedConversation?.number);
    return contacts.find((contact) => contact.phoneNumbers.some((phone) => numberKey(phone) === key)) || null;
  }, [contacts, dialNumber, selectedConversation?.number]);

  const callState = firstText(status?.callState, status?.CallState, status?.CurrentCallState);
  const isRinging = !!status?.isRinging || /ring|incoming/i.test(callState);
  const isCallActive = !!status?.isCallActive || /active|dial/i.test(callState);
  const connected = !!status?.connected;
  const bridgeOnline = !!status;
  const hostConnectorName = firstText(status?.hostConnector, status?.hostName, "Host connector");
  const hostPlatform = firstText(status?.hostPlatform, status?.platform, "unknown");
  const hostContract = firstText(status?.hostControlContract, "deskphone-host-control/v1");
  const hostScope = firstText(status?.hostScope, "local");
  const phoneTransport = status?.phoneTransport || {};
  const hostStatusLabel = bridgeOnline
    ? `${connected ? "Phone connected" : `${hostConnectorName} online`} - ${callState || "Ready"}`
    : "Host connector offline";

  async function runPost(path, label) {
    setBusy(label);
    try {
      await fetchJson(bridgeBase, path, { method: "POST" });
      await refresh();
    } catch {
      setError("Host control app did not accept the command.");
      onOnlineChange?.(false);
    } finally {
      setBusy("");
    }
  }

  function selectNumber(number, nextView = activeView) {
    const normalized = normalizePhone(number) || number;
    setDialNumber(normalized);
    setActiveView(nextView);
    const match = conversations.find((conversation) => numberKey(conversation.number) === numberKey(normalized));
    if (match) setSelectedKey(match.key);
  }

  async function sendMessage() {
    const target = normalizePhone(dialNumber);
    const body = messageBody.trim();
    if (!target || !body) return;
    await runPost(`/send?to=${encodeURIComponent(target)}&body=${encodeURIComponent(body)}`, "send");
    setMessageBody("");
  }

  async function dial(targetOverride = "") {
    const target = normalizePhone(typeof targetOverride === "string" ? targetOverride : dialNumber);
    if (!target) return;
    await runPost(`/dial?n=${encodeURIComponent(target)}`, "dial");
  }

  function saveBridge() {
    const next = normalizeBridgeBase(draftBridge);
    setBridgeBase(next);
    setDraftBridge(next);
    try {
      localStorage.setItem(HOST_CONNECTOR_KEY, next);
    } catch {}
  }

  function resetBridge() {
    setBridgeBase(DEFAULT_BRIDGE);
    setDraftBridge(DEFAULT_BRIDGE);
    try {
      localStorage.removeItem(HOST_CONNECTOR_KEY);
      localStorage.removeItem(LEGACY_BRIDGE_KEY);
    } catch {}
  }

  const selectedName = selectedContact?.displayName || selectedConversation?.displayName || dialNumber || "No contact selected";
  const selectedNumbers = selectedContact?.phoneNumbers?.length ? selectedContact.phoneNumbers : (dialNumber ? [dialNumber] : []);

  const themeVars = {
    "--dp-bg": T.bg || "#f7f5ef",
    "--dp-panel": T.card || "#ffffff",
    "--dp-soft": T.bgW || "#f1eee7",
    "--dp-text": T.text || "#202124",
    "--dp-muted": T.tSoft || "#667085",
    "--dp-faint": T.tFaint || "#8a8f98",
    "--dp-border": T.brd || "#d9d4ca",
    "--dp-border-soft": T.brdS || T.brd || "#ebe6dc",
    "--dp-primary": T.primary || "#255f85",
    "--dp-on-primary": T.onPrimary || "#ffffff",
    "--dp-tonal": T.tonal || "#e4eef6",
    "--dp-on-tonal": T.onTonal || T.text || "#202124",
  };

  return (
    <section className={`deskphone-web ${embedded ? "is-embedded" : ""}`} style={themeVars}>
      <style>{`
        .deskphone-web {
          position: fixed;
          inset: 64px 0 0;
          z-index: 7600;
          min-height: 0;
          background: var(--dp-bg);
          color: var(--dp-text);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          display: grid;
          grid-template-rows: auto 1fr;
          overflow: hidden;
        }
        .deskphone-web.is-embedded {
          position: relative;
          inset: auto;
          z-index: auto;
          min-height: 620px;
          border: 1px solid var(--dp-border);
        }
        .dp-topbar {
          height: 58px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          padding: 0 16px;
          border-bottom: 1px solid var(--dp-border);
          background: var(--dp-panel);
          box-sizing: border-box;
        }
        .dp-brand {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .dp-brand-mark,
        .dp-avatar {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--dp-tonal);
          color: var(--dp-on-tonal);
          flex: 0 0 auto;
          font-weight: 900;
        }
        .dp-title {
          font-size: 15px;
          font-weight: 950;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dp-subtitle {
          margin-top: 2px;
          font-size: 11px;
          font-weight: 700;
          color: var(--dp-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dp-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          min-width: 0;
        }
        .dp-button,
        .dp-icon-button,
        .dp-tab,
        .dp-row {
          font-family: inherit;
        }
        .dp-button {
          height: 36px;
          border-radius: 8px;
          border: 1px solid var(--dp-border);
          background: var(--dp-soft);
          color: var(--dp-text);
          font-size: 12px;
          font-weight: 850;
          cursor: pointer;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          white-space: nowrap;
        }
        .dp-button.primary {
          border-color: var(--dp-primary);
          background: var(--dp-primary);
          color: var(--dp-on-primary);
        }
        .dp-button.danger {
          border-color: #b3261e;
          background: #b3261e;
          color: #fff;
        }
        .dp-icon-button {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid var(--dp-border);
          background: var(--dp-soft);
          color: var(--dp-muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }
        .dp-button:disabled,
        .dp-icon-button:disabled {
          opacity: 0.48;
          cursor: default;
        }
        .dp-shell {
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(260px, 330px) minmax(0, 1fr) minmax(260px, 330px);
          overflow: hidden;
        }
        .dp-left,
        .dp-main,
        .dp-detail {
          min-width: 0;
          min-height: 0;
          overflow: hidden;
          background: var(--dp-panel);
        }
        .dp-left {
          border-right: 1px solid var(--dp-border);
          display: grid;
          grid-template-rows: auto auto 1fr;
        }
        .dp-main {
          display: grid;
          grid-template-rows: auto 1fr auto;
        }
        .dp-detail {
          border-left: 1px solid var(--dp-border);
          display: grid;
          grid-template-rows: auto 1fr;
        }
        .dp-tabs {
          padding: 10px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 4px;
          border-bottom: 1px solid var(--dp-border-soft);
          background: var(--dp-panel);
        }
        .dp-tab {
          min-width: 0;
          height: 38px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--dp-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 850;
        }
        .dp-tab.is-active {
          background: var(--dp-tonal);
          color: var(--dp-on-tonal);
        }
        .dp-search {
          padding: 10px;
          border-bottom: 1px solid var(--dp-border-soft);
        }
        .dp-input,
        .dp-textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--dp-border);
          border-radius: 8px;
          background: var(--dp-soft);
          color: var(--dp-text);
          outline: none;
          font: inherit;
          font-size: 13px;
        }
        .dp-input {
          height: 38px;
          padding: 0 11px;
        }
        .dp-textarea {
          min-height: 82px;
          resize: vertical;
          padding: 10px 11px;
          line-height: 1.35;
        }
        .dp-list {
          min-height: 0;
          overflow: auto;
        }
        .dp-row {
          width: 100%;
          min-height: 58px;
          padding: 9px 10px;
          border: 0;
          border-bottom: 1px solid var(--dp-border-soft);
          background: transparent;
          color: var(--dp-text);
          cursor: pointer;
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          text-align: left;
        }
        .dp-row.is-active {
          background: var(--dp-tonal);
          color: var(--dp-on-tonal);
        }
        .dp-row-title,
        .dp-line {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dp-row-title {
          font-size: 13px;
          font-weight: 900;
        }
        .dp-row-sub {
          margin-top: 2px;
          color: var(--dp-muted);
          font-size: 12px;
          line-height: 1.25;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dp-row-meta {
          display: grid;
          justify-items: end;
          gap: 4px;
          color: var(--dp-faint);
          font-size: 11px;
          font-weight: 800;
        }
        .dp-unread {
          min-width: 18px;
          height: 18px;
          border-radius: 9px;
          background: var(--dp-primary);
          color: var(--dp-on-primary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          padding: 0 5px;
          box-sizing: border-box;
        }
        .dp-section-head {
          min-height: 58px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--dp-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          box-sizing: border-box;
        }
        .dp-section-title {
          min-width: 0;
          font-size: 14px;
          font-weight: 950;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dp-section-note {
          margin-top: 2px;
          font-size: 11px;
          color: var(--dp-muted);
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dp-thread {
          min-height: 0;
          overflow: auto;
          padding: 14px;
          background: var(--dp-bg);
        }
        .dp-bubble-row {
          display: flex;
          margin: 7px 0;
        }
        .dp-bubble-row.is-sent {
          justify-content: flex-end;
        }
        .dp-bubble {
          max-width: min(620px, 76%);
          border-radius: 8px;
          border: 1px solid var(--dp-border-soft);
          background: var(--dp-panel);
          color: var(--dp-text);
          padding: 9px 11px;
          box-sizing: border-box;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .dp-bubble-row.is-sent .dp-bubble {
          background: var(--dp-primary);
          color: var(--dp-on-primary);
          border-color: var(--dp-primary);
        }
        .dp-bubble-text {
          font-size: 14px;
          line-height: 1.35;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .dp-bubble-meta {
          margin-top: 5px;
          font-size: 10px;
          opacity: 0.76;
          display: flex;
          justify-content: flex-end;
          gap: 5px;
        }
        .dp-composer {
          border-top: 1px solid var(--dp-border);
          padding: 10px;
          display: grid;
          grid-template-columns: minmax(150px, 230px) minmax(0, 1fr) auto;
          gap: 8px;
          align-items: end;
          background: var(--dp-panel);
        }
        .dp-call-list {
          min-height: 0;
          overflow: auto;
          background: var(--dp-bg);
        }
        .dp-call-row {
          display: grid;
          grid-template-columns: 42px minmax(0,1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 11px 14px;
          border-bottom: 1px solid var(--dp-border-soft);
          background: var(--dp-panel);
        }
        .dp-detail-body {
          min-height: 0;
          overflow: auto;
          padding: 14px;
          display: grid;
          align-content: start;
          gap: 12px;
        }
        .dp-profile {
          display: grid;
          gap: 10px;
          justify-items: center;
          text-align: center;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--dp-border-soft);
        }
        .dp-profile .dp-avatar {
          width: 62px;
          height: 62px;
          border-radius: 8px;
          font-size: 24px;
        }
        .dp-command-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .dp-empty,
        .dp-alert {
          margin: 14px;
          border: 1px solid var(--dp-border);
          background: var(--dp-soft);
          color: var(--dp-muted);
          border-radius: 8px;
          padding: 14px;
          font-size: 13px;
          line-height: 1.35;
        }
        .dp-alert {
          margin: 0;
          color: #8c1d18;
          background: #fceeee;
          border-color: #f3c7c2;
        }
        .dp-settings {
          padding: 14px;
          overflow: auto;
          display: grid;
          gap: 14px;
          background: var(--dp-bg);
        }
        .dp-settings-row {
          background: var(--dp-panel);
          border-bottom: 1px solid var(--dp-border-soft);
          padding: 12px;
          display: grid;
          gap: 8px;
        }
        .dp-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--dp-faint);
          display: inline-block;
          flex: 0 0 auto;
        }
        .dp-status-dot.online { background: #137333; }
        .dp-status-dot.warn { background: #b3261e; }
        @media (max-width: 1060px) {
          .dp-shell {
            grid-template-columns: minmax(240px, 310px) minmax(0, 1fr);
          }
          .dp-detail {
            grid-column: 1 / -1;
            border-left: 0;
            border-top: 1px solid var(--dp-border);
            grid-template-rows: auto;
          }
          .dp-detail-body {
            grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
            align-items: start;
          }
        }
        @media (max-width: 760px) {
          .deskphone-web {
            inset: 56px 0 0;
          }
          .dp-topbar {
            height: auto;
            min-height: 58px;
            grid-template-columns: 1fr;
            align-items: stretch;
            padding: 9px 10px;
          }
          .dp-actions {
            justify-content: stretch;
            overflow-x: auto;
          }
          .dp-shell {
            grid-template-columns: 1fr;
            overflow: auto;
          }
          .dp-left,
          .dp-main,
          .dp-detail {
            overflow: visible;
            min-height: auto;
            border-left: 0;
            border-right: 0;
          }
          .dp-list,
          .dp-thread,
          .dp-call-list,
          .dp-detail-body {
            overflow: visible;
          }
          .dp-composer {
            grid-template-columns: 1fr;
          }
          .dp-detail-body {
            grid-template-columns: 1fr;
          }
          .dp-bubble {
            max-width: 88%;
          }
        }
      `}</style>

      <header className="dp-topbar">
        <div className="dp-brand">
          <span className="dp-brand-mark">{icon("smartphone", 20)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="dp-title">DeskPhone Web</div>
            <div className="dp-subtitle">
              <span className={`dp-status-dot ${bridgeOnline ? "online" : "warn"}`} />{" "}
              {hostStatusLabel}
              {lastUpdated ? ` - ${lastUpdated}` : ""}
            </div>
          </div>
        </div>
        <div className="dp-actions">
          <button className="dp-button" onClick={() => runPost("/connect", "connect")} disabled={!!busy} title="Connect phone">
            {icon("link", 17)} Connect
          </button>
          <button className="dp-button" onClick={() => runPost("/refresh", "refresh")} disabled={!!busy} title="Refresh phone data">
            {icon("sync", 17)} Sync
          </button>
          <button className="dp-button primary" onClick={() => runPost("/answer", "answer")} disabled={!isRinging || !!busy} title="Answer call">
            {icon("phone_callback", 17)} Answer
          </button>
          <button className="dp-button danger" onClick={() => runPost("/hangup", "hangup")} disabled={(!isCallActive && !isRinging) || !!busy} title="Hang up">
            {icon("call_end", 17)} End
          </button>
          {onLaunchNative && (
            <button className="dp-icon-button" onClick={onLaunchNative} title="Open native DeskPhone">
              {icon("open_in_new", 18)}
            </button>
          )}
          {onClose && (
            <button className="dp-icon-button" onClick={onClose} title="Close phone">
              {icon("close", 18)}
            </button>
          )}
        </div>
      </header>

      <div className="dp-shell">
        <aside className="dp-left">
          <nav className="dp-tabs" aria-label="Phone views">
            {[
              ["messages", "Messages", "chat"],
              ["calls", "Calls", "call"],
              ["contacts", "Contacts", "contacts"],
              ["settings", "Host", "settings_ethernet"],
            ].map(([id, label, iconName]) => (
              <button
                key={id}
                className={`dp-tab ${activeView === id ? "is-active" : ""}`}
                onClick={() => setActiveView(id)}
                title={label}
              >
                {icon(iconName, 17)} <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="dp-search">
            <input
              className="dp-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={activeView === "calls" ? "Search calls" : activeView === "contacts" ? "Search contacts" : "Search messages"}
            />
          </div>
          <div className="dp-list">
            {activeView === "messages" && (
              filteredConversations.length ? filteredConversations.map((conversation) => (
                <button
                  key={conversation.key}
                  className={`dp-row ${selectedConversation?.key === conversation.key ? "is-active" : ""}`}
                  onClick={() => {
                    setSelectedKey(conversation.key);
                    selectNumber(conversation.number, "messages");
                  }}
                >
                  <span className="dp-avatar">{contactInitial(conversation.displayName)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="dp-row-title dp-line">{conversation.displayName}</span>
                    <span className="dp-row-sub">{conversation.lastPreview || conversation.number}</span>
                  </span>
                  <span className="dp-row-meta">
                    <span>{timeLabel(conversation.lastTimestamp)}</span>
                    {conversation.unreadCount > 0 && <span className="dp-unread">{conversation.unreadCount}</span>}
                  </span>
                </button>
              )) : <div className="dp-empty">No message threads loaded.</div>
            )}

            {activeView === "calls" && (
              filteredCalls.length ? filteredCalls.map((call) => (
                <button
                  key={call.id}
                  className="dp-row"
                  onClick={() => selectNumber(call.number, "calls")}
                >
                  <span className="dp-avatar">{icon(callIconName(call.direction), 18)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="dp-row-title dp-line">{call.displayName}</span>
                    <span className="dp-row-sub">{call.number}</span>
                  </span>
                  <span className="dp-row-meta">
                    <span>{timeLabel(call.timestamp)}</span>
                    {call.isMissed && <span style={{ color: "#b3261e" }}>Missed</span>}
                  </span>
                </button>
              )) : <div className="dp-empty">No recent calls loaded.</div>
            )}

            {activeView === "contacts" && (
              filteredContacts.length ? filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  className="dp-row"
                  onClick={() => selectNumber(contact.primaryPhone || contact.phoneNumbers[0], "contacts")}
                >
                  <span className="dp-avatar">{contactInitial(contact.displayName)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="dp-row-title dp-line">{contact.displayName}</span>
                    <span className="dp-row-sub">{contact.phoneNumbers[0] || "No number"}</span>
                  </span>
                  <span className="dp-row-meta">{contact.phoneNumbers.length > 1 ? `${contact.phoneNumbers.length} nums` : ""}</span>
                </button>
              )) : <div className="dp-empty">No contacts loaded.</div>
            )}

            {activeView === "settings" && (
              <div className="dp-settings">
                <div className="dp-settings-row">
                  <label style={{ fontSize: 12, fontWeight: 900, color: "var(--dp-muted)" }}>Host control address</label>
                  <input className="dp-input" value={draftBridge} onChange={(event) => setDraftBridge(event.target.value)} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="dp-button primary" onClick={saveBridge}>{icon("check", 17)} Save</button>
                    <button className="dp-button" onClick={resetBridge}>{icon("restart_alt", 17)} Reset</button>
                    <button className="dp-button" onClick={refresh}>{icon("sync", 17)} Test</button>
                  </div>
                </div>
                <div className="dp-settings-row">
                  <div style={{ fontSize: 12, fontWeight: 900, color: "var(--dp-muted)" }}>Current host</div>
                  <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>{bridgeBase}</div>
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="dp-main">
          <div className="dp-section-head">
            <div style={{ minWidth: 0 }}>
              <div className="dp-section-title">
                {activeView === "calls" ? "Call History" : activeView === "contacts" ? "Contacts" : "Messages"}
              </div>
              <div className="dp-section-note">
                {activeView === "messages"
                  ? `${conversations.length} threads - ${messages.length} messages`
                  : activeView === "calls"
                    ? `${calls.length} calls`
                    : activeView === "contacts"
                      ? `${contacts.length} contacts`
                      : bridgeBase}
              </div>
            </div>
            <button className="dp-icon-button" onClick={refresh} disabled={!!busy} title="Refresh">
              {icon("refresh", 18)}
            </button>
          </div>

          {error && <div className="dp-alert">{error}</div>}

          {activeView === "messages" && (
            <>
              <div className="dp-thread">
                {selectedConversation ? selectedConversation.messages.map((message) => (
                  <div key={message.id} className={`dp-bubble-row ${message.isSent ? "is-sent" : ""}`}>
                    <div className="dp-bubble">
                      <div className="dp-bubble-text">{message.body || (message.attachments.length ? "Attachment" : "Message")}</div>
                      {message.attachments.length > 0 && (
                        <div style={{ marginTop: 7, display: "grid", gap: 5 }}>
                          {message.attachments.slice(0, 4).map((attachment, index) => (
                            <div key={`${message.id}-att-${index}`} style={{ fontSize: 11, opacity: 0.82 }}>
                              {attachment.isImage ? "Image" : attachment.isContactCard ? "Contact card" : "File"} - {attachment.fileName || attachment.contentType || "attachment"}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="dp-bubble-meta">
                        <span>{fullTimeLabel(message.timestamp)}</span>
                        {message.isSent && <span>{message.isRead ? "Read" : "Sent"}</span>}
                      </div>
                    </div>
                  </div>
                )) : <div className="dp-empty">Select a message thread.</div>}
              </div>
              <div className="dp-composer">
                <input
                  className="dp-input"
                  value={dialNumber}
                  onChange={(event) => setDialNumber(event.target.value)}
                  placeholder="Number"
                />
                <textarea
                  className="dp-textarea"
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Message"
                />
                <button className="dp-icon-button" onClick={sendMessage} disabled={!normalizePhone(dialNumber) || !messageBody.trim() || !!busy} title="Send message">
                  {icon("send", 19)}
                </button>
              </div>
            </>
          )}

          {activeView === "calls" && (
            <div className="dp-call-list">
              {filteredCalls.length ? filteredCalls.map((call) => (
                <div className="dp-call-row" key={`main-${call.id}`}>
                  <span className="dp-avatar">{icon(callIconName(call.direction), 18)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="dp-row-title dp-line">{call.displayName}</div>
                    <div className="dp-row-sub">{call.number} - {call.subtitle || call.direction}</div>
                  </div>
                  <div className="dp-actions">
                    <span style={{ fontSize: 11, color: "var(--dp-muted)", fontWeight: 800 }}>{call.timeDisplay || timeLabel(call.timestamp)}</span>
                    <button className="dp-icon-button" onClick={() => selectNumber(call.number, "messages")} title="Message">{icon("chat", 17)}</button>
                    <button className="dp-icon-button" onClick={() => { selectNumber(call.number, "calls"); dial(call.number); }} title="Call">{icon("call", 17)}</button>
                  </div>
                </div>
              )) : <div className="dp-empty">No call history loaded.</div>}
            </div>
          )}

          {activeView === "contacts" && (
            <div className="dp-call-list">
              {filteredContacts.length ? filteredContacts.map((contact) => (
                <div className="dp-call-row" key={`main-${contact.id}`}>
                  <span className="dp-avatar">{contactInitial(contact.displayName)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="dp-row-title dp-line">{contact.displayName}</div>
                    <div className="dp-row-sub">{contact.phoneNumbers.join(" - ")}</div>
                  </div>
                  <div className="dp-actions">
                    <button className="dp-icon-button" onClick={() => selectNumber(contact.primaryPhone, "messages")} title="Message">{icon("chat", 17)}</button>
                    <button className="dp-icon-button" onClick={() => { selectNumber(contact.primaryPhone, "contacts"); dial(contact.primaryPhone); }} title="Call">{icon("call", 17)}</button>
                  </div>
                </div>
              )) : <div className="dp-empty">No contacts loaded.</div>}
            </div>
          )}

          {activeView === "settings" && (
            <div className="dp-settings">
              <div className="dp-settings-row">
                <div style={{ fontSize: 13, fontWeight: 900 }}>Host status</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>{bridgeOnline ? "Online" : "Offline"}</div>
              </div>
              <div className="dp-settings-row">
                <div style={{ fontSize: 13, fontWeight: 900 }}>Host connector</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>{hostConnectorName}</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>Platform: {hostPlatform}</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>Scope: {hostScope}</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>Contract: {hostContract}</div>
              </div>
              <div className="dp-settings-row">
                <div style={{ fontSize: 13, fontWeight: 900 }}>Phone profiles</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>Calls: {firstText(phoneTransport.calls, "HFP")} - {status?.hfp || "unknown"}</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>Messages: {firstText(phoneTransport.messages, "MAP")} - {status?.map || "unknown"}</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)" }}>Contacts: {firstText(phoneTransport.contacts, "PBAP")}</div>
              </div>
            </div>
          )}
        </main>

        <aside className="dp-detail">
          <div className="dp-section-head">
            <div style={{ minWidth: 0 }}>
              <div className="dp-section-title">Actions</div>
              <div className="dp-section-note">{busy ? `Working: ${busy}` : "Ready"}</div>
            </div>
          </div>
          <div className="dp-detail-body">
            <div className="dp-profile">
              <span className="dp-avatar">{contactInitial(selectedName)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="dp-section-title">{selectedName}</div>
                <div className="dp-section-note">{selectedNumbers.join(" - ") || "No number selected"}</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <input
                className="dp-input"
                value={dialNumber}
                onChange={(event) => setDialNumber(event.target.value)}
                placeholder="Number"
              />
              <div className="dp-command-grid">
                <button className="dp-button primary" onClick={dial} disabled={!normalizePhone(dialNumber) || !!busy}>
                  {icon("call", 17)} Call
                </button>
                <button className="dp-button" onClick={() => setActiveView("messages")} disabled={!dialNumber}>
                  {icon("chat", 17)} Text
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                className="dp-textarea"
                value={messageBody}
                onChange={(event) => setMessageBody(event.target.value)}
                placeholder="Message"
              />
              <button className="dp-button primary" onClick={sendMessage} disabled={!normalizePhone(dialNumber) || !messageBody.trim() || !!busy}>
                {icon("send", 17)} Send message
              </button>
            </div>

            <div className="dp-command-grid">
              <button className="dp-button" onClick={() => runPost("/refresh", "refresh")} disabled={!!busy}>
                {icon("sync", 17)} Sync
              </button>
              <button className="dp-button" onClick={() => runPost("/connect", "connect")} disabled={!!busy}>
                {icon("link", 17)} Connect
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default DeskPhoneWebPanel;
