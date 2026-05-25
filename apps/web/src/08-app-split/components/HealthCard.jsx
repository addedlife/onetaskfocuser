import React from 'react';
import { NC_FONT_STACK, NC_TYPE, suiteIcon } from '../ui-tokens.jsx';

// Google Health-style color palette
const METRIC_COLOR = {
  steps:     "#4285F4",
  heartRate: "#EA4335",
  sleep:     "#7C3AED",
  weight:    "#00897B",
};

function formatSleep(val) {
  if (val === null || val === undefined) return "—";
  const h = Math.floor(val);
  const m = Math.round((val % 1) * 60);
  return `${h}h ${m < 10 ? "0" : ""}${m}m`;
}

function MetricArc({ value, goal, color, size = 64, sw = 5.5 }) {
  const bg = `${color}20`;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct = goal && value ? Math.min(1, value / goal) : 0;
  const dash = circ * pct;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)", display: "block", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={sw} />
      {pct > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1.1s cubic-bezier(0.4,0,0.2,1)" }}
        />
      )}
    </svg>
  );
}

function MetricSolid({ color, size = 64 }) {
  const bg = `${color}1A`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 3} fill={bg} />
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 3} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.35} />
    </svg>
  );
}

function MetricCell({ label, icon, color, display, value, goal, useRing }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
      flex: 1, minWidth: 0, padding: "0 4px",
    }}>
      <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
        {useRing
          ? <MetricArc value={value} goal={goal} color={color} />
          : <MetricSolid color={color} />
        }
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>
          <span className="material-symbols-rounded"
            style={{ fontSize: 18, color, lineHeight: 1 }}>{icon}</span>
        </div>
      </div>
      <span style={{
        fontSize: 13, fontWeight: 700, color, fontFamily: NC_FONT_STACK,
        lineHeight: 1.15, textAlign: "center", whiteSpace: "nowrap",
        overflow: "hidden", maxWidth: "100%", textOverflow: "ellipsis",
      }}>{display}</span>
      <span style={{
        fontSize: 10, color: "#888", fontFamily: NC_FONT_STACK,
        textAlign: "center", lineHeight: 1.2,
      }}>{label}</span>
    </div>
  );
}

export function HealthCard({ T, C, healthData, healthConfig, onOpenHealth, onDismiss }) {
  const data = healthData || {};
  const config = healthConfig || {};
  const goals = config.goals || {};
  const isDemo = !healthData || data.source === "demo" || !data.source;
  const connected = !isDemo;

  const statusDot = connected ? "#34A853" : C.faint || "#aaa";
  const statusLabel = connected
    ? `Synced · ${data.source === "fitbit" ? "Fitbit" : data.source === "googlefit" ? "Google Fit" : "Manual"}`
    : "Demo — tap Open to connect";

  const stepsVal  = data.steps     ?? (isDemo ? 6234  : null);
  const hrVal     = data.heartRate ?? (isDemo ? 72    : null);
  const sleepVal  = data.sleep     ?? (isDemo ? 7.38  : null);
  const weightVal = data.weight    ?? (isDemo ? 175.2 : null);

  const stepsGoal  = goals.steps || 10000;
  const sleepGoal  = goals.sleep || 8;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 16px",
      background: C.bg,
      border: `1px solid ${C.divider}`,
      borderRadius: 10,
      flexShrink: 0,
    }}>
      {/* Left: title + status */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 72, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 14, color: METRIC_COLOR.heartRate }}>favorite</span>
          <span style={{ fontSize: NC_TYPE.label || 12, fontWeight: 700, fontFamily: NC_FONT_STACK, color: C.text }}>Health</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusDot, flexShrink: 0 }} />
          <span style={{ fontSize: 9.5, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.2 }}>{statusLabel}</span>
        </div>
      </div>

      {/* Middle: 4 metric rings */}
      <div style={{ flex: 1, display: "flex", justifyContent: "space-evenly", alignItems: "flex-start", minWidth: 0, gap: 4 }}>
        <MetricCell
          label="Steps" icon="directions_walk" color={METRIC_COLOR.steps}
          value={stepsVal} goal={stepsGoal} useRing display={stepsVal !== null ? Number(stepsVal).toLocaleString() : "—"}
        />
        <MetricCell
          label="Heart" icon="favorite" color={METRIC_COLOR.heartRate}
          value={hrVal} goal={null} useRing={false} display={hrVal !== null ? `${hrVal} bpm` : "—"}
        />
        <MetricCell
          label="Sleep" icon="bedtime" color={METRIC_COLOR.sleep}
          value={sleepVal} goal={sleepGoal} useRing display={formatSleep(sleepVal)}
        />
        <MetricCell
          label="Weight" icon="monitor_weight" color={METRIC_COLOR.weight}
          value={weightVal} goal={null} useRing={false} display={weightVal !== null ? `${weightVal} lb` : "—"}
        />
      </div>

      {/* Right: Open + Dismiss */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
        <button onClick={onOpenHealth} style={{
          height: 30, padding: "0 11px", borderRadius: 15,
          border: `1px solid ${C.divider}`,
          background: C.bgSoft || "transparent",
          color: C.text, cursor: "pointer",
          fontSize: 11.5, fontFamily: NC_FONT_STACK, fontWeight: 500,
          display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
        }}>
          {suiteIcon("open_in_full", 11)} Open
        </button>
        <button onClick={onDismiss} title="Dismiss health card" style={{
          width: 22, height: 22, borderRadius: "50%", border: "none",
          background: "transparent", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.faint, padding: 0, flexShrink: 0,
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
        </button>
      </div>
    </div>
  );
}
