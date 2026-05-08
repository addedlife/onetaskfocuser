import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_HOST = "http://127.0.0.1:8765";
const ANDROID_BRIDGE_INTENT_URL = "intent://start#Intent;scheme=webphonebridge;package=com.pureinc.webphonebridge;end";
const HOST_CONNECTOR_KEY = "deskphone_web_host_url";
const LEGACY_BRIDGE_KEY = "deskphone_web_bridge_url";
const RAIL_COLLAPSED_KEY = "deskphone_web_rail_collapsed";
const RAIL_AUTO_COLLAPSE_KEY = "deskphone_web_rail_autocollapse";
const RAIL_WIDTH_KEY = "deskphone_web_rail_width";
const MESSAGE_LIST_WIDTH_KEY = "deskphone_web_message_list_width";
const CALL_HISTORY_WIDTH_KEY = "deskphone_web_call_history_width";
const THREAD_DIALPAD_KEYS = [
  ["1", "MainWindow.xaml:2952"],
  ["2", "MainWindow.xaml:2953"],
  ["3", "MainWindow.xaml:2954"],
  ["4", "MainWindow.xaml:2955"],
  ["5", "MainWindow.xaml:2956"],
  ["6", "MainWindow.xaml:2957"],
  ["7", "MainWindow.xaml:2958"],
  ["8", "MainWindow.xaml:2959"],
  ["9", "MainWindow.xaml:2960"],
  ["*", "MainWindow.xaml:2961"],
  ["0", "MainWindow.xaml:2962"],
  ["#", "MainWindow.xaml:2963"],
];
const DESKPHONE_WEB_VERSION = "001";
const MAX_COMPOSE_ATTACHMENTS = 6;

const COLORS = {
  bgMain: "#FFFFFF",
  bgSidebar: "#FFFFFF",
  bgHover: "#F1F3F4",
  bgInput: "#F8F9FA",
  bgSelected: "#F1F3F4",
  accentBlue: "#00796B",
  accentBlueDark: "#00695C",
  accentBlueLight: "#E0F2F1",
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
  textOnAccentBlueLight: "#00695C",
  border: "#DADCE0",
};

function buildDeskPhoneWebVars(theme = {}) {
  const bg = theme.card || theme.bg || COLORS.bgMain;
  const bgSoft = theme.bgW || COLORS.bgInput;
  const selected = theme.tonal || theme.bgW || COLORS.bgSelected;
  const accent = theme.primary || COLORS.accentBlue;
  return {
    "--dp-bg-main": bg,
    "--dp-bg-sidebar": bg,
    "--dp-bg-hover": selected,
    "--dp-bg-input": bgSoft,
    "--dp-bg-selected": selected,
    "--dp-blue": accent,
    "--dp-blue-dark": theme.onTonal || accent,
    "--dp-blue-light": theme.tonal || selected,
    "--dp-green": theme.success || COLORS.accentGreen,
    "--dp-green-dark": theme.successDark || COLORS.accentGreenDark,
    "--dp-green-light": theme.successLight || COLORS.accentGreenLight,
    "--dp-red": theme.danger || COLORS.accentRed,
    "--dp-red-light": theme.dangerLight || COLORS.accentRedLight,
    "--dp-text": theme.text || COLORS.textPrimary,
    "--dp-text-second": theme.tSoft || COLORS.textSecond,
    "--dp-muted": theme.tSoft || COLORS.textMuted,
    "--dp-disabled": theme.tFaint || COLORS.textDisabled,
    "--dp-border": theme.brdS || theme.brd || COLORS.border,
    "--dp-border-strong": theme.brd || "#BDC1C6",
    "--dp-bg-surface": bg,
  };
}

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
const CALL_FILTERS = ["All", "Missed", "In", "Out"];

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

function isLocalBridgeHost(host) {
  try {
    const url = new URL(normalizeHost(host));
    const hostname = url.hostname.toLowerCase();
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
    return isLoopback && url.port === "8765";
  } catch {
    return false;
  }
}

function isLikelyMobileBridgeBrowser() {
  if (typeof navigator === "undefined") return false;
  const userAgent = `${navigator.userAgent || ""} ${navigator.platform || ""}`.toLowerCase();
  const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
  return userAgent.includes("android") || (coarsePointer && (navigator.maxTouchPoints || 0) > 0);
}

function isLocalMobileBridgeHost(host) {
  return isLocalBridgeHost(host) && isLikelyMobileBridgeBrowser();
}

function openAndroidBridgeApp() {
  window.location.href = ANDROID_BRIDGE_INTENT_URL;
}

async function readJson(host, path) {
  const response = await fetch(`${host}${path}`, { cache: "no-store" });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error || body?.message || "";
    } catch {
      detail = "";
    }
    throw new Error(detail ? `${path}: ${detail}` : `${path} returned ${response.status}`);
  }
  return response.json();
}

async function readOptionalJson(host, path) {
  try {
    return { ok: true, path, data: await readJson(host, path) };
  } catch (error) {
    return { ok: false, path, error };
  }
}

function stringifyAsciiJson(value) {
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

async function postJson(host, path, payload) {
  const options = {
    method: "POST",
    cache: "no-store",
  };
  if (payload !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = stringifyAsciiJson(payload);
  }
  const response = await fetch(`${host}${path}`, {
    ...options,
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

function formatFileSize(bytes = 0) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function sanitizeUploadFileName(name = "") {
  const clean = String(name || "attachment.bin")
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "attachment.bin";
}

function guessUploadContentType(file) {
  if (file?.type) return file.type;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".vcf")) return "text/vcard";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function makeComposeAttachment(file, index = 0) {
  return {
    id: `${Date.now()}-${index}-${file?.name || "attachment"}-${file?.size || 0}-${file?.lastModified || 0}`,
    file,
    fileName: sanitizeUploadFileName(file?.name),
    contentType: guessUploadContentType(file),
    size: file?.size || 0,
  };
}

function addComposeFiles(fileList, setAttachments, onNotice) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  setAttachments((current) => {
    const room = Math.max(0, MAX_COMPOSE_ATTACHMENTS - current.length);
    const next = files.slice(0, room).map(makeComposeAttachment);
    if (files.length > room) onNotice?.(`Attached ${room}; DeskPhone allows ${MAX_COMPOSE_ATTACHMENTS} at once in the browser.`);
    return [...current, ...next];
  });
}

function fileToDataBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Attachment read failed"));
    reader.readAsDataURL(file);
  });
}

async function composeAttachmentUpload(attachment) {
  return {
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    dataBase64: await fileToDataBase64(attachment.file),
  };
}

async function sendComposeMessage({ onCommand, to, body, attachments, label }) {
  const phone = String(to || "").trim();
  const text = String(body || "").trim();
  if (!phone || (!text && !attachments.length)) return false;
  if (attachments.length) {
    const uploads = await Promise.all(attachments.map(composeAttachmentUpload));
    await onCommand("/send-with-attachments", label, { to: phone, body: text, attachments: uploads });
  } else {
    await onCommand(`/send?to=${encodeURIComponent(phone)}&body=${encodeURIComponent(text)}`, label);
  }
  return true;
}

function ComposeAttachmentTray({ attachments, onRemove, removeSource }) {
  if (!attachments.length) return null;
  return (
    <div className="dp-compose-attachments">
      {attachments.map((attachment) => (
        <span className="dp-compose-attachment-chip" key={attachment.id}>
          {icon(attachment.contentType?.startsWith("image/") ? "image" : "attach_file", 16)}
          <span>{attachment.fileName}</span>
          <small>{formatFileSize(attachment.size)}</small>
          <button type="button" aria-label={`Remove ${attachment.fileName}`} data-native-source={removeSource} onClick={() => onRemove(attachment.id)}>
            {icon("close", 15)}
          </button>
        </span>
      ))}
    </div>
  );
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

function isAndroidPhoneBridge(status) {
  const build = String(status?.build || status?.Build || "");
  return build.toLowerCase().includes("android bridge") || !!status?.remotePhone;
}

function remotePhoneStatus(status) {
  return status?.remotePhone || status?.RemotePhone || {};
}

function hasRemotePhoneRows(status) {
  const remote = remotePhoneStatus(status);
  return !!(remote.contacts || remote.calls || remote.messages);
}

function isBridgeApiReady(status, online) {
  return !!(online && isAndroidPhoneBridge(status));
}

function connectionStatusFromStatus(status) {
  if (!status) return "Not connected";
  const remote = remotePhoneStatus(status);
  if (remote.contacts || remote.calls || remote.messages) return "Phone data connected";
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
  if (isAndroidPhoneBridge(status)) return hostBuildNumber(status) || "Android Bridge";
  const numberOnly = hostBuildNumber(status);
  return numberOnly ? `Windows Host: ${numberOnly}` : "Windows Host: unknown";
}

function hostBuildDetailLabel(status) {
  const build = status?.build || status?.Build || status?.buildNumber || status?.BuildNumber || "";
  if (isAndroidPhoneBridge(status)) return build || "Android Bridge";
  return build ? `Windows Host: ${build}` : "Windows Host: not reporting build details";
}

function webVersionBadge() {
  return `Web ${DESKPHONE_WEB_VERSION}`;
}

function hostDeviceName(status) {
  const remote = remotePhoneStatus(status);
  return (
    remote.preferredName ||
    status?.phoneName ||
    status?.PhoneName ||
    status?.deviceName ||
    status?.DeviceName ||
    status?.connectedDeviceName ||
    status?.ConnectedDeviceName ||
    status?.hostConnector ||
    "phone"
  );
}

function quickConnectSummary(status, online) {
  const remote = remotePhoneStatus(status);
  if (remote.contacts || remote.calls || remote.messages) {
    return `${hostDeviceName(status)}: ${remote.contacts || 0} contacts, ${remote.calls || 0} calls, ${remote.messages || 0} messages`;
  }
  const state = online && status?.connected ? "connected" : online ? "ready" : "ready";
  return `Preferred Phone [${hostDeviceName(status)}] ${state}`;
}

function bridgeConnectSummary(status, online) {
  const remote = remotePhoneStatus(status);
  if (hasRemotePhoneRows(status)) {
    return `${remote.contacts || 0} contacts, ${remote.calls || 0} calls, ${remote.messages || 0} texts`;
  }
  return isBridgeApiReady(status, online) ? "Bridge API connected" : online ? "Local bridge is ready" : "Open the bridge app";
}

function bridgeStatusLabel(status, online) {
  if (isBridgeApiReady(status, online)) return "Local bridge connected";
  return online ? "Local bridge ready" : "Bridge app not reached";
}

function bridgeIndicatorRows(status, online) {
  const remote = remotePhoneStatus(status);
  const displayConnected = isBridgeApiReady(status, online);
  return [
    {
      key: "display",
      label: "Local bridge",
      value: displayConnected ? "Connected" : "Not connected",
      ok: displayConnected,
    },
    {
      key: "calls",
      label: "Calls",
      value: remote.calls ? "Loaded" : status?.calls || status?.Calls || "No call rows yet",
      ok: !!(remote.calls || status?.calls || status?.Calls),
    },
    {
      key: "messages",
      label: "Texts",
      value: remote.messages ? "Loaded" : status?.messages || status?.Messages || "No text rows yet",
      ok: !!(remote.messages || status?.messages || status?.Messages),
    },
  ];
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
  if (Array.isArray(value?.messages)) return value.messages;
  if (Array.isArray(value?.calls)) return value.calls;
  if (Array.isArray(value?.contacts)) return value.contacts;
  if (Array.isArray(value?.devices)) return value.devices;
  if (Array.isArray(value?.knownDevices)) return value.knownDevices;
  if (Array.isArray(value?.KnownDevices)) return value.KnownDevices;
  if (Array.isArray(value?.scannedDevices)) return value.scannedDevices;
  if (Array.isArray(value?.ScannedDevices)) return value.ScannedDevices;
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
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  const text = String(value || "").trim();
  const mapMatch = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
  if (mapMatch) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = mapMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const numeric = text.match(/^\d{12,}$/) ? Number(text) : NaN;
  if (Number.isFinite(numeric)) return new Date(numeric);
  const date = new Date(text);
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
  const timestamp = raw?.timestamp || raw?.datetime || raw?.date || raw?.time || "";
  const attachments = getApiList(raw?.attachments).map(normalizeAttachment);
  const sendStatus = normalizeSendStatus(raw);
  const readValue = raw?.isRead ?? raw?.IsRead ?? raw?.read ?? raw?.Read;
  const isRead = typeof readValue === "string" ? !["0", "false", "no"].includes(readValue.toLowerCase()) : readValue !== false;
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
    isRead: raw?.isSent ? true : isRead,
    isPinned: !!(raw?.isPinned ?? raw?.IsPinned),
    pinActionLabel: raw?.pinActionLabel || raw?.PinActionLabel || ((raw?.isPinned ?? raw?.IsPinned) ? "Unpin" : "Pin"),
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

function saveDataUrlAttachment(attachment, onNotice) {
  if (!attachment?.dataUrl) {
    onNotice?.("Attachment data is not available in the browser yet.");
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

function callTimestampMs(call) {
  const parsed = Date.parse(call?.timestamp || call?.Timestamp || call?.time || call?.Time || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSortedCalls(calls) {
  return getApiList(calls)
    .slice()
    .sort((a, b) => callTimestampMs(b) - callTimestampMs(a));
}

function groupCallsByNumber(calls, selectedKey) {
  return getSortedCalls(calls)
    .filter((call) => normalizePhoneKey(call?.number) === selectedKey)
    .slice(0, 12);
}

function callBucket(call) {
  const raw = String(call?.direction || call?.directionLabel || call?.type || call?.callType || "").toLowerCase();
  const numeric = Number(call?.type ?? call?.callType ?? call?.directionCode ?? call?.direction);
  if (call?.isMissed || raw.includes("miss") || numeric === 3) return "Missed";
  if (raw.includes("out") || raw.includes("dial") || numeric === 2) return "Out";
  if (raw.includes("in") || raw.includes("receiv") || numeric === 1) return "In";
  return "";
}

function callMatchesFilter(call, filter) {
  if (filter === "All") return true;
  return callBucket(call) === filter;
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
  bridgeMode,
  connectionStatus,
  callsConnectionLabel,
  messagesConnectionLabel,
  onReconnect,
  onSettings,
}) {
  const isBridge = bridgeMode || isAndroidPhoneBridge(status);
  const bridgeRows = isBridge ? bridgeIndicatorRows(status, online) : [];
  const reconnectLabel = isBridge ? "Refresh phone data" : "Reconnect saved phone";
  const settingsLabel = isBridge ? "Bridge settings" : "Connection settings";
  const collapsedCode = isBridge ? "API" : "BT";
  if (collapsed) {
    return (
      <div className="dp-rail-connection-collapsed" data-native-source="MainWindow.xaml:710">
        <div className="dp-collapsed-status-tile" title={connectionStatus}>
          <span className={`dp-status-dot ${online && (status?.connected || isBridge) ? "is-online" : ""}`} />
          <span className="dp-collapsed-bt">{collapsedCode}</span>
        </div>
        <button
          className="dp-collapsed-icon-button"
          aria-label={reconnectLabel}
          title={reconnectLabel}
          data-native-source="MainWindow.xaml:737"
          data-native-glyph="E627"
          onClick={onReconnect}
          disabled={!online}
        >
          {icon("sync", 20)}
        </button>
        <button
          className="dp-collapsed-icon-button"
          aria-label={settingsLabel}
          title={settingsLabel}
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
            <span className={`dp-status-dot ${online && (status?.connected || isBridge) ? "is-online" : ""}`} />
            <span className="dp-rail-status-text">{connectionStatus}</span>
          </div>
          <button
            className="dp-compact-icon-button"
            aria-label={reconnectLabel}
            title={reconnectLabel}
            data-native-source="MainWindow.xaml:665"
            data-native-glyph="E627"
            onClick={onReconnect}
            disabled={!online}
          >
            {icon("sync", 20)}
          </button>
        </div>
        <div className="dp-rail-subtitle">{isBridge ? bridgeConnectSummary(status, online) : quickConnectSummary(status, online)}</div>
        {bridgeRows.length ? (
          <div className="dp-bridge-indicators is-compact">
            {bridgeRows.map((row) => (
              <div className="dp-bridge-indicator" key={row.key}>
                <span className={`dp-status-dot ${row.ok ? "is-online" : ""}`} />
                <span>{row.label}: {row.ok ? "Connected" : "Needs attention"}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="dp-rail-channel">{callsConnectionLabel}</div>
            <div className="dp-rail-channel">{messagesConnectionLabel}</div>
          </>
        )}
      </div>
      <ShellButton
        className="dp-tonal dp-rail-wide-button"
        nativeSource="MainWindow.xaml:692"
        onClick={onReconnect}
        disabled={!online}
      >
        {reconnectLabel}
      </ShellButton>
      <ShellButton
        className="dp-tonal dp-rail-wide-button"
        nativeSource="MainWindow.xaml:701"
        onClick={onSettings}
      >
        {settingsLabel}
      </ShellButton>
    </div>
  );
}

function ReconnectPrompt({ visible, status, bridgeMode, onConnect, onChooseDevice, onDismiss }) {
  if (!visible) {
    return (
      <div className="dp-native-hidden" data-native-source="MainWindow.xaml:788" aria-hidden="true">
        <button data-native-source="MainWindow.xaml:808">Connect</button>
        <button data-native-source="MainWindow.xaml:812">Choose device</button>
        <button data-native-source="MainWindow.xaml:816">Dismiss reconnect prompt</button>
      </div>
    );
  }
  const isBridge = bridgeMode || isAndroidPhoneBridge(status);
  return (
    <div className="dp-prompt dp-reconnect-prompt" data-native-source="MainWindow.xaml:788">
      <div className="dp-prompt-text">
        <div className="dp-prompt-title">{isBridge ? "Refresh phone data?" : `Reconnect to ${hostDeviceName(status)}?`}</div>
        <div className="dp-prompt-subtitle">{isBridge ? "The local Android bridge is the active phone source." : "Your phone was connected last session."}</div>
      </div>
      <ShellButton className="dp-primary" nativeSource="MainWindow.xaml:808" onClick={onConnect}>
        {isBridge ? "Refresh" : "Connect"}
      </ShellButton>
      <ShellButton className="dp-tonal" nativeSource="MainWindow.xaml:812" onClick={onChooseDevice}>
        {isBridge ? "Bridge settings" : "Choose device"}
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

function BuildUpdateOverlay({ showPrompt, showIndicator, title, body, onShowPrompt, onAccept, onSnooze }) {
  return (
    <>
      {showPrompt ? (
        <div className="dp-build-overlay" data-native-source="MainWindow.xaml:855">
          <div className="dp-build-dialog">
            <h2>{title || "New DeskPhone build available"}</h2>
            <p>{body || "The native DeskPhone app can switch to the staged build when the host exposes the update action to the web shell."}</p>
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

function ConversationRow({ conversation, selected, onSelect, onConversationAction }) {
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
          <button type="button" data-native-source="MainWindow.xaml:1299" onClick={() => onConversationAction("mark-conversation-read", "mark read", conversation.number)}>Mark read</button>
          <button type="button" data-native-source="MainWindow.xaml:1302" onClick={() => onConversationAction("mark-conversation-unread", "mark unread", conversation.number)}>Mark unread</button>
          <button type="button" data-native-source="MainWindow.xaml:1306" onClick={() => onConversationAction("toggle-conversation-pin", "toggle conversation pin", conversation.number)}>Pin / unpin</button>
          <button type="button" data-native-source="MainWindow.xaml:1309" onClick={() => onConversationAction("toggle-conversation-mute", "toggle conversation mute", conversation.number)}>Mute / unmute alerts</button>
          <button type="button" data-native-source="MainWindow.xaml:1312" onClick={() => onConversationAction("toggle-conversation-block", "toggle conversation block", conversation.number)}>Block / unblock locally</button>
        </div>
      </details>
    </div>
  );
}

function ThreadSearchBar({ value, onChange, matchCount, currentIndex, onPrevious, onNext }) {
  const status = value ? (matchCount ? `${currentIndex + 1} of ${matchCount}` : "No matches") : "";
  const disabled = !matchCount;
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
      <button type="button" title="Previous match" aria-label="Previous match" data-native-source="MainWindow.xaml:1693" onClick={onPrevious} disabled={disabled}>{icon("keyboard_arrow_up", 18)}</button>
      <button type="button" title="Next match" aria-label="Next match" data-native-source="MainWindow.xaml:1697" onClick={onNext} disabled={disabled}>{icon("keyboard_arrow_down", 18)}</button>
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

function MessageAttachments({ message, onNotice, onOpenImage }) {
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
            <button type="button" onClick={() => saveDataUrlAttachment(attachment, onNotice)}>Save</button>
            </div>
          ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  previousMessage,
  open,
  searchMatch = false,
  searchCurrent = false,
  onToggleOpen,
  onCopy,
  onCall,
  onForward,
  onTogglePin,
  onDelete,
  onNotice,
  onOpenImage,
}) {
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
  const itemClass = [
    "dp-message-item",
    message.isSent ? "is-outgoing" : "is-incoming",
    searchMatch ? "is-search-match" : "",
    searchCurrent ? "is-search-current" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={itemClass}
      data-native-source="MainWindow.xaml:1845"
      data-message-id={message.id}
      data-thread-search-match={searchMatch ? "true" : undefined}
      data-thread-search-current={searchCurrent ? "true" : undefined}
    >
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
        <MessageAttachments message={message} onNotice={onNotice} onOpenImage={onOpenImage} />
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
            <button type="button" title="Copy" aria-label="Copy" onClick={(event) => { event.stopPropagation(); onCopy(message); }}>{icon("content_copy", 17)}</button>
            <button
              type="button"
              title="Forward"
              aria-label="Forward"
              data-native-source={message.isSent ? "MainWindow.xaml:2260" : "MainWindow.xaml:2040"}
              onClick={(event) => {
                event.stopPropagation();
                onForward(message);
              }}
            >
              {icon("forward", 17)}
            </button>
            <button type="button" title="Call" aria-label="Call" onClick={(event) => { event.stopPropagation(); onCall(message.number); }}>{icon("call", 17)}</button>
            <button
              type="button"
              title="Delete"
              aria-label="Delete"
              data-native-source={message.isSent ? "MainWindow.xaml:2268" : "MainWindow.xaml:2048"}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(message);
              }}
            >
              {icon("delete", 17)}
            </button>
            <button
              type="button"
              title={message.pinActionLabel || "Pin"}
              aria-label={message.pinActionLabel || "Pin"}
              data-native-source={message.isSent ? "MainWindow.xaml:2272" : "MainWindow.xaml:2052"}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin(message);
              }}
            >
              {icon("push_pin", 17)}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConversationCallHistory({
  calls,
  selectedConversation,
  mode = "thread",
  dialerDefaultOpen = false,
  dialerOpenSignal = 0,
  hasUndoCallHistoryDelete = false,
  undoCallHistoryDeleteText = "Call deleted",
  onUndoCallHistoryDelete,
  onCall,
  onText,
  onDial,
  onOpenFullCalls,
  onDeleteAllCalls,
  onToggleCallBlock,
  onDeleteCall,
}) {
  const [callFilter, setCallFilter] = useState("All");
  const [dialerOpen, setDialerOpen] = useState(dialerDefaultOpen);
  const [dialerNumber, setDialerNumber] = useState("");
  const [showRecents, setShowRecents] = useState(true);
  const isFullCallsSurface = mode === "full";
  const selectedCalls = getSortedCalls(calls);
  const visibleCalls = selectedCalls.filter((call) => callMatchesFilter(call, callFilter));
  const callSummary = selectedCalls.length
    ? callFilter === "All"
      ? `${selectedCalls.length} total`
      : `${visibleCalls.length} of ${selectedCalls.length} ${callFilter.toLowerCase()}`
    : "No calls";

  useEffect(() => {
    if (dialerOpenSignal) setDialerOpen(true);
  }, [dialerOpenSignal]);

  return (
    <aside className={`dp-thread-calls ${isFullCallsSurface ? "is-full-calls" : ""}`} data-native-source={isFullCallsSurface ? "MainWindow.xaml:3246" : "MainWindow.xaml:2459"}>
      <div className="dp-thread-calls-header">
        <div>
          <strong>Calls</strong>
          <span>{callSummary}</span>
        </div>
        <div className="dp-thread-calls-header-actions">
          <button type="button" title="Show keypad" aria-label="Show keypad" data-native-source="MainWindow.xaml:2573" onClick={() => setDialerOpen(true)}>{icon("dialpad", 18)}</button>
          {isFullCallsSurface && showRecents ? (
            <button type="button" title="Hide recents" aria-label="Hide recents" data-native-source="MainWindow.xaml:3259" onClick={() => setShowRecents(false)}>{icon("close", 18)}</button>
          ) : null}
          <button type="button" title="Delete all call history" aria-label="Delete all call history" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3271" : "MainWindow.xaml:2592"} onClick={onDeleteAllCalls}>{icon("delete", 18)}</button>
        </div>
      </div>
      {isFullCallsSurface && !showRecents ? (
        <div className="dp-calls-hidden-pane" data-native-source="MainWindow.xaml:3204">
          <ShellButton className="dp-tonal" iconName="history" nativeSource="MainWindow.xaml:3204" onClick={() => setShowRecents(true)}>Show recents</ShellButton>
        </div>
      ) : (
        <>
          <div className="dp-call-filter-grid" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3298" : "MainWindow.xaml:2483"}>
            {CALL_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter}
                className={callFilter === filter ? "is-active" : ""}
                onClick={() => setCallFilter(filter)}
                data-automation-id={`CallHistoryFilter${filter}`}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="dp-thread-call-list">
            {visibleCalls.map((call) => (
              <div className={`dp-thread-call-row ${call.isMissed ? "is-missed" : ""}`} key={call.id || `${call.number}-${call.timestamp}`}>
                <div>{icon(call.isMissed ? "phone_missed" : call.direction === "Outgoing" ? "call_made" : "call_received", 18)}</div>
                <div>
                  <strong>{call.directionLabel || call.direction || "Call"}</strong>
                  <span>{call.timeDisplay || formatConversationTime(call.timestamp)}{call.durationDisplay ? ` - ${call.durationDisplay}` : ""}</span>
                </div>
                <div className="dp-thread-call-actions">
                  <button type="button" title="Message this number" aria-label="Message this number" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3513" : "MainWindow.xaml:2826"} onClick={() => onText(call.number)}>{icon("sms", 17)}</button>
                  <button type="button" title="Call this number" aria-label="Call this number" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3518" : "MainWindow.xaml:2831"} onClick={() => onCall(call.number)}>{icon("call", 17)}</button>
                  <button type="button" title="Block / unblock locally" aria-label="Block / unblock locally" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3522" : "MainWindow.xaml:2836"} onClick={() => onToggleCallBlock(call)}>{icon("block", 17)}</button>
                  <button type="button" title="Delete call entry" aria-label="Delete call entry" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3527" : "MainWindow.xaml:2841"} onClick={() => onDeleteCall(call)}>{icon("delete", 17)}</button>
                </div>
              </div>
            ))}
            {!visibleCalls.length ? (
              <div className="dp-thread-call-empty">
                {selectedCalls.length ? `No ${callFilter.toLowerCase()} calls in this view.` : isFullCallsSurface ? "Full call history will appear here when DeskPhone reports calls." : "Calls for this conversation will appear here when DeskPhone reports them."}
              </div>
            ) : null}
          </div>
        </>
      )}
      {hasUndoCallHistoryDelete ? (
        <div className="dp-call-undo-bar" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3378" : "MainWindow.xaml:2627"}>
          <span>{undoCallHistoryDeleteText}</span>
          <button type="button" onClick={onUndoCallHistoryDelete}>Undo</button>
        </div>
      ) : null}
      {dialerOpen ? (
        <div className="dp-thread-dialer" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3552" : "MainWindow.xaml:2871"}>
          <div className="dp-thread-dialer-top">
            <label>
              <span>Number</span>
              <input
                value={dialerNumber}
                onChange={(event) => setDialerNumber(event.target.value)}
                inputMode="tel"
                aria-label="Dial number"
                data-automation-id="ThreadDialerNumber"
              />
            </label>
            <button type="button" title="Hide keypad" aria-label="Hide keypad" data-native-source={isFullCallsSurface ? "MainWindow.xaml:3576" : "MainWindow.xaml:2871"} onClick={() => setDialerOpen(false)}>{icon("close", 18)}</button>
          </div>
          <div className="dp-thread-dialer-keys" aria-label="Dial pad">
            {THREAD_DIALPAD_KEYS.map(([key, nativeSource]) => (
              <button
                type="button"
                key={key}
                data-native-source={nativeSource}
                onClick={() => setDialerNumber((value) => `${value}${key}`)}
              >
                {key}
              </button>
            ))}
          </div>
          <div className="dp-thread-dialer-actions">
            <button type="button" title="Backspace" aria-label="Backspace" data-native-source="MainWindow.xaml:2893" onClick={() => setDialerNumber((value) => value.slice(0, -1))}>{icon("backspace", 17)}</button>
            <button type="button" title="Text" aria-label="Text" data-native-source="MainWindow.xaml:2931" onClick={() => onText(dialerNumber)} disabled={!dialerNumber.trim()}>{icon("sms", 17)}<span>Text</span></button>
            <button type="button" title="Voicemail" aria-label="Voicemail" data-native-source="MainWindow.xaml:2966" onClick={() => onDial("*86")}>{icon("voicemail", 17)}<span>Voicemail</span></button>
            <button type="button" title="Call" aria-label="Call" data-native-source="MainWindow.xaml:2992" onClick={() => onDial(dialerNumber)} disabled={!dialerNumber.trim()}>{icon("call", 17)}<span>Call</span></button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function MessagesSlice({
  status,
  messages,
  calls,
  contacts,
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
  onOpenNewMessage,
  onOpenFullCalls,
  onOpenContactEditor,
  onNotice,
}) {
  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchCursor, setThreadSearchCursor] = useState(0);
  const [openActionMessageId, setOpenActionMessageId] = useState("");
  const [activeImage, setActiveImage] = useState(null);
  const [imageRotation, setImageRotation] = useState(0);
  const [replyAttachments, setReplyAttachments] = useState([]);
  const messageScrollRef = useRef(null);
  const composeRef = useRef(null);
  const replyAttachmentInputRef = useRef(null);

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

  useEffect(() => {
    setReplyAttachments([]);
  }, [selectedConversation?.key]);

  const hasUndoMessageDelete = !!(status?.hasUndoMessageDelete || status?.HasUndoMessageDelete);
  const undoMessageDeleteText = status?.undoMessageDeleteText || status?.UndoMessageDeleteText || "Message deleted";
  const hasUndoCallHistoryDelete = !!(status?.hasUndoCallHistoryDelete || status?.HasUndoCallHistoryDelete);
  const undoCallHistoryDeleteText = status?.undoCallHistoryDeleteText || status?.UndoCallHistoryDeleteText || "Call deleted";
  const pinnedMessages = useMemo(
    () => selectedConversation?.messages.filter((message) => message.isPinned).slice().reverse() || [],
    [selectedConversation]
  );
  const threadSearchLower = threadSearch.trim().toLowerCase();
  const threadMatchIds = useMemo(() => (
    threadSearchLower && selectedConversation
      ? selectedConversation.messages.filter((message) => (
        message.body.toLowerCase().includes(threadSearchLower) ||
        message.preview.toLowerCase().includes(threadSearchLower)
      )).map((message) => message.id)
      : []
  ), [selectedConversation, threadSearchLower]);
  const threadMatchIdSet = useMemo(() => new Set(threadMatchIds), [threadMatchIds]);
  const threadMatchCount = threadMatchIds.length;
  const activeThreadSearchCursor = threadMatchCount ? Math.min(threadSearchCursor, threadMatchCount - 1) : 0;

  useEffect(() => {
    setThreadSearchCursor(threadMatchIds.length ? threadMatchIds.length - 1 : 0);
  }, [selectedConversation?.key, threadSearchLower, threadMatchIds.length]);

  useEffect(() => {
    if (!threadMatchIds.length) return;
    const scrollBox = messageScrollRef.current;
    window.requestAnimationFrame(() => {
      scrollBox?.querySelector('[data-thread-search-current="true"]')?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  }, [threadSearchCursor, threadMatchIds.length]);

  const stepThreadSearchMatch = useCallback((direction) => {
    if (!threadMatchIds.length) {
      onNotice("No search matches.");
      return;
    }
    setThreadSearchCursor((current) => {
      const offset = direction === "previous" ? -1 : 1;
      return (current + offset + threadMatchIds.length) % threadMatchIds.length;
    });
  }, [onNotice, threadMatchIds.length]);

  const callNumber = useCallback((number) => {
    const normalized = normalizePhoneKey(number);
    if (!normalized) {
      onNotice("Call needs a phone number.");
      return;
    }
    onCommand(`/dial?n=${encodeURIComponent(normalized)}`, "call");
  }, [onCommand, onNotice]);

  const dialRawNumber = useCallback((number) => {
    const cleaned = String(number || "").replace(/[^\d+*#]/g, "");
    if (!cleaned) return;
    onCommand(`/dial?n=${encodeURIComponent(cleaned)}`, "call");
  }, [onCommand]);

  const textNumber = useCallback((number) => {
    const normalized = normalizePhoneKey(number);
    if (!normalized || normalized !== selectedConversation?.key) {
      setDraft("");
      onOpenNewMessage(normalized || number);
      return;
    }
    composeRef.current?.focus();
    onNotice("Reply box ready for this number.");
  }, [onNotice, onOpenNewMessage, selectedConversation?.key, setDraft]);

  const copyMessage = useCallback(async (message) => {
    const text = message.body || message.preview || "";
    try {
      await navigator.clipboard.writeText(text);
      onNotice("Copied message text.");
    } catch {
      onNotice("Copy is blocked by this browser session.");
    }
  }, [onNotice]);

  const forwardMessage = useCallback((message) => {
    setDraft(message.body || message.preview || "");
    onOpenNewMessage();
    onNotice("Forward draft ready. Choose a recipient.");
  }, [onNotice, onOpenNewMessage, setDraft]);

  const sendMessage = useCallback(async () => {
    const sent = await sendComposeMessage({
      onCommand,
      to: selectedConversation?.number,
      body: draft,
      attachments: replyAttachments,
      label: replyAttachments.length ? "send message with attachments" : "send message",
    });
    if (!sent) return;
    setDraft("");
    setReplyAttachments([]);
  }, [draft, selectedConversation, onCommand, replyAttachments, setDraft]);

  const scrollToLatestMessage = useCallback(() => {
    const scrollBox = messageScrollRef.current;
    if (!scrollBox) return;
    scrollBox.scrollTop = scrollBox.scrollHeight;
  }, []);

  const scrollToMessage = useCallback((messageId) => {
    const scrollBox = messageScrollRef.current;
    const item = Array.from(scrollBox?.querySelectorAll?.("[data-message-id]") || [])
      .find((node) => node.getAttribute("data-message-id") === messageId);
    item?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const revealMessageActions = useCallback((messageId) => {
    setOpenActionMessageId((current) => current === messageId ? "" : messageId);
  }, []);

  useEffect(() => {
    if (!openActionMessageId) return;
    window.requestAnimationFrame(() => {
      const scrollBox = messageScrollRef.current;
      const item = Array.from(scrollBox?.querySelectorAll?.("[data-message-id]") || [])
        .find((node) => node.getAttribute("data-message-id") === openActionMessageId);
      item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [openActionMessageId]);

  const toggleMessagePin = useCallback(async (message) => {
    if (!message?.id) {
      onNotice("Pin needs a message id from DeskPhone.");
      return;
    }
    await onCommand(`/toggle-message-pin?id=${encodeURIComponent(message.id)}`, "toggle message pin");
  }, [onCommand, onNotice]);

  const deleteMessage = useCallback(async (message) => {
    if (!message?.id) {
      onNotice("Delete needs a message id from DeskPhone.");
      return;
    }
    await onCommand(`/delete-message?id=${encodeURIComponent(message.id)}`, "delete message");
  }, [onCommand, onNotice]);

  const runConversationAction = useCallback((endpoint, label, number) => {
    const normalized = normalizePhoneKey(number);
    if (!normalized) {
      onNotice("That action needs a phone number.");
      return;
    }
    onCommand(`/${endpoint}?phone=${encodeURIComponent(normalized)}`, label);
  }, [onCommand, onNotice]);

  const deleteAllCalls = useCallback(() => {
    if (!window.confirm("Delete all call history from DeskPhone Web?")) return;
    onCommand("/delete-all-call-history", "delete all call history");
  }, [onCommand]);

  const toggleCallBlock = useCallback((call) => {
    const normalized = normalizePhoneKey(call?.number);
    if (!normalized) {
      onNotice("Block needs a phone number.");
      return;
    }
    onCommand(`/toggle-call-block?phone=${encodeURIComponent(normalized)}`, "toggle call block");
  }, [onCommand, onNotice]);

  const deleteCall = useCallback((call) => {
    if (!call?.id) {
      onNotice("Delete needs a call id from DeskPhone.");
      return;
    }
    onCommand(`/delete-call-entry?id=${encodeURIComponent(call.id)}`, "delete call entry");
  }, [onCommand, onNotice]);

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
  const closeThreadActionMenu = (event) => {
    event.stopPropagation();
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

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
              <DeskPhoneIconButton iconName="add" label="New message" nativeSource="MainWindow.xaml:1078" nativeGlyph="E145" onClick={onOpenNewMessage} />
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
              onConversationAction={runConversationAction}
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
                currentIndex={activeThreadSearchCursor}
                onPrevious={() => stepThreadSearchMatch("previous")}
                onNext={() => stepThreadSearchMatch("next")}
              />
              <div className="dp-thread-actions" data-native-source="MainWindow.xaml:1738">
                <details className="dp-thread-actions-menu" onClick={(event) => event.stopPropagation()}>
                  <summary title="Conversation actions" aria-label="Conversation actions">{icon("more_vert", 20)}</summary>
                  <div className="dp-floating-menu">
                    {!showMessagesList ? (
                      <button
                        type="button"
                        data-native-source="MainWindow.xaml:1831"
                        onClick={(event) => {
                          closeThreadActionMenu(event);
                          setShowMessagesList(true);
                        }}
                      >
                        {icon("menu_open", 18)}
                        <span>Show threads</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1738"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        runConversationAction("toggle-conversation-block", "toggle conversation block", selectedConversation.number);
                      }}
                    >
                      {icon("block", 18)}
                      <span>Block / unblock locally</span>
                    </button>
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1742"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        runConversationAction("toggle-conversation-pin", "toggle conversation pin", selectedConversation.number);
                      }}
                    >
                      {icon("push_pin", 18)}
                      <span>Pin / unpin conversation</span>
                    </button>
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1746"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        runConversationAction("toggle-conversation-mute", "toggle conversation mute", selectedConversation.number);
                      }}
                    >
                      {icon("notifications_off", 18)}
                      <span>Mute / unmute alerts</span>
                    </button>
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1750"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        runConversationAction("mark-conversation-read", "mark read", selectedConversation.number);
                      }}
                    >
                      {icon("mark_email_read", 18)}
                      <span>Mark read</span>
                    </button>
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1755"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        runConversationAction("mark-conversation-unread", "mark unread", selectedConversation.number);
                      }}
                    >
                      {icon("mark_email_unread", 18)}
                      <span>Mark unread</span>
                    </button>
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1760"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        onOpenContactEditor(selectedConversation.number, "new");
                      }}
                    >
                      {icon("person_add", 18)}
                      <span>Add contact</span>
                    </button>
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1766"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        onOpenContactEditor(selectedConversation.number, "edit");
                      }}
                    >
                      {icon("edit", 18)}
                      <span>Edit contact</span>
                    </button>
                    <button
                      type="button"
                      data-native-source="MainWindow.xaml:1776"
                      onClick={(event) => {
                        closeThreadActionMenu(event);
                        callNumber(selectedConversation.number);
                      }}
                    >
                      {icon("call", 18)}
                      <span>Call</span>
                    </button>
                  </div>
                </details>
              </div>
            </header>

            <div className="dp-thread-detail-grid" data-native-source="MainWindow.xaml:1611">
              <main className="dp-thread-messages" data-native-source="MainWindow.xaml:1845">
                {pinnedMessages.length ? (
                  <div className="dp-pinned-message-strip" data-native-source="MainWindow.xaml:2670">
                    <div className="dp-pinned-strip-title">
                      {icon("push_pin", 15)}
                      <span>{pinnedMessages.length === 1 ? "1 pinned message" : `${pinnedMessages.length} pinned messages`}</span>
                    </div>
                    <div className="dp-pinned-strip-list">
                      {pinnedMessages.slice(0, 4).map((message) => (
                        <button
                          key={message.id}
                          type="button"
                          data-native-source="MainWindow.xaml:2670"
                          onClick={() => scrollToMessage(message.id)}
                        >
                          <strong>{formatBubbleTime(message.timestamp)}</strong>
                          <span>{message.preview || message.body || "Pinned message"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="dp-message-scroll" ref={messageScrollRef}>
                  {selectedConversation.messages.map((message, index) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      previousMessage={selectedConversation.messages[index - 1]}
                      open={openActionMessageId === message.id}
                      searchMatch={threadMatchIdSet.has(message.id)}
                      searchCurrent={threadMatchIds[activeThreadSearchCursor] === message.id}
                      onToggleOpen={revealMessageActions}
                      onCopy={copyMessage}
                      onCall={callNumber}
                      onForward={forwardMessage}
                      onTogglePin={toggleMessagePin}
                      onDelete={deleteMessage}
                      onNotice={onNotice}
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
                {hasUndoMessageDelete ? (
                  <div className="dp-undo-delete-bar" data-native-source="MainWindow.xaml:2315">
                    <span>{undoMessageDeleteText}</span>
                    <button type="button" data-native-source="MainWindow.xaml:2340" onClick={() => onCommand("/undo-message-delete", "undo message delete")}>Undo</button>
                  </div>
                ) : null}
                <footer className="dp-compose-bar" data-native-source="MainWindow.xaml:2342">
                  <button
                    type="button"
                    className="dp-compose-attach"
                    title="Attach pictures, files, or contact cards"
                    aria-label="Attach pictures, files, or contact cards"
                    data-native-source="MainWindow.xaml:2362"
                    onClick={() => replyAttachmentInputRef.current?.click()}
                  >
                    {icon("attach_file", 22)}
                  </button>
                  <input
                    ref={replyAttachmentInputRef}
                    type="file"
                    multiple
                    className="dp-hidden-file-input"
                    data-native-source="MainWindow.xaml:2362"
                    onChange={(event) => {
                      addComposeFiles(event.target.files, setReplyAttachments, onNotice);
                      event.target.value = "";
                    }}
                  />
                  <textarea
                    ref={composeRef}
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
                    disabled={!draft.trim() && !replyAttachments.length}
                    onClick={sendMessage}
                  >
                    {icon("send", 21)}
                  </button>
                  <ComposeAttachmentTray
                    attachments={replyAttachments}
                    removeSource="MainWindow.xaml:2399"
                    onRemove={(id) => setReplyAttachments((current) => current.filter((attachment) => attachment.id !== id))}
                  />
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
                hasUndoCallHistoryDelete={hasUndoCallHistoryDelete}
                undoCallHistoryDeleteText={undoCallHistoryDeleteText}
                onUndoCallHistoryDelete={() => onCommand("/undo-call-history-delete", "undo call history delete")}
                onCall={callNumber}
                onText={textNumber}
                onDial={dialRawNumber}
                onOpenFullCalls={onOpenFullCalls}
                onDeleteAllCalls={deleteAllCalls}
                onToggleCallBlock={toggleCallBlock}
                onDeleteCall={deleteCall}
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

function contactDisplayName(contact) {
  return contact?.displayName || contact?.name || contact?.Name || contact?.fullName || "Unknown contact";
}

function contactPhoneOptions(contact) {
  const values = [
    contact?.primaryPhone,
    contact?.PrimaryPhone,
    contact?.phone,
    contact?.Phone,
    contact?.mobile,
    contact?.Mobile,
    contact?.formattedPhone,
    contact?.FormattedPhone,
    ...(Array.isArray(contact?.phoneNumbers) ? contact.phoneNumbers : []),
    ...(Array.isArray(contact?.PhoneNumbers) ? contact.PhoneNumbers : []),
  ];
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function contactKey(contact, index) {
  return contact?.id || contact?.Id || contact?.contactId || contact?.ContactId || `${contactDisplayName(contact)}-${index}`;
}

function ContactsSlice({ contacts, contactDraft, onContactDraftConsumed, onCommand, onOpenNewMessage, onNotice }) {
  const sortedContacts = useMemo(
    () => [...contacts].sort((a, b) => contactDisplayName(a).localeCompare(contactDisplayName(b))),
    [contacts]
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [editorName, setEditorName] = useState("");
  const [editorPhone, setEditorPhone] = useState("");
  const [editorId, setEditorId] = useState("");
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  const editorNameRef = useRef(null);
  const selectedContact = useMemo(
    () => sortedContacts.find((contact, index) => contactKey(contact, index) === selectedKey) || null,
    [selectedKey, sortedContacts]
  );
  const selectedPhones = isCreatingContact ? [] : contactPhoneOptions(selectedContact);
  const selectedPhone = selectedPhones[0] || "";
  const canSave = editorName.trim() && editorPhone.trim();

  useEffect(() => {
    if (!sortedContacts.length) {
      if (!isCreatingContact) setSelectedKey("");
      return;
    }
    if (isCreatingContact) return;
    if (!selectedKey || !sortedContacts.some((contact, index) => contactKey(contact, index) === selectedKey)) {
      setSelectedKey(contactKey(sortedContacts[0], 0));
    }
  }, [isCreatingContact, selectedKey, sortedContacts]);

  useEffect(() => {
    if (!selectedContact) return;
    setIsCreatingContact(false);
    setEditorId(selectedKey);
    setEditorName(contactDisplayName(selectedContact));
    setEditorPhone(contactPhoneOptions(selectedContact)[0] || "");
  }, [selectedContact, selectedKey]);

  useEffect(() => {
    if (!contactDraft?.phone) return;
    const normalized = normalizePhoneKey(contactDraft.phone);
    const matchIndex = sortedContacts.findIndex((contact) =>
      contactPhoneOptions(contact).some((phone) => normalizePhoneKey(phone) === normalized)
    );
    if (contactDraft.mode === "edit" && matchIndex >= 0) {
      const match = sortedContacts[matchIndex];
      setIsCreatingContact(false);
      setSelectedKey(contactKey(match, matchIndex));
      setEditorId(contactKey(match, matchIndex));
      setEditorName(contactDisplayName(match));
      setEditorPhone(contactPhoneOptions(match).find((phone) => normalizePhoneKey(phone) === normalized) || contactDraft.phone);
      onNotice?.("Contact editor ready.");
    } else {
      setIsCreatingContact(true);
      setSelectedKey("");
      setEditorId("");
      setEditorName("");
      setEditorPhone(contactDraft.phone);
      onNotice?.("New contact ready.");
    }
    onContactDraftConsumed?.();
    window.requestAnimationFrame(() => editorNameRef.current?.focus());
  }, [contactDraft, onContactDraftConsumed, onNotice, sortedContacts]);

  const startNewContact = useCallback(() => {
    setIsCreatingContact(true);
    setSelectedKey("");
    setEditorId("");
    setEditorName("");
    setEditorPhone("");
    onNotice?.("New contact ready.");
    window.requestAnimationFrame(() => editorNameRef.current?.focus());
  }, [onNotice]);

  const saveContact = useCallback(() => {
    if (!canSave) return;
    onCommand(`/save-contact?id=${encodeURIComponent(editorId)}&name=${encodeURIComponent(editorName.trim())}&phone=${encodeURIComponent(editorPhone.trim())}`, "save contact");
  }, [canSave, editorId, editorName, editorPhone, onCommand]);

  const deleteContact = useCallback(() => {
    const phone = editorPhone.trim() || selectedPhone;
    if (!editorId) return;
    onCommand(`/delete-contact?id=${encodeURIComponent(editorId)}&phone=${encodeURIComponent(phone)}`, "delete contact");
  }, [editorId, editorPhone, onCommand, selectedPhone]);

  return (
    <div className="dp-contacts-shell" data-native-source="MainWindow.xaml:3368">
      <div className="dp-contacts-header">
        <SourceTag>MainWindow.xaml:3368</SourceTag>
        <h2>Contacts</h2>
        <div className="dp-settings-actions">
          <ShellButton className="dp-primary" iconName="person_add" nativeSource="MainWindow.xaml:3766" onClick={startNewContact}>New Contact</ShellButton>
        </div>
      </div>
      <div className="dp-contacts-grid">
        <div className="dp-contacts-list" data-native-source="MainWindow.xaml:3762">
          {sortedContacts.slice(0, 80).map((contact, index) => {
            const key = contactKey(contact, index);
            const phones = contactPhoneOptions(contact);
            return (
              <button
                key={key}
                type="button"
                className={selectedContact === contact ? "is-selected" : ""}
                data-native-source="MainWindow.xaml:3784"
                onClick={() => {
                  setIsCreatingContact(false);
                  setSelectedKey(key);
                }}
              >
                <strong>{contactDisplayName(contact)}</strong>
                <span>{phones[0] || "No phone number"}</span>
              </button>
            );
          })}
        </div>
        <section className="dp-contact-detail" data-native-source="MainWindow.xaml:3840">
          {selectedContact || isCreatingContact ? (
            <>
              <h3>{selectedContact ? contactDisplayName(selectedContact) : "New contact"}</h3>
              <div className="dp-contact-phone-list">
                {selectedPhones.length ? selectedPhones.map((phone) => <span key={phone}>{phone}</span>) : editorPhone.trim() ? <span>{editorPhone.trim()}</span> : <span>No phone number</span>}
              </div>
              <div className="dp-contact-editor" data-native-source="MainWindow.xaml:3933">
                <label>
                  <span>Name</span>
                  <input ref={editorNameRef} value={editorName} onChange={(event) => setEditorName(event.target.value)} data-automation-id="ContactEditorName" />
                </label>
                <label>
                  <span>Phone</span>
                  <input value={editorPhone} onChange={(event) => setEditorPhone(event.target.value)} inputMode="tel" data-automation-id="ContactEditorPhone" />
                </label>
              </div>
              <div className="dp-settings-actions dp-contact-actions">
                <ShellButton className="dp-tonal" iconName="sms" nativeSource="MainWindow.xaml:3888" onClick={() => onOpenNewMessage(selectedPhone)} disabled={!selectedPhone}>Text</ShellButton>
                <ShellButton className="dp-tonal" iconName="call" nativeSource="MainWindow.xaml:3895" onClick={() => onCommand(`/dial?n=${encodeURIComponent(selectedPhone)}`, "call contact")} disabled={!selectedPhone}>Call</ShellButton>
                <ShellButton className="dp-tonal" iconName="edit" nativeSource="MainWindow.xaml:3919" onClick={() => { editorNameRef.current?.focus(); onNotice?.("Contact editor ready."); }}>Edit Details</ShellButton>
                <ShellButton className="dp-tonal" iconName="delete" nativeSource="MainWindow.xaml:3953" onClick={deleteContact} disabled={!editorId}>Delete</ShellButton>
                <ShellButton className="dp-primary" iconName="save" nativeSource="MainWindow.xaml:3959" onClick={saveContact} disabled={!canSave}>Save Contact</ShellButton>
              </div>
            </>
          ) : (
            <div className="dp-contact-empty">No contacts loaded</div>
          )}
        </section>
      </div>
    </div>
  );
}

function NewMessageComposer({ contacts, initialTo = "", initialBody = "", onCommand, onCancel, onNotice }) {
  const [query, setQuery] = useState("");
  const [selectedPhone, setSelectedPhone] = useState(initialTo);
  const [body, setBody] = useState(initialBody);
  const [attachments, setAttachments] = useState([]);
  const attachmentInputRef = useRef(null);
  const contactOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return contacts.flatMap((contact, contactIndex) => (
      contactPhoneOptions(contact).map((phone, phoneIndex) => ({
        key: `${contactKey(contact, contactIndex)}-${phoneIndex}`,
        name: contactDisplayName(contact),
        phone,
        searchable: `${contactDisplayName(contact)} ${phone}`.toLowerCase(),
      }))
    )).filter((option) => !search || option.searchable.includes(search)).slice(0, 12);
  }, [contacts, query]);

  useEffect(() => {
    setSelectedPhone(initialTo || "");
  }, [initialTo]);

  useEffect(() => {
    setBody(initialBody || "");
  }, [initialBody]);

  const send = useCallback(async () => {
    const sent = await sendComposeMessage({
      onCommand,
      to: selectedPhone,
      body,
      attachments,
      label: attachments.length ? "send new message with attachments" : "send new message",
    });
    if (!sent) return;
    setBody("");
    setAttachments([]);
    onNotice("Message sent to DeskPhone.");
  }, [attachments, body, onCommand, onNotice, selectedPhone]);

  return (
    <div className="dp-new-compose-shell" data-native-source="MainWindow.xaml:2999">
      <div className="dp-new-compose-header">
        <SourceTag>MainWindow.xaml:2999</SourceTag>
        <h2>New message</h2>
        <ShellButton className="dp-tonal" iconName="close" nativeSource="MainWindow.xaml:3036" onClick={onCancel}>Cancel</ShellButton>
      </div>
      <div className="dp-new-compose-grid">
        <section className="dp-new-compose-panel">
          <label className="dp-host-label">
            To
            <input
              value={selectedPhone}
              onChange={(event) => setSelectedPhone(event.target.value)}
              inputMode="tel"
              placeholder="Phone number"
              data-automation-id="NewMessageTo"
            />
          </label>
          <label className="dp-host-label">
            Search contacts
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or number"
              data-automation-id="NewMessageContactSearch"
            />
          </label>
          <div className="dp-compose-contact-list" data-native-source="MainWindow.xaml:3069">
            {contactOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                data-native-source="MainWindow.xaml:3069"
                className={selectedPhone === option.phone ? "is-selected" : ""}
                onClick={() => setSelectedPhone(option.phone)}
              >
                <strong>{option.name}</strong>
                <span>{option.phone}</span>
              </button>
            ))}
            {!contactOptions.length ? <div className="dp-contact-empty">No matching contacts</div> : null}
          </div>
        </section>
        <section className="dp-new-compose-panel">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Message text"
            data-automation-id="NewMessageBody"
          />
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="dp-hidden-file-input"
            data-native-source="MainWindow.xaml:3124"
            onChange={(event) => {
              addComposeFiles(event.target.files, setAttachments, onNotice);
              event.target.value = "";
            }}
          />
          <ComposeAttachmentTray
            attachments={attachments}
            removeSource="MainWindow.xaml:3153"
            onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))}
          />
          <div className="dp-settings-actions">
            <ShellButton className="dp-tonal" iconName="attach_file" nativeSource="MainWindow.xaml:3124" onClick={() => attachmentInputRef.current?.click()}>Attach</ShellButton>
            <ShellButton className="dp-primary" iconName="send" nativeSource="MainWindow.xaml:3136" onClick={send} disabled={!selectedPhone.trim() || (!body.trim() && !attachments.length)}>Send Message</ShellButton>
          </div>
        </section>
      </div>
    </div>
  );
}

function SimpleTabContent({
  activeTab,
  status,
  messages,
  calls,
  contacts,
  callDialerSignal,
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
  newMessageTo,
  contactDraft,
  host,
  hostInput,
  setHostInput,
  onSaveHost,
  onRefresh,
  onCommand,
  onOpenBridge,
  onOpenNewMessage,
  onOpenFullCalls,
  onOpenContactEditor,
  onContactDraftConsumed,
  onCancelNewMessage,
  onNotice,
}) {
  const [settingsSection, setSettingsSection] = useState("connection");

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
        onOpenNewMessage={onOpenNewMessage}
        onOpenFullCalls={onOpenFullCalls}
        onOpenContactEditor={onOpenContactEditor}
        onNotice={onNotice}
      />
    );
  }
  if (activeTab === "new-message") {
    return (
      <NewMessageComposer
        contacts={contacts}
        initialTo={newMessageTo}
        initialBody={draft}
        onCommand={onCommand}
        onCancel={onCancelNewMessage}
        onNotice={onNotice}
      />
    );
  }
  if (activeTab === "contacts") {
    return (
      <ContactsSlice
        contacts={contacts}
        contactDraft={contactDraft}
        onContactDraftConsumed={onContactDraftConsumed}
        onCommand={onCommand}
        onOpenNewMessage={onOpenNewMessage}
        onNotice={onNotice}
      />
    );
  }
  if (activeTab === "calls") {
    return (
      <div className="dp-calls-shell" data-native-source="MainWindow.xaml:3204">
        <ConversationCallHistory
          calls={calls}
          mode="full"
          dialerDefaultOpen={true}
          dialerOpenSignal={callDialerSignal}
          hasUndoCallHistoryDelete={!!(status?.hasUndoCallHistoryDelete || status?.HasUndoCallHistoryDelete)}
          undoCallHistoryDeleteText={status?.undoCallHistoryDeleteText || status?.UndoCallHistoryDeleteText || "Call deleted"}
          onUndoCallHistoryDelete={() => onCommand("/undo-call-history-delete", "undo call history delete")}
          onCall={(number) => {
            const normalized = normalizePhoneKey(number);
            if (!normalized) {
              onNotice("Call needs a phone number.");
              return;
            }
            onCommand(`/dial?n=${encodeURIComponent(normalized)}`, "call");
          }}
          onText={(number) => onOpenNewMessage(normalizePhoneKey(number) || number)}
          onDial={(number) => {
            const cleaned = String(number || "").replace(/[^\d+*#]/g, "");
            if (cleaned) onCommand(`/dial?n=${encodeURIComponent(cleaned)}`, "call");
          }}
          onOpenFullCalls={() => {}}
          onDeleteAllCalls={() => {
            if (!window.confirm("Delete all call history from DeskPhone Web?")) return;
            onCommand("/delete-all-call-history", "delete all call history");
          }}
          onToggleCallBlock={(call) => {
            const normalized = normalizePhoneKey(call?.number);
            if (!normalized) {
              onNotice("Block needs a phone number.");
              return;
            }
            onCommand(`/toggle-call-block?phone=${encodeURIComponent(normalized)}`, "toggle call block");
          }}
          onDeleteCall={(call) => {
            if (!call?.id) {
              onNotice("Delete needs a call id from DeskPhone.");
              return;
            }
            onCommand(`/delete-call-entry?id=${encodeURIComponent(call.id)}`, "delete call entry");
          }}
        />
      </div>
    );
  }
  if (activeTab === "settings") {
    const syncThemeWithShamash = Boolean(status?.syncThemeWithShamash ?? status?.SyncThemeWithShamash);
    const pauseHistoryActivity = Boolean(status?.pauseHistoryActivity ?? status?.PauseHistoryActivity);
    const isDarkModeEnabled = Boolean(status?.isDarkModeEnabled ?? status?.IsDarkModeEnabled);
    const knownDevices = getApiList(status?.knownDevices || status?.KnownDevices);
    const scannedDevices = getApiList(status?.scannedDevices || status?.ScannedDevices);
    const deviceAddress = (device) => device?.address || device?.Address || "";
    const deviceName = (device) => device?.name || device?.Name || deviceAddress(device) || "Phone";
    const isScanning = Boolean(status?.isScanning ?? status?.IsScanning);
    const bluetoothStatus = status?.bluetoothStatus || status?.BluetoothStatus || "";
    const isAndroidBridge = isAndroidPhoneBridge(status) || isLocalMobileBridgeHost(hostInput);
    const remotePhone = remotePhoneStatus(status);
    const phoneDataReady = isBridgeApiReady(status, true);
    const bridgeRows = isAndroidBridge ? bridgeIndicatorRows(status, true) : [];
    const settingSections = isAndroidBridge
      ? [
          ["connection", "Bridge", "MainWindow.xaml:3995"],
          ["appearance", "Appearance", "MainWindow.xaml:4000"],
        ]
      : [
          ["connection", "Connection", "MainWindow.xaml:3995"],
          ["appearance", "Appearance", "MainWindow.xaml:4000"],
          ["contact-sync", "Contact Sync", "MainWindow.xaml:4005"],
          ["audio", "Audio", "MainWindow.xaml:4010"],
        ];

    return (
      <div className="dp-settings-shell" data-native-source="MainWindow.xaml:3847">
        <SourceTag>MainWindow.xaml:3847</SourceTag>
        <div className="dp-settings-heading">
          <h2>{settingSections.find(([id]) => id === settingsSection)?.[1] || "Settings"}</h2>
          <div className="dp-settings-sections" data-native-source="MainWindow.xaml:3995">
            {settingSections.map(([id, label, nativeSource]) => (
              <button
                key={id}
                type="button"
                className={settingsSection === id ? "is-active" : ""}
                data-native-source={nativeSource}
                onClick={() => setSettingsSection(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {settingsSection === "connection" && (
          <section className="dp-settings-panel" data-native-source="MainWindow.xaml:3995">
            <label className="dp-host-label">
              Host URL
              <input value={hostInput} onChange={(event) => setHostInput(event.target.value)} spellCheck={false} />
            </label>
            <div className="dp-settings-actions">
              <ShellButton className="dp-primary" iconName="save" onClick={onSaveHost}>Save</ShellButton>
              <ShellButton className="dp-tonal" iconName="refresh" onClick={onRefresh}>Test</ShellButton>
              {isLocalMobileBridgeHost(hostInput) ? <ShellButton className="dp-tonal" iconName="open_in_new" onClick={onOpenBridge}>Open bridge app</ShellButton> : null}
            </div>
            {!isAndroidBridge ? (
              <div className="dp-settings-actions dp-settings-tools">
                <ShellButton className="dp-tonal" iconName="bluetooth" nativeSource="MainWindow.xaml:4140" onClick={() => onCommand("/open-bluetooth-settings", "open Bluetooth settings")}>Bluetooth Settings</ShellButton>
                <ShellButton className="dp-tonal" iconName="folder_open" nativeSource="MainWindow.xaml:4627" onClick={() => onCommand("/open-builds-folder", "open builds folder")}>Builds Folder</ShellButton>
                <ShellButton className="dp-tonal" iconName="article" nativeSource="MainWindow.xaml:4633" onClick={() => onCommand("/open-event-log", "open event log")}>Event Log</ShellButton>
              </div>
            ) : null}
            {isAndroidBridge ? (
              <div className="dp-device-manager dp-phone-bridge-card" data-native-source="MainWindow.xaml:4052">
                <div className="dp-device-manager-head">
                  <h3>Local bridge</h3>
                  <span className={`dp-bridge-state ${phoneDataReady ? "is-ready" : "needs-attention"}`}>
                    {phoneDataReady ? "Bridge connected" : "Bridge needs attention"}
                  </span>
                </div>
                <div className="dp-device-status">Endpoint: {normalizeHost(hostInput)}</div>
                <div className="dp-bridge-metrics" aria-label="Bridge data available">
                  <div><strong>{remotePhone.contacts || 0}</strong><span>Contacts</span></div>
                  <div><strong>{remotePhone.calls || 0}</strong><span>Calls</span></div>
                  <div><strong>{remotePhone.messages || 0}</strong><span>Texts</span></div>
                </div>
                {remotePhone.lastError ? <div className="dp-device-empty">{remotePhone.lastError}</div> : null}
                <div className="dp-bridge-indicators">
                  {bridgeRows.map((row) => (
                    <div className="dp-bridge-indicator" key={row.key}>
                      <span className={`dp-status-dot ${row.ok ? "is-online" : ""}`} />
                      <div>
                        <strong>{row.label}</strong>
                        <span>{row.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="dp-settings-actions">
                  <ShellButton className="dp-primary" iconName="sync" nativeSource="MainWindow.xaml:4083" onClick={() => onCommand("/phone/sync", "refresh phone data")}>Refresh phone data</ShellButton>
                  {isLocalMobileBridgeHost(hostInput) ? <ShellButton className="dp-tonal" iconName="open_in_new" onClick={onOpenBridge}>Open bridge app</ShellButton> : null}
                </div>
              </div>
            ) : (
              <>
                <div className="dp-device-manager" data-native-source="MainWindow.xaml:4052">
                  <div className="dp-device-manager-head">
                    <h3>Paired phones</h3>
                    <ShellButton className="dp-tonal" iconName="search" nativeSource="MainWindow.xaml:4052" onClick={() => onCommand("/scan-devices", "scan devices")} disabled={isScanning}>Scan for new device</ShellButton>
                  </div>
                  {bluetoothStatus ? <div className="dp-device-status">{bluetoothStatus}</div> : null}
                  <div className="dp-device-list">
                    {knownDevices.length ? knownDevices.map((device) => {
                      const address = deviceAddress(device);
                      const name = deviceName(device);
                      const isDefault = device?.isDefault || device?.IsDefault;
                      return (
                        <div className="dp-device-row" key={`known-${address || name}`}>
                          <div>
                            <strong>{name}{isDefault ? " (default)" : ""}</strong>
                            {address ? <span className="dp-device-address" title={address}>Paired</span> : <span className="dp-device-status-text">Not found</span>}
                          </div>
                          <div className="dp-device-row-actions">
                            <ShellButton className="dp-tonal" iconName="link" nativeSource="MainWindow.xaml:4083" onClick={() => onCommand(`/connect-saved-device?addr=${encodeURIComponent(address)}`, "connect saved device")} disabled={!address}>Connect</ShellButton>
                            <ShellButton className="dp-tonal" iconName="star" nativeSource="MainWindow.xaml:4088" onClick={() => onCommand(`/set-default-saved-device?addr=${encodeURIComponent(address)}`, "set default device")} disabled={!address}>Set default</ShellButton>
                            <ShellButton className="dp-tonal" iconName="delete" nativeSource="MainWindow.xaml:4102" onClick={() => onCommand(`/forget-saved-device?addr=${encodeURIComponent(address)}`, "forget device")} disabled={!address}>Forget</ShellButton>
                          </div>
                        </div>
                      );
                    }) : <div className="dp-device-empty">No saved phones yet.</div>}
                  </div>
                </div>
                <div className="dp-device-manager" data-native-source="MainWindow.xaml:4135">
                  <div className="dp-device-manager-head">
                    <h3>Scanned phones</h3>
                    <ShellButton className="dp-tonal" iconName="search" nativeSource="MainWindow.xaml:4135" onClick={() => onCommand("/scan-devices", "scan devices")} disabled={isScanning}>Scan for devices</ShellButton>
                  </div>
                  <div className="dp-device-list">
                    {scannedDevices.length ? scannedDevices.map((device) => {
                      const address = deviceAddress(device);
                      return (
                        <div className="dp-device-row" key={`scanned-${address || deviceName(device)}`}>
                          <div>
                            <strong>{deviceName(device)}</strong>
                            <span>{address}{device?.isPaired || device?.IsPaired ? " - paired" : ""}</span>
                          </div>
                          <div className="dp-device-row-actions">
                            <ShellButton className="dp-tonal" iconName="link" nativeSource="MainWindow.xaml:4150" onClick={() => onCommand(`/connect-scanned-device?addr=${encodeURIComponent(address)}`, "connect scanned device")} disabled={!address}>Connect to selected device</ShellButton>
                          </div>
                        </div>
                      );
                    }) : <div className="dp-device-empty">No scanned phones shown.</div>}
                  </div>
                </div>
              </>
            )}
          </section>
        )}
        {settingsSection === "appearance" && (
          <section className="dp-settings-panel" data-native-source="MainWindow.xaml:4000" aria-label="Appearance settings">
            <div className="dp-settings-actions dp-settings-tools">
              <ShellButton className="dp-tonal" iconName="restart_alt" nativeSource="MainWindow.xaml:4235" onClick={() => onCommand("/reset-ui-scale", "reset appearance")}>Reset</ShellButton>
              <ShellButton className="dp-tonal" iconName="sync" nativeSource="MainWindow.xaml:4288" onClick={() => onCommand("/refresh-theme-sync", "refresh theme sync")}>Refresh Sync</ShellButton>
            </div>
            <label className="dp-settings-toggle" data-native-source="MainWindow.xaml:4258">
              <span>Sync theme with Shamash app</span>
              <input type="checkbox" checked={syncThemeWithShamash} onChange={(event) => onCommand(`/set-theme-sync?enabled=${event.target.checked ? 1 : 0}`, "set theme sync")} />
            </label>
            <label className="dp-settings-toggle" data-native-source="MainWindow.xaml:4294">
              <span>History Background Fetching</span>
              <input type="checkbox" checked={!pauseHistoryActivity} onChange={(event) => onCommand(`/set-history-paused?paused=${event.target.checked ? 0 : 1}`, "set history background fetching")} />
            </label>
            <label className="dp-settings-toggle" data-native-source="MainWindow.xaml:4309">
              <span>Dark mode</span>
              <input type="checkbox" checked={isDarkModeEnabled} onChange={(event) => onCommand(`/set-dark-mode?enabled=${event.target.checked ? 1 : 0}`, "set dark mode")} />
            </label>
          </section>
        )}
        {settingsSection === "contact-sync" && (
          <section className="dp-settings-panel" data-native-source="MainWindow.xaml:4005">
            <div className="dp-settings-actions dp-settings-tools">
              <ShellButton className="dp-tonal" iconName="upload_file" nativeSource="MainWindow.xaml:4381" onClick={() => onCommand("/import-starter-vcf", "import starter VCF")}>Import VCF</ShellButton>
              <ShellButton className="dp-tonal" iconName="move_to_inbox" nativeSource="MainWindow.xaml:4385" onClick={() => onCommand("/import-pending-contacts", "import synced contacts")}>Import Synced</ShellButton>
              <ShellButton className="dp-tonal" iconName="block" nativeSource="MainWindow.xaml:4390" onClick={() => onCommand("/skip-pending-contacts", "ignore pending contacts")}>Ignore Pending</ShellButton>
              <ShellButton className="dp-tonal" iconName="folder_open" nativeSource="MainWindow.xaml:4395" onClick={() => onCommand("/open-contact-sync-folder", "open contact sync folder")}>Sync Folder</ShellButton>
              <ShellButton className="dp-tonal" iconName="download" nativeSource="MainWindow.xaml:4412" onClick={() => onCommand("/export-messages-backup", "export messages backup")}>Save Backup</ShellButton>
            </div>
          </section>
        )}
        {settingsSection === "audio" && (
          <section className="dp-settings-panel" data-native-source="MainWindow.xaml:4010">
            <div className="dp-settings-actions dp-settings-tools">
              <ShellButton className="dp-tonal" iconName="volume_up" nativeSource="MainWindow.xaml:4480" onClick={() => onCommand("/open-sound-settings", "open sound settings")}>Sound Settings</ShellButton>
              <ShellButton className="dp-tonal" iconName="sync" nativeSource="MainWindow.xaml:4476" onClick={() => onCommand("/audio-refresh", "refresh audio")}>Refresh Audio</ShellButton>
            </div>
          </section>
        )}
        <div className="dp-host-note">Active endpoint: {host}</div>
      </div>
    );
  }
  return (
    <div className="dp-tab-placeholder" data-native-source="MainWindow.xaml:3920">
      <SourceTag>MainWindow.xaml:3920</SourceTag>
      <h2>Developer Tools</h2>
      <div className="dp-settings-actions dp-settings-tools">
        <ShellButton className="dp-tonal" iconName="article" nativeSource="MainWindow.xaml:620" onClick={() => onCommand("/open-live-log", "open live log")}>Live Log</ShellButton>
        <ShellButton className="dp-tonal" iconName="ink_eraser" nativeSource="LogWindow.xaml:45" onClick={() => onCommand("/clear-log", "clear log")}>Clear Log</ShellButton>
        <ShellButton className="dp-tonal" iconName="fact_check" nativeSource="MainWindow.xaml:4346" onClick={() => onCommand("/run-ui-auditor", "run UI auditor")}>Open Auditor</ShellButton>
        <ShellButton className="dp-tonal" iconName="bug_report" nativeSource="MainWindow.xaml:4639" onClick={() => onCommand("/run-ui-auditor", "run UI auditor")}>Run UI Auditor</ShellButton>
      </div>
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
  --dp-border-strong: #BDC1C6;
  --dp-bg-surface: #FFFFFF;
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
  border-right: 0;
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
  border-radius: 18px;
  background: var(--dp-bg-selected);
  color: var(--dp-blue);
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
  font-weight: 500;
  color: var(--dp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-app-build,
.dp-app-time {
  margin-top: 2px;
  font-weight: 400;
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
  width: 40px;
  height: 40px;
  min-width: 40px;
  border: 0;
  border-radius: 20px;
  padding: 0;
  background: transparent;
  color: var(--dp-muted);
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
  background: var(--dp-bg-hover);
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
  min-height: 40px;
  margin: 2px 8px;
  padding: 8px 12px;
  border: 0;
  border-radius: 20px;
  background: transparent;
  color: var(--dp-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
}
.dp-nav-item:hover {
  background: var(--dp-bg-input);
}
.dp-nav-item.is-active {
  background: var(--dp-bg-selected);
  color: var(--dp-text);
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
  background: transparent;
  border-radius: 8px;
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
  border-radius: 8px;
  background: var(--dp-bg-selected);
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
  font-weight: 500;
  color: var(--dp-muted);
}
.dp-collapsed-icon-button {
  width: 52px;
  height: 44px;
  margin-top: 8px;
  border: 0;
  border-radius: 22px;
  background: transparent;
  color: var(--dp-muted);
  cursor: pointer;
}
.dp-build-badge {
  width: 52px;
  box-sizing: border-box;
  margin-top: 10px;
  padding: 5px 4px;
  border-radius: 8px;
  background: var(--dp-bg-input);
  color: var(--dp-muted);
  text-align: center;
  font-size: 9px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-content {
  position: relative;
  background: var(--dp-bg-main);
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
  border-radius: 8px;
  padding: 13px 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
}
.dp-reconnect-prompt {
  background: var(--dp-bg-input);
  border: 1px solid var(--dp-border);
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
  border-radius: 8px;
  border: 1px solid var(--dp-border);
  background: var(--dp-bg-main);
  padding: 24px;
  box-sizing: border-box;
}
.dp-build-dialog h2 {
  margin: 0;
  color: var(--dp-text);
  font-size: 22px;
  font-weight: 500;
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
  border-radius: 8px;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  box-shadow: none;
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
  border-radius: 22px;
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
  font-weight: 500;
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
  border-radius: 4px;
  padding: 0 18px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
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
  background: var(--dp-bg-input);
  color: var(--dp-text-second);
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
.dp-calls-shell {
  height: 100%;
  min-height: 520px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--dp-bg-main);
}
.dp-new-compose-shell {
  min-height: 520px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
  padding: 22px;
  display: grid;
  gap: 18px;
  align-content: start;
}
.dp-new-compose-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dp-new-compose-header h2 {
  margin: 0;
  color: var(--dp-text);
}
.dp-new-compose-grid {
  display: grid;
  grid-template-columns: minmax(220px, 340px) minmax(0, 1fr);
  gap: 16px;
}
.dp-new-compose-panel {
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-input);
  padding: 16px;
  display: grid;
  gap: 12px;
  align-content: start;
}
.dp-new-compose-panel textarea {
  width: 100%;
  min-height: 170px;
  box-sizing: border-box;
  border: 1px solid var(--dp-border);
  border-radius: 4px;
  padding: 10px 11px;
  resize: vertical;
  color: var(--dp-text);
  font: 400 14px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
.dp-compose-contact-list {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
}
.dp-compose-contact-list button {
  width: 100%;
  min-height: 54px;
  border: 0;
  background: transparent;
  color: var(--dp-text);
  display: grid;
  gap: 3px;
  padding: 9px 11px;
  text-align: left;
  cursor: pointer;
}
.dp-compose-contact-list button.is-selected {
  background: var(--dp-bg-selected);
}
.dp-compose-contact-list strong,
.dp-compose-contact-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  border-right: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}
.dp-message-list-header {
  padding: 14px 16px 8px;
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
  font-size: 20px;
  font-weight: 500;
}
.dp-history-status {
  border-radius: 8px;
  padding: 3px 8px;
  background: var(--dp-bg-input);
  color: var(--dp-muted);
  font-size: 11px;
  font-weight: 500;
}
.dp-message-header-actions {
  display: flex;
  gap: 4px;
}
.dp-compact-icon-button.is-active {
  color: var(--dp-text);
  background: var(--dp-bg-selected);
}
.dp-message-search {
  height: 46px;
  box-sizing: border-box;
  border: 1px solid var(--dp-border);
  border-radius: 23px;
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
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.dp-filter-grid::-webkit-scrollbar {
  display: none;
}
.dp-filter-grid button {
  height: 32px;
  min-width: fit-content;
  border: 0;
  border-radius: 4px;
  padding: 0 8px;
  background: transparent;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.dp-filter-grid button.is-active {
  background: transparent;
  color: var(--dp-text);
  border-bottom-color: var(--dp-blue);
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
  font-weight: 500;
}
.dp-empty-conversations .dp-material-icon {
  color: var(--dp-border);
}
.dp-conversation-row {
  position: relative;
  min-width: 0;
  border: 0;
  padding: 13px 12px 13px 16px;
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
  background: var(--dp-bg-selected);
  color: var(--dp-text-second);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
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
  font-size: 16px;
  font-weight: 500;
}
.dp-conversation-row.is-unread .dp-conversation-name,
.dp-conversation-row.is-unread .dp-conversation-preview,
.dp-conversation-row.is-unread .dp-conversation-time {
  font-weight: 600;
}
.dp-conversation-badges {
  display: none;
  gap: 8px;
  color: var(--dp-muted);
  font-size: 11px;
  font-weight: 500;
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
  color: var(--dp-text);
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
  width: 32px;
  height: 32px;
  border-radius: 16px;
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
  background: var(--dp-bg-hover);
  color: var(--dp-text);
}
.dp-floating-menu {
  position: absolute;
  z-index: 40;
  top: 34px;
  right: 0;
  min-width: 190px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: white;
  box-shadow: 0 8px 24px rgba(60, 64, 67, 0.18);
  padding: 6px;
}
.dp-floating-menu button {
  width: 100%;
  border: 0;
  border-radius: 4px;
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
  border-radius: 36px;
  background: var(--dp-bg-hover);
  color: var(--dp-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.dp-no-conversation strong {
  font-size: 16px;
  font-weight: 500;
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
  padding: 10px 16px;
  display: grid;
  grid-template-columns: auto minmax(150px, auto) minmax(220px, 1fr) auto;
  align-items: center;
  gap: 12px;
}
.dp-thread-avatar {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  font-size: 14px;
}
.dp-thread-identity {
  min-width: 0;
  display: grid;
}
.dp-thread-identity strong {
  color: var(--dp-text);
  font-size: 16px;
  font-weight: 500;
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
  border-radius: 16px;
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
.dp-thread-calls-header button,
.dp-thread-dialer button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 16px;
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
.dp-thread-calls-header button:hover,
.dp-thread-dialer button:hover {
  background: var(--dp-bg-hover);
}
.dp-thread-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.dp-thread-actions-menu {
  position: relative;
}
.dp-thread-actions-menu summary {
  width: 40px;
  height: 40px;
  border-radius: 20px;
  color: var(--dp-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  list-style: none;
  cursor: pointer;
}
.dp-thread-actions-menu summary::-webkit-details-marker {
  display: none;
}
.dp-thread-actions-menu[open] summary,
.dp-thread-actions-menu summary:hover {
  background: var(--dp-bg-hover);
  color: var(--dp-text);
}
.dp-thread-actions-menu .dp-floating-menu {
  top: 40px;
  right: 0;
  min-width: 230px;
}
.dp-thread-actions-menu .dp-floating-menu button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  font-weight: 500;
  white-space: nowrap;
}
.dp-thread-actions-menu .dp-floating-menu button span:last-child {
  font-size: 13px;
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
  background: var(--dp-bg-main);
}
.dp-thread-messages:has(.dp-pinned-message-strip) {
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.dp-pinned-message-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--dp-border);
  background: var(--dp-bg-surface);
}
.dp-pinned-strip-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dp-text-second);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.dp-pinned-strip-list {
  min-width: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.dp-pinned-strip-list button {
  min-width: 160px;
  max-width: 240px;
  height: 42px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
  color: var(--dp-text);
  cursor: pointer;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  text-align: left;
}
.dp-pinned-strip-list strong {
  color: var(--dp-muted);
  font-size: 11px;
}
.dp-pinned-strip-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.dp-message-scroll {
  min-height: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-padding-block: 16px 112px;
  padding: 12px 24px 112px;
}
.dp-message-item {
  display: grid;
  scroll-margin-block: 16px 104px;
}
.dp-message-item.is-outgoing {
  justify-items: end;
}
.dp-message-item.is-incoming {
  justify-items: start;
}
.dp-message-item.is-search-match .dp-message-bubble {
  box-shadow: 0 0 0 2px rgba(251, 188, 4, 0.32);
}
.dp-message-item.is-search-current .dp-message-bubble {
  outline: 2px solid #fbbc04;
  outline-offset: 2px;
}
.dp-date-divider {
  justify-self: center;
  margin: 16px 0;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 500;
}
.dp-message-bubble {
  max-width: min(68ch, 76%);
  margin: 3px 0;
  border-radius: 16px;
  padding: 8px 12px;
  cursor: pointer;
  box-shadow: none;
}
.dp-message-bubble.is-incoming {
  border: 1px solid var(--dp-border);
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
  font-size: 15px;
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
  font-weight: 500;
}
.dp-message-status.is-failed {
  color: #FCE8E6;
  font-weight: 600;
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
  border-radius: 8px;
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
  border-radius: 4px;
  background: var(--dp-bg-hover);
  color: var(--dp-text-second);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.dp-bubble-actions {
  margin-top: 4px;
  color: var(--dp-muted);
  display: flex;
  justify-content: flex-start;
  gap: 6px;
}
.dp-message-bubble.is-outgoing .dp-bubble-actions {
  color: white;
}
.dp-bubble-actions button {
  width: 28px;
  height: 28px;
  opacity: 0.82;
}
.dp-bubble-actions button:hover {
  background: transparent;
  opacity: 1;
  transform: translateY(-1px);
}
.dp-message-bubble.is-outgoing .dp-bubble-actions button {
  color: inherit;
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
  box-shadow: 0 2px 8px rgba(60, 64, 67, 0.22);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dp-undo-delete-bar {
  display: none;
}
.dp-call-undo-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-input);
  color: var(--dp-text);
  padding: 9px 10px;
  font-size: 13px;
}
.dp-call-undo-bar button {
  min-height: 30px;
  border: 1px solid var(--dp-border-strong);
  border-radius: 7px;
  background: var(--dp-bg-main);
  color: var(--dp-blue-dark);
  font-weight: 500;
  cursor: pointer;
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
.dp-hidden-file-input {
  display: none;
}
.dp-compose-attachments {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dp-compose-bar .dp-compose-attachments {
  grid-column: 2 / 4;
}
.dp-compose-attachment-chip {
  max-width: 100%;
  min-height: 34px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-input);
  color: var(--dp-text);
  padding: 5px 6px 5px 9px;
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
}
.dp-compose-attachment-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 12px;
}
.dp-compose-attachment-chip small {
  color: var(--dp-muted);
  font-size: 11px;
  white-space: nowrap;
}
.dp-compose-attachment-chip button {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dp-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
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
  background: transparent;
  color: var(--dp-muted);
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
  border-radius: 8px;
  background: white;
  color: var(--dp-text);
  padding: 12px;
  font: 16px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  line-height: 1.35;
}
.dp-thread-calls {
  min-width: 0;
  min-height: 0;
  background: var(--dp-bg-main);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dp-thread-calls.is-full-calls {
  height: 100%;
}
.dp-calls-hidden-pane {
  border-bottom: 1px solid var(--dp-border);
  padding: 18px 16px;
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
  font-weight: 500;
}
.dp-thread-calls-header span {
  margin-top: 2px;
  color: var(--dp-muted);
  font-size: 12px;
}
.dp-thread-calls-header-actions,
.dp-thread-call-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dp-call-filter-grid {
  border-bottom: 1px solid var(--dp-border);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.dp-call-filter-grid::-webkit-scrollbar {
  display: none;
}
.dp-call-filter-grid button {
  height: 30px;
  min-width: fit-content;
  border: 0;
  border-radius: 4px;
  padding: 0 10px;
  background: transparent;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.dp-call-filter-grid button.is-active {
  background: transparent;
  color: var(--dp-text);
  border-bottom-color: var(--dp-blue);
}
.dp-thread-dialer {
  border-bottom: 1px solid var(--dp-border);
  padding: 10px 12px 12px;
  background: white;
}
.dp-thread-dialer-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}
.dp-thread-dialer-top label,
.dp-thread-dialer-top span {
  display: block;
}
.dp-thread-dialer-top span {
  margin-bottom: 4px;
  color: var(--dp-muted);
  font-size: 11px;
  font-weight: 500;
}
.dp-thread-dialer-top input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--dp-border);
  border-radius: 4px;
  padding: 8px 9px;
  color: var(--dp-text);
  font: 400 14px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
.dp-thread-dialer-keys {
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.dp-thread-dialer-keys button {
  width: 100%;
  height: 32px;
  border-radius: 4px;
  color: var(--dp-text);
  font-size: 15px;
  font-weight: 500;
  background: var(--dp-bg-input);
}
.dp-thread-dialer-actions {
  margin-top: 8px;
  display: grid;
  grid-template-columns: auto 1fr 1fr 1fr;
  gap: 6px;
}
.dp-thread-dialer-actions button {
  width: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.dp-thread-call-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
}
.dp-thread-call-row {
  padding: 12px 14px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}
.dp-thread-call-row > div:first-child {
  color: var(--dp-muted);
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
  font-weight: 500;
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
.dp-contacts-shell {
  min-height: 360px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
  padding: 24px;
  display: grid;
  gap: 18px;
  align-content: start;
}
.dp-contacts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dp-contacts-header h2,
.dp-contact-detail h3 {
  margin: 0;
  color: var(--dp-text);
}
.dp-contacts-grid {
  display: grid;
  grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
  gap: 16px;
  min-height: 320px;
}
.dp-contacts-list {
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  overflow: auto;
  background: var(--dp-bg-sidebar);
}
.dp-contacts-list button {
  width: 100%;
  min-height: 58px;
  border: 0;
  background: transparent;
  color: var(--dp-text);
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.dp-contacts-list button.is-selected {
  background: var(--dp-bg-selected);
}
.dp-contacts-list strong {
  font-size: 14px;
  font-weight: 500;
}
.dp-contacts-list span,
.dp-contact-phone-list span,
.dp-contact-empty {
  color: var(--dp-text-second);
  font-size: 13px;
}
.dp-contact-detail {
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-input);
  padding: 18px;
  display: grid;
  align-content: start;
  gap: 14px;
}
.dp-contact-phone-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dp-contact-phone-list span {
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
  padding: 6px 9px;
}
.dp-contact-editor {
  display: grid;
  gap: 10px;
}
.dp-contact-editor label {
  display: grid;
  gap: 5px;
  color: var(--dp-text-second);
  font-size: 12px;
  font-weight: 500;
}
.dp-contact-editor input {
  min-height: 38px;
  border: 1px solid var(--dp-border-strong);
  border-radius: 8px;
  background: var(--dp-bg-main);
  color: var(--dp-text);
  padding: 0 10px;
  font: inherit;
}
.dp-contact-actions {
  margin-top: 4px;
}
.dp-tab-placeholder,
.dp-settings-shell {
  min-height: 360px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
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
  font-weight: 500;
  color: var(--dp-text);
}
.dp-tab-placeholder p,
.dp-host-note {
  margin: 0;
  color: var(--dp-text-second);
  font-size: 14px;
  line-height: 1.55;
}
.dp-settings-heading {
  display: grid;
  gap: 12px;
}
.dp-settings-sections {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dp-settings-sections button {
  min-height: 38px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: transparent;
  color: var(--dp-text-second);
  padding: 0 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.dp-settings-sections button.is-active {
  border-color: var(--dp-border);
  background: var(--dp-bg-selected);
  color: var(--dp-text);
}
.dp-settings-panel {
  display: grid;
  gap: 14px;
  min-height: 88px;
}
.dp-settings-toggle {
  min-height: 44px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-input);
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--dp-text);
  font-size: 14px;
  font-weight: 500;
}
.dp-settings-toggle input {
  width: 20px;
  height: 20px;
  accent-color: var(--dp-blue);
}
.dp-source-tag {
  display: inline-flex;
  width: fit-content;
  border-radius: 6px;
  background: var(--dp-bg-input);
  color: var(--dp-muted);
  font-size: 11px;
  font-weight: 500;
  padding: 4px 7px;
}
.dp-placeholder-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 160px));
  gap: 10px;
}
.dp-placeholder-stats div {
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-input);
  padding: 12px;
}
.dp-placeholder-stats span {
  display: block;
  font-size: 26px;
  line-height: 1;
  font-weight: 500;
  color: var(--dp-text);
}
.dp-placeholder-stats label {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dp-muted);
}
.dp-host-label {
  display: grid;
  gap: 6px;
  color: var(--dp-text-second);
  font-size: 13px;
  font-weight: 500;
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
.dp-settings-tools {
  margin-top: 10px;
}
.dp-device-manager {
  display: grid;
  gap: 10px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
  padding: 12px;
}
.dp-device-manager-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dp-device-manager h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}
.dp-device-status,
.dp-device-empty {
  color: var(--dp-muted);
  font-size: 13px;
}
.dp-device-list {
  display: grid;
  gap: 8px;
}
.dp-device-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 52px;
  border-top: 1px solid var(--dp-border);
  padding-top: 8px;
}
.dp-device-row strong,
.dp-device-row span {
  display: block;
}
.dp-device-row span {
  margin-top: 2px;
  color: var(--dp-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.dp-device-row-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.dp-phone-bridge-card {
  background: var(--dp-bg-input);
}
.dp-bridge-state {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border-radius: 999px;
  padding: 0 10px;
  background: var(--dp-bg-main);
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 700;
}
.dp-bridge-state.is-ready {
  color: var(--dp-green-dark);
  background: var(--dp-green-light);
}
.dp-bridge-state.needs-attention {
  color: var(--dp-red);
}
.dp-bridge-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.dp-bridge-metrics div {
  min-height: 62px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
  padding: 10px;
}
.dp-bridge-metrics strong,
.dp-bridge-metrics span {
  display: block;
}
.dp-bridge-metrics strong {
  color: var(--dp-text);
  font-size: 24px;
  line-height: 1;
  font-weight: 700;
}
.dp-bridge-metrics span {
  margin-top: 6px;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 600;
}
.dp-bridge-details {
  border-top: 1px solid var(--dp-border);
  padding-top: 8px;
}
.dp-bridge-details summary {
  cursor: pointer;
  color: var(--dp-muted);
  font-size: 13px;
  font-weight: 600;
}
.dp-bridge-details .dp-device-list {
  margin-top: 8px;
}
.dp-bridge-details .dp-device-row {
  grid-template-columns: 1fr;
}
.dp-bridge-indicators {
  display: grid;
  gap: 8px;
}
.dp-bridge-indicators.is-compact {
  gap: 5px;
  margin-top: 8px;
}
.dp-bridge-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  color: var(--dp-text);
  font-size: 13px;
}
.dp-bridge-indicator strong,
.dp-bridge-indicator span {
  display: block;
}
.dp-bridge-indicator strong {
  font-size: 13px;
  font-weight: 700;
}
.dp-bridge-indicator div > span {
  margin-top: 2px;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 500;
}
.dp-bridge-indicators.is-compact .dp-bridge-indicator {
  min-height: 20px;
  color: var(--dp-muted);
  font-size: 12px;
}
.dp-ledger-panel {
  margin: 0 24px 20px;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-main);
  overflow: hidden;
}
.dp-ledger-panel summary {
  cursor: pointer;
  padding: 12px 14px;
  color: var(--dp-muted);
  font-size: 12px;
  font-weight: 500;
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
  border-radius: 8px;
  background: #FFE1E1;
  color: #8A1F1F;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 500;
}
.dp-action-toast {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 20px;
  z-index: 545;
  border: 1px solid var(--dp-border);
  border-radius: 8px;
  background: var(--dp-bg-input);
  color: var(--dp-text-second);
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 500;
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
@media (max-width: 760px), (pointer: coarse) and (max-width: 920px) {
  .dp-web-root.is-mobile-bridge {
    min-height: 100dvh;
    padding-top: 0;
  }
  .dp-shell.is-mobile-bridge,
  .dp-shell.is-mobile-bridge.is-collapsed {
    height: 100dvh;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  .dp-shell.is-mobile-bridge .dp-rail {
    min-height: 58px;
    border-bottom: 1px solid var(--dp-border);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: auto;
    align-items: center;
    overflow: hidden;
  }
  .dp-shell.is-mobile-bridge .dp-app-identity {
    margin: 8px 6px 8px 10px;
    grid-template-columns: 1fr;
  }
  .dp-shell.is-mobile-bridge .dp-app-copy,
  .dp-shell.is-mobile-bridge .dp-new-message-slot,
  .dp-shell.is-mobile-bridge .dp-nav-label,
  .dp-shell.is-mobile-bridge .dp-nav-divider,
  .dp-shell.is-mobile-bridge .dp-rail-connection {
    display: none;
  }
  .dp-shell.is-mobile-bridge .dp-nav-list {
    min-width: 0;
    margin: 0 4px;
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .dp-shell.is-mobile-bridge .dp-nav-list::-webkit-scrollbar {
    display: none;
  }
  .dp-shell.is-mobile-bridge .dp-nav-item,
  .dp-shell.is-mobile-bridge .dp-nav-item.is-collapsed {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    margin: 4px 1px;
    padding: 0;
    justify-content: center;
  }
  .dp-shell.is-mobile-bridge .dp-nav-icon {
    width: auto;
    justify-content: center;
  }
  .dp-shell.is-mobile-bridge .dp-rail-connection-collapsed {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0 8px 0 0;
    gap: 2px;
  }
  .dp-shell.is-mobile-bridge .dp-collapsed-status-tile,
  .dp-shell.is-mobile-bridge .dp-collapsed-icon-button,
  .dp-shell.is-mobile-bridge .dp-build-badge {
    width: 40px;
    height: 40px;
    margin-top: 0;
  }
  .dp-shell.is-mobile-bridge .dp-build-badge {
    display: none;
  }
  .dp-shell.is-mobile-bridge .dp-splitter {
    display: none;
  }
  .dp-shell.is-mobile-bridge .dp-content {
    min-height: 0;
    grid-template-rows: auto auto auto minmax(0, 1fr);
  }
  .dp-shell.is-mobile-bridge .dp-tab-area {
    min-height: 0;
  }
  .dp-shell.is-mobile-bridge .dp-tab-area.is-messages {
    min-height: 0;
  }
  .dp-shell.is-mobile-bridge .dp-message-shell,
  .dp-shell.is-mobile-bridge .dp-message-shell.is-list-hidden {
    height: 100%;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(190px, 42%) minmax(0, 1fr);
  }
  .dp-shell.is-mobile-bridge .dp-message-shell.is-list-hidden {
    grid-template-rows: minmax(0, 1fr);
  }
  .dp-shell.is-mobile-bridge .dp-message-splitter,
  .dp-shell.is-mobile-bridge .dp-thread-inner-splitter {
    display: none;
  }
  .dp-shell.is-mobile-bridge .dp-conversation-pane {
    border-right: 0;
    border-bottom: 1px solid var(--dp-border);
  }
  .dp-shell.is-mobile-bridge .dp-thread-detail-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .dp-shell.is-mobile-bridge .dp-thread-calls {
    display: none;
  }
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
  .dp-contacts-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .dp-new-compose-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .dp-contacts-list {
    max-height: 260px;
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
  .dp-contacts-shell {
    padding: 14px;
  }
  .dp-new-compose-shell {
    padding: 14px;
  }
}
`;

export function DeskPhoneWebPanel({
  T,
  onOnlineChange,
  onClose,
  embedded = false,
}) {
  const [hostInput, setHostInput] = useState(() => readSavedHost());
  const [host, setHost] = useState(() => readSavedHost());
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState("messages");
  const [railCollapsed, setRailCollapsed] = useState(() => readSavedRailState());
  const [railAutoCollapse, setRailAutoCollapse] = useState(() => {
    try { return localStorage.getItem(RAIL_AUTO_COLLAPSE_KEY) !== 'false'; } catch { return true; }
  });
  const railRef = useRef(null);
  const railAcTimer = useRef(null);
  const bridgeAutoOpenAttempted = useRef(false);
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
  const [callDialerSignal, setCallDialerSignal] = useState(0);
  const [draft, setDraft] = useState("");
  const [newMessageTo, setNewMessageTo] = useState("");
  const [contactDraft, setContactDraft] = useState(null);

  const showNotice = useCallback((message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextMessages, nextCalls, nextContacts] = await Promise.all([
        readOptionalJson(host, "/status"),
        readOptionalJson(host, "/messages"),
        readOptionalJson(host, "/calls"),
        readOptionalJson(host, "/contacts"),
      ]);
      const anyOnline = nextStatus.ok || nextMessages.ok || nextCalls.ok || nextContacts.ok;
      if (!anyOnline) {
        throw nextStatus.error || nextMessages.error || nextCalls.error || nextContacts.error || new Error("DeskPhone host was not reached.");
      }
      if (nextStatus.ok) setStatus(nextStatus.data);
      if (nextMessages.ok) setMessages(getApiList(nextMessages.data));
      if (nextCalls.ok) setCalls(getApiList(nextCalls.data));
      if (nextContacts.ok) setContacts(getApiList(nextContacts.data));
      setOnline(true);
      const failed = [nextStatus, nextMessages, nextCalls, nextContacts].filter((item) => !item.ok);
      setError(failed.length ? failed.map((item) => item.error?.message || `${item.path} failed`).join(" | ") : "");
      onOnlineChange?.(true);
    } catch (err) {
      setStatus(null);
      setMessages([]);
      setCalls([]);
      setContacts([]);
      setOnline(false);
      if (isLocalMobileBridgeHost(host) && !bridgeAutoOpenAttempted.current) {
        bridgeAutoOpenAttempted.current = true;
        openAndroidBridgeApp();
        setError("Opening Android bridge app. Return here after it starts.");
      } else {
        setError(err?.message || "DeskPhone host was not reached.");
      }
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

  const bridgeMode = isAndroidPhoneBridge(status) || isLocalMobileBridgeHost(host);
  const connectionStatus = useMemo(
    () => bridgeMode ? bridgeStatusLabel(status, online) : connectionStatusFromStatus(status),
    [bridgeMode, online, status]
  );
  const callsConnectionLabel = useMemo(() => {
    const hfpStatus = status?.hfp || status?.Hfp || "";
    const isConnected = String(hfpStatus).toLowerCase().includes("connected");
    return (
      <div className="dp-channel-row">
        <div className="dp-channel-status">
          <span className={`dp-status-dot ${isConnected ? "is-online" : ""}`} />
          <strong>Phone to phone (via Bluetooth)</strong>
        </div>
        <div className="dp-channel-guide">
          {isConnected ? "Connected" : "Not available. Phone may not be paired or Bluetooth is off."}
        </div>
      </div>
    );
  }, [status]);
  const messagesConnectionLabel = useMemo(() => {
    const mapStatus = status?.map || status?.Map || "";
    const isConnected = String(mapStatus).toLowerCase().includes("connected");

    // Build device descriptor: "Device Name, OS Type"
    const deviceName = status?.hostDeviceName || status?.HostDeviceName || "This device";
    const osType = status?.hostOsType || status?.HostOsType ||
      (navigator.userAgent.includes("Windows") ? "Windows" :
       navigator.userAgent.includes("Mac") ? "macOS" : "");
    const deviceDescriptor = osType ? `${deviceName}, ${osType}` : deviceName;

    return (
      <div className="dp-channel-row">
        <div className="dp-channel-status">
          <span className={`dp-status-dot ${isConnected ? "is-online" : ""}`} />
          <strong>{deviceDescriptor} to phone (via Bluetooth)</strong>
        </div>
        <div className="dp-channel-guide">
          {isConnected ? "Connected" : "Can't reach phone app. Make sure it's running."}
        </div>
      </div>
    );
  }, [status]);
  const showReconnectPrompt = !reconnectDismissed && !!(status?.showReconnectPrompt || status?.ShowReconnectPrompt || (!online && !bridgeMode));
  const effectiveBuildPrompt = !!(status?.showBuildUpdatePrompt || status?.ShowBuildUpdatePrompt || showBuildPrompt);
  const effectiveBuildIndicator = !!(status?.showBuildUpdateIndicator || status?.ShowBuildUpdateIndicator || showBuildIndicator);
  const effectiveMuted = !!(status?.isMuted ?? status?.IsMuted ?? muted);

  const runCommand = useCallback(async (path, label, payload) => {
    setBusy(label);
    try {
      await postJson(host, path, payload);
      await refresh();
      setError("");
    } catch (err) {
      setError(err?.message || "DeskPhone did not accept the command.");
    } finally {
      setBusy("");
    }
  }, [host, refresh]);

  const toggleRail = useCallback(() => {
    setRailCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const clearRailAC = useCallback(() => {
    if (railAcTimer.current) { clearTimeout(railAcTimer.current); railAcTimer.current = null; }
  }, []);

  const isRailHovered = useCallback(() => Boolean(railRef.current?.matches?.(":hover")), []);

  const scheduleRailAC = useCallback(() => {
    clearRailAC();
    if (!railAutoCollapse || railCollapsed || isRailHovered()) return;
    railAcTimer.current = setTimeout(() => {
      if (!isRailHovered()) {
        setRailCollapsed(true);
        try { localStorage.setItem(RAIL_COLLAPSED_KEY, 'true'); } catch {}
      }
    }, 10000);
  }, [railAutoCollapse, railCollapsed, clearRailAC, isRailHovered]);

  useEffect(() => {
    scheduleRailAC();
    return clearRailAC;
  }, [scheduleRailAC, clearRailAC]);

  const toggleRailAutoCollapse = useCallback(() => {
    setRailAutoCollapse(v => {
      const next = !v;
      try { localStorage.setItem(RAIL_AUTO_COLLAPSE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const handleSaveHost = useCallback(() => {
    const normalized = saveHost(hostInput);
    setHostInput(normalized);
    setHost(normalized);
  }, [hostInput]);

  const openNewMessage = useCallback((to = "") => {
    setNewMessageTo(String(to || ""));
    setActiveTab("new-message");
  }, []);

  const openFullCalls = useCallback(() => {
    setActiveTab("calls");
  }, []);

  const openContactEditor = useCallback((phone = "", mode = "new") => {
    setContactDraft({ phone: String(phone || ""), mode });
    setActiveTab("contacts");
  }, []);

  const handleNavSelect = useCallback((id) => {
    if (id === "make-call") {
      setActiveTab("calls");
      setCallDialerSignal((value) => value + 1);
      return;
    }
    if (id === "live-log") {
      runCommand("/open-live-log", "open live log");
      return;
    }
    if (id === "contacts") {
      setActiveTab("contacts");
      return;
    }
    if (id === "developer") {
      setActiveTab("developer");
      return;
    }
    setActiveTab(id);
  }, [runCommand]);

  const rootClasses = [
    "dp-web-root",
    embedded ? "is-embedded" : "",
    bridgeMode ? "is-mobile-bridge" : "",
  ].join(" ");
  const shellClasses = [
    "dp-shell",
    railCollapsed ? "is-collapsed" : "",
    bridgeMode ? "is-mobile-bridge" : "",
  ].join(" ");
  const themeVars = useMemo(() => buildDeskPhoneWebVars(T), [T]);

  return (
    <main className={rootClasses} style={themeVars}>
      <style>{css}</style>
      <div
        className={shellClasses}
        data-native-source="MainWindow.xaml:359"
        style={{ "--dp-rail-width": `${railWidth}px` }}
      >
        <aside ref={railRef} className="dp-rail" data-native-source="MainWindow.xaml:382" onMouseEnter={clearRailAC} onMouseLeave={scheduleRailAC}>
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
              onClick={openNewMessage}
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
            bridgeMode={bridgeMode}
            connectionStatus={connectionStatus}
            callsConnectionLabel={callsConnectionLabel}
            messagesConnectionLabel={messagesConnectionLabel}
            onReconnect={() => runCommand(bridgeMode ? "/phone/sync" : "/connect", bridgeMode ? "refresh phone data" : "connect")}
            onSettings={() => setActiveTab("settings")}
          />

          {/* Auto-collapse toggle */}
          <button
            onClick={toggleRailAutoCollapse}
            title={railAutoCollapse ? "Auto-collapse: ON — click to disable" : "Auto-collapse: OFF — click to enable"}
            data-automation-id="DeskPhoneRailAutoCollapseToggle"
            style={{
              display: "flex", alignItems: "center", gap: railCollapsed ? 0 : 6,
              justifyContent: railCollapsed ? "center" : "flex-start",
              width: "100%", padding: railCollapsed ? "6px 0" : "6px 10px",
              margin: "6px 0 2px", border: "none", borderRadius: 8, cursor: "pointer",
              background: railAutoCollapse ? "rgba(127,127,127,0.10)" : "transparent",
              color: railAutoCollapse ? COLORS.textSecond : COLORS.textMuted,
              fontSize: 11, fontWeight: 700, fontFamily: "system-ui",
              overflow: "hidden", whiteSpace: "nowrap", boxSizing: "border-box",
            }}
          >
            <span className="material-symbols-rounded dp-material-icon" aria-hidden="true" style={{ fontSize: 14 }}>timer</span>
            {!railCollapsed && (railAutoCollapse ? "Auto-collapse: on" : "Auto-collapse: off")}
          </button>
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
              bridgeMode={bridgeMode}
              onConnect={() => runCommand(bridgeMode ? "/phone/sync" : "/connect", bridgeMode ? "refresh phone data" : "connect")}
              onChooseDevice={() => {
                setReconnectDismissed(true);
                setActiveTab("settings");
              }}
              onDismiss={() => setReconnectDismissed(true)}
            />
            <ContactImportPrompt />
          </div>

          <BuildUpdateOverlay
            showPrompt={effectiveBuildPrompt}
            showIndicator={effectiveBuildIndicator && !effectiveBuildPrompt}
            title={status?.pendingBuildTitle || status?.PendingBuildTitle}
            body={status?.pendingBuildBody || status?.PendingBuildBody}
            onShowPrompt={() => {
              setShowBuildPrompt(true);
              setShowBuildIndicator(false);
              runCommand("/show-build-update-prompt", "show build update");
            }}
            onAccept={() => {
              setShowBuildPrompt(false);
              setShowBuildIndicator(false);
              runCommand("/accept-build-update", "use new build");
            }}
            onSnooze={() => {
              setShowBuildPrompt(false);
              setShowBuildIndicator(true);
              runCommand("/snooze-build-update", "snooze build update");
            }}
          />

          <CallBanner
            status={status}
            muted={effectiveMuted}
            onMute={() => {
              setMuted((value) => !value);
              runCommand("/toggle-mute", effectiveMuted ? "unmute call" : "mute call");
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
              contacts={contacts}
              callDialerSignal={callDialerSignal}
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
              newMessageTo={newMessageTo}
              contactDraft={contactDraft}
              host={host}
              hostInput={hostInput}
              setHostInput={setHostInput}
              onSaveHost={handleSaveHost}
              onRefresh={refresh}
              onCommand={runCommand}
              onOpenBridge={() => {
                bridgeAutoOpenAttempted.current = true;
                openAndroidBridgeApp();
              }}
              onOpenNewMessage={openNewMessage}
              onOpenFullCalls={openFullCalls}
              onOpenContactEditor={openContactEditor}
              onContactDraftConsumed={() => setContactDraft(null)}
              onCancelNewMessage={() => setActiveTab("messages")}
              onNotice={showNotice}
            />
          </div>

          {activeTab === "developer" ? <ParityLedgerPanel rows={[...SHELL_PARITY_ROWS, ...MESSAGE_PARITY_ROWS]} /> : null}

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
