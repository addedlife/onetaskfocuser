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

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const CONVERSATION_FILTERS = ["All", "Unread", "Pinned", "Muted", "Blocked"];
const CALL_FILTERS = ["All", "Missed", "Incoming", "Outgoing", "Blocked"];
const SETTINGS_SECTIONS = [
  ["connection", "Connection", "settings_ethernet"],
  ["appearance", "Appearance", "palette"],
  ["contacts", "Contact Sync", "sync_alt"],
  ["audio", "Audio", "volume_up"],
];
const DESKPHONE_NAV = [
  ["messages", "Phone", "forum"],
  ["new-message", "New Message", "edit_square"],
  ["dialer", "Make Call", "dialpad"],
  ["calls", "Calls", "call"],
  ["contacts", "Contacts", "contacts"],
  ["settings", "Settings", "settings"],
  ["developer", "Developer Tools", "developer_mode"],
  ["log", "Live Log", "article"],
];

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
      pinned: false,
      muted: false,
      blocked: false,
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

function NativeOnlyButton({ className = "dp-button", children, onUnavailable, title = "Native DeskPhone action" }) {
  return (
    <button className={`${className} is-native-only`} onClick={onUnavailable} title={`${title} - available in native DeskPhone until the host exposes it`}>
      {children}
    </button>
  );
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
  const [conversationFilter, setConversationFilter] = useState("All");
  const [conversationSortNewest, setConversationSortNewest] = useState(true);
  const [conversationSearch, setConversationSearch] = useState("");
  const [callFilter, setCallFilter] = useState("All");
  const [settingsSection, setSettingsSection] = useState("connection");
  const [showMessagesListPane, setShowMessagesListPane] = useState(true);
  const [showConversationCallsPane, setShowConversationCallsPane] = useState(true);
  const [showConversationDialerPane, setShowConversationDialerPane] = useState(true);
  const [showDialPad, setShowDialPad] = useState(false);
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
    const byFilter = conversations.filter((conversation) => {
      if (conversationFilter === "Unread") return conversation.unreadCount > 0;
      if (conversationFilter === "Pinned") return conversation.pinned;
      if (conversationFilter === "Muted") return conversation.muted;
      if (conversationFilter === "Blocked") return conversation.blocked;
      return true;
    });
    const bySearch = q
      ? byFilter.filter((conversation) =>
          `${conversation.displayName} ${conversation.number} ${conversation.lastPreview}`.toLowerCase().includes(q)
        )
      : byFilter;
    return [...bySearch].sort((a, b) => {
      const left = parseDate(a.lastTimestamp)?.getTime() || 0;
      const right = parseDate(b.lastTimestamp)?.getTime() || 0;
      return conversationSortNewest ? right - left : left - right;
    });
  }, [conversations, conversationFilter, conversationSortNewest, search]);

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((call) => {
      const lower = `${call.displayName} ${call.number} ${call.direction} ${call.subtitle}`.toLowerCase();
      if (q && !lower.includes(q)) return false;
      if (callFilter === "Missed") return call.isMissed;
      if (callFilter === "Incoming") return /in|receiv/i.test(call.direction);
      if (callFilter === "Outgoing") return /out|dial/i.test(call.direction);
      if (callFilter === "Blocked") return false;
      return true;
    });
  }, [calls, callFilter, search]);

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

  function showNativeOnly(action) {
    setError(`${action} is visible here for DeskPhone parity, but the current web host does not expose that command yet.`);
  }

  function chooseView(id) {
    if (id === "new-message") {
      setActiveView("messages");
      setSelectedKey("");
      setDialNumber("");
      setMessageBody("");
      setShowMessagesListPane(true);
      return;
    }
    setActiveView(id);
  }

  function appendDialKey(key) {
    setDialNumber((prev) => `${prev}${key}`);
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard?.writeText(message.body || "");
      setError("");
    } catch {
      showNativeOnly("Copy message");
    }
  }

  const selectedName = selectedContact?.displayName || selectedConversation?.displayName || dialNumber || "No contact selected";
  const selectedNumbers = selectedContact?.phoneNumbers?.length ? selectedContact.phoneNumbers : (dialNumber ? [dialNumber] : []);
  const selectedConversationCalls = selectedConversation
    ? calls.filter((call) => numberKey(call.number) === numberKey(selectedConversation.number)).slice(0, 8)
    : [];
  const currentViewTitle = activeView === "dialer"
    ? "Make Call"
    : activeView === "calls"
      ? "Calls"
      : activeView === "contacts"
        ? "Contacts"
        : activeView === "settings"
          ? "Settings"
          : activeView === "developer"
            ? "Developer Tools"
            : activeView === "log"
              ? "Live Log"
              : "Phone";

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
        .dp-button.success,
        .dp-icon-button.success {
          border-color: #137333;
          background: #137333;
          color: #fff;
        }
        .dp-button.is-native-only,
        .dp-icon-button.is-native-only {
          border-style: dashed;
          opacity: 0.72;
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
          grid-template-columns: 232px minmax(250px, 340px) minmax(0, 1fr) minmax(270px, 340px);
          overflow: hidden;
        }
        .dp-rail {
          min-width: 0;
          min-height: 0;
          border-right: 1px solid var(--dp-border);
          background: color-mix(in srgb, var(--dp-panel) 88%, var(--dp-soft));
          display: grid;
          grid-template-rows: 1fr auto;
          overflow: hidden;
        }
        .dp-rail-nav {
          min-height: 0;
          overflow: auto;
          padding: 12px 10px;
          display: grid;
          align-content: start;
          gap: 6px;
        }
        .dp-rail-button {
          width: 100%;
          min-width: 0;
          height: 42px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--dp-muted);
          cursor: pointer;
          display: grid;
          grid-template-columns: 30px minmax(0,1fr);
          gap: 8px;
          align-items: center;
          padding: 0 10px;
          text-align: left;
          font-size: 13px;
          font-weight: 850;
          font-family: inherit;
        }
        .dp-rail-button.is-active {
          background: var(--dp-tonal);
          color: var(--dp-on-tonal);
        }
        .dp-rail-foot {
          border-top: 1px solid var(--dp-border-soft);
          padding: 12px 10px;
          display: grid;
          gap: 8px;
        }
        .dp-rail-card {
          border: 1px solid var(--dp-border-soft);
          border-radius: 8px;
          background: var(--dp-panel);
          padding: 10px;
          display: grid;
          gap: 8px;
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
        .dp-main.no-composer {
          grid-template-rows: auto 1fr;
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
          display: grid;
          gap: 8px;
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
          display: block;
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
          display: block;
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
        .dp-filter-row,
        .dp-toolbar-row {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .dp-filter-button {
          height: 30px;
          border: 1px solid var(--dp-border);
          border-radius: 8px;
          background: transparent;
          color: var(--dp-muted);
          padding: 0 9px;
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 850;
        }
        .dp-filter-button.is-active {
          background: var(--dp-tonal);
          color: var(--dp-on-tonal);
          border-color: transparent;
        }
        .dp-pane-grid {
          min-height: 0;
          overflow: auto;
          background: var(--dp-bg);
          padding: 14px;
          display: grid;
          gap: 12px;
          align-content: start;
        }
        .dp-panel-block {
          border: 1px solid var(--dp-border-soft);
          border-radius: 8px;
          background: var(--dp-panel);
          padding: 14px;
          display: grid;
          gap: 10px;
        }
        .dp-dialpad {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .dp-dial-key {
          height: 54px;
          border-radius: 8px;
          border: 1px solid var(--dp-border);
          background: var(--dp-soft);
          color: var(--dp-text);
          font: inherit;
          font-size: 20px;
          font-weight: 900;
          cursor: pointer;
        }
        .dp-message-tools {
          margin-top: 7px;
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
        }
        .dp-mini-action {
          height: 24px;
          border-radius: 7px;
          border: 1px solid currentColor;
          background: transparent;
          color: inherit;
          opacity: 0.72;
          padding: 0 7px;
          font-size: 10px;
          font-weight: 850;
          cursor: pointer;
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
            grid-template-columns: 74px minmax(240px, 310px) minmax(0, 1fr);
          }
          .dp-rail {
            grid-row: 1 / span 2;
          }
          .dp-rail-button {
            grid-template-columns: 1fr;
            justify-items: center;
            padding: 0;
          }
          .dp-rail-button span:last-child,
          .dp-rail-foot .dp-rail-card > div:not(:first-child),
          .dp-rail-foot .dp-button span {
            display: none;
          }
          .dp-detail {
            grid-column: 2 / -1;
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
          .dp-rail {
            grid-template-rows: auto;
            grid-row: auto;
            width: 100%;
            border-right: 0;
            border-bottom: 1px solid var(--dp-border);
          }
          .dp-rail-nav {
            display: flex;
            overflow-x: auto;
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
          }
          .dp-rail-button {
            width: auto;
            min-width: 74px;
            grid-template-columns: 1fr;
            justify-items: center;
            padding: 0 8px;
          }
          .dp-rail-foot {
            display: none;
          }
          .dp-rail,
          .dp-left,
          .dp-main,
          .dp-detail {
            grid-column: 1 / -1;
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
        <aside className="dp-rail">
          <nav className="dp-rail-nav" aria-label="DeskPhone sections">
            {DESKPHONE_NAV.map(([id, label, iconName]) => (
              <button
                key={id}
                className={`dp-rail-button ${activeView === id || (id === "new-message" && !selectedConversation && activeView === "messages") ? "is-active" : ""}`}
                onClick={() => chooseView(id)}
                title={label}
              >
                {icon(iconName, 19)}
                <span className="dp-line">{label}</span>
              </button>
            ))}
          </nav>
          <div className="dp-rail-foot">
            <div className="dp-rail-card">
              <div className="dp-section-title">Connection</div>
              <div className="dp-section-note">{connected ? "Phone connected" : bridgeOnline ? "Host online" : "Host offline"}</div>
              <div className="dp-command-grid">
                <button className="dp-button" onClick={() => runPost("/connect", "connect")} disabled={!!busy} title="Clean reconnect to saved device">
                  {icon("link", 17)} <span>Connect</span>
                </button>
                <button className="dp-button" onClick={() => chooseView("settings")} title="Connection settings">
                  {icon("settings", 17)} <span>Settings</span>
                </button>
              </div>
            </div>
          </div>
        </aside>

        <aside className="dp-left">
          <div className="dp-section-head">
            <div style={{ minWidth: 0 }}>
              <div className="dp-section-title">
                {activeView === "settings" ? "Settings" : activeView === "contacts" ? "Contacts" : activeView === "calls" ? "Call History" : "Messages"}
              </div>
              <div className="dp-section-note">
                {activeView === "messages"
                  ? `${filteredConversations.length} of ${conversations.length} threads`
                  : activeView === "calls"
                    ? `${filteredCalls.length} of ${calls.length} calls`
                    : activeView === "contacts"
                      ? `${filteredContacts.length} of ${contacts.length} contacts`
                      : hostConnectorName}
              </div>
            </div>
            {activeView === "messages" && (
              <button className="dp-icon-button" onClick={() => setShowMessagesListPane((value) => !value)} title={showMessagesListPane ? "Hide threads" : "Show threads"}>
                {icon(showMessagesListPane ? "close" : "menu_open", 18)}
              </button>
            )}
          </div>

          {activeView === "settings" ? (
            <div className="dp-list">
              {SETTINGS_SECTIONS.map(([id, label, iconName]) => (
                <button key={id} className={`dp-row ${settingsSection === id ? "is-active" : ""}`} onClick={() => setSettingsSection(id)}>
                  <span className="dp-avatar">{icon(iconName, 18)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="dp-row-title dp-line">{label}</span>
                    <span className="dp-row-sub">DeskPhone settings section</span>
                  </span>
                </button>
              ))}
            </div>
          ) : activeView === "messages" && !showMessagesListPane ? (
            <div className="dp-pane-grid">
              <div className="dp-panel-block">
                <div className="dp-section-title">Threads hidden</div>
                <div className="dp-section-note">Matches the native hide-threads control.</div>
                <button className="dp-button primary" onClick={() => setShowMessagesListPane(true)}>{icon("menu_open", 17)} Show threads</button>
              </div>
            </div>
          ) : (
            <>
              <div className="dp-search">
                <input
                  className="dp-input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={activeView === "calls" ? "Search calls" : activeView === "contacts" ? "Search contacts" : "Search messages"}
                />
                {activeView === "messages" && (
                  <>
                    <div className="dp-filter-row">
                      {CONVERSATION_FILTERS.map((filter) => (
                        <button key={filter} className={`dp-filter-button ${conversationFilter === filter ? "is-active" : ""}`} onClick={() => setConversationFilter(filter)}>
                          {filter}
                        </button>
                      ))}
                    </div>
                    <div className="dp-toolbar-row">
                      <button className="dp-button" onClick={() => chooseView("new-message")}>{icon("add", 17)} New</button>
                      <button className="dp-button" onClick={() => setConversationSortNewest((value) => !value)}>{icon("sort", 17)} {conversationSortNewest ? "Newest" : "Oldest"}</button>
                    </div>
                  </>
                )}
                {activeView === "calls" && (
                  <div className="dp-filter-row">
                    {CALL_FILTERS.map((filter) => (
                      <button key={filter} className={`dp-filter-button ${callFilter === filter ? "is-active" : ""}`} onClick={() => setCallFilter(filter)}>
                        {filter}
                      </button>
                    ))}
                  </div>
                )}
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
                    <button key={call.id} className="dp-row" onClick={() => selectNumber(call.number, "calls")}>
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
                    <button key={contact.id} className="dp-row" onClick={() => selectNumber(contact.primaryPhone || contact.phoneNumbers[0], "contacts")}>
                      <span className="dp-avatar">{contactInitial(contact.displayName)}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="dp-row-title dp-line">{contact.displayName}</span>
                        <span className="dp-row-sub">{contact.phoneNumbers[0] || "No number"}</span>
                      </span>
                      <span className="dp-row-meta">{contact.phoneNumbers.length > 1 ? `${contact.phoneNumbers.length} nums` : ""}</span>
                    </button>
                  )) : <div className="dp-empty">No contacts loaded.</div>
                )}
              </div>
            </>
          )}
        </aside>

        <main className={`dp-main ${activeView !== "messages" ? "no-composer" : ""}`}>
          <div className="dp-section-head">
            <div style={{ minWidth: 0 }}>
              <div className="dp-section-title">{currentViewTitle}</div>
              <div className="dp-section-note">
                {activeView === "messages"
                  ? selectedConversation ? `${selectedConversation.displayName} - ${selectedConversation.messages.length} messages` : "Start a new conversation"
                  : activeView === "dialer"
                    ? callState || "Ready"
                    : activeView === "calls"
                      ? `${filteredCalls.length} visible records`
                      : activeView === "contacts"
                        ? "Call, text, edit, or add contacts"
                        : activeView === "developer"
                          ? "Build history, logs, and diagnostic tools"
                          : activeView === "log"
                            ? "Native live log bridge"
                            : `${hostPlatform} - ${hostScope}`}
              </div>
            </div>
            <div className="dp-actions">
              {activeView === "messages" && (
                <>
                  <button className="dp-icon-button" onClick={() => setShowConversationCallsPane((value) => !value)} title="Show or hide conversation calls">{icon("call_log", 18)}</button>
                  <button className="dp-icon-button" onClick={() => setShowConversationDialerPane((value) => !value)} title="Show or hide dialer">{icon("dialpad", 18)}</button>
                  <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Block or unblock conversation")} title="Block conversation">{icon("block", 18)}</NativeOnlyButton>
                  <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Pin or unpin conversation")} title="Pin conversation">{icon("push_pin", 18)}</NativeOnlyButton>
                  <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Mute or unmute alerts")} title="Mute alerts">{icon("notifications_off", 18)}</NativeOnlyButton>
                </>
              )}
              <button className="dp-icon-button" onClick={refresh} disabled={!!busy} title="Refresh">{icon("refresh", 18)}</button>
            </div>
          </div>

          {error && <div className="dp-alert">{error}</div>}

          {activeView === "messages" && (
            <>
              {selectedConversation && (
                <div className="dp-search" style={{ borderBottom: "1px solid var(--dp-border-soft)" }}>
                  <div className="dp-toolbar-row">
                    <input className="dp-input" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search in conversation" />
                    <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Previous search match")} title="Previous match">{icon("keyboard_arrow_up", 18)}</NativeOnlyButton>
                    <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Next search match")} title="Next match">{icon("keyboard_arrow_down", 18)}</NativeOnlyButton>
                    <button className="dp-icon-button" onClick={() => setConversationSearch("")} title="Clear search">{icon("close", 18)}</button>
                  </div>
                </div>
              )}
              <div className="dp-thread">
                {selectedConversation ? selectedConversation.messages
                  .filter((message) => !conversationSearch.trim() || `${message.body} ${message.preview}`.toLowerCase().includes(conversationSearch.trim().toLowerCase()))
                  .map((message) => (
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
                        <div className="dp-message-tools">
                          <button className="dp-mini-action" onClick={() => copyMessage(message)}>Copy</button>
                          {message.isSent && <NativeOnlyButton className="dp-mini-action" onUnavailable={() => showNativeOnly("Retry message")} title="Retry failed message">Retry</NativeOnlyButton>}
                          {message.attachments.length > 0 && <NativeOnlyButton className="dp-mini-action" onUnavailable={() => showNativeOnly("Save attachment")} title="Save attachment">Save</NativeOnlyButton>}
                          <NativeOnlyButton className="dp-mini-action" onUnavailable={() => showNativeOnly("Delete message")} title="Delete message">Delete</NativeOnlyButton>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="dp-empty">Choose a thread or type a number below to start a new message.</div>
                  )}
              </div>
              <div className="dp-composer">
                <input className="dp-input" value={dialNumber} onChange={(event) => setDialNumber(event.target.value)} placeholder="Name or number" />
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
                <div style={{ display: "grid", gap: 8 }}>
                  <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Add attachment")} title="Add attachment">{icon("attach_file", 19)}</NativeOnlyButton>
                  <button className="dp-icon-button success" onClick={sendMessage} disabled={!normalizePhone(dialNumber) || !messageBody.trim() || !!busy} title="Send message">
                    {icon("send", 19)}
                  </button>
                </div>
              </div>
            </>
          )}

          {activeView === "dialer" && (
            <div className="dp-pane-grid">
              <div className="dp-panel-block">
                <div className="dp-section-title">Make Call</div>
                <input className="dp-input" value={dialNumber} onChange={(event) => setDialNumber(event.target.value)} placeholder="Name or number" />
                <div className="dp-dialpad">
                  {DIAL_KEYS.map((key) => <button key={key} className="dp-dial-key" onClick={() => appendDialKey(key)}>{key}</button>)}
                </div>
                <div className="dp-command-grid">
                  <button className="dp-button success" onClick={dial} disabled={!normalizePhone(dialNumber) || !!busy}>{icon("call", 17)} Call</button>
                  <NativeOnlyButton onUnavailable={() => showNativeOnly("Dial voicemail")} title="Voicemail">{icon("voicemail", 17)} Voicemail</NativeOnlyButton>
                </div>
              </div>
            </div>
          )}

          {activeView === "calls" && (
            <div className="dp-call-list">
              <div className="dp-toolbar-row" style={{ padding: 12, borderBottom: "1px solid var(--dp-border-soft)", background: "var(--dp-panel)" }}>
                <NativeOnlyButton onUnavailable={() => showNativeOnly("Delete all call history")} title="Delete all call history">{icon("delete_sweep", 17)} Delete all</NativeOnlyButton>
                <NativeOnlyButton onUnavailable={() => showNativeOnly("Undo call-history delete")} title="Undo call-history delete">{icon("undo", 17)} Undo</NativeOnlyButton>
              </div>
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
                    <button className="dp-icon-button success" onClick={() => { selectNumber(call.number, "calls"); dial(call.number); }} title="Call">{icon("call", 17)}</button>
                    <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Block call record")} title="Block caller">{icon("block", 17)}</NativeOnlyButton>
                    <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Delete call record")} title="Delete call record">{icon("delete", 17)}</NativeOnlyButton>
                  </div>
                </div>
              )) : <div className="dp-empty">No call history loaded.</div>}
            </div>
          )}

          {activeView === "contacts" && (
            <div className="dp-pane-grid">
              <div className="dp-panel-block">
                <div className="dp-toolbar-row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="dp-section-title">Contacts</div>
                    <div className="dp-section-note">Search saved contacts, then call, text, edit, or add.</div>
                  </div>
                  <NativeOnlyButton onUnavailable={() => showNativeOnly("New contact")} title="New contact">{icon("person_add", 17)} New Contact</NativeOnlyButton>
                </div>
              </div>
              {filteredContacts.length ? filteredContacts.map((contact) => (
                <div className="dp-call-row" key={`main-${contact.id}`}>
                  <span className="dp-avatar">{contactInitial(contact.displayName)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="dp-row-title dp-line">{contact.displayName}</div>
                    <div className="dp-row-sub">{contact.phoneNumbers.join(" - ")}</div>
                  </div>
                  <div className="dp-actions">
                    <button className="dp-icon-button" onClick={() => selectNumber(contact.primaryPhone || contact.phoneNumbers[0], "messages")} title="Text">{icon("chat", 17)}</button>
                    <button className="dp-icon-button success" onClick={() => { selectNumber(contact.primaryPhone || contact.phoneNumbers[0], "contacts"); dial(contact.primaryPhone || contact.phoneNumbers[0]); }} title="Call">{icon("call", 17)}</button>
                    <NativeOnlyButton className="dp-icon-button" onUnavailable={() => showNativeOnly("Edit contact")} title="Edit details">{icon("edit", 17)}</NativeOnlyButton>
                  </div>
                </div>
              )) : <div className="dp-empty">No contacts loaded.</div>}
              <div className="dp-panel-block">
                <div className="dp-section-title">Editor</div>
                <input className="dp-input" value={selectedContact?.displayName || ""} readOnly placeholder="Name" />
                <input className="dp-input" value={selectedContact?.primaryPhone || ""} readOnly placeholder="Phone" />
                <div className="dp-command-grid">
                  <NativeOnlyButton onUnavailable={() => showNativeOnly("Start new contact")} title="New contact">New</NativeOnlyButton>
                  <NativeOnlyButton onUnavailable={() => showNativeOnly("Delete contact")} title="Delete contact">Delete</NativeOnlyButton>
                  <NativeOnlyButton className="dp-button primary" onUnavailable={() => showNativeOnly("Save contact")} title="Save contact">Save Contact</NativeOnlyButton>
                </div>
              </div>
            </div>
          )}

          {activeView === "settings" && (
            <div className="dp-pane-grid">
              {settingsSection === "connection" && (
                <>
                  <div className="dp-panel-block">
                    <div className="dp-section-title">Primary Device</div>
                    <div className="dp-section-note">{connected ? "Connected through the host app" : "Use the host app to connect to the saved phone"}</div>
                    <div className="dp-command-grid">
                      <button className="dp-button primary" onClick={() => runPost("/connect", "connect")} disabled={!!busy}>Connect</button>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Scan for new device")} title="Scan for new device">Scan for new device</NativeOnlyButton>
                    </div>
                  </div>
                  <div className="dp-panel-block">
                    <div className="dp-section-title">Scan and Pair</div>
                    <div className="dp-toolbar-row">
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Scan for devices")} title="Scan for devices">Scan for devices</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Open Bluetooth Settings")} title="Open Bluetooth Settings">Open Bluetooth Settings</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Connect selected device")} title="Connect selected device">Connect to selected device</NativeOnlyButton>
                    </div>
                  </div>
                  <div className="dp-panel-block">
                    <label style={{ fontSize: 12, fontWeight: 900, color: "var(--dp-muted)" }}>Host control address</label>
                    <input className="dp-input" value={draftBridge} onChange={(event) => setDraftBridge(event.target.value)} />
                    <div className="dp-toolbar-row">
                      <button className="dp-button primary" onClick={saveBridge}>{icon("check", 17)} Save</button>
                      <button className="dp-button" onClick={resetBridge}>{icon("restart_alt", 17)} Reset</button>
                      <button className="dp-button" onClick={refresh}>{icon("sync", 17)} Test</button>
                    </div>
                  </div>
                </>
              )}
              {settingsSection === "appearance" && (
                <>
                  <div className="dp-panel-block">
                    <div className="dp-section-title">Appearance</div>
                    <div className="dp-section-note">Text size, dark mode, theme sync, and auditor controls from native DeskPhone.</div>
                    <div className="dp-toolbar-row">
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Reset text size")} title="Reset text size">Reset</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Toggle dark mode")} title="Dark mode">Dark mode</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Sync theme with Shamash app")} title="Theme sync">Sync theme</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Refresh theme sync")} title="Refresh sync">Refresh sync</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Open UI auditor")} title="Open Auditor">Open Auditor</NativeOnlyButton>
                    </div>
                  </div>
                </>
              )}
              {settingsSection === "contacts" && (
                <>
                  <div className="dp-panel-block">
                    <div className="dp-section-title">Contact Sync</div>
                    <div className="dp-section-note">PBAP is read-heavy; phone-side writes still require a helper contract.</div>
                    <div className="dp-toolbar-row">
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Import starter VCF")} title="Import starter VCF">Import starter VCF</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Import synced contacts")} title="Import synced contacts">Import synced contacts</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Ignore pending contacts")} title="Ignore pending contacts">Ignore pending</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Open contact sync folder")} title="Open contact sync folder">Open contact sync folder</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Save messages backup")} title="Save messages backup">Save messages backup</NativeOnlyButton>
                      <NativeOnlyButton onUnavailable={() => showNativeOnly("Open Bluetooth Settings")} title="Open Bluetooth Settings">Open Bluetooth Settings</NativeOnlyButton>
                    </div>
                  </div>
                </>
              )}
              {settingsSection === "audio" && (
                <div className="dp-panel-block">
                  <div className="dp-section-title">Audio</div>
                  <div className="dp-section-note">Playback, microphone, and call-audio routing controls.</div>
                  <div className="dp-toolbar-row">
                    <NativeOnlyButton onUnavailable={() => showNativeOnly("Refresh audio devices")} title="Refresh audio">Refresh</NativeOnlyButton>
                    <NativeOnlyButton onUnavailable={() => showNativeOnly("Open Sound Settings")} title="Open Sound Settings">Open Sound Settings</NativeOnlyButton>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeView === "developer" && (
            <div className="dp-pane-grid">
              <div className="dp-panel-block">
                <div className="dp-section-title">Developer Tools</div>
                <div className="dp-section-note">Build history, logs, and diagnostic tools.</div>
                <div className="dp-toolbar-row">
                  <NativeOnlyButton onUnavailable={() => showNativeOnly("Open builds folder")} title="Open builds folder">Open builds folder</NativeOnlyButton>
                  <button className="dp-button" onClick={() => chooseView("log")}>Open event log</button>
                  <NativeOnlyButton onUnavailable={() => showNativeOnly("Run UI auditor")} title="Run UI auditor">Run UI auditor</NativeOnlyButton>
                </div>
              </div>
              <div className="dp-panel-block">
                <div className="dp-section-title">Current host</div>
                <div className="dp-section-note">{hostConnectorName}</div>
                <div style={{ fontSize: 12, color: "var(--dp-muted)", overflowWrap: "anywhere" }}>Platform: {hostPlatform} - Scope: {hostScope} - Contract: {hostContract}</div>
              </div>
            </div>
          )}

          {activeView === "log" && (
            <div className="dp-pane-grid">
              <div className="dp-panel-block">
                <div className="dp-section-title">Live Log</div>
                <div className="dp-section-note">The browser can show the native app, but the log stream is still a native DeskPhone surface.</div>
                <div className="dp-toolbar-row">
                  {onLaunchNative && <button className="dp-button primary" onClick={onLaunchNative}>{icon("open_in_new", 17)} Open native DeskPhone</button>}
                  <button className="dp-button" onClick={() => runPost("/show", "show")} disabled={!!busy}>{icon("visibility", 17)} Focus host</button>
                </div>
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

            {showConversationDialerPane && (
              <div className="dp-panel-block">
                <div className="dp-section-title">Dialer</div>
                <input className="dp-input" value={dialNumber} onChange={(event) => setDialNumber(event.target.value)} placeholder="Name or number" />
                {showDialPad && (
                  <div className="dp-dialpad">
                    {DIAL_KEYS.map((key) => <button key={`side-${key}`} className="dp-dial-key" onClick={() => appendDialKey(key)}>{key}</button>)}
                  </div>
                )}
                <div className="dp-command-grid">
                  <button className="dp-button success" onClick={dial} disabled={!normalizePhone(dialNumber) || !!busy}>{icon("call", 17)} Call</button>
                  <button className="dp-button" onClick={() => setActiveView("messages")} disabled={!dialNumber}>{icon("chat", 17)} Text</button>
                  <button className="dp-button" onClick={() => setShowDialPad((value) => !value)}>{icon("dialpad", 17)} Keypad</button>
                  <NativeOnlyButton onUnavailable={() => showNativeOnly("Dial voicemail")} title="Voicemail">{icon("voicemail", 17)} Voicemail</NativeOnlyButton>
                </div>
              </div>
            )}

            <div className="dp-panel-block">
              <div className="dp-section-title">Message</div>
              <textarea className="dp-textarea" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder="Message" />
              <div className="dp-command-grid">
                <NativeOnlyButton onUnavailable={() => showNativeOnly("Add attachment")} title="Add attachment">{icon("attach_file", 17)} Attach</NativeOnlyButton>
                <button className="dp-button primary" onClick={sendMessage} disabled={!normalizePhone(dialNumber) || !messageBody.trim() || !!busy}>{icon("send", 17)} Send</button>
              </div>
            </div>

            {showConversationCallsPane && (
              <div className="dp-panel-block">
                <div className="dp-section-title">Recent calls</div>
                {(selectedConversationCalls.length ? selectedConversationCalls : calls.slice(0, 5)).map((call) => (
                  <div key={`detail-${call.id}`} className="dp-toolbar-row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--dp-border-soft)", paddingTop: 8 }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="dp-row-title dp-line">{call.displayName}</span>
                      <span className="dp-row-sub">{call.timeDisplay || timeLabel(call.timestamp)}</span>
                    </span>
                    <button className="dp-icon-button success" onClick={() => dial(call.number)} title="Call back">{icon("call", 17)}</button>
                  </div>
                ))}
                {!calls.length && <div className="dp-section-note">No recent calls loaded.</div>}
              </div>
            )}

            <div className="dp-command-grid">
              <button className="dp-button" onClick={() => runPost("/refresh", "refresh")} disabled={!!busy}>{icon("sync", 17)} Sync</button>
              <button className="dp-button" onClick={() => runPost("/connect", "connect")} disabled={!!busy}>{icon("link", 17)} Connect</button>
              <button className="dp-button primary" onClick={() => runPost("/answer", "answer")} disabled={!isRinging || !!busy}>{icon("phone_callback", 17)} Answer</button>
              <button className="dp-button danger" onClick={() => runPost("/hangup", "hangup")} disabled={(!isCallActive && !isRinging) || !!busy}>{icon("call_end", 17)} End</button>
              <NativeOnlyButton onUnavailable={() => showNativeOnly("Mute microphone")} title="Mute microphone">{icon("mic_off", 17)} Mute</NativeOnlyButton>
              <NativeOnlyButton onUnavailable={() => showNativeOnly("Undo last delete")} title="Undo last delete">{icon("undo", 17)} Undo</NativeOnlyButton>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default DeskPhoneWebPanel;
