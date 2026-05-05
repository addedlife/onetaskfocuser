import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_HOST = "http://127.0.0.1:8765";
const HOST_CONNECTOR_KEY = "deskphone_web_host_url";
const LEGACY_BRIDGE_KEY = "deskphone_web_bridge_url";
const RAIL_COLLAPSED_KEY = "deskphone_web_rail_collapsed";
const RAIL_WIDTH_KEY = "deskphone_web_rail_width";
const MESSAGE_LIST_WIDTH_KEY = "deskphone_web_message_list_width";
const CALL_HISTORY_WIDTH_KEY = "deskphone_web_call_history_width";
const DESKPHONE_WEB_VERSION = "001";

const COLORS = {
  bgMain: "#FAFAFA",
  bgSidebar: "#F8F9FA",
  bgHover: "#F0F2F5",
  bgInput: "#F5F7FA",
  bgSelected: "#E8F0FE",
  accentBlue: "#1A73E8",
  accentBlueDark: "#1557B0",
  accentBlueLight: "#D2E3FC",
  accentGreen: "#1E8E3E",
  accentGreenDark: "#137333",
  accentGreenLight: "#CEEAD6",
  accentRed: "#D93025",
  accentRedLight: "#FCE8E6",
  textPrimary: "#202124",
  textSecond: "#3C4043",
  textMuted: "#5F6368",
  textDisabled: "#9AA0A6",
  textOnAccent: "#FFFFFF",
  textOnAccentBlueLight: "#174EA6",
  border: "#E8EAED",
};

const SHELL_PARITY_ROWS = [
  ["MainWindow.xaml:359", "RootShellGrid", "Root frame, rounded text rendering, scaled shell"],
  ["MainWindow.xaml:373", "RootNavigationColumn", "Navigation rail width 292, runtime 268, min 224, max 360"],
  ["MainWindow.xaml:382", "Left rail border", "Sidebar background and right divider"],
  ["MainWindow.xaml:396", "App identity", "36 by 36 app icon, DeskPhone title, web version, Windows host build"],
  ["MainWindow.xaml:442", "NavigationRailToggleButton", "Collapse or expand sidebar"],
  ["MainWindow.xaml:455", "NewMessageButton", "Native element exists but is collapsed in this shell slice"],
  ["MainWindow.xaml:508", "NavMessages", "Phone tab"],
  ["MainWindow.xaml:525", "NavMakeCall", "Native element exists but is collapsed in current native rail"],
  ["MainWindow.xaml:544", "NavCalls", "Native element exists but is collapsed in current native rail"],
  ["MainWindow.xaml:562", "NavContacts", "Contacts tab"],
  ["MainWindow.xaml:586", "NavSettings", "Settings tab"],
  ["MainWindow.xaml:603", "NavDeveloperTools", "Developer Tools tab"],
  ["MainWindow.xaml:620", "NavLiveLog", "Native element exists but is collapsed in current native rail"],
  ["MainWindow.xaml:637", "Connection status pill", "Status dot, connection label, quick reconnect, channel labels"],
  ["MainWindow.xaml:788", "Reconnect prompt", "Startup reconnect band with Connect, Choose device, dismiss"],
  ["MainWindow.xaml:823", "Contact import prompt", "Copied as hidden because native XAML hard-collapses it"],
  ["MainWindow.xaml:855", "Build update modal", "Overlay with Use New Build and Not Yet actions"],
  ["MainWindow.xaml:897", "Build update indicator", "Top-right New Build Available button"],
  ["MainWindow.xaml:921", "Active call banner", "Ringing or active call band with mute, accept, hang up"],
];

const MESSAGE_FILTERS = ["All", "Unread", "Pinned", "Muted", "Blocked"];

const MESSAGE_PARITY_ROWS = [
  ["MainWindow.xaml:1036", "MessagesRootGrid", "300px conversation list, splitter, thread pane"],
  ["MainWindow.xaml:1061", "Messages header", "Title, history badge, new message, sort, hide threads"],
  ["MainWindow.xaml:1106", "ConversationSearchBox", "Search field with icon and placeholder"],
  ["MainWindow.xaml:1138", "Conversation filters", "All, Unread, Pinned, Muted, Blocked"],
  ["MainWindow.xaml:1267", "Conversation list row", "Avatar, display name, badges, timestamp, preview"],
  ["MainWindow.xaml:1299", "Conversation context menu", "Mark read/unread, pin, mute, block handoff controls"],
  ["MainWindow.xaml:1438", "No conversation placeholder", "Select a conversation / start a new one"],
  ["MainWindow.xaml:1623", "Conversation header", "Avatar, display name, number, search, action buttons"],
  ["MainWindow.xaml:1845", "Message list", "Date dividers, inbound/outbound bubbles, attachments, action tray"],
  ["MainWindow.xaml:2285", "ScrollToBottomButton", "Floating scroll-to-latest button"],
  ["MainWindow.xaml:2315", "Undo delete bar", "Copied as dormant handoff until web delete exists"],
  ["MainWindow.xaml:2342", "Compose bar", "Attach, reply box, attachment chips, send button"],
  ["MainWindow.xaml:2459", "Conversation call history", "Thread-side call history with call-back action"],
];

const NAV_ITEMS = [
  {
    id: "messages",
    label: "Phone",
    icon: "forum",
    nativeGlyph: "E0CA",
    source: "MainWindow.xaml:508",
    automationId: "NavMessages",
    tooltip: "Phone: messages and calls",
    kind: "radio",
    visible: true,
  },
  {
    id: "make-call",
    label: "Make Call",
    icon: "call",
    nativeGlyph: "E0B0",
    source: "MainWindow.xaml:525",
    automationId: "NavMakeCall",
    tooltip: "Make a call",
    kind: "button",
    visible: false,
  },
  {
    id: "calls",
    label: "Calls",
    icon: "call",
    nativeGlyph: "E0B0",
    source: "MainWindow.xaml:544",
    automationId: "NavCalls",
    tooltip: "Calls",
    kind: "radio",
    visible: false,
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: "contacts",
    nativeGlyph: "E7FD",
    source: "MainWindow.xaml:562",
    automationId: "NavContacts",
    tooltip: "Contacts",
    kind: "radio",
    visible: true,
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    nativeGlyph: "E8B8",
    source: "MainWindow.xaml:586",
    automationId: "NavSettings",
    tooltip: "Settings",
    kind: "radio",
    visible: true,
  },
  {
    id: "developer",
    label: "Developer Tools",
    icon: "developer_mode",
    nativeGlyph: "E869",
    source: "MainWindow.xaml:603",
    automationId: "NavDeveloperTools",
    tooltip: "Developer Tools",
    kind: "radio",
    visible: true,
  },
  {
    id: "live-log",
    label: "Live Log",
    icon: "article",
    nativeGlyph: "EB8E",
    source: "MainWindow.xaml:620",
    automationId: "NavLiveLog",
    tooltip: "Open or focus the live log window",
    kind: "button",
    visible: false,
  },
];

function icon(name, size = 20) {
  return (
    <span className="material-symbols-rounded dp-material-icon" aria-hidden="true" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

function normalizeHost(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_HOST;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function readSavedHost() {
  try {
    return normalizeHost(
      localStorage.getItem(HOST_CONNECTOR_KEY) ||
        localStorage.getItem(LEGACY_BRIDGE_KEY) ||
        DEFAULT_HOST
    );
  } catch {
    return DEFAULT_HOST;
  }
}

function readSavedRailState() {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readSavedNumber(key, fallback, min, max) {
  try {
    const parsed = Number(localStorage.getItem(key));
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
  } catch {
    return fallback;
  }
}

function saveNumber(key, value) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Locked-down browser modes may block localStorage. The live page still keeps the size in memory.
  }
}

function saveHost(value) {
  const normalized = normalizeHost(value);
  try {
    localStorage.setItem(HOST_CONNECTOR_KEY, normalized);
  } catch {
    // Some locked-down browser modes block localStorage. The current page still keeps the value in memory.
  }
  return normalized;
}

async function readJson(host, path) {
  const response = await fetch(`${host}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function postJson(host, path) {
  const response = await fetch(`${host}${path}`, {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true };
  }
}

function handoffPath(target, value = "") {
  const params = new URLSearchParams({ target });
  if (value) params.set("value", value);
  return `/handoff?${params.toString()}`;
}

function nativeHandoffTarget(label, source = "") {
  const text = `${label || ""} ${source || ""}`.toLowerCase();
  if (text.includes("new message") || source.includes("MainWindow.xaml:455") || source.includes("MainWindow.xaml:1078")) return "new-message";
  if (text.includes("make call") || source.includes("MainWindow.xaml:525")) return "make-call";
  if (text.includes("live log") || source.includes("MainWindow.xaml:620")) return "live-log";
  if (text.includes("developer") || source.includes("MainWindow.xaml:603")) return "developer-tools";
  if (text.includes("connection settings") || text.includes("choose device") || source.includes("MainWindow.xaml:701") || source.includes("MainWindow.xaml:745") || source.includes("MainWindow.xaml:812")) return "settings-connection";
  if (text.includes("build")) return "build-update";
  if (text.includes("mark unread")) return "mark-unread";
  if (text.includes("mark read")) return "mark-read";
  if (text.includes("pin / unpin") || text.includes("pin conversation")) return "toggle-pin";
  if (text.includes("mute / unmute") || text.includes("mute alerts")) return "toggle-mute";
  if (text.includes("block / unblock") || text.includes("block locally")) return "toggle-block";
  if (text.includes("edit contact")) return "edit-contact";
  if (text.includes("new contact") || text.includes("add contact") || text.includes("save as contact")) return "new-contact";
  if (text.includes("contact") || source.includes("MainWindow.xaml:562")) return "contacts";
  if (text.includes("call") || source.includes("MainWindow.xaml:544")) return "calls";
  if (source.includes("MainWindow.xaml:")) return "messages";
  return "show";
}

function includesConnected(value) {
  return String(value || "").toLowerCase().includes("connected");
}

function channelLabel(status, label) {
  const text = String(status || "");
  const lower = text.toLowerCase();
  if (lower.includes("connected")) return `${label}: Connected`;
  if (lower.includes("connecting")) return `${label}: Connecting`;
  if (lower.includes("reconnecting")) return `${label}: Reconnecting`;
  if (
    lower.includes("failed") ||
    lower.includes("rejected") ||
    lower.includes("timed out") ||
    lower.includes("denied")
  ) {
    return `${label}: Needs attention`;
  }
  return `${label}: Not connected`;
}

function connectionStatusFromStatus(status) {
  if (!status) return "Not connected";
  const callsOk = includesConnected(status.hfp || status.Hfp || status.calls);
  const msgsOk = includesConnected(status.map || status.Map || status.messages);
  if (callsOk && msgsOk) return "Connected";
  if (callsOk) return "Calls only (messages reconnecting...)";
  if (msgsOk) return "Messages only (calls reconnecting...)";
  return "Not connected";
}

function webVersionLabel() {
  return `DeskPhone Web Version ${DESKPHONE_WEB_VERSION}`;
}

function hostBuildNumber(status) {
  const build = status?.build || status?.Build || status?.buildNumber || status?.BuildNumber || "";
  return String(build).split(/\s+/)[0] || "";
}

function hostBuildLabel(status) {
  const numberOnly = hostBuildNumber(status);
  return numberOnly ? `Windows Host: ${numberOnly}` : "Windows Host: unknown";
}

function hostBuildDetailLabel(status) {
  const build = status?.build || status?.Build || status?.buildNumber || status?.BuildNumber || "";
  return build ? `Windows Host: ${build}` : "Windows Host: not reporting build details";
}

function webVersionBadge() {
  return `Web ${DESKPHONE_WEB_VERSION}`;
}

function hostDeviceName(status) {
  return (
    status?.phoneName ||
    status?.PhoneName ||
    status?.deviceName ||
    status?.DeviceName ||
    status?.connectedDeviceName ||
    status?.ConnectedDeviceName ||
    status?.hostConnector ||
    "saved phone"
  );
}

function quickConnectSummary(status, online) {
  const state = online && status?.connected ? "connected" : online ? "ready" : "ready";
  return `Preferred Phone [${hostDeviceName(status)}] ${state}`;
}

function callBannerText(status) {
  if (!status) return "";
  const callState = String(status.callState || status.CallState || "");
  const number = status.callNumber || status.CallNumber || status.number || "";
  if (status.isRinging || callState === "IncomingRinging") return `Incoming: ${number || "Unknown"}`;
  if (callState === "Dialing") return `Calling ${number || "Unknown"}...`;
  if (status.isCallActive || callState === "Active") return `${number || "Active call"}`;
  if (callState === "Ending") return "Ending call...";
  return "";
}

function getApiList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.value)) return value.value;
  return [];
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhoneKey(value) {
  const digits = digitsOnly(value);
  if (!digits) return String(value || "").trim().toLowerCase();
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function formatPhone(value) {
  const digits = normalizePhoneKey(value);
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return String(value || digits || "Unknown").trim();
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatConversationTime(value) {
  const date = parseDate(value);
  if (!date) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatBubbleTime(value) {
  const date = parseDate(value);
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateDivider(value) {
  const date = parseDate(value);
  if (!date) return "";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function avatarInitial(label) {
  const cleaned = String(label || "").trim();
  if (!cleaned) return "?";
  const firstLetter = cleaned.match(/[A-Za-z0-9]/)?.[0] || cleaned[0];
  return firstLetter.toUpperCase();
}

function messagePreview(message) {
  const body = String(message?.preview || message?.body || "").trim();
  if (body) return body;
  if (message?.isMms) return "Photo";
  if (message?.attachments?.length) return "Attachment";
  return "No preview";
}

function normalizeSendStatus(raw) {
  return String(raw?.sendStatus || raw?.SendStatus || "").trim();
}

function outgoingStatusLabel(message) {
  if (!message?.isSent) return "";
  if (message.outgoingStatusLabel) return message.outgoingStatusLabel;
  return message.sendStatus ? message.sendStatusLabel || message.sendStatus : "Sent";
}

function outgoingStatusIconName(message) {
  const status = String(message?.sendStatus || "").toLowerCase();
  if (status === "sending") return "schedule";
  if (status === "confirming") return "hourglass_top";
  if (status === "failed") return "error";
  return "done_all";
}

function normalizeAttachment(raw, index) {
  const contentType = raw?.contentType || raw?.type || "";
  const fileName = raw?.fileName || raw?.name || `Attachment ${index + 1}`;
  const dataUrl = raw?.dataUrl || raw?.imageDataUrl || raw?.url || "";
  const isImage =
    !!raw?.isImage ||
    /^image\//i.test(contentType) ||
    /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(fileName);

  return {
    ...raw,
    fileName,
    contentType,
    dataUrl,
    isImage,
    isContactCard: !!raw?.isContactCard,
    size: Number(raw?.size || raw?.length || 0),
  };
}

function normalizeMessage(raw, index) {
  const number = raw?.number || raw?.to || raw?.from || "";
  const key = normalizePhoneKey(number) || `unknown-${index}`;
  const timestamp = raw?.timestamp || raw?.time || "";
  const attachments = getApiList(raw?.attachments).map(normalizeAttachment);
  const sendStatus = normalizeSendStatus(raw);
  return {
    id: raw?.id || raw?.handle || `${key}-${timestamp}-${index}`,
    handle: raw?.handle || "",
    key,
    number,
    formattedPhone: formatPhone(number),
    from: raw?.from || "",
    to: raw?.to || "",
    body: raw?.body || raw?.preview || "",
    preview: messagePreview(raw),
    timestamp,
    timestampMs: parseDate(timestamp)?.getTime() || 0,
    isSent: !!raw?.isSent,
    isRead: raw?.isSent ? true : raw?.isRead !== false,
    sendStatus,
    sendStatusLabel: raw?.sendStatusLabel || raw?.SendStatusLabel || "",
    outgoingStatusLabel: raw?.outgoingStatusLabel || raw?.OutgoingStatusLabel || "",
    outgoingStatusIcon: raw?.outgoingStatusIcon || raw?.OutgoingStatusIcon || "",
    isMms: !!raw?.isMms,
    sourceDeviceAddress: raw?.sourceDeviceAddress || "",
    attachments,
  };
}

function attachmentLabel(attachment) {
  if (attachment?.isImage) return "Image";
  if (attachment?.isContactCard) return "Contact card";
  return attachment?.contentType || "Attachment";
}

function saveDataUrlAttachment(attachment, onNativeHandoff) {
  if (!attachment?.dataUrl) {
    onNativeHandoff("Save attachment", "MainWindow.xaml:2006");
    return;
  }

  const link = document.createElement("a");
  link.href = attachment.dataUrl;
  link.download = attachment.fileName || "DeskPhone attachment";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function buildConversations(messages) {
  const grouped = new Map();
  messages.map(normalizeMessage).forEach((message) => {
    const existing = grouped.get(message.key) || {
      key: message.key,
      number: message.number,
      formattedPhone: message.formattedPhone,
      displayName: message.formattedPhone,
      avatarInitial: avatarInitial(message.formattedPhone),
      messages: [],
      isPinned: false,
      areAlertsMuted: false,
      isBlocked: false,
    };
    existing.messages.push(message);
    grouped.set(message.key, existing);
  });

  return Array.from(grouped.values()).map((conversation) => {
    const newestFirst = [...conversation.messages].sort((a, b) => b.timestampMs - a.timestampMs);
    const chronological = [...conversation.messages].sort((a, b) => a.timestampMs - b.timestampMs);
    const latest = newestFirst[0];
    const unreadCount = newestFirst.filter((message) => !message.isSent && !message.isRead).length;
    return {
      ...conversation,
      messages: chronological,
      latest,
      displayName: conversation.displayName,
      avatarInitial: avatarInitial(conversation.displayName),
      preview: latest?.preview || "No preview",
      timestampMs: latest?.timestampMs || 0,
      timestampDisplay: formatConversationTime(latest?.timestamp),
      unreadCount,
      isUnread: unreadCount > 0,
    };
  });
}

function filterConversations(conversations, search, filter, unreadFirst) {
  const query = String(search || "").trim().toLowerCase();
  return conversations
    .filter((conversation) => {
      if (filter === "Unread" && !conversation.isUnread) return false;
      if (filter === "Pinned" && !conversation.isPinned) return false;
      if (filter === "Muted" && !conversation.areAlertsMuted) return false;
      if (filter === "Blocked" && !conversation.isBlocked) return false;
      if (!query) return true;
      return (
        conversation.displayName.toLowerCase().includes(query) ||
        conversation.formattedPhone.toLowerCase().includes(query) ||
        conversation.preview.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (unreadFirst && a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
      return b.timestampMs - a.timestampMs;
    });
}

function groupCallsByNumber(calls, selectedKey) {
  return getApiList(calls)
    .filter((call) => normalizePhoneKey(call?.number) === selectedKey)
    .slice(0, 12);
}

function startHorizontalDrag(event, { startValue, min, max, onChange, invert = false }) {
  event.preventDefault();
  const startX = event.clientX;
  const pointerId = event.pointerId;
  try {
    event.currentTarget.setPointerCapture?.(pointerId);
  } catch {
    // Some automated and embedded browser surfaces do not expose a capturable pointer.
  }

  const handleMove = (moveEvent) => {
    const delta = moveEvent.clientX - startX;
    const next = clamp(startValue + (invert ? -delta : delta), min, max);
    onChange(next);
  };

  const stop = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function SourceTag({ children }) {
  return <span className="dp-source-tag">{children}</span>;
}

function ShellButton({
  children,
  iconName,
  className = "",
  nativeSource,
  nativeGlyph,
  ...props
}) {
  return (
    <button {...props} className={`dp-md-button ${className}`} data-native-source={nativeSource || ""} data-native-glyph={nativeGlyph || ""}>
      {iconName ? icon(iconName, 18) : null}
      <span>{children}</span>
    </button>
  );
}

function RailNavItem({ item, active, collapsed, onSelect }) {
  const className = [
    "dp-nav-item",
    active ? "is-active" : "",
    collapsed ? "is-collapsed" : "",
    item.visible ? "" : "is-native-collapsed",
  ].join(" ");
  return (
    <button
      type="button"
      className={className}
      title={item.tooltip}
      aria-label={item.tooltip}
      data-automation-id={item.automationId}
      data-native-source={item.source}
      data-native-glyph={item.nativeGlyph}
      onClick={() => onSelect(item.id)}
    >
      <span className="dp-nav-icon">{icon(item.icon, item.id === "live-log" ? 20 : 21)}</span>
      {!collapsed ? <span className="dp-nav-label">{item.label}</span> : null}
    </button>
  );
}

function ConnectionRail({
  collapsed,
  online,
  status,
  connectionStatus,
  callsConnectionLabel,
  messagesConnectionLabel,
  onReconnect,
  onSettings,
}) {
  if (collapsed) {
    return (
      <div className="dp-rail-connection-collapsed" data-native-source="MainWindow.xaml:710">
        <div className="dp-collapsed-status-tile" title={connectionStatus}>
          <span className={`dp-status-dot ${online && status?.connected ? "is-online" : ""}`} />
          <span className="dp-collapsed-bt">BT</span>
        </div>
        <button
          className="dp-collapsed-icon-button"
          aria-label="Reconnect saved phone"
          title="Reconnect saved phone"
          data-native-source="MainWindow.xaml:737"
          data-native-glyph="E627"
          onClick={onReconnect}
          disabled={!online}
        >
          {icon("sync", 20)}
        </button>
        <button
          className="dp-collapsed-icon-button"
          aria-label="Connection settings"
          title="Connection settings"
          data-native-source="MainWindow.xaml:745"
          data-native-glyph="E8B8"
          onClick={onSettings}
        >
          {icon("settings", 20)}
        </button>
        <div className="dp-build-badge" title={`${webVersionLabel()} / ${hostBuildDetailLabel(status)}`}>
          {webVersionBadge()}
        </div>
      </div>
    );
  }

  return (
    <div className="dp-rail-connection" data-native-source="MainWindow.xaml:637">
      <div className="dp-rail-status-card">
        <div className="dp-rail-status-row">
          <div className="dp-rail-status-left">
            <span className={`dp-status-dot ${online && status?.connected ? "is-online" : ""}`} />
            <span className="dp-rail-status-text">{connectionStatus}</span>
          </div>
          <button
            className="dp-compact-icon-button"
            aria-label="Reconnect saved phone"
            title="Clean reconnect to saved device"
            data-native-source="MainWindow.xaml:665"
            data-native-glyph="E627"
            onClick={onReconnect}
            disabled={!online}
          >
            {icon("sync", 20)}
          </button>
        </div>
        <div className="dp-rail-subtitle">{quickConnectSummary(status, online)}</div>
        <div className="dp-rail-channel">{callsConnectionLabel}</div>
        <div className="dp-rail-channel">{messagesConnectionLabel}</div>
      </div>
      <ShellButton
        className="dp-tonal dp-rail-wide-button"
        nativeSource="MainWindow.xaml:692"
        onClick={onReconnect}
        disabled={!online}
      >
        Reconnect saved phone
      </ShellButton>
      <ShellButton
        className="dp-tonal dp-rail-wide-button"
        nativeSource="MainWindow.xaml:701"
        onClick={onSettings}
      >
        Connection Settings
      </ShellButton>
    </div>
  );
}

function ReconnectPrompt({ visible, status, onConnect, onChooseDevice, onDismiss }) {
  if (!visible) {
    return (
      <div className="dp-native-hidden" data-native-source="MainWindow.xaml:788" aria-hidden="true">
        <button data-native-source="MainWindow.xaml:808">Connect</button>
        <button data-native-source="MainWindow.xaml:812">Choose device</button>
        <button data-native-source="MainWindow.xaml:816">Dismiss reconnect prompt</button>
      </div>
    );
  }
  return (
    <div className="dp-prompt dp-reconnect-prompt" data-native-source="MainWindow.xaml:788">
      <div className="dp-prompt-text">
        <div className="dp-prompt-title">Reconnect to {hostDeviceName(status)}?</div>
        <div className="dp-prompt-subtitle">Your phone was connected last session.</div>
      </div>
      <ShellButton className="dp-primary" nativeSource="MainWindow.xaml:808" onClick={onConnect}>
        Connect
      </ShellButton>
      <ShellButton className="dp-tonal" nativeSource="MainWindow.xaml:812" onClick={onChooseDevice}>
        Choose device
      </ShellButton>
      <button
        className="dp-compact-icon-button"
        aria-label="Dismiss reconnect prompt"
        title="Dismiss"
        data-native-source="MainWindow.xaml:816"
        data-native-glyph="E5CD"
        onClick={onDismiss}
      >
        {icon("close", 20)}
      </button>
    </div>
  );
}

function ContactImportPrompt() {
  return (
    <div className="dp-native-hidden" data-native-source="MainWindow.xaml:823" aria-hidden="true">
      <div>Contact import prompt</div>
      <button data-native-source="MainWindow.xaml:843">Yes</button>
      <button data-native-source="MainWindow.xaml:847">No</button>
    </div>
  );
}

function BuildUpdateOverlay({ showPrompt, showIndicator, onShowPrompt, onAccept, onSnooze }) {
  return (
    <>
      {showPrompt ? (
        <div className="dp-build-overlay" data-native-source="MainWindow.xaml:855">
          <div className="dp-build-dialog">
            <h2>New DeskPhone build available</h2>
            <p>The native DeskPhone app can switch to the staged build when the host exposes the update action to the web shell.</p>
            <div className="dp-build-dialog-actions">
              <ShellButton className="dp-primary" nativeSource="MainWindow.xaml:882" onClick={onAccept}>
                Use New Build
              </ShellButton>
              <ShellButton className="dp-tonal" nativeSource="MainWindow.xaml:887" onClick={onSnooze}>
                Not Yet
              </ShellButton>
            </div>
          </div>
        </div>
      ) : null}
      {showIndicator ? (
        <div className="dp-build-indicator" data-native-source="MainWindow.xaml:897">
          <ShellButton className="dp-tonal" iconName="notifications" nativeSource="MainWindow.xaml:904" onClick={onShowPrompt}>
            New Build Available
          </ShellButton>
        </div>
      ) : null}
      {!showPrompt && !showIndicator ? (
        <div className="dp-native-hidden" data-native-source="MainWindow.xaml:855" aria-hidden="true">
          <button data-native-source="MainWindow.xaml:882">Use New Build</button>
          <button data-native-source="MainWindow.xaml:887">Not Yet</button>
          <button data-native-source="MainWindow.xaml:904">New Build Available</button>
        </div>
      ) : null}
    </>
  );
}

function CallBanner({ status, muted, onMute, onAnswer, onHangup }) {
  const isRinging = !!(status?.isRinging || status?.callState === "IncomingRinging");
  const isCallActive = !!(status?.isCallActive || status?.callState === "Active" || status?.callState === "Dialing");
  const visible = isRinging || isCallActive;
  if (!visible) {
    return (
      <div className="dp-native-hidden" data-native-source="MainWindow.xaml:921" aria-hidden="true">
        <button data-native-source="MainWindow.xaml:973">Mute</button>
        <button data-native-source="MainWindow.xaml:993">Accept</button>
        <button data-native-source="MainWindow.xaml:1006">Hang Up</button>
      </div>
    );
  }

  return (
    <div className={`dp-call-banner ${isRinging ? "is-ringing" : "is-active-call"}`} data-native-source="MainWindow.xaml:921">
      <div className="dp-call-icon" data-native-source="MainWindow.xaml:951">
        {icon("phone_in_talk", 22)}
      </div>
      <div className="dp-call-text">{callBannerText(status)}</div>
      <div className="dp-call-actions">
        {isCallActive ? (
          <ShellButton
            className={`dp-tonal ${muted ? "is-muted" : ""}`}
            nativeSource="MainWindow.xaml:973"
            onClick={onMute}
            title="Mute currently needs a host endpoint before it can control Windows audio from the web."
          >
            {muted ? "Unmute" : "Mute"}
          </ShellButton>
        ) : null}
        {isRinging ? (
          <ShellButton className="dp-success" nativeSource="MainWindow.xaml:993" onClick={onAnswer}>
            Accept
          </ShellButton>
        ) : null}
        <ShellButton className="dp-destructive" nativeSource="MainWindow.xaml:1006" onClick={onHangup}>
          {isRinging ? "Decline" : "Hang Up"}
        </ShellButton>
      </div>
    </div>
  );
}

function DeskPhoneIconButton({
  iconName,
  label,
  nativeSource,
  nativeGlyph,
  className = "",
  ...props
}) {
  return (
    <button
      {...props}
      type="button"
      className={`dp-compact-icon-button ${className}`}
      aria-label={label}
      title={label}
      data-native-source={nativeSource || ""}
      data-native-glyph={nativeGlyph || ""}
    >
      {icon(iconName, 20)}
    </button>
  );
}

function ConversationRow({ conversation, selected, onSelect, onNativeHandoff }) {
  const rowClass = [
    "dp-conversation-row",
    selected ? "is-selected" : "",
    conversation.isUnread ? "is-unread" : "",
  ].join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      className={rowClass}
      data-native-source="MainWindow.xaml:1267"
      onClick={() => onSelect(conversation.key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(conversation.key);
      }}
    >
      <div className="dp-conversation-avatar" data-native-source="MainWindow.xaml:1334">
        {conversation.avatarInitial}
      </div>
      <div className="dp-conversation-copy">
        <div className="dp-conversation-topline">
          <span className="dp-conversation-name">{conversation.displayName}</span>
          <span className="dp-conversation-badges">
            {conversation.isPinned ? <span>Pinned</span> : null}
            {conversation.areAlertsMuted ? <span>Alerts off</span> : null}
            {conversation.isBlocked ? <span className="is-danger">Blocked</span> : null}
          </span>
          <span className="dp-conversation-time">{conversation.timestampDisplay}</span>
        </div>
        <div className="dp-conversation-preview">{conversation.preview}</div>
      </div>
      <details className="dp-conversation-menu" onClick={(event) => event.stopPropagation()}>
        <summary aria-label="Conversation actions">{icon("more_vert", 18)}</summary>
        <div className="dp-floating-menu" data-native-source="MainWindow.xaml:1299">
          <button type="button" onClick={() => onNativeHandoff("Mark read", "MainWindow.xaml:1301", conversation.number)}>Mark read</button>
          <button type="button" onClick={() => onNativeHandoff("Mark unread", "MainWindow.xaml:1304", conversation.number)}>Mark unread</button>
          <button type="button" onClick={() => onNativeHandoff("Pin / unpin", "MainWindow.xaml:1308", conversation.number)}>Pin / unpin</button>
          <button type="button" onClick={() => onNativeHandoff("Mute / unmute alerts", "MainWindow.xaml:1311", conversation.number)}>Mute / unmute alerts</button>
          <button type="button" onClick={() => onNativeHandoff("Block / unblock locally", "MainWindow.xaml:1314", conversation.number)}>Block / unblock locally</button>
        </div>
      </details>
    </div>
  );
}

function ThreadSearchBar({ value, onChange, matchCount, onNativeHandoff }) {
  const status = value ? (matchCount ? `${matchCount} matches` : "No matches") : "";
  return (
    <div className="dp-thread-search" data-native-source="MainWindow.xaml:1688">
      {icon("search", 15)}
      <input
        aria-label="Search this conversation"
        data-automation-id="ThreadSearchBox"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search this conversation"
      />
      <span>{status}</span>
      <button type="button" title="Previous match" aria-label="Previous match" onClick={() => onNativeHandoff("Previous thread search match", "MainWindow.xaml:1693")}>{icon("keyboard_arrow_up", 18)}</button>
      <button type="button" title="Next match" aria-label="Next match" onClick={() => onNativeHandoff("Next thread search match", "MainWindow.xaml:1697")}>{icon("keyboard_arrow_down", 18)}</button>
      <button type="button" title="Clear search" aria-label="Clear search" onClick={() => onChange("")}>{icon("close", 18)}</button>
    </div>
  );
}

function ImageLightbox({ image, rotation, onClose, onRotate }) {
  if (!image) return null;
  return (
    <div className="dp-image-viewer" role="dialog" aria-modal="true" aria-label={image.fileName || "MMS image"}>
      <button type="button" className="dp-image-viewer-close" aria-label="Close image" title="Close" onClick={onClose}>
        {icon("close", 26)}
      </button>
      <div className="dp-image-viewer-stage" onDoubleClick={onClose}>
        <img
          src={image.dataUrl}
          alt={image.fileName || "MMS image"}
          style={{ transform: `rotate(${rotation}deg)` }}
        />
      </div>
      <div className="dp-image-viewer-tools" aria-label="Image tools">
        <button type="button" aria-label="Rotate left" title="Rotate left" onClick={() => onRotate(-90)}>
          {icon("rotate_left", 24)}
        </button>
        <button type="button" aria-label="Rotate right" title="Rotate right" onClick={() => onRotate(90)}>
          {icon("rotate_right", 24)}
        </button>
      </div>
    </div>
  );
}

function MessageAttachments({ message, onNativeHandoff, onOpenImage }) {
  if (!message.attachments.length) return null;
  return (
    <div className="dp-attachment-stack">
      {message.attachments.map((attachment, index) => {
        const isInlineImage = attachment.isImage && attachment.dataUrl;
        return (
          <React.Fragment key={`${message.id}-attachment-${index}`}>
          {isInlineImage ? (
            <img
              className="dp-mms-image"
              src={attachment.dataUrl}
              alt={attachment.fileName || "MMS image"}
              loading="lazy"
              role="button"
              tabIndex={0}
              title="Double-click to open full screen"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onOpenImage(attachment);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.stopPropagation();
                  onOpenImage(attachment);
                }
              }}
            />
          ) : null}
          {!isInlineImage ? (
            <div className={`dp-attachment-row ${message.isSent ? "is-outgoing" : ""}`}>
            {icon(attachment.isImage ? "image" : attachment.isContactCard ? "contact_page" : "attach_file", 18)}
            <div>
              <strong>{attachment.fileName || "Attachment"}</strong>
              <span>{attachmentLabel(attachment)}{attachment.size ? ` - ${Math.round(attachment.size / 1024)} KB` : ""}</span>
            </div>
            <button type="button" onClick={() => saveDataUrlAttachment(attachment, onNativeHandoff)}>Save</button>
            </div>
          ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MessageBubble({ message, previousMessage, open, onToggleOpen, onCopy, onCall, onNativeHandoff, onOpenImage }) {
  const currentDivider = formatDateDivider(message.timestamp);
  const previousDivider = previousMessage ? formatDateDivider(previousMessage.timestamp) : "";
  const showDateDivider = currentDivider && currentDivider !== previousDivider;
  const hasVisibleImage = message.attachments.some((attachment) => attachment.isImage && attachment.dataUrl);
  const hasNonImageAttachment = message.attachments.some((attachment) => !(attachment.isImage && attachment.dataUrl));
  const isMediaOnly = hasVisibleImage && !hasNonImageAttachment && !message.body;
  const statusLabel = outgoingStatusLabel(message);
  const hasPendingSendStatus = !!message.sendStatus;
  const bubbleClass = [
    "dp-message-bubble",
    message.isSent ? "is-outgoing" : "is-incoming",
    isMediaOnly ? "is-media-only" : "",
    hasPendingSendStatus ? "has-send-status" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={`dp-message-item ${message.isSent ? "is-outgoing" : "is-incoming"}`} data-native-source="MainWindow.xaml:1845">
      {showDateDivider ? <div className="dp-date-divider" data-native-source="MainWindow.xaml:1872">{currentDivider}</div> : null}
      <div
        role="button"
        tabIndex={0}
        className={bubbleClass}
        data-native-source={message.isSent ? "MainWindow.xaml:2163" : "MainWindow.xaml:1889"}
        onClick={() => onToggleOpen(message.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onToggleOpen(message.id);
        }}
      >
        {message.body ? <div className="dp-message-body">{message.body}</div> : null}
        {!message.body && message.isMms && !hasVisibleImage ? <div className="dp-message-body dp-muted-body">MMS message</div> : null}
        <MessageAttachments message={message} onNativeHandoff={onNativeHandoff} onOpenImage={onOpenImage} />
        <div className="dp-message-meta">
          {message.isSent ? (
            <span
              className={`dp-message-status ${message.sendStatus ? `is-${message.sendStatus.toLowerCase()}` : ""}`}
              title={statusLabel}
              aria-label={statusLabel}
            >
              {icon(outgoingStatusIconName(message), 13)}
              {message.sendStatus ? <span>{statusLabel}</span> : null}
            </span>
          ) : null}
          <span>{formatBubbleTime(message.timestamp)}</span>
        </div>
        {open ? (
          <div className="dp-bubble-actions" data-native-source={message.isSent ? "MainWindow.xaml:2248" : "MainWindow.xaml:2032"}>
            <button type="button" title="Copy" onClick={(event) => { event.stopPropagation(); onCopy(message); }}>{icon("content_copy", 17)}</button>
            <button type="button" title="Forward" onClick={(event) => { event.stopPropagation(); onNativeHandoff("Forward message", "MainWindow.xaml:2037", message.number); }}>{icon("forward", 17)}</button>
            <button type="button" title="Call" onClick={(event) => { event.stopPropagation(); onCall(message.number); }}>{icon("call", 17)}</button>
            <button type="button" title="Delete" onClick={(event) => { event.stopPropagation(); onNativeHandoff("Delete message", "MainWindow.xaml:2043", message.number); }}>{icon("delete", 17)}</button>
            <button type="button" title="Pin" onClick={(event) => { event.stopPropagation(); onNativeHandoff("Pin message", "MainWindow.xaml:2047", message.number); }}>{icon("push_pin", 17)}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConversationCallHistory({ calls, selectedConversation, onCall, onNativeHandoff }) {
  const selectedCalls = selectedConversation ? groupCallsByNumber(calls, selectedConversation.key) : [];
  return (
    <aside className="dp-thread-calls" data-native-source="MainWindow.xaml:2459">
      <div className="dp-thread-calls-header">
        <div>
          <strong>Call history</strong>
          <span>{selectedCalls.length ? `${selectedCalls.length} with this number` : "No recent calls"}</span>
        </div>
        <button type="button" onClick={() => onNativeHandoff("Open full call history", "MainWindow.xaml:2459")}>{icon("open_in_new", 18)}</button>
      </div>
      <div className="dp-thread-call-list">
        {selectedCalls.map((call) => (
          <div className={`dp-thread-call-row ${call.isMissed ? "is-missed" : ""}`} key={call.id || `${call.number}-${call.timestamp}`}>
            <div>{icon(call.isMissed ? "phone_missed" : call.direction === "Outgoing" ? "call_made" : "call_received", 18)}</div>
            <div>
              <strong>{call.directionLabel || call.direction || "Call"}</strong>
              <span>{call.timeDisplay || formatConversationTime(call.timestamp)}{call.durationDisplay ? ` - ${call.durationDisplay}` : ""}</span>
            </div>
            <button type="button" title="Call back" aria-label="Call back" onClick={() => onCall(call.number)}>{icon("call", 17)}</button>
          </div>
        ))}
        {!selectedCalls.length ? (
          <div className="dp-thread-call-empty">Calls for this conversation will appear here when DeskPhone reports them.</div>
        ) : null}
      </div>
    </aside>
  );
}

function MessagesSlice({
  status,
  messages,
  calls,
  selectedConversationKey,
  setSelectedConversationKey,
  conversationSearch,
  setConversationSearch,
  conversationFilter,
  setConversationFilter,
  unreadFirst,
  setUnreadFirst,
  showMessagesList,
  setShowMessagesList,
  messageListWidth,
  setMessageListWidth,
  callHistoryWidth,
  setCallHistoryWidth,
  draft,
  setDraft,
  onCommand,
  onNativeHandoff,
  onNotice,
}) {
  const [threadSearch, setThreadSearch] = useState("");
  const [openActionMessageId, setOpenActionMessageId] = useState("");
  const [activeImage, setActiveImage] = useState(null);
  const [imageRotation, setImageRotation] = useState(0);
  const messageScrollRef = useRef(null);

  const conversations = useMemo(() => buildConversations(messages), [messages]);
  const visibleConversations = useMemo(
    () => filterConversations(conversations, conversationSearch, conversationFilter, unreadFirst),
    [conversations, conversationSearch, conversationFilter, unreadFirst]
  );

  useEffect(() => {
    if (!conversations.length) {
      if (selectedConversationKey) setSelectedConversationKey("");
      return;
    }
    if (!conversations.some((conversation) => conversation.key === selectedConversationKey)) {
      setSelectedConversationKey(conversations[0].key);
    }
  }, [conversations, selectedConversationKey, setSelectedConversationKey]);

  const selectedConversation =
    conversations.find((conversation) => conversation.key === selectedConversationKey) ||
    visibleConversations[0] ||
    null;
  const threadSearchLower = threadSearch.trim().toLowerCase();
  const threadMatchCount = threadSearchLower
    ? selectedConversation?.messages.filter((message) => (
        message.body.toLowerCase().includes(threadSearchLower) ||
        message.preview.toLowerCase().includes(threadSearchLower)
      )).length || 0
    : 0;

  const callNumber = useCallback((number) => {
    const normalized = normalizePhoneKey(number);
    if (!normalized) {
      onNativeHandoff("Call", "MainWindow.xaml:1776", number);
      return;
    }
    onCommand(`/dial?n=${encodeURIComponent(normalized)}`, "call");
  }, [onCommand, onNativeHandoff]);

  const copyMessage = useCallback(async (message) => {
    const text = message.body || message.preview || "";
    try {
      await navigator.clipboard.writeText(text);
      onNotice("Copied message text.");
    } catch {
      onNativeHandoff("Copy message", "MainWindow.xaml:2032", message.number);
    }
  }, [onNativeHandoff, onNotice]);

  const sendMessage = useCallback(async () => {
    const body = draft.trim();
    if (!body || !selectedConversation?.number) return;
    await onCommand(`/send?to=${encodeURIComponent(selectedConversation.number)}&body=${encodeURIComponent(body)}`, "send message");
    setDraft("");
  }, [draft, selectedConversation, onCommand, setDraft]);

  const scrollToLatestMessage = useCallback(() => {
    const scrollBox = messageScrollRef.current;
    if (!scrollBox) return;
    scrollBox.scrollTop = scrollBox.scrollHeight;
  }, []);

  const openImageViewer = useCallback((attachment) => {
    setActiveImage(attachment);
    setImageRotation(0);
  }, []);

  const closeImageViewer = useCallback(() => {
    setActiveImage(null);
    setImageRotation(0);
  }, []);

  const rotateImageViewer = useCallback((delta) => {
    setImageRotation((current) => (current + delta + 360) % 360);
  }, []);

  useEffect(() => {
    const scrollBox = messageScrollRef.current;
    if (!scrollBox || !selectedConversation) return;
    scrollBox.scrollTop = scrollBox.scrollHeight;
  }, [selectedConversation?.key, selectedConversation?.messages.length]);

  useEffect(() => {
    if (!activeImage) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeImageViewer();
      if (event.key === "ArrowLeft") rotateImageViewer(-90);
      if (event.key === "ArrowRight") rotateImageViewer(90);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeImage, closeImageViewer, rotateImageViewer]);

  const messageShellClass = [
    "dp-message-shell",
    showMessagesList ? "" : "is-list-hidden",
  ].join(" ");
  const emptyText = conversationSearch ? "No conversations match this search" : "No conversations yet";

  return (
    <div
      className={messageShellClass}
      data-native-source="MainWindow.xaml:1036"
      style={{
        "--dp-message-list-width": `${messageListWidth}px`,
        "--dp-call-history-width": `${callHistoryWidth}px`,
      }}
    >
      <section className="dp-conversation-pane" data-native-source="MainWindow.xaml:1050">
        <header className="dp-message-list-header" data-native-source="MainWindow.xaml:1061">
          <div className="dp-message-header-top">
            <h2>Messages</h2>
            {status?.fullHistoryStatus ? <span className="dp-history-status">{status.fullHistoryStatus}</span> : null}
            <div className="dp-message-header-actions">
              <DeskPhoneIconButton iconName="add" label="New message" nativeSource="MainWindow.xaml:1078" nativeGlyph="E145" onClick={() => onNativeHandoff("New message", "MainWindow.xaml:1078")} />
              <DeskPhoneIconButton
                iconName={unreadFirst ? "mark_email_unread" : "sort"}
                label={unreadFirst ? "Sort: Unread first - click for Recent first" : "Sort: Recent first - click for Unread first"}
                nativeSource="MainWindow.xaml:1083"
                nativeGlyph="E164"
                className={unreadFirst ? "is-active" : ""}
                onClick={() => setUnreadFirst((value) => !value)}
              />
              <DeskPhoneIconButton iconName="close" label="Hide threads" nativeSource="MainWindow.xaml:1098" nativeGlyph="E5CD" onClick={() => setShowMessagesList(false)} />
            </div>
          </div>

          <label className="dp-message-search" data-native-source="MainWindow.xaml:1106">
            {icon("search", 18)}
            <input
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="Search..."
              aria-label="Search conversations"
              data-automation-id="ConversationSearchBox"
            />
          </label>

          <div className="dp-filter-grid" data-native-source="MainWindow.xaml:1138">
            {MESSAGE_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter}
                className={conversationFilter === filter ? "is-active" : ""}
                onClick={() => setConversationFilter(filter)}
                data-automation-id={`ConversationFilter${filter}`}
              >
                {filter}
              </button>
            ))}
          </div>
        </header>

        <div className="dp-conversation-list" data-native-source="MainWindow.xaml:1267">
          {!visibleConversations.length ? (
            <div className="dp-empty-conversations" data-native-source="MainWindow.xaml:1247">
              {icon("forum", 48)}
              <span>{emptyText}</span>
            </div>
          ) : null}
          {visibleConversations.map((conversation) => (
            <ConversationRow
              key={conversation.key}
              conversation={conversation}
              selected={selectedConversation?.key === conversation.key}
              onSelect={setSelectedConversationKey}
              onNativeHandoff={onNativeHandoff}
            />
          ))}
        </div>
      </section>

      <div
        className="dp-message-splitter dp-draggable-splitter"
        data-native-source="MainWindow.xaml:1433"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize message list"
        onPointerDown={(event) => startHorizontalDrag(event, {
          startValue: messageListWidth,
          min: 210,
          max: 420,
          onChange: setMessageListWidth,
        })}
      />

      <section className="dp-thread-pane" data-native-source="MainWindow.xaml:1438">
        {!selectedConversation ? (
          <div className="dp-no-conversation" data-native-source="MainWindow.xaml:1438">
            <div>{icon("forum", 36)}</div>
            <strong>Select a conversation</strong>
            <span>or start a new one</span>
          </div>
        ) : (
          <div className="dp-thread-layout" data-native-source="MainWindow.xaml:1623">
            <header className="dp-thread-header" data-native-source="MainWindow.xaml:1623">
              <div className="dp-thread-avatar">{selectedConversation.avatarInitial}</div>
              <div className="dp-thread-identity">
                <strong>{selectedConversation.displayName}</strong>
                <span>{selectedConversation.formattedPhone}</span>
              </div>
              <ThreadSearchBar
                value={threadSearch}
                onChange={setThreadSearch}
                matchCount={threadMatchCount}
                onNativeHandoff={onNativeHandoff}
              />
              <div className="dp-thread-actions" data-native-source="MainWindow.xaml:1738">
                {!showMessagesList ? (
                  <ShellButton className="dp-tonal dp-show-threads-button" iconName="menu_open" nativeSource="MainWindow.xaml:1831" onClick={() => setShowMessagesList(true)}>
                    Show threads
                  </ShellButton>
                ) : null}
                <DeskPhoneIconButton iconName="block" label="Block / unblock locally" nativeSource="MainWindow.xaml:1738" nativeGlyph="E14B" onClick={() => onNativeHandoff("Block / unblock locally", "MainWindow.xaml:1738", selectedConversation.number)} />
                <DeskPhoneIconButton iconName="push_pin" label="Pin / unpin conversation" nativeSource="MainWindow.xaml:1743" nativeGlyph="F10D" onClick={() => onNativeHandoff("Pin / unpin conversation", "MainWindow.xaml:1743", selectedConversation.number)} />
                <DeskPhoneIconButton iconName="notifications_off" label="Mute / unmute alerts" nativeSource="MainWindow.xaml:1748" nativeGlyph="E7F6" onClick={() => onNativeHandoff("Mute / unmute alerts", "MainWindow.xaml:1748", selectedConversation.number)} />
                <DeskPhoneIconButton iconName="mark_email_read" label="Mark read" nativeSource="MainWindow.xaml:1753" nativeGlyph="E151" onClick={() => onNativeHandoff("Mark read", "MainWindow.xaml:1753", selectedConversation.number)} />
                <DeskPhoneIconButton iconName="mark_email_unread" label="Mark unread" nativeSource="MainWindow.xaml:1758" nativeGlyph="F18A" onClick={() => onNativeHandoff("Mark unread", "MainWindow.xaml:1758", selectedConversation.number)} />
                <DeskPhoneIconButton iconName="person_add" label="Add contact" nativeSource="MainWindow.xaml:1763" nativeGlyph="E7FE" onClick={() => onNativeHandoff("Add contact", "MainWindow.xaml:1763", selectedConversation.number)} />
                <DeskPhoneIconButton iconName="edit" label="Edit contact" nativeSource="MainWindow.xaml:1768" nativeGlyph="E3C9" onClick={() => onNativeHandoff("Edit contact", "MainWindow.xaml:1768", selectedConversation.number)} />
                <DeskPhoneIconButton iconName="call" label="Call" nativeSource="MainWindow.xaml:1776" nativeGlyph="E0B0" onClick={() => callNumber(selectedConversation.number)} />
              </div>
            </header>

            <div className="dp-thread-detail-grid" data-native-source="MainWindow.xaml:1611">
              <main className="dp-thread-messages" data-native-source="MainWindow.xaml:1845">
                <div className="dp-message-scroll" ref={messageScrollRef}>
                  {selectedConversation.messages.map((message, index) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      previousMessage={selectedConversation.messages[index - 1]}
                      open={openActionMessageId === message.id}
                      onToggleOpen={(id) => setOpenActionMessageId((current) => current === id ? "" : id)}
                      onCopy={copyMessage}
                      onCall={callNumber}
                      onNativeHandoff={onNativeHandoff}
                      onOpenImage={openImageViewer}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="dp-scroll-bottom"
                  data-native-source="MainWindow.xaml:2285"
                  aria-label="Scroll to latest message"
                  data-automation-id="ScrollToBottomButton"
                  onClick={scrollToLatestMessage}
                >
                  {icon("keyboard_arrow_down", 24)}
                </button>
                <div className="dp-undo-delete-bar" data-native-source="MainWindow.xaml:2315" aria-hidden="true">
                  <span>Message deleted</span>
                  <button type="button" onClick={() => onNativeHandoff("Undo message delete", "MainWindow.xaml:2334")}>Undo</button>
                </div>
                <footer className="dp-compose-bar" data-native-source="MainWindow.xaml:2342">
                  <button
                    type="button"
                    className="dp-compose-attach"
                    title="Attach pictures, files, or contact cards"
                    aria-label="Attach pictures, files, or contact cards"
                    data-native-source="MainWindow.xaml:2354"
                    onClick={() => onNativeHandoff("Attach pictures, files, or contact cards", "MainWindow.xaml:2354")}
                  >
                    {icon("attach_file", 22)}
                  </button>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") sendMessage();
                    }}
                    minLength={0}
                    placeholder="Message text"
                    aria-label="Message text"
                    data-automation-id="ReplyComposeBox"
                  />
                  <button
                    type="button"
                    className="dp-send-button"
                    aria-label="Send message"
                    data-automation-id="ReplySendButton"
                    data-native-source="MainWindow.xaml:2402"
                    disabled={!draft.trim()}
                    onClick={sendMessage}
                  >
                    {icon("send", 21)}
                  </button>
                </footer>
              </main>
              <div
                className="dp-thread-inner-splitter dp-draggable-splitter"
                data-native-source="MainWindow.xaml:2424"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize call history"
                onPointerDown={(event) => startHorizontalDrag(event, {
                  startValue: callHistoryWidth,
                  min: 260,
                  max: 480,
                  onChange: setCallHistoryWidth,
                  invert: true,
                })}
              />
              <ConversationCallHistory
                calls={calls}
                selectedConversation={selectedConversation}
                onCall={callNumber}
                onNativeHandoff={onNativeHandoff}
              />
            </div>
          </div>
        )}
      </section>
      <ImageLightbox
        image={activeImage}
        rotation={imageRotation}
        onClose={closeImageViewer}
        onRotate={rotateImageViewer}
      />
    </div>
  );
}

function SimpleTabContent({
  activeTab,
  status,
  messages,
  calls,
  selectedConversationKey,
  setSelectedConversationKey,
  conversationSearch,
  setConversationSearch,
  conversationFilter,
  setConversationFilter,
  unreadFirst,
  setUnreadFirst,
  showMessagesList,
  setShowMessagesList,
  messageListWidth,
  setMessageListWidth,
  callHistoryWidth,
  setCallHistoryWidth,
  draft,
  setDraft,
  host,
  hostInput,
  setHostInput,
  onSaveHost,
  onRefresh,
  onShowNative,
  onCommand,
  onNativeHandoff,
  onNotice,
}) {
  if (activeTab === "messages") {
    return (
      <MessagesSlice
        status={status}
        messages={messages}
        calls={calls}
        selectedConversationKey={selectedConversationKey}
        setSelectedConversationKey={setSelectedConversationKey}
        conversationSearch={conversationSearch}
        setConversationSearch={setConversationSearch}
        conversationFilter={conversationFilter}
        setConversationFilter={setConversationFilter}
        unreadFirst={unreadFirst}
        setUnreadFirst={setUnreadFirst}
        showMessagesList={showMessagesList}
        setShowMessagesList={setShowMessagesList}
        messageListWidth={messageListWidth}
        setMessageListWidth={setMessageListWidth}
        callHistoryWidth={callHistoryWidth}
        setCallHistoryWidth={setCallHistoryWidth}
        draft={draft}
        setDraft={setDraft}
        onCommand={onCommand}
        onNativeHandoff={onNativeHandoff}
        onNotice={onNotice}
      />
    );
  }
  if (activeTab === "contacts") {
    return (
      <div className="dp-tab-placeholder" data-native-source="MainWindow.xaml:3368">
        <SourceTag>MainWindow.xaml:3368</SourceTag>
        <h2>Contacts tab shell</h2>
        <p>Contacts are scheduled after the message and call-history surfaces because the native contact editor has its own full ledger.</p>
      </div>
    );
  }
  if (activeTab === "settings") {
    return (
      <div className="dp-settings-shell" data-native-source="MainWindow.xaml:3847">
        <SourceTag>MainWindow.xaml:3847</SourceTag>
        <h2>Connection Settings</h2>
        <label className="dp-host-label">
          Host URL
          <input value={hostInput} onChange={(event) => setHostInput(event.target.value)} spellCheck={false} />
        </label>
        <div className="dp-settings-actions">
          <ShellButton className="dp-primary" iconName="save" onClick={onSaveHost}>Save</ShellButton>
          <ShellButton className="dp-tonal" iconName="refresh" onClick={onRefresh}>Test</ShellButton>
          <ShellButton className="dp-tonal" iconName="open_in_new" onClick={onShowNative}>Show native app</ShellButton>
        </div>
        <div className="dp-host-note">Active endpoint: {host}</div>
      </div>
    );
  }
  return (
    <div className="dp-tab-placeholder" data-native-source="MainWindow.xaml:3920">
      <SourceTag>MainWindow.xaml:3920</SourceTag>
      <h2>Developer Tools shell</h2>
      <p>The native shell contains build, log, UI-auditor, and theme-sync actions here. They will be copied from the inventory as their own slice.</p>
    </div>
  );
}

function ParityLedgerPanel({ rows }) {
  return (
    <details className="dp-ledger-panel">
      <summary>DeskPhone web parity ledger</summary>
      <div className="dp-ledger-grid">
        {rows.map(([source, name, note]) => (
          <div className="dp-ledger-row" key={`${source}-${name}`}>
            <span>{source}</span>
            <strong>{name}</strong>
            <em>{note}</em>
          </div>
        ))}
      </div>
    </details>
  );
}

const css = `
.dp-web-root {
  --dp-bg-main: ${COLORS.bgMain};
  --dp-bg-sidebar: ${COLORS.bgSidebar};
  --dp-bg-hover: ${COLORS.bgHover};
  --dp-bg-input: ${COLORS.bgInput};
  --dp-bg-selected: ${COLORS.bgSelected};
  --dp-blue: ${COLORS.accentBlue};
  --dp-blue-dark: ${COLORS.accentBlueDark};
  --dp-blue-light: ${COLORS.accentBlueLight};
  --dp-green: ${COLORS.accentGreen};
  --dp-green-dark: ${COLORS.accentGreenDark};
  --dp-green-light: ${COLORS.accentGreenLight};
  --dp-red: ${COLORS.accentRed};
  --dp-red-light: ${COLORS.accentRedLight};
  --dp-text: ${COLORS.textPrimary};
  --dp-text-second: ${COLORS.textSecond};
  --dp-muted: ${COLORS.textMuted};
  --dp-disabled: ${COLORS.textDisabled};
  --dp-border: ${COLORS.border};
  min-height: 100vh;
  width: 100%;
  align-self: stretch;
  box-sizing: border-box;
  background: var(--dp-bg-main);
  color: var(--dp-text);
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  padding-top: 64px;
}
.dp-web-root.is-embedded {
  min-height: 620px;
  padding-top: 0;
}
.dp-shell {
  width: 100%;
  height: calc(100vh - 64px);
  min-height: 620px;
  display: grid;
  grid-template-columns: minmax(224px, var(--dp-rail-width, 268px)) 7px minmax(0, 1fr);
  background: var(--dp-bg-main);
  overflow: hidden;
}
.dp-web-root.is-embedded .dp-shell {
  height: 620px;
  min-height: 620px;
}
.dp-shell.is-collapsed {
  grid-template-columns: 76px minmax(0, 1fr);
}
.dp-rail {
  min-width: 0;
  background: var(--dp-bg-sidebar);
  border-right: 1px solid var(--dp-border);
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  overflow: hidden;
}
.dp-splitter {
  width: 7px;
  position: relative;
  background: transparent;
}
.dp-draggable-splitter {
  cursor: col-resize;
  touch-action: none;
}
.dp-draggable-splitter::before {
  content: "";
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  left: -5px;
  right: -5px;
}
.dp-draggable-splitter:hover::after {
  background: var(--dp-blue);
  opacity: 1;
}
.dp-splitter::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--dp-border);
  opacity: 0.72;
}
.dp-shell.is-collapsed .dp-splitter {
  display: none;
}
.dp-app-identity {
  margin: 24px 16px 16px 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.dp-app-title-block {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  min-width: 0;
}
.dp-app-icon-box {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--dp-blue);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}
.dp-app-copy {
  min-width: 0;
}
.dp-app-name {
  font-size: 19px;
  line-height: 1.15;
  font-weight: 600;
  color: var(--dp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-app-build,
.dp-app-time {
  margin-top: 2px;
  font-weight: 600;
  color: var(--dp-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-app-build {
  font-size: 11px;
}
.dp-app-time {
  font-size: 10px;
}
.dp-compact-icon-button {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border: 0;
  border-radius: 10px;
  padding: 0;
  background: var(--dp-blue-light);
  color: var(--dp-text-on-blue-light, #174EA6);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dp-compact-icon-button:disabled,
.dp-md-button:disabled,
.dp-collapsed-icon-button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.dp-compact-icon-button:hover,
.dp-md-button:hover,
.dp-collapsed-icon-button:hover {
  filter: brightness(0.98);
}
.dp-material-icon {
  line-height: 1;
  font-weight: 400;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dp-new-message-slot {
  margin: 0 16px 20px;
}
.dp-new-message-button {
  width: 100%;
  height: 48px;
  justify-content: center;
}
.dp-native-collapsed,
.dp-native-hidden,
.is-native-collapsed {
  display: none !important;
}
.dp-nav-list {
  margin: 0 8px;
  display: flex;
  flex-direction: column;
}
.dp-nav-item {
  height: auto;
  min-height: 43px;
  margin: 3px 8px;
  padding: 10px 13px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--dp-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}
.dp-nav-item:hover {
  background: var(--dp-bg-input);
}
.dp-nav-item.is-active {
  background: var(--dp-blue-light);
  color: var(--dp-text-on-blue-light, #174EA6);
}
.dp-nav-item.is-collapsed {
  width: 56px;
  height: 48px;
  min-height: 48px;
  margin: 4px auto;
  padding: 0;
  justify-content: center;
}
.dp-nav-icon {
  width: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
}
.dp-nav-item.is-collapsed .dp-nav-icon {
  width: auto;
  justify-content: center;
}
.dp-nav-divider {
  height: 1px;
  margin: 12px 16px;
  background: var(--dp-border);
}
.dp-rail-connection {
  padding: 20px 16px 16px;
}
.dp-rail-status-card {
  background: var(--dp-bg-input);
  border-radius: 12px;
  padding: 12px 10px;
}
.dp-rail-status-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.dp-rail-status-left {
  display: flex;
  align-items: center;
  min-width: 0;
}
.dp-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dp-disabled);
  flex: 0 0 auto;
  margin-right: 8px;
}
.dp-status-dot.is-online {
  background: var(--dp-green);
}
.dp-rail-status-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--dp-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-rail-subtitle {
  margin: 7px 0 0 16px;
  font-size: 10px;
  line-height: 15px;
  color: var(--dp-muted);
}
.dp-rail-channel {
  margin: 9px 0 0 16px;
  font-size: 11px;
  color: var(--dp-muted);
}
.dp-rail-channel + .dp-rail-channel {
  margin-top: 3px;
}
.dp-rail-wide-button {
  width: 100%;
  height: 38px;
  margin-top: 10px;
}
.dp-rail-wide-button + .dp-rail-wide-button {
  height: 36px;
  margin-top: 8px;
}
.dp-rail-connection-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 0 14px;
}
.dp-collapsed-status-tile {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--dp-bg-input);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.dp-collapsed-status-tile .dp-status-dot {
  width: 10px;
  height: 10px;
  margin: 0 0 6px;
}
.dp-collapsed-bt {
  font-size: 11px;
  font-weight: 600;
  color: var(--dp-muted);
}
.dp-collapsed-icon-button {
  width: 52px;
  height: 44px;
  margin-top: 8px;
  border: 0;
  border-radius: 10px;
  background: var(--dp-blue-light);
  color: var(--dp-text-on-blue-light, #174EA6);
  cursor: pointer;
}
.dp-build-badge {
  width: 52px;
  box-sizing: border-box;
  margin-top: 10px;
  padding: 5px 4px;
  border-radius: 10px;
  background: var(--dp-bg-input);
  color: var(--dp-muted);
  text-align: center;
  font-size: 9px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-content {
  position: relative;
  background: var(--dp-bg-sidebar);
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  overflow: hidden;
}
.dp-prompts {
  display: grid;
}
.dp-prompt {
  margin: 16px 24px 0;
  border-radius: 12px;
  padding: 13px 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
}
.dp-reconnect-prompt {
  background: var(--dp-blue-light);
  border: 1px solid var(--dp-blue);
}
.dp-prompt-title {
  color: var(--dp-blue);
  font-size: 14px;
  font-weight: 500;
}
.dp-prompt-subtitle {
  margin-top: 2px;
  color: var(--dp-muted);
  font-size: 12px;
}
.dp-build-indicator {
  position: absolute;
  z-index: 510;
  top: 16px;
  right: 24px;
}
.dp-build-overlay {
  position: absolute;
  inset: 0;
  z-index: 520;
  background: rgba(8, 20, 32, 0.4);
  display: grid;
  place-items: center;
  padding: 24px;
}
.dp-build-dialog {
  width: min(460px, 100%);
  border-radius: 12px;
  border: 1px solid var(--dp-border);
  background: var(--dp-bg-main);
  padding: 24px;
  box-sizing: border-box;
}
.dp-build-dialog h2 {
  margin: 0;
  color: var(--dp-text);
  font-size: 22px;
  font-weight: 600;
}
.dp-build-dialog p {
  margin: 12px 0 0;
  color: var(--dp-text-second);
  font-size: 14px;
  line-height: 22px;
}
.dp-build-dialog-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}
.dp-call-banner {
  margin: 12px 24px 0;
  border-radius: 16px;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.10);
}
.dp-call-banner.is-ringing {
  background: #EAF1FB;
}
.dp-call-banner.is-active-call {
  background: #E6F4EA;
}
.dp-call-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: white;
  background: var(--dp-green);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dp-call-banner.is-ringing .dp-call-icon {
  background: var(--dp-blue);
}
.dp-call-text {
  color: var(--dp-text);
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-call-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.dp-md-button {
  min-width: 38px;
  height: 38px;
  border: 0;
  border-radius: 10px;
  padding: 0 18px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  white-space: nowrap;
}
.dp-primary {
  background: var(--dp-blue);
  color: white;
}
.dp-tonal {
  background: var(--dp-blue-light);
  color: var(--dp-text-on-blue-light, #174EA6);
}
.dp-success {
  background: var(--dp-green);
  color: white;
}
.dp-destructive {
  background: var(--dp-red);
  color: white;
}
.dp-tonal.is-muted {
  background: #FFCDD2;
  color: #C62828;
}
.dp-tab-area {
  min-height: 0;
  overflow: auto;
  padding: 24px;
}
.dp-tab-area.is-messages {
  padding: 0;
  overflow: hidden;
}
.dp-message-shell {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(210px, var(--dp-message-list-width, 300px)) 7px minmax(0, 1fr);
  background: var(--dp-bg-main);
  border-top: 1px solid var(--dp-border);
  overflow: hidden;
}
.dp-message-shell.is-list-hidden {
  grid-template-columns: 0 0 minmax(0, 1fr);
}
.dp-message-shell.is-list-hidden .dp-conversation-pane,
.dp-message-shell.is-list-hidden .dp-message-splitter {
  display: none;
}
.dp-conversation-pane {
  min-width: 0;
  background: var(--dp-bg-sidebar);
  border-right: 1px solid var(--dp-border);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}
.dp-message-list-header {
  padding: 16px 16px 10px;
}
.dp-message-header-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px 4px;
}
.dp-message-header-top h2 {
  margin: 0;
  color: var(--dp-text);
  font-size: 22px;
  font-weight: 600;
}
.dp-history-status {
  border-radius: 10px;
  padding: 3px 8px;
  background: var(--dp-blue-light);
  color: var(--dp-blue);
  font-size: 11px;
  font-weight: 600;
}
.dp-message-header-actions {
  display: flex;
  gap: 4px;
}
.dp-compact-icon-button.is-active {
  color: var(--dp-blue);
}
.dp-message-search {
  height: 46px;
  box-sizing: border-box;
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  background: var(--dp-bg-input);
  padding: 6px 10px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  color: var(--dp-muted);
}
.dp-message-search input,
.dp-thread-search input {
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--dp-text);
  font: inherit;
}
.dp-filter-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}
.dp-filter-grid button {
  height: 32px;
  min-width: 0;
  border: 0;
  border-radius: 10px;
  padding: 0 6px;
  background: var(--dp-bg-input);
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.dp-filter-grid button.is-active {
  background: var(--dp-blue-light);
  color: var(--dp-blue);
}
.dp-conversation-list {
  min-height: 0;
  overflow: auto;
}
.dp-empty-conversations {
  height: 100%;
  min-height: 220px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  color: var(--dp-muted);
  font-size: 15px;
  font-weight: 600;
}
.dp-empty-conversations .dp-material-icon {
  color: var(--dp-border);
}
.dp-conversation-row {
  position: relative;
  min-width: 0;
  border: 0;
  border-bottom: 1px solid var(--dp-border);
  padding: 14px 12px 14px 16px;
  background: transparent;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  cursor: pointer;
}
.dp-conversation-row:hover {
  background: var(--dp-bg-hover);
}
.dp-conversation-row.is-selected {
  background: var(--dp-bg-selected);
}
.dp-conversation-avatar,
.dp-thread-avatar {
  background: var(--dp-blue-light);
  color: var(--dp-blue);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.dp-conversation-avatar {
  width: 40px;
  height: 40px;
  border-radius: 20px;
  font-size: 15px;
}
.dp-conversation-copy {
  min-width: 0;
}
.dp-conversation-topline {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}
.dp-conversation-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dp-text);
  font-size: 18px;
  font-weight: 600;
}
.dp-conversation-row.is-unread .dp-conversation-name,
.dp-conversation-row.is-unread .dp-conversation-preview,
.dp-conversation-row.is-unread .dp-conversation-time {
  font-weight: 700;
}
.dp-conversation-badges {
  display: none;
  gap: 8px;
  color: var(--dp-blue);
  font-size: 11px;
  font-weight: 700;
}
.dp-conversation-badges .is-danger {
  color: var(--dp-red);
}
.dp-conversation-time {
  color: var(--dp-muted);
  font-size: 13px;
  white-space: nowrap;
}
.dp-conversation-row.is-unread .dp-conversation-time {
  color: var(--dp-blue);
}
.dp-conversation-preview {
  margin-top: 4px;
  color: var(--dp-muted);
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-conversation-menu {
  position: relative;
  margin-left: 6px;
}
.dp-conversation-menu summary {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dp-muted);
  list-style: none;
}
.dp-conversation-menu summary::-webkit-details-marker {
  display: none;
}
.dp-conversation-menu[open] summary {
  background: var(--dp-blue-light);
  color: var(--dp-blue);
}
.dp-floating-menu {
  position: absolute;
  z-index: 40;
  top: 34px;
  right: 0;
  min-width: 190px;
  border: 1px solid var(--dp-border);
  border-radius: 12px;
  background: white;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.14);
  padding: 6px;
}
.dp-floating-menu button {
  width: 100%;
  border: 0;
  border-radius: 8px;
  padding: 9px 10px;
  background: transparent;
  color: var(--dp-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.dp-floating-menu button:hover {
  background: var(--dp-bg-hover);
}
.dp-message-splitter,
.dp-thread-inner-splitter {
  position: relative;
  background: transparent;
}
.dp-message-splitter::after,
.dp-thread-inner-splitter::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--dp-border);
}
.dp-thread-pane {
  min-width: 0;
  min-height: 0;
  background: var(--dp-bg-main);
  overflow: hidden;
}
.dp-no-conversation {
  height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  color: var(--dp-muted);
}
.dp-no-conversation div {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: var(--dp-bg-hover);
  color: var(--dp-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.dp-no-conversation strong {
  font-size: 16px;
  font-weight: 600;
}
.dp-no-conversation span {
  color: var(--dp-disabled);
  font-size: 13px;
}
.dp-thread-layout {
  height: 100%;
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}
.dp-thread-header {
  min-width: 0;
  border-bottom: 1px solid var(--dp-border);
  padding: 8px 14px;
  display: grid;
  grid-template-columns: auto minmax(150px, auto) minmax(220px, 1fr) auto;
  align-items: center;
  gap: 12px;
}
.dp-thread-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 14px;
}
.dp-thread-identity {
  min-width: 0;
  display: grid;
}
.dp-thread-identity strong {
  color: var(--dp-text);
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-thread-identity span {
  margin-top: 1px;
  color: var(--dp-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-thread-search {
  min-width: 0;
  min-height: 32px;
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  background: var(--dp-bg-input);
  color: var(--dp-muted);
  padding: 4px 6px;
  display: grid;
  grid-template-columns: auto minmax(80px, 1fr) auto auto auto auto;
  align-items: center;
  gap: 4px;
}
.dp-thread-search span {
  color: var(--dp-muted);
  font-size: 11px;
  white-space: nowrap;
}
.dp-thread-search button,
.dp-bubble-actions button,
.dp-thread-call-row button,
.dp-thread-calls-header button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dp-thread-search button:hover,
.dp-bubble-actions button:hover,
.dp-thread-call-row button:hover,
.dp-thread-calls-header button:hover {
  background: rgba(26, 115, 232, 0.12);
}
.dp-thread-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px;
}
.dp-show-threads-button {
  height: 34px;
  padding: 0 12px;
}
.dp-thread-detail-grid {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(340px, 1fr) 7px minmax(260px, var(--dp-call-history-width, 360px));
  overflow: hidden;
}
.dp-thread-messages {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  position: relative;
  background: var(--dp-bg-sidebar);
}
.dp-message-scroll {
  min-height: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 24px 84px;
}
.dp-message-item {
  display: grid;
}
.dp-message-item.is-outgoing {
  justify-items: end;
}
.dp-message-item.is-incoming {
  justify-items: start;
}
.dp-date-divider {
  justify-self: center;
  margin: 16px 0;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 700;
}
.dp-message-bubble {
  max-width: min(68ch, 76%);
  margin: 3px 0;
  border-radius: 18px;
  padding: 8px 12px;
  cursor: pointer;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
}
.dp-message-bubble.is-incoming {
  border: 1px solid #E0E0E0;
  background: white;
  color: var(--dp-text);
  border-bottom-left-radius: 6px;
}
.dp-message-bubble.is-outgoing {
  background: var(--dp-blue);
  color: white;
  border-bottom-right-radius: 6px;
}
.dp-message-bubble.is-media-only {
  max-width: min(340px, 70vw);
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
  line-height: 0;
}
.dp-message-bubble.is-media-only.is-incoming,
.dp-message-bubble.is-media-only.is-outgoing {
  border: 0;
  background: transparent;
}
.dp-message-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: clamp(14px, 1rem, 17px);
  line-height: 1.45;
}
.dp-muted-body {
  color: var(--dp-muted);
  font-style: italic;
}
.dp-message-bubble.is-outgoing .dp-muted-body {
  color: rgba(255, 255, 255, 0.8);
}
.dp-message-meta {
  margin-top: 5px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 5px;
  color: var(--dp-muted);
  font-size: 11px;
}
.dp-message-bubble.is-outgoing .dp-message-meta {
  color: rgba(255, 255, 255, 0.78);
}
.dp-message-bubble.is-media-only:not(.has-send-status) .dp-message-meta {
  display: none;
}
.dp-message-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.dp-message-status.is-sending,
.dp-message-status.is-confirming {
  font-weight: 700;
}
.dp-message-status.is-failed {
  color: #FCE8E6;
  font-weight: 800;
}
.dp-attachment-stack {
  display: grid;
  gap: 6px;
  margin-top: 6px;
}
.dp-message-bubble.is-media-only .dp-attachment-stack {
  display: block;
  margin: 0;
  line-height: 0;
}
.dp-mms-image {
  display: block;
  width: auto;
  max-width: min(340px, 100%);
  max-height: 360px;
  object-fit: contain;
  border: 0;
  border-radius: 16px;
  background: transparent;
}
.dp-message-bubble.is-media-only .dp-mms-image {
  max-width: min(340px, 70vw);
  height: auto;
  border-radius: clamp(10px, 4%, 18px);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16);
}
.dp-mms-image[role="button"] {
  cursor: zoom-in;
}
.dp-attachment-row {
  min-width: 0;
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  background: var(--dp-bg-input);
  padding: 8px 10px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}
.dp-attachment-row.is-outgoing {
  border-color: rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.12);
}
.dp-attachment-row strong,
.dp-attachment-row span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.dp-attachment-row span {
  color: var(--dp-muted);
  font-size: 11px;
}
.dp-attachment-row.is-outgoing span {
  color: rgba(255, 255, 255, 0.78);
}
.dp-attachment-row button {
  min-width: 56px;
  height: 28px;
  border: 0;
  border-radius: 10px;
  background: var(--dp-blue-light);
  color: var(--dp-blue);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.dp-bubble-actions {
  margin-top: 8px;
  border-radius: 10px;
  padding: 6px 8px;
  background: var(--dp-bg-input);
  color: var(--dp-blue);
  display: grid;
  grid-template-columns: repeat(5, 28px);
  justify-content: space-between;
  gap: 4px;
}
.dp-message-bubble.is-outgoing .dp-bubble-actions {
  background: rgba(255, 255, 255, 0.14);
  color: white;
}
.dp-scroll-bottom {
  position: absolute;
  right: 20px;
  bottom: 88px;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 20px;
  background: var(--dp-blue);
  color: white;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dp-undo-delete-bar {
  display: none;
}
.dp-compose-bar {
  min-width: 0;
  border-top: 1px solid var(--dp-border);
  background: var(--dp-bg-main);
  padding: 14px 20px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}
.dp-compose-attach,
.dp-send-button {
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 22px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dp-compose-attach {
  background: var(--dp-blue-light);
  color: var(--dp-blue);
}
.dp-send-button {
  background: var(--dp-blue);
  color: white;
}
.dp-send-button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.dp-compose-bar textarea {
  min-width: 0;
  min-height: 52px;
  max-height: 140px;
  resize: vertical;
  border: 1px solid var(--dp-border);
  border-radius: 12px;
  background: white;
  color: var(--dp-text);
  padding: 12px;
  font: 18px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  line-height: 1.35;
}
.dp-thread-calls {
  min-width: 0;
  min-height: 0;
  background: var(--dp-bg-main);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}
.dp-thread-calls-header {
  border-bottom: 1px solid var(--dp-border);
  padding: 14px 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.dp-thread-calls-header strong,
.dp-thread-calls-header span {
  display: block;
}
.dp-thread-calls-header strong {
  color: var(--dp-text);
  font-size: 15px;
  font-weight: 700;
}
.dp-thread-calls-header span {
  margin-top: 2px;
  color: var(--dp-muted);
  font-size: 12px;
}
.dp-thread-call-list {
  min-height: 0;
  overflow: auto;
}
.dp-thread-call-row {
  border-bottom: 1px solid var(--dp-border);
  padding: 12px 14px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}
.dp-thread-call-row > div:first-child {
  color: var(--dp-blue);
}
.dp-thread-call-row.is-missed > div:first-child,
.dp-thread-call-row.is-missed strong {
  color: var(--dp-red);
}
.dp-thread-call-row strong,
.dp-thread-call-row span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-thread-call-row strong {
  color: var(--dp-text);
  font-size: 13px;
  font-weight: 700;
}
.dp-thread-call-row span {
  margin-top: 2px;
  color: var(--dp-muted);
  font-size: 12px;
}
.dp-thread-call-empty {
  padding: 18px 16px;
  color: var(--dp-muted);
  font-size: 13px;
  line-height: 1.45;
}
.dp-tab-placeholder,
.dp-settings-shell {
  min-height: 360px;
  border: 1px solid var(--dp-border);
  border-radius: 14px;
  background: var(--dp-bg-main);
  padding: 24px;
  display: grid;
  gap: 18px;
  align-content: start;
}
.dp-tab-placeholder h2,
.dp-settings-shell h2 {
  margin: 10px 0 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--dp-text);
}
.dp-tab-placeholder p,
.dp-host-note {
  margin: 0;
  color: var(--dp-text-second);
  font-size: 14px;
  line-height: 1.55;
}
.dp-source-tag {
  display: inline-flex;
  width: fit-content;
  border-radius: 6px;
  background: var(--dp-bg-input);
  color: var(--dp-muted);
  font-size: 11px;
  font-weight: 700;
  padding: 4px 7px;
}
.dp-placeholder-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 160px));
  gap: 10px;
}
.dp-placeholder-stats div {
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  background: var(--dp-bg-input);
  padding: 12px;
}
.dp-placeholder-stats span {
  display: block;
  font-size: 26px;
  line-height: 1;
  font-weight: 700;
  color: var(--dp-text);
}
.dp-placeholder-stats label {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dp-muted);
}
.dp-host-label {
  display: grid;
  gap: 6px;
  color: var(--dp-text-second);
  font-size: 13px;
  font-weight: 700;
}
.dp-host-label input {
  height: 42px;
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  background: var(--dp-bg-input);
  color: var(--dp-text);
  padding: 0 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
}
.dp-settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dp-ledger-panel {
  margin: 0 24px 20px;
  border: 1px solid var(--dp-border);
  border-radius: 12px;
  background: var(--dp-bg-main);
  overflow: hidden;
}
.dp-ledger-panel summary {
  cursor: pointer;
  padding: 12px 14px;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 700;
}
.dp-ledger-grid {
  display: grid;
  border-top: 1px solid var(--dp-border);
}
.dp-ledger-row {
  display: grid;
  grid-template-columns: 150px 190px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dp-border);
  align-items: center;
}
.dp-ledger-row span,
.dp-ledger-row em {
  color: var(--dp-muted);
  font-size: 11px;
  font-style: normal;
}
.dp-ledger-row strong {
  color: var(--dp-text);
  font-size: 12px;
}
.dp-error-toast {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 20px;
  z-index: 540;
  border: 1px solid #F0B5B5;
  border-radius: 12px;
  background: #FFE1E1;
  color: #8A1F1F;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
}
.dp-action-toast {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 20px;
  z-index: 545;
  border: 1px solid var(--dp-blue);
  border-radius: 12px;
  background: var(--dp-blue-light);
  color: var(--dp-blue);
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
}
.dp-action-toast + .dp-error-toast {
  bottom: 66px;
}
.dp-image-viewer {
  position: fixed;
  z-index: 9000;
  inset: 0;
  background: #050608;
  display: block;
  color: white;
}
.dp-image-viewer-stage {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0;
}
.dp-image-viewer-stage img {
  max-width: 100vw;
  max-height: 100vh;
  object-fit: contain;
  transform-origin: center;
  transition: transform 160ms ease;
}
.dp-image-viewer-close {
  position: absolute;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  z-index: 2;
  width: 46px;
  height: 46px;
  margin: 0;
  border: 0;
  border-radius: 23px;
  background: rgba(255, 255, 255, 0.16);
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dp-image-viewer-tools {
  position: absolute;
  left: 0;
  right: 0;
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 20px;
  pointer-events: none;
}
.dp-image-viewer-tools button {
  width: 46px;
  height: 46px;
  border: 0;
  border-radius: 23px;
  background: rgba(255, 255, 255, 0.16);
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.dp-image-viewer-close:hover,
.dp-image-viewer-tools button:hover {
  background: rgba(255, 255, 255, 0.26);
}
@media (max-width: 980px) {
  .dp-shell,
  .dp-shell.is-collapsed {
    grid-template-columns: 76px minmax(0, 1fr);
  }
  .dp-splitter {
    display: none;
  }
  .dp-app-copy,
  .dp-new-message-slot,
  .dp-nav-label,
  .dp-nav-divider,
  .dp-rail-connection {
    display: none;
  }
  .dp-app-identity {
    margin: 22px 10px 16px;
    justify-content: center;
    grid-template-columns: 1fr;
  }
  .dp-app-title-block {
    display: flex;
    justify-content: center;
  }
  .dp-app-icon-box {
    margin: 0;
  }
  .dp-rail-connection-collapsed {
    display: flex;
  }
  .dp-prompt,
  .dp-call-banner {
    margin-left: 12px;
    margin-right: 12px;
  }
  .dp-tab-area {
    padding: 14px 12px;
  }
  .dp-tab-area.is-messages {
    padding: 0;
  }
  .dp-message-shell,
  .dp-message-shell.is-list-hidden {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(220px, 320px) minmax(0, 1fr);
  }
  .dp-message-shell.is-list-hidden {
    grid-template-rows: minmax(0, 1fr);
  }
  .dp-message-shell.is-list-hidden .dp-thread-pane {
    grid-row: 1;
  }
  .dp-message-splitter {
    display: none;
  }
  .dp-conversation-pane {
    border-right: 0;
    border-bottom: 1px solid var(--dp-border);
  }
  .dp-thread-header {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .dp-thread-search,
  .dp-thread-actions {
    grid-column: 1 / -1;
  }
  .dp-thread-detail-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .dp-thread-inner-splitter {
    display: none;
  }
  .dp-thread-calls {
    max-height: 240px;
    border-top: 1px solid var(--dp-border);
  }
  .dp-prompt,
  .dp-call-banner {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
  .dp-call-actions {
    flex-wrap: wrap;
  }
  .dp-ledger-panel {
    margin: 0 12px 14px;
  }
  .dp-ledger-row {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 560px) {
  .dp-web-root {
    padding-top: 64px;
  }
  .dp-shell,
  .dp-shell.is-collapsed {
    grid-template-columns: 64px minmax(0, 1fr);
  }
  .dp-nav-item.is-collapsed,
  .dp-nav-item {
    width: 48px;
  }
  .dp-collapsed-status-tile,
  .dp-collapsed-icon-button,
  .dp-build-badge {
    width: 48px;
  }
  .dp-md-button {
    width: 100%;
  }
  .dp-placeholder-stats {
    grid-template-columns: 1fr;
  }
  .dp-filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dp-filter-grid button:last-child {
    grid-column: 1 / -1;
  }
  .dp-conversation-row {
    grid-template-columns: 42px minmax(0, 1fr) auto;
    padding-left: 12px;
  }
  .dp-conversation-avatar {
    width: 34px;
    height: 34px;
  }
  .dp-thread-search {
    grid-template-columns: auto minmax(0, 1fr) repeat(3, 28px);
  }
  .dp-thread-search span {
    display: none;
  }
  .dp-message-scroll {
    padding: 10px 12px 92px;
  }
  .dp-message-bubble {
    max-width: 88%;
  }
  .dp-compose-bar {
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 12px;
  }
  .dp-compose-bar textarea {
    font-size: 16px;
  }
}
`;

export function DeskPhoneWebPanel({
  onOnlineChange,
  onClose,
  onLaunchNative,
  embedded = false,
}) {
  const [hostInput, setHostInput] = useState(() => readSavedHost());
  const [host, setHost] = useState(() => readSavedHost());
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState("messages");
  const [railCollapsed, setRailCollapsed] = useState(() => readSavedRailState());
  const [reconnectDismissed, setReconnectDismissed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showBuildPrompt, setShowBuildPrompt] = useState(false);
  const [showBuildIndicator, setShowBuildIndicator] = useState(false);
  const [selectedConversationKey, setSelectedConversationKey] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationFilter, setConversationFilter] = useState("All");
  const [unreadFirst, setUnreadFirst] = useState(false);
  const [showMessagesList, setShowMessagesList] = useState(true);
  const [railWidth, setRailWidth] = useState(() => readSavedNumber(RAIL_WIDTH_KEY, 268, 224, 360));
  const [messageListWidth, setMessageListWidth] = useState(() => readSavedNumber(MESSAGE_LIST_WIDTH_KEY, 300, 210, 420));
  const [callHistoryWidth, setCallHistoryWidth] = useState(() => readSavedNumber(CALL_HISTORY_WIDTH_KEY, 360, 260, 480));
  const [draft, setDraft] = useState("");

  const showNotice = useCallback((message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextMessages, nextCalls] = await Promise.all([
        readJson(host, "/status"),
        readJson(host, "/messages"),
        readJson(host, "/calls"),
      ]);
      setStatus(nextStatus);
      setMessages(getApiList(nextMessages));
      setCalls(getApiList(nextCalls));
      setOnline(true);
      setError("");
      onOnlineChange?.(true);
    } catch (err) {
      setStatus(null);
      setMessages([]);
      setCalls([]);
      setOnline(false);
      setError(err?.message || "DeskPhone host was not reached.");
      onOnlineChange?.(false);
    }
  }, [host, onOnlineChange]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => saveNumber(RAIL_WIDTH_KEY, railWidth), [railWidth]);
  useEffect(() => saveNumber(MESSAGE_LIST_WIDTH_KEY, messageListWidth), [messageListWidth]);
  useEffect(() => saveNumber(CALL_HISTORY_WIDTH_KEY, callHistoryWidth), [callHistoryWidth]);

  const connectionStatus = useMemo(() => connectionStatusFromStatus(status), [status]);
  const callsConnectionLabel = useMemo(() => channelLabel(status?.hfp || status?.Hfp, "Calls"), [status]);
  const messagesConnectionLabel = useMemo(() => channelLabel(status?.map || status?.Map, "Messages"), [status]);
  const showReconnectPrompt = !reconnectDismissed && !online;

  const runCommand = useCallback(async (path, label) => {
    setBusy(label);
    try {
      await postJson(host, path);
      await refresh();
      setError("");
    } catch (err) {
      setError(err?.message || "DeskPhone did not accept the command.");
      if (path === "/show" && onLaunchNative) onLaunchNative();
    } finally {
      setBusy("");
    }
  }, [host, refresh, onLaunchNative]);

  const showNativeApp = useCallback(() => {
    if (onLaunchNative) {
      onLaunchNative();
      return;
    }
    runCommand("/show", "show");
  }, [onLaunchNative, runCommand]);

  const nativeHandoff = useCallback(async (label, source, value = "") => {
    setBusy(source ? `${label} (${source})` : label);
    const target = nativeHandoffTarget(label, source);
    try {
      try {
        await postJson(host, handoffPath(target, value));
      } catch (handoffError) {
        await postJson(host, "/show");
      }
      setError("");
      showNotice(`${label} is opening in desktop DeskPhone for now.`);
    } catch (err) {
      if (onLaunchNative) {
        onLaunchNative();
        showNotice(`${label} is opening in desktop DeskPhone for now.`);
      } else {
        setError(`${label} needs desktop DeskPhone until the web action is fully built. ${err?.message || ""}`.trim());
      }
    } finally {
      setBusy("");
    }
  }, [host, onLaunchNative, showNotice]);

  const toggleRail = useCallback(() => {
    setRailCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleSaveHost = useCallback(() => {
    const normalized = saveHost(hostInput);
    setHostInput(normalized);
    setHost(normalized);
  }, [hostInput]);

  const handleNavSelect = useCallback((id) => {
    if (id === "make-call") {
      setActiveTab("messages");
      nativeHandoff("Make Call", "MainWindow.xaml:525");
      return;
    }
    if (id === "live-log") {
      runCommand("/show", "show log");
      return;
    }
    if (id === "contacts") {
      setActiveTab("contacts");
      nativeHandoff("Contacts", "MainWindow.xaml:562");
      return;
    }
    if (id === "developer") {
      setActiveTab("developer");
      nativeHandoff("Developer Tools", "MainWindow.xaml:603");
      return;
    }
    setActiveTab(id);
  }, [nativeHandoff, runCommand]);

  const rootClasses = [
    "dp-web-root",
    embedded ? "is-embedded" : "",
  ].join(" ");
  const shellClasses = [
    "dp-shell",
    railCollapsed ? "is-collapsed" : "",
  ].join(" ");

  return (
    <main className={rootClasses}>
      <style>{css}</style>
      <div
        className={shellClasses}
        data-native-source="MainWindow.xaml:359"
        style={{ "--dp-rail-width": `${railWidth}px` }}
      >
        <aside className="dp-rail" data-native-source="MainWindow.xaml:382">
          <div className="dp-app-identity" data-native-source="MainWindow.xaml:396">
            <div className="dp-app-title-block">
              <div className="dp-app-icon-box" data-native-source="MainWindow.xaml:410">
                {icon("smartphone", 20)}
              </div>
              {!railCollapsed ? (
                <div className="dp-app-copy">
                  <div className="dp-app-name">DeskPhone</div>
                  <div className="dp-app-build" title={webVersionLabel()}>{webVersionLabel()}</div>
                  <div className="dp-app-time" title={hostBuildDetailLabel(status)}>{hostBuildLabel(status)}</div>
                </div>
              ) : null}
            </div>
            <button
              className="dp-compact-icon-button"
              aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              data-automation-id="NavigationRailToggleButton"
              data-native-source="MainWindow.xaml:442"
              data-native-glyph={railCollapsed ? "E9BD" : "E5CB"}
              onClick={toggleRail}
            >
              {icon(railCollapsed ? "keyboard_double_arrow_right" : "keyboard_double_arrow_left", 20)}
            </button>
          </div>

          <div className={`dp-new-message-slot ${railCollapsed ? "is-collapsed" : ""}`}>
            <ShellButton
              className="dp-tonal dp-new-message-button dp-native-collapsed"
              iconName="edit_square"
              nativeSource="MainWindow.xaml:455"
              nativeGlyph="E3C9"
              onClick={() => setActiveTab("messages")}
              title="New message"
            >
              New Message
            </ShellButton>
          </div>

          <nav className="dp-nav-list" aria-label="DeskPhone navigation" data-native-source="MainWindow.xaml:495">
            {NAV_ITEMS.map((item, index) => (
              <React.Fragment key={item.id}>
                {index === 4 && !railCollapsed ? <div className="dp-nav-divider" data-native-source="MainWindow.xaml:583" /> : null}
                <RailNavItem
                  item={item}
                  active={activeTab === item.id || (activeTab === "messages" && item.id === "messages")}
                  collapsed={railCollapsed}
                  onSelect={handleNavSelect}
                />
              </React.Fragment>
            ))}
          </nav>

          <ConnectionRail
            collapsed={railCollapsed}
            online={online}
            status={status}
            connectionStatus={connectionStatus}
            callsConnectionLabel={callsConnectionLabel}
            messagesConnectionLabel={messagesConnectionLabel}
            onReconnect={() => runCommand("/connect", "connect")}
            onSettings={() => setActiveTab("settings")}
          />
        </aside>

        <div
          className="dp-splitter dp-draggable-splitter"
          data-native-source="MainWindow.xaml:770"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize navigation rail"
          onPointerDown={(event) => startHorizontalDrag(event, {
            startValue: railWidth,
            min: 224,
            max: 360,
            onChange: setRailWidth,
          })}
        />

        <section className="dp-content" data-native-source="MainWindow.xaml:775">
          <div className="dp-prompts">
            <ReconnectPrompt
              visible={showReconnectPrompt}
              status={status}
              onConnect={() => runCommand("/connect", "connect")}
              onChooseDevice={showNativeApp}
              onDismiss={() => setReconnectDismissed(true)}
            />
            <ContactImportPrompt />
          </div>

          <BuildUpdateOverlay
            showPrompt={showBuildPrompt}
            showIndicator={showBuildIndicator}
            onShowPrompt={() => {
              setShowBuildPrompt(true);
              setShowBuildIndicator(false);
            }}
            onAccept={() => nativeHandoff("Use New Build", "MainWindow.xaml:882")}
            onSnooze={() => {
              setShowBuildPrompt(false);
              setShowBuildIndicator(true);
            }}
          />

          <CallBanner
            status={status}
            muted={muted}
            onMute={() => {
              setMuted((value) => !value);
              nativeHandoff(muted ? "Unmute call" : "Mute call", "MainWindow.xaml:973");
            }}
            onAnswer={() => runCommand("/answer", "answer")}
            onHangup={() => runCommand("/hangup", "hangup")}
          />

          <div className={`dp-tab-area ${activeTab === "messages" ? "is-messages" : ""}`}>
            <SimpleTabContent
              activeTab={activeTab}
              status={status}
              messages={messages}
              calls={calls}
              selectedConversationKey={selectedConversationKey}
              setSelectedConversationKey={setSelectedConversationKey}
              conversationSearch={conversationSearch}
              setConversationSearch={setConversationSearch}
              conversationFilter={conversationFilter}
              setConversationFilter={setConversationFilter}
              unreadFirst={unreadFirst}
              setUnreadFirst={setUnreadFirst}
              showMessagesList={showMessagesList}
              setShowMessagesList={setShowMessagesList}
              messageListWidth={messageListWidth}
              setMessageListWidth={setMessageListWidth}
              callHistoryWidth={callHistoryWidth}
              setCallHistoryWidth={setCallHistoryWidth}
              draft={draft}
              setDraft={setDraft}
              host={host}
              hostInput={hostInput}
              setHostInput={setHostInput}
              onSaveHost={handleSaveHost}
              onRefresh={refresh}
              onShowNative={showNativeApp}
              onCommand={runCommand}
              onNativeHandoff={nativeHandoff}
              onNotice={showNotice}
            />
          </div>

          <ParityLedgerPanel rows={[...SHELL_PARITY_ROWS, ...MESSAGE_PARITY_ROWS]} />

          {notice ? <div className="dp-action-toast">{notice}</div> : null}
          {error ? <div className="dp-error-toast">{error}</div> : null}
          {busy ? <div className="dp-native-hidden" aria-hidden="true">Working: {busy}</div> : null}
          {onClose ? <button className="dp-native-hidden" onClick={onClose} aria-hidden="true">Close</button> : null}
        </section>
      </div>
    </main>
  );
}

export default DeskPhoneWebPanel;
