import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NC_FONT_STACK, NC_TYPE, suiteIcon } from '../ui-tokens.jsx';

// ── Palette ──────────────────────────────────────────────────────────────────
const M = {
  steps:     { label: "Steps",       unit: "",     icon: "directions_walk", color: "#4285F4", goal: 10000 },
  heartRate: { label: "Heart Rate",  unit: "bpm",  icon: "favorite",        color: "#EA4335", goal: null  },
  sleep:     { label: "Sleep",       unit: "hrs",  icon: "bedtime",          color: "#7C3AED", goal: 8     },
  weight:    { label: "Weight",      unit: "lb",   icon: "monitor_weight",   color: "#00897B", goal: null  },
};

const PERIODS = [
  { id: "day",   label: "D" },
  { id: "week",  label: "W" },
  { id: "month", label: "M" },
  { id: "year",  label: "Y" },
  { id: "all",   label: "All" },
];

// ── Demo data generation ──────────────────────────────────────────────────────
function genDemoHistory(days) {
  const today = new Date("2026-05-25");
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const seed = i * 17 + 3;
    const pseudo = (n) => ((seed * n * 1013 + 7) % 1000) / 1000;
    return {
      date: d.toISOString().slice(0, 10),
      steps:     Math.floor(3500 + pseudo(1) * 9000),
      heartRate: Math.floor(60  + pseudo(2) * 24),
      sleep:     +(5.0  + pseudo(3) * 3.5).toFixed(1),
      weight:    +(173  + pseudo(4) * 5).toFixed(1),
    };
  });
}

const DEMO_DAY     = [genDemoHistory(1)[0]];
const DEMO_WEEK    = genDemoHistory(7);
const DEMO_MONTH   = genDemoHistory(30);
const DEMO_YEAR    = genDemoHistory(52).map((d, i) => ({
  ...d,
  label: `W${i + 1}`,
  steps:     Math.floor(d.steps * 7),
  heartRate: d.heartRate,
  sleep:     +(d.sleep * 7).toFixed(1),
  weight:    d.weight,
}));

// ── Helper formatters ─────────────────────────────────────────────────────────
function formatSleep(val) {
  if (val === null || val === undefined) return "—";
  const h = Math.floor(val);
  const m = Math.round((val % 1) * 60);
  return `${h}h ${m < 10 ? "0" : ""}${m}m`;
}

function fmtVal(key, val) {
  if (val === null || val === undefined) return "—";
  if (key === "sleep")     return formatSleep(val);
  if (key === "steps")     return Number(val).toLocaleString();
  if (key === "heartRate") return `${Math.round(val)} bpm`;
  if (key === "weight")    return `${(+val).toFixed(1)} lb`;
  return String(val);
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function pctChange(curr, prev) {
  if (!prev) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ── Mini SVG Bar Chart ────────────────────────────────────────────────────────
function MiniBarChart({ values, color, height = 56 }) {
  if (!values || values.length === 0) return null;
  const valid = values.filter(v => v !== null && v !== undefined && Number.isFinite(v));
  if (!valid.length) return <div style={{ height }} />;
  const max = Math.max(...valid);
  const min = Math.min(...valid);
  const range = max - min || 1;
  const n = values.length;
  const barW = Math.max(2, Math.floor(240 / n) - 2);
  const gap  = Math.max(1, 2);
  const totalW = n * (barW + gap) - gap;

  return (
    <svg width={totalW} height={height} viewBox={`0 0 ${totalW} ${height}`}
      style={{ display: "block", overflow: "visible" }} preserveAspectRatio="none">
      {values.map((v, i) => {
        const val = v ?? min;
        const pct = (val - min) / range;
        const bh  = Math.max(3, pct * (height - 6)) || 4;
        const x   = i * (barW + gap);
        const y   = height - bh;
        const isLast = i === n - 1;
        return (
          <rect key={i} x={x} y={y} width={barW} height={bh} rx={Math.min(barW / 2, 2)}
            fill={color} opacity={isLast ? 1 : 0.28 + 0.55 * ((i + 1) / n)}
          />
        );
      })}
    </svg>
  );
}

// ── Full ring (for today's metric summary) ────────────────────────────────────
function BigRing({ value, goal, color, size = 88, sw = 7 }) {
  const bg = `${color}1C`;
  const r  = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = goal && value ? Math.min(1, value / goal) : 0;
  const dash = circ * pct;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)", display: "block", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={sw} />
      {pct > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      )}
    </svg>
  );
}

// ── Metric Card ───────────────────────────────────────────────────────────────
function MetricCard({ metricKey, values, todayVal, period, C }) {
  const m    = M[metricKey];
  const nums = values.map(d => d[metricKey]).filter(v => v !== null && v !== undefined);
  const currAvg = nums.length ? avg(nums) : null;
  const prevNums = values.slice(0, Math.floor(values.length / 2)).map(d => d[metricKey]).filter(Boolean);
  const prevAvg  = prevNums.length ? avg(prevNums) : null;
  const change   = currAvg !== null && prevAvg !== null ? pctChange(currAvg, prevAvg) : null;

  const displayToday = fmtVal(metricKey, todayVal);
  const displayAvg   = currAvg !== null ? fmtVal(metricKey, Math.round(currAvg * 10) / 10) : "—";
  const hasGoal = m.goal !== null;

  const changeColor = change === null ? C.muted
    : metricKey === "heartRate" || metricKey === "weight"
      ? change > 0 ? C.danger || "#EA4335" : C.success || "#34A853"
      : change > 0 ? C.success || "#34A853" : C.danger  || "#EA4335";

  return (
    <div style={{
      background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 12,
      padding: 18, display: "flex", flexDirection: "column", gap: 14,
      minHeight: 180, position: "relative", overflow: "hidden",
    }}>
      {/* Subtle color splash */}
      <div style={{
        position: "absolute", top: -24, right: -24, width: 100, height: 100,
        borderRadius: "50%", background: `${m.color}0D`, pointerEvents: "none",
      }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: `${m.color}18`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, color: m.color }}>{m.icon}</span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK }}>{m.label}</span>
        </div>
        {change !== null && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: changeColor,
            fontFamily: NC_FONT_STACK, background: `${changeColor}14`,
            borderRadius: 10, padding: "2px 7px",
          }}>
            {change > 0 ? "+" : ""}{change.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Value + ring (period = day) or value + avg (period > day) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {period === "day" && hasGoal ? (
          <div style={{ position: "relative", width: 88, height: 88, flexShrink: 0 }}>
            <BigRing value={todayVal} goal={m.goal} color={m.color} />
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, color: m.color }}>{m.icon}</span>
            </div>
          </div>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: m.color, fontFamily: NC_FONT_STACK, lineHeight: 1.1, letterSpacing: -0.5 }}>
            {period === "day" ? displayToday : displayAvg}
          </div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: NC_FONT_STACK, marginTop: 3 }}>
            {period === "day"
              ? (hasGoal ? `Goal: ${m.key === "sleep" ? formatSleep(m.goal) : Number(m.goal).toLocaleString()} ${m.unit}`.trim() : "Today")
              : `Avg ${period}`}
          </div>
          {m.unit && period !== "day" && (
            <div style={{ fontSize: 11, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 1 }}>
              {m.unit}
            </div>
          )}
        </div>
      </div>

      {/* Mini chart */}
      {nums.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ overflow: "hidden", borderRadius: 4 }}>
            <MiniBarChart values={nums} color={m.color} height={48} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9.5, color: C.faint, fontFamily: NC_FONT_STACK }}>{values[0]?.date?.slice(5) || ""}</span>
            <span style={{ fontSize: 9.5, color: C.faint, fontFamily: NC_FONT_STACK }}>{values[values.length - 1]?.date?.slice(5) || "Today"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Connect Modal ─────────────────────────────────────────────────────────────
function ConnectModal({ C, onClose, onStartGoogleHealth, googleHealthLinked, connectLoading, connectError }) {
  const [showOther, setShowOther] = React.useState(false);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9980, background: "rgba(0,0,0,0.52)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(420px,94vw)", background: C.bg,
        border: `1px solid ${C.divider}`, borderRadius: 16,
        boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
        fontFamily: NC_FONT_STACK, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px 14px", borderBottom: `1px solid ${C.divider}` }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Connect Health Data</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: "50%", border: "none",
            background: C.hover || "transparent", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", color: C.muted }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>

        <div style={{ padding: "18px 20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Google Health — primary option */}
          <div style={{
            border: `2px solid ${googleHealthLinked ? C.success || "#34A853" : connectError ? C.danger || "#EA4335" : C.accent}`,
            borderRadius: 12, padding: "16px 18px",
            background: googleHealthLinked ? `${C.success || "#34A853"}08` : `${C.accent}06`,
            display: "flex", gap: 14, alignItems: "center",
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `${C.accent}18` }}>
              <span className="material-symbols-rounded" style={{ fontSize: 22, color: C.accent }}>monitor_heart</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Google Health</span>
                <span style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 7px", borderRadius: 8,
                  background: googleHealthLinked ? `${C.success || "#34A853"}20` : `${C.accent}18`,
                  color: googleHealthLinked ? C.success || "#34A853" : C.accent }}>
                  {googleHealthLinked ? "Connected" : "Recommended"}
                </span>
              </div>
              {connectError ? (
                <div style={{ fontSize: 12, color: C.danger || "#EA4335", lineHeight: 1.4, fontWeight: 500 }}>
                  {connectError}
                  {connectError.includes("not set") && (
                    <span style={{ color: C.muted, fontWeight: 400 }}>{" "}— follow the Setup Guide on this page.</span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>
                  Steps, heart rate, sleep &amp; weight from Google Health / Wear OS.
                </div>
              )}
            </div>
            <button onClick={onStartGoogleHealth} disabled={connectLoading} style={{
              flexShrink: 0, height: 34, padding: "0 16px", borderRadius: 17,
              border: "none", background: connectLoading ? C.divider : C.accent, color: "#fff",
              cursor: connectLoading ? "wait" : "pointer", fontSize: 13,
              fontFamily: NC_FONT_STACK, fontWeight: 600, whiteSpace: "nowrap",
            }}>
              {connectLoading ? "Opening…"
                : connectError ? "Retry"
                : googleHealthLinked ? "Reconnect"
                : "Connect"}
            </button>
          </div>

          {/* Manual log shortcut */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", border: `1px solid ${C.divider}`, borderRadius: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 1 }}>Manual entry</div>
              <div style={{ fontSize: 11.5, color: C.muted }}>Log today's values yourself</div>
            </div>
            <button onClick={onClose} style={{ height: 30, padding: "0 14px", borderRadius: 15,
              border: `1px solid ${C.divider}`, background: "none", color: C.muted,
              cursor: "pointer", fontSize: 12, fontFamily: NC_FONT_STACK }}>
              Use Log button ↗
            </button>
          </div>

          {/* Other sources — collapsible */}
          <button onClick={() => setShowOther(v => !v)} style={{
            width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 5,
            background: "none", border: "none", cursor: "pointer", padding: "2px 0",
            color: C.faint, fontSize: 12, fontFamily: NC_FONT_STACK,
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: 14,
              transition: "transform 0.15s", transform: showOther ? "rotate(180deg)" : "none" }}>
              expand_more
            </span>
            Other sources (Apple Health)
          </button>

          {showOther && (
            <div style={{ border: `1px solid ${C.divider}`, borderRadius: 10, padding: "12px 14px",
              background: C.bgSoft || C.bg, fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
              <strong style={{ color: C.text }}>Apple Health:</strong>{" "}
              iOS-native, not accessible from the web. Install "Health Auto Export" on iPhone and point it at this app's Firebase endpoint, or use Manual entry.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Manual Entry Modal ────────────────────────────────────────────────────────
function ManualEntryModal({ C, onClose, onSave }) {
  const [steps,     setSteps]     = useState("");
  const [heartRate, setHR]        = useState("");
  const [sleep,     setSleep]     = useState("");
  const [weight,    setWeight]    = useState("");

  const field = (label, value, set, placeholder) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, fontFamily: NC_FONT_STACK }}>{label}</label>
      <input type="number" value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
        style={{
          height: 36, borderRadius: 8, border: `1px solid ${C.divider}`,
          background: C.bgSoft || C.bg, color: C.text, fontFamily: NC_FONT_STACK,
          fontSize: 13, padding: "0 11px", outline: "none", boxSizing: "border-box", width: "100%",
        }}
      />
    </div>
  );

  function handleSave() {
    const data = {
      date: new Date().toISOString().slice(0, 10),
      source: "manual",
      steps:     steps     ? Number(steps)     : null,
      heartRate: heartRate ? Number(heartRate) : null,
      sleep:     sleep     ? Number(sleep)     : null,
      weight:    weight    ? Number(weight)    : null,
    };
    onSave(data);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9980, background: "rgba(0,0,0,0.52)",
      display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(380px,94vw)", background: C.bg,
        border: `1px solid ${C.divider}`, borderRadius: 14,
        boxShadow: "0 20px 60px rgba(0,0,0,0.28)", padding: "20px 22px",
        fontFamily: NC_FONT_STACK,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>Log Today's Data</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {field("Steps",            steps,     setSteps,  "e.g. 7500")}
          {field("Heart Rate (bpm)", heartRate, setHR,     "e.g. 72")}
          {field("Sleep (hours)",    sleep,     setSleep,  "e.g. 7.5")}
          {field("Weight (lb)",      weight,    setWeight, "e.g. 174.5")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{
            height: 34, padding: "0 16px", borderRadius: 8,
            border: `1px solid ${C.divider}`, background: "none", color: C.muted,
            cursor: "pointer", fontSize: 12.5, fontFamily: NC_FONT_STACK,
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            height: 34, padding: "0 18px", borderRadius: 8,
            border: "none", background: C.accent, color: "#fff",
            cursor: "pointer", fontSize: 12.5, fontFamily: NC_FONT_STACK, fontWeight: 600,
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── HealthPage ────────────────────────────────────────────────────────────────
export function HealthPage({
  T, C,
  healthData,
  healthConfig,
  healthHistory,
  onClose,
  onSaveHealthData,
  onSyncNow,
  topOffset = 0,
  sidebarW = 0,
  userId = "",
  getAuthToken,
  healthCardVisible = true,
  onSetHealthCardVisible,
}) {
  const [period, setPeriod]           = useState("week");
  const [showConnect, setShowConnect] = useState(false);
  const [showManual, setShowManual]   = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError]     = useState(null);

  const config  = healthConfig || {};
  const goals   = config.goals  || {};
  const today   = healthData    || {};
  const history = (healthHistory && healthHistory.length > 0) ? healthHistory : null;
  const connected = config.oauthType === "google" || config.fitbitLinked || config.googleFitLinked;
  const hasData   = !!history || (!!today.source && today.source !== "demo");
  const isDemo    = !connected && !hasData;
  const isConnectedNoData = connected && !hasData;

  const periodHistory = useMemo(() => {
    const src = history || (period === "year" ? DEMO_YEAR : period === "month" ? DEMO_MONTH : DEMO_WEEK);
    if (period === "day")   return DEMO_DAY;
    if (period === "week")  return src.slice(-7);
    if (period === "month") return src.slice(-30);
    if (period === "year")  return src.slice(-52);
    return src;
  }, [period, history]);

  const todayRow = useMemo(() => {
    const todayDate = new Date().toISOString().slice(0, 10);
    return (history || []).find(d => d.date === todayDate) || today || DEMO_DAY[0];
  }, [history, today]);

  async function handleSync() {
    if (!onSyncNow) return;
    setSyncing(true);
    try { await onSyncNow(); } catch {}
    setSyncing(false);
  }

  const sourceLabel = config.oauthType === "google" ? "Google Health"
    : config.fitbitLinked    ? "Fitbit"
    : config.googleFitLinked ? "Google Fit"
    : isDemo                 ? "Demo data"
    : "Manual";

  return (
    <div style={{
      position: "fixed",
      inset: `${topOffset}px 0 0 ${sidebarW}px`,
      zIndex: 7700,
      background: C.bg,
      display: "flex", flexDirection: "column",
      fontFamily: NC_FONT_STACK,
      overflow: "hidden",
      borderLeft: `1px solid ${C.divider}`,
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 22px", height: 60, flexShrink: 0,
        borderBottom: `1px solid ${C.divider}`,
        background: C.bg,
      }}>
        <button onClick={onClose} style={{
          width: 32, height: 32, borderRadius: "50%", border: "none",
          background: C.hover || "transparent", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.muted, flexShrink: 0,
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 22, color: "#EA4335" }}>favorite</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>Health</div>
            <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: connected ? "#34A853" : C.faint, flexShrink: 0 }} />
              {sourceLabel}
              {isDemo && " · connect a source to see live data"}
            </div>
          </div>
        </div>

        {/* Period tabs */}
        <div style={{
          display: "flex", gap: 2, background: C.bgSoft || C.hover,
          borderRadius: 20, padding: 3,
        }}>
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)} style={{
              height: 28, padding: "0 12px", borderRadius: 17, border: "none",
              background: period === p.id ? C.bg : "transparent",
              color: period === p.id ? C.text : C.muted,
              cursor: "pointer", fontSize: 12, fontFamily: NC_FONT_STACK, fontWeight: 500,
              boxShadow: period === p.id ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
              transition: "all 0.15s",
            }}>{p.label}</button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setShowManual(true)} title="Log data manually" style={{
            height: 32, padding: "0 12px", borderRadius: 16,
            border: `1px solid ${C.divider}`, background: C.bg, color: C.text,
            cursor: "pointer", fontSize: 12, fontFamily: NC_FONT_STACK, fontWeight: 500,
            display: "flex", alignItems: "center", gap: 5,
          }}>
            {suiteIcon("edit", 13)} Log
          </button>
          {connected && (
            <button onClick={handleSync} disabled={syncing} title="Sync now" style={{
              height: 32, padding: "0 12px", borderRadius: 16,
              border: `1px solid ${C.divider}`, background: C.bg, color: C.text,
              cursor: syncing ? "wait" : "pointer", fontSize: 12, fontFamily: NC_FONT_STACK, fontWeight: 500,
              display: "flex", alignItems: "center", gap: 5, opacity: syncing ? 0.6 : 1,
            }}>
              {suiteIcon(syncing ? "hourglass_top" : "sync", 13)} {syncing ? "Syncing…" : "Sync"}
            </button>
          )}
          <button onClick={() => setShowConnect(true)} style={{
            height: 32, padding: "0 14px", borderRadius: 16,
            border: "none", background: C.accent, color: "#fff",
            cursor: "pointer", fontSize: 12, fontFamily: NC_FONT_STACK, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 5,
          }}>
            {suiteIcon(connected ? "manage_accounts" : "link", 13)}
            {connected ? "Manage" : "Connect"}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{
        flex: 1, overflowY: "auto", overscrollBehavior: "contain",
        padding: "20px clamp(16px,3vw,32px) 28px",
      }}>
        {/* Demo notice — informational only; Connect lives in the header */}
        {isDemo && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 10, marginBottom: 18,
            background: `${C.accent}10`, border: `1px solid ${C.accent}30`,
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, color: C.accent }}>info</span>
            <span style={{ fontSize: 12, color: C.text, fontFamily: NC_FONT_STACK }}>
              Showing demo data. Use <strong>Connect</strong> above to link Google Health.
            </span>
          </div>
        )}

        {/* Connected but no data synced yet */}
        {isConnectedNoData && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 10, marginBottom: 18,
            background: `${C.success || "#34A853"}10`, border: `1px solid ${C.success || "#34A853"}30`,
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, color: C.success || "#34A853" }}>check_circle</span>
            <span style={{ fontSize: 12, color: C.text, fontFamily: NC_FONT_STACK }}>
              Google Health connected — hit <strong>Sync</strong> to pull your first data.
            </span>
            <button onClick={handleSync} disabled={syncing} style={{
              marginLeft: "auto", flexShrink: 0, height: 28, padding: "0 12px",
              borderRadius: 14, border: `1px solid ${C.success || "#34A853"}`, background: "none",
              color: C.success || "#34A853", cursor: syncing ? "wait" : "pointer",
              fontSize: 11.5, fontFamily: NC_FONT_STACK, fontWeight: 600, opacity: syncing ? 0.6 : 1,
            }}>{syncing ? "Syncing…" : "Sync now"}</button>
          </div>
        )}

        {/* Today's summary row — only show when period = day */}
        {period === "day" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            marginBottom: 20,
          }}>
            {Object.keys(M).map(key => {
              const m = M[key];
              const val = todayRow[key];
              const goal = m.goal || goals[key];
              const hasGoal = !!goal;
              const pct = hasGoal ? Math.min(100, Math.round((val || 0) / goal * 100)) : null;
              return (
                <div key={key} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: `${m.color}10`, borderRadius: 10, padding: "8px 14px",
                  border: `1px solid ${m.color}28`, flex: 1, minWidth: 130,
                }}>
                  <div style={{ position: "relative", width: 42, height: 42, flexShrink: 0 }}>
                    <svg width={42} height={42} viewBox="0 0 42 42" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx={21} cy={21} r={17} fill="none" stroke={`${m.color}20`} strokeWidth={4} />
                      {hasGoal && val && (
                        <circle cx={21} cy={21} r={17} fill="none" stroke={m.color} strokeWidth={4}
                          strokeDasharray={`${2 * Math.PI * 17 * Math.min(1, (val || 0) / goal)} ${2 * Math.PI * 17}`}
                          strokeLinecap="round"
                        />
                      )}
                    </svg>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 14, color: m.color }}>{m.icon}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: m.color, fontFamily: NC_FONT_STACK, lineHeight: 1.2 }}>
                      {fmtVal(key, val ?? (isDemo ? DEMO_DAY[0][key] : null))}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.muted, fontFamily: NC_FONT_STACK }}>
                      {m.label}{pct !== null ? ` · ${pct}%` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 4 metric cards grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 14,
        }}>
          {Object.keys(M).map(key => (
            <MetricCard
              key={key}
              metricKey={key}
              values={periodHistory.map(d => ({
                date: d.date || d.label || "",
                [key]: d[key] !== undefined ? d[key] : null,
              }))}
              todayVal={todayRow[key] ?? (isDemo ? DEMO_DAY[0][key] : null)}
              period={period}
              C={C}
            />
          ))}
        </div>

        {/* Setup instructions — only when not connected */}
        {!connected && (
          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: 1, textTransform: "uppercase", fontFamily: NC_FONT_STACK, marginBottom: 12 }}>
              Setup Guide
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SetupStep num={1} color="#4285F4" title="Enable Google Health API (one-time)"
                C={C} steps={[
                  "Go to console.cloud.google.com and open (or create) your project",
                  'Go to APIs & Services → Library, search for "Google Health API", and click Enable',
                  'Go to APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID (Web application)',
                  'Add authorized redirect URI: https://onetaskfocuser.netlify.app/health-callback',
                  "Copy the Client ID and Client Secret",
                  "In Netlify dashboard → Site configuration → Environment variables, add GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET",
                  "Trigger a new Netlify deploy after setting the env vars",
                ]}
              />
              <SetupStep num={2} color="#EA4335" title="Connect your Google account"
                C={C} steps={[
                  'Click the "Connect" button above',
                  "Sign in with the Google account linked to your Wear OS / health data",
                  "Grant the requested health permissions",
                  "You'll be redirected back here automatically",
                  'Hit "Sync" to pull your first data',
                ]}
              />
            </div>
          </div>
        )}

        {/* NerveCenter card toggle */}
        {onSetHealthCardVisible && (
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.divider}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK }}>Show on NerveCenter</div>
              <div style={{ fontSize: 11.5, color: C.muted, fontFamily: NC_FONT_STACK, marginTop: 2 }}>Display a compact health strip in the NerveCenter dashboard</div>
            </div>
            <button
              onClick={() => onSetHealthCardVisible(!healthCardVisible)}
              style={{
                width: 42, height: 24, borderRadius: 12, border: "none",
                background: healthCardVisible ? C.accent : C.divider,
                cursor: "pointer", padding: 0, position: "relative", flexShrink: 0,
                transition: "background 0.2s",
              }}
            >
              <span style={{
                position: "absolute", top: 3, left: healthCardVisible ? 21 : 3,
                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                transition: "left 0.2s",
              }} />
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showConnect && (
        <ConnectModal
          C={C}
          onClose={() => { setShowConnect(false); setConnectError(null); }}
          googleHealthLinked={config.oauthType === "google"}
          connectLoading={connectLoading}
          connectError={connectError}
          onStartGoogleHealth={async () => {
            setConnectLoading(true);
            setConnectError(null);
            const dlog = (msg, data) => fetch("/api/debug-log", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source: "fe:connect", msg, data }),
            }).catch(() => {});
            dlog("Connect clicked", { userId });
            try {
              const token = getAuthToken ? await getAuthToken() : null;
              if (!token) {
                setConnectError("Sign in again before connecting Google Health.");
                setConnectLoading(false);
                return;
              }
              const r    = await fetch(`/api/google-health?action=authorize-url`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = await r.json();
              dlog(`authorize-url response status ${r.status}`, { status: r.status, hasUrl: !!data.url, error: data.error, urlPrefix: data.url?.slice(0, 120) });
              if (!r.ok || !data.url) {
                setConnectError(data.error || "Could not start Google Health authorization.");
                setConnectLoading(false);
                return;
              }
              dlog("redirecting to Google", { urlPrefix: data.url.slice(0, 120) });
              window.location.href = data.url;
            } catch (err) {
              dlog("authorize-url fetch threw", { err: String(err) });
              setConnectError("Network error — check that the app is deployed.");
              setConnectLoading(false);
            }
          }}
        />
      )}
      {showManual && (
        <ManualEntryModal
          C={C}
          onClose={() => setShowManual(false)}
          onSave={data => onSaveHealthData && onSaveHealthData(data)}
        />
      )}
    </div>
  );
}

// ── SetupStep helper ──────────────────────────────────────────────────────────
function SetupStep({ num, color, title, steps, C }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      border: `1px solid ${C.divider}`, borderRadius: 10, overflow: "hidden",
    }}>
      <button onClick={() => setOpen(v => !v)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "11px 14px", border: "none", background: "none", cursor: "pointer",
        textAlign: "left",
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: "50%", background: `${color}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, fontSize: 11, fontWeight: 700, color, fontFamily: NC_FONT_STACK,
        }}>{num}</div>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: C.text, fontFamily: NC_FONT_STACK }}>{title}</span>
        <span className="material-symbols-rounded" style={{ fontSize: 16, color: C.faint }}>
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px 46px", borderTop: `1px solid ${C.divider}` }}>
          <ol style={{ margin: "10px 0 0", padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 5 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ fontSize: 12, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.55 }}>{s}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
