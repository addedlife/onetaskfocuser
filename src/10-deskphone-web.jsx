import React, { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_HOST = "http://127.0.0.1:8765";
const HOST_CONNECTOR_KEY = "deskphone_web_host_url";
const LEGACY_BRIDGE_KEY = "deskphone_web_bridge_url";
const RAIL_COLLAPSED_KEY = "deskphone_web_rail_collapsed";

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
  ["MainWindow.xaml:396", "App identity", "36 by 36 app icon, DeskPhone title, build number, build time"],
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

function buildLabel(status) {
  const build = status?.build || status?.Build || status?.buildNumber || status?.BuildNumber || "";
  if (!build) return "Build Number: unknown";
  const numberOnly = String(build).split(/\s+/)[0] || build;
  return `Build Number: ${numberOnly}`;
}

function buildTimeLabel(status) {
  const build = status?.build || status?.Build || "";
  const parts = String(build).split(/\s{2,}/).filter(Boolean);
  if (parts.length > 1) return `Build Time: ${parts.slice(1).join(" ")}`;
  return "Build Time: host reported";
}

function buildBadge(status) {
  const build = status?.build || status?.Build || "";
  return String(build).split(/\s+/)[0] || "b---";
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
        <div className="dp-build-badge" title={status?.build || "Build badge"}>
          {buildBadge(status)}
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

function MessagesSlicePlaceholder({ status }) {
  return (
    <div className="dp-tab-placeholder" data-native-source="MainWindow.xaml:1026">
      <div>
        <SourceTag>MainWindow.xaml:1026</SourceTag>
        <h2>Messages root grid</h2>
        <p>This first slice copies the frame around the message area. The next slice copies the message list, filters, context menus, conversation header, bubbles, attachments, and compose bar from the inventory.</p>
      </div>
      <div className="dp-placeholder-stats">
        <div>
          <span>{status?.conversationCount ?? "-"}</span>
          <label>Conversations</label>
        </div>
        <div>
          <span>{status?.messageCount ?? "-"}</span>
          <label>Messages</label>
        </div>
      </div>
    </div>
  );
}

function SimpleTabContent({ activeTab, status, host, hostInput, setHostInput, onSaveHost, onRefresh, onShowNative }) {
  if (activeTab === "messages") return <MessagesSlicePlaceholder status={status} />;
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
      <summary>First shell slice parity ledger</summary>
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
  min-height: calc(100vh - 64px);
  display: grid;
  grid-template-columns: 268px 7px minmax(0, 1fr);
  background: var(--dp-bg-main);
  overflow: hidden;
}
.dp-web-root.is-embedded .dp-shell {
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
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("messages");
  const [railCollapsed, setRailCollapsed] = useState(() => readSavedRailState());
  const [reconnectDismissed, setReconnectDismissed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showBuildPrompt, setShowBuildPrompt] = useState(false);
  const [showBuildIndicator, setShowBuildIndicator] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await readJson(host, "/status");
      setStatus(nextStatus);
      setOnline(true);
      setError("");
      onOnlineChange?.(true);
    } catch (err) {
      setStatus(null);
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
      return;
    }
    if (id === "live-log") {
      runCommand("/show", "show log");
      return;
    }
    setActiveTab(id);
  }, [runCommand]);

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
      <div className={shellClasses} data-native-source="MainWindow.xaml:359">
        <aside className="dp-rail" data-native-source="MainWindow.xaml:382">
          <div className="dp-app-identity" data-native-source="MainWindow.xaml:396">
            <div className="dp-app-title-block">
              <div className="dp-app-icon-box" data-native-source="MainWindow.xaml:410">
                {icon("smartphone", 20)}
              </div>
              {!railCollapsed ? (
                <div className="dp-app-copy">
                  <div className="dp-app-name">DeskPhone</div>
                  <div className="dp-app-build" title={buildLabel(status)}>{buildLabel(status)}</div>
                  <div className="dp-app-time" title={buildTimeLabel(status)}>{buildTimeLabel(status)}</div>
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

        <div className="dp-splitter" data-native-source="MainWindow.xaml:770" />

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
            onAccept={() => setError("Use New Build needs a host API endpoint before the web page can trigger it.")}
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
              setError("Mute is copied into the shell, but host control is still needed before web can toggle microphone mute.");
            }}
            onAnswer={() => runCommand("/answer", "answer")}
            onHangup={() => runCommand("/hangup", "hangup")}
          />

          <div className="dp-tab-area">
            <SimpleTabContent
              activeTab={activeTab}
              status={status}
              host={host}
              hostInput={hostInput}
              setHostInput={setHostInput}
              onSaveHost={handleSaveHost}
              onRefresh={refresh}
              onShowNative={showNativeApp}
            />
          </div>

          <ParityLedgerPanel rows={SHELL_PARITY_ROWS} />

          {error ? <div className="dp-error-toast">{error}</div> : null}
          {busy ? <div className="dp-native-hidden" aria-hidden="true">Working: {busy}</div> : null}
          {onClose ? <button className="dp-native-hidden" onClick={onClose} aria-hidden="true">Close</button> : null}
        </section>
      </div>
    </main>
  );
}

export default DeskPhoneWebPanel;
