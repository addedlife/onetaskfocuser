import React, { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_HOST = "http://127.0.0.1:8765";
const HOST_CONNECTOR_KEY = "deskphone_web_host_url";
const LEGACY_BRIDGE_KEY = "deskphone_web_bridge_url";

const INVENTORY_COUNTS = [
  ["Native files scanned", "57"],
  ["XAML screen/style files", "17"],
  ["C# plumbing files", "40"],
  ["UI/layout/style elements", "2,013"],
  ["Action elements", "199"],
  ["Command bindings", "135"],
  ["Methods/functions", "501"],
  ["Host endpoints", "18"],
];

const REBUILD_RULES = [
  "Native DeskPhone is the source of truth.",
  "Every visible action is mapped before it is rebuilt.",
  "Host commands are added only when the browser cannot safely do the job by itself.",
  "Prototype styling does not count as parity.",
];

const REVIEW_QUEUE = [
  {
    source: "MainWindow.xaml:442",
    element: "Navigation rail toggle",
    command: "ToggleNavigationRailCommand",
    state: "review-first",
  },
  {
    source: "MainWindow.xaml:455",
    element: "New Message",
    command: "Open compose surface",
    state: "review-first",
  },
  {
    source: "MainWindow.xaml:508",
    element: "Phone",
    command: "Show messages and calls",
    state: "review-first",
  },
  {
    source: "MainWindow.xaml:525",
    element: "Make Call",
    command: "Open dialer",
    state: "host-check",
  },
  {
    source: "MainWindow.xaml:544",
    element: "Calls",
    command: "Show call history",
    state: "review-first",
  },
  {
    source: "MainWindow.xaml:562",
    element: "Contacts",
    command: "Show contacts",
    state: "review-first",
  },
  {
    source: "MainWindow.xaml:586",
    element: "Settings",
    command: "Show settings",
    state: "review-first",
  },
  {
    source: "MainWindow.xaml:620",
    element: "Live Log",
    command: "Open or focus log window",
    state: "host-needed",
  },
  {
    source: "MainWindow.xaml:808",
    element: "Connect",
    command: "ReconnectCommand",
    state: "host-needed",
  },
  {
    source: "MainWindow.xaml:993",
    element: "Accept call",
    command: "AnswerCommand",
    state: "host-needed",
  },
  {
    source: "MainWindow.xaml:1006",
    element: "Hang up",
    command: "HangUpCommand",
    state: "host-needed",
  },
  {
    source: "MainWindow.xaml:1078",
    element: "Conversation new message",
    command: "Open compose surface",
    state: "review-first",
  },
];

const DOCS = [
  "DESKPHONE_EXACT_PARITY_INVENTORY.md",
  "DESKPHONE_WEB_PARITY_EXECUTION_RULES.md",
  "deskphone-web-parity-map.csv",
  "deskphone-ui-elements.csv",
];

function icon(name, size = 20) {
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>
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

function saveHost(value) {
  const normalized = normalizeHost(value);
  try {
    localStorage.setItem(HOST_CONNECTOR_KEY, normalized);
  } catch {
    // Local storage can be blocked in strict browser modes. The typed value still works for this session.
  }
  return normalized;
}

async function readJson(host, path, options = {}) {
  const response = await fetch(`${host}${path}`, {
    cache: "no-store",
    ...options,
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

async function postJson(host, path, body = {}) {
  const response = await fetch(`${host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true };
  }
}

function pickStatusText(status) {
  if (!status) return "Host not reached";
  return (
    status.connectionState ||
    status.ConnectionState ||
    status.state ||
    status.State ||
    status.status ||
    status.Status ||
    "Host reached"
  );
}

function formatClock(value) {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function getMetric(status, keys, fallback = "Unknown") {
  if (!status) return fallback;
  for (const key of keys) {
    const value = status[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return fallback;
}

function stateTone(state) {
  if (state === "host-needed") return { text: "Host needed", color: "#b45309", background: "#fff7ed" };
  if (state === "host-check") return { text: "Host check", color: "#0369a1", background: "#eff6ff" };
  return { text: "Review first", color: "#166534", background: "#f0fdf4" };
}

function ActionButton({ children, iconName, tone = "neutral", ...props }) {
  const palette = {
    primary: { background: "#0f766e", color: "#ffffff", border: "#0f766e" },
    neutral: { background: "#ffffff", color: "#172554", border: "#cbd5e1" },
    quiet: { background: "#f8fafc", color: "#334155", border: "#dbe3ef" },
  }[tone];
  return (
    <button
      {...props}
      style={{
        minHeight: 40,
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        background: palette.background,
        color: palette.color,
        cursor: props.disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "0 14px",
        fontSize: 13,
        fontWeight: 800,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        opacity: props.disabled ? 0.55 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {iconName ? icon(iconName, 18) : null}
      <span>{children}</span>
    </button>
  );
}

function Section({ title, eyebrow, children, actions }) {
  return (
    <section
      style={{
        border: "1px solid #d8e1ef",
        background: "#ffffff",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          minHeight: 58,
          padding: "14px 16px",
          borderBottom: "1px solid #e5edf7",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0 }}>
            {eyebrow}
          </div>
          <h2 style={{ margin: "3px 0 0", color: "#0f172a", fontSize: 18, lineHeight: 1.2 }}>
            {title}
          </h2>
        </div>
        {actions ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>{actions}</div> : null}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div
      style={{
        minHeight: 76,
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "12px 14px",
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 4, color: "#0f172a", fontSize: 22, lineHeight: 1, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function StatusDot({ online }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        borderRadius: 99,
        background: online ? "#16a34a" : "#dc2626",
        boxShadow: online ? "0 0 0 4px rgba(22,163,74,0.14)" : "0 0 0 4px rgba(220,38,38,0.12)",
        flex: "0 0 auto",
      }}
    />
  );
}

function QueueRow({ item, compact }) {
  const tone = stateTone(item.state);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : "minmax(150px,0.85fr) minmax(180px,1fr) minmax(180px,1fr) 116px",
        gap: compact ? 6 : 12,
        alignItems: compact ? "start" : "center",
        minHeight: 50,
        padding: compact ? "12px" : "9px 12px",
        borderBottom: "1px solid #e5edf7",
      }}
    >
      <div style={{ color: "#475569", fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.source}
      </div>
      <div style={{ color: "#0f172a", fontSize: 13, fontWeight: 900, minWidth: 0 }}>{item.element}</div>
      <div style={{ color: "#334155", fontSize: 13, minWidth: 0 }}>{item.command}</div>
      <div
        style={{
          justifySelf: compact ? "start" : "end",
          width: 104,
          minHeight: 28,
          borderRadius: 6,
          background: tone.background,
          color: tone.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: 0,
        }}
      >
        {tone.text}
      </div>
    </div>
  );
}

export function DeskPhoneWebPanel() {
  const [hostInput, setHostInput] = useState(() => readSavedHost());
  const [host, setHost] = useState(() => readSavedHost());
  const [status, setStatus] = useState(null);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState(null);
  const [activeView, setActiveView] = useState("restart");
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === "undefined") return 1200;
    return window.innerWidth;
  });

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const statusText = useMemo(() => pickStatusText(status), [status]);
  const phoneName = useMemo(
    () => getMetric(status, ["phoneName", "PhoneName", "deviceName", "DeviceName", "connectedDeviceName", "ConnectedDeviceName"], "No phone reported"),
    [status]
  );
  const phoneAddress = useMemo(
    () => getMetric(status, ["phoneAddress", "PhoneAddress", "deviceAddress", "DeviceAddress", "sourceDeviceAddress", "SourceDeviceAddress"], "No address reported"),
    [status]
  );
  const buildLabel = useMemo(
    () => getMetric(status, ["build", "Build", "buildNumber", "BuildNumber", "version", "Version"], "Unknown"),
    [status]
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const nextStatus = await readJson(host, "/status");
      setStatus(nextStatus);
      setOnline(true);
      setError("");
      setLastChecked(new Date());
    } catch (err) {
      setStatus(null);
      setOnline(false);
      setError(err?.message || "DeskPhone host was not reached.");
      setLastChecked(new Date());
    } finally {
      setBusy(false);
    }
  }, [host]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 7000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const handleSaveHost = useCallback(() => {
    const normalized = saveHost(hostInput);
    setHostInput(normalized);
    setHost(normalized);
  }, [hostInput]);

  const handleShowNative = useCallback(async () => {
    setBusy(true);
    try {
      await postJson(host, "/show");
      setError("");
      await refresh();
    } catch (err) {
      setError(err?.message || "Could not ask DeskPhone to open.");
    } finally {
      setBusy(false);
    }
  }, [host, refresh]);

  const handleOpenProtocol = useCallback(() => {
    window.location.href = "deskphone://open";
  }, []);

  const views = [
    ["restart", "Restart", "restart_alt"],
    ["native", "Native Source", "data_object"],
    ["queue", "Rebuild Queue", "format_list_bulleted"],
    ["host", "Host Link", "settings_ethernet"],
  ];
  const compact = viewportWidth < 760;
  const singleColumn = viewportWidth < 980;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#eef3f8",
        color: "#0f172a",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        padding: "84px clamp(12px, 2.2vw, 28px) 28px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 16 }}>
        <header
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "1fr" : "minmax(0,1fr) auto",
            gap: 16,
            alignItems: compact ? "start" : "end",
            borderBottom: "1px solid #cbd5e1",
            paddingBottom: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#0f766e", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0 }}>
              {icon("phonelink_setup", 18)}
              DeskPhone Web build 2
            </div>
            <h1 style={{ margin: "6px 0 0", fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1, letterSpacing: 0 }}>
              Exact-parity restart
            </h1>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 42,
              padding: "0 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#ffffff",
              color: online ? "#14532d" : "#991b1b",
              fontWeight: 900,
            }}
          >
            <StatusDot online={online} />
            <span>{online ? "Host online" : "Host offline"}</span>
          </div>
        </header>

        <nav
          aria-label="DeskPhone rebuild sections"
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
            gap: 6,
            padding: 4,
            border: "1px solid #d8e1ef",
            borderRadius: 8,
            background: "#ffffff",
          }}
        >
          {views.map(([id, label, iconName]) => {
            const active = activeView === id;
            return (
              <button
                key={id}
                onClick={() => setActiveView(id)}
                style={{
                  minWidth: 0,
                  minHeight: 42,
                  border: "none",
                  borderRadius: 6,
                  background: active ? "#172554" : "transparent",
                  color: active ? "#ffffff" : "#475569",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "0 10px",
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                {icon(iconName, 18)}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              </button>
            );
          })}
        </nav>

        {activeView === "restart" ? (
          <div style={{ display: "grid", gridTemplateColumns: singleColumn ? "1fr" : "minmax(0, 1.05fr) minmax(320px, 0.95fr)", gap: 16 }}>
            <Section
              eyebrow="Decision"
              title="The first web phone build is removed from the path forward"
              actions={<ActionButton iconName="refresh" onClick={refresh} disabled={busy}>{busy ? "Checking" : "Refresh"}</ActionButton>}
            >
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ color: "#334155", fontSize: 15, lineHeight: 1.55 }}>
                  The old polished browser mockup is no longer the engineering baseline. This route now starts from the native DeskPhone inventory, then rebuilds each screen, button, state, and host command only after it is mapped.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  {REBUILD_RULES.map((rule) => (
                    <div key={rule} style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 48, padding: 10, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
                      <span style={{ color: "#0f766e", marginTop: 1 }}>{icon("check_circle", 18)}</span>
                      <span style={{ color: "#1e293b", fontSize: 13, lineHeight: 1.35, fontWeight: 700 }}>{rule}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section eyebrow="Live link" title="DeskPhone host connection">
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <StatusDot online={online} />
                  <div>
                    <div style={{ color: online ? "#14532d" : "#991b1b", fontWeight: 900 }}>{statusText}</div>
                    <div style={{ color: "#64748b", fontSize: 12 }}>Last check: {formatClock(lastChecked)}</div>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ color: "#334155", fontSize: 13 }}><strong>Phone:</strong> {phoneName}</div>
                  <div style={{ color: "#334155", fontSize: 13 }}><strong>Address:</strong> {phoneAddress}</div>
                  <div style={{ color: "#334155", fontSize: 13 }}><strong>Build:</strong> {buildLabel}</div>
                </div>
                {error ? (
                  <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 800 }}>
                    {error}
                  </div>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <ActionButton iconName="open_in_new" tone="primary" onClick={handleShowNative} disabled={busy || !online}>Show native app</ActionButton>
                  <ActionButton iconName="smartphone" onClick={handleOpenProtocol}>Open DeskPhone</ActionButton>
                </div>
              </div>
            </Section>
          </div>
        ) : null}

        {activeView === "native" ? (
          <Section eyebrow="Native inventory" title="What the rebuild must match">
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {INVENTORY_COUNTS.map(([label, value]) => (
                  <Metric key={label} label={label} value={value} />
                ))}
              </div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                {DOCS.map((doc) => (
                  <div key={doc} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: "1px solid #e5edf7", background: "#ffffff" }}>
                    <span style={{ color: "#0f766e" }}>{icon("description", 18)}</span>
                    <span style={{ color: "#0f172a", fontSize: 13, fontWeight: 900 }}>{doc}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        ) : null}

        {activeView === "queue" ? (
          <Section eyebrow="First slice" title="Top-level native actions awaiting mapping">
            <div style={{ border: "1px solid #d8e1ef", borderRadius: 8, overflow: "hidden", background: "#ffffff" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: compact ? "1fr" : "minmax(150px,0.85fr) minmax(180px,1fr) minmax(180px,1fr) 116px",
                  gap: 12,
                  alignItems: "center",
                  minHeight: 38,
                  padding: "0 12px",
                  background: "#f1f5f9",
                  color: "#475569",
                  fontSize: 11,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0,
                }}
              >
                <div>Native source</div>
                <div>Element</div>
                <div>Behavior</div>
                <div style={{ textAlign: "right" }}>State</div>
              </div>
              {REVIEW_QUEUE.map((item) => (
                <QueueRow key={`${item.source}-${item.element}`} item={item} compact={compact} />
              ))}
            </div>
          </Section>
        ) : null}

        {activeView === "host" ? (
          <Section
            eyebrow="Local bridge"
            title="Connection endpoint"
            actions={<ActionButton iconName="save" tone="primary" onClick={handleSaveHost}>Save host</ActionButton>}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 900 }}>
                Host URL
                <input
                  value={hostInput}
                  onChange={(event) => setHostInput(event.target.value)}
                  spellCheck={false}
                  style={{
                    width: "100%",
                    minHeight: 42,
                    boxSizing: "border-box",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    padding: "0 12px",
                    color: "#0f172a",
                    background: "#ffffff",
                    fontSize: 14,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                <Metric label="Active endpoint" value={host.replace(/^https?:\/\//i, "")} />
                <Metric label="Connection" value={online ? "Online" : "Offline"} />
                <Metric label="Last check" value={formatClock(lastChecked)} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <ActionButton iconName="refresh" onClick={refresh} disabled={busy}>{busy ? "Checking" : "Check now"}</ActionButton>
                <ActionButton iconName="open_in_new" onClick={handleShowNative} disabled={busy || !online}>Show native app</ActionButton>
                <ActionButton iconName="smartphone" onClick={handleOpenProtocol}>Open DeskPhone</ActionButton>
              </div>
            </div>
          </Section>
        ) : null}
      </div>
    </main>
  );
}

export default DeskPhoneWebPanel;
