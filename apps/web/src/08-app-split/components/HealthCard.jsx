import React from 'react';
import { NC_FONT_STACK, NC_TYPE } from '../ui-tokens.jsx';

// Demo data — used only when no real health history is present
const DEMO_HR_SERIES = [
  58,57,56,55,54,56,62,68,74,78,80,82,79,77,80,83,78,75,73,70,68,65,62,60
];
const DEMO = { steps: 6234, stepsMAvg: 7841, stepsYAvg: 8102, sleep: 7.38, sleepMAvg: 7.75, sleepYAvg: 7.5, weight: 175.2, weightMAvg: 174.8, weightYAvg: 173.5 };

function formatSleep(val) {
  if (!val && val !== 0) return "—";
  const h = Math.floor(val);
  const m = Math.round((val % 1) * 60);
  return `${h}h ${m < 10 ? "0" : ""}${m}m`;
}

function avgField(records, field) {
  const vals = (records || []).map(r => r[field]).filter(v => v != null && Number.isFinite(v));
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

// Muted small HR line graph
function HRLine({ series, color, height = 38 }) {
  const pts = (series || []).filter(v => v != null && Number.isFinite(v));
  if (pts.length < 2) return <div style={{ height }} />;
  const min = Math.min(...pts) - 3;
  const max = Math.max(...pts) + 3;
  const range = max - min || 1;
  const w = 110;
  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const low  = Math.round(Math.min(...pts));
  const high = Math.round(Math.max(...pts));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: "block", overflow: "visible" }}>
        <polyline points={coords} fill="none" stroke={color} strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: NC_FONT_STACK, fontSize: 9, opacity: 0.45 }}>
        <span>{low}</span><span style={{ opacity: 0.5 }}>bpm</span><span>{high}</span>
      </div>
    </div>
  );
}

// Each metric section: label row + value rows
function MetricSection({ label, rows, C }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: C.faint, fontFamily: NC_FONT_STACK, lineHeight: 1 }}>{label}</span>
      {rows.map(([period, val], i) => (
        <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 9.5, color: C.faint, fontFamily: NC_FONT_STACK, minWidth: 10, lineHeight: 1.5 }}>{period}</span>
          <span style={{ fontSize: 12.5, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? C.text : C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.4, whiteSpace: "nowrap" }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

export function HealthCard({
  C,
  healthData,
  healthHistory,
  healthConfig,
  onOpenHealth,
  onDismiss,
  cardHeight = 92,
  onResizeStart,
}) {
  const today   = new Date().toISOString().slice(0, 10);
  const thisM   = today.slice(0, 7);
  const thisY   = today.slice(0, 4);
  const data    = healthData || {};
  const hist    = healthHistory || [];
  const mRecs   = hist.filter(r => r.date?.startsWith(thisM));
  const yRecs   = hist.filter(r => r.date?.startsWith(thisY));
  const connected = !!(healthConfig?.oauthType || healthConfig?.fitbitLinked);
  const isDemo  = !connected && !hist.length && !data.source;

  const stepsD    = data.steps        ?? (isDemo ? DEMO.steps     : null);
  const stepsMAvg = avgField(mRecs, "steps") ?? (isDemo ? DEMO.stepsMAvg : null);
  const stepsYAvg = avgField(yRecs, "steps") ?? (isDemo ? DEMO.stepsYAvg : null);

  const sleepD    = data.sleep        ?? (isDemo ? DEMO.sleep     : null);
  const sleepMAvg = avgField(mRecs, "sleep") ?? (isDemo ? DEMO.sleepMAvg : null);
  const sleepYAvg = avgField(yRecs, "sleep") ?? (isDemo ? DEMO.sleepYAvg : null);

  const weightD    = data.weight       ?? (isDemo ? DEMO.weight    : null);
  const weightMAvg = avgField(mRecs, "weight") ?? (isDemo ? DEMO.weightMAvg : null);
  const weightYAvg = avgField(yRecs, "weight") ?? (isDemo ? DEMO.weightYAvg : null);

  const hrSeries = data.hrSeries ?? (isDemo ? DEMO_HR_SERIES : null);
  const hrNow    = data.heartRate ?? (isDemo ? 72 : null);

  const fmtSteps = v => v != null ? Math.round(v).toLocaleString() : "—";
  const fmtWeight = v => v != null ? `${(+v).toFixed(1)} lb` : "—";
  const lineColor = C.muted || "#999";

  return (
    <div style={{ display: "flex", flexDirection: "column", background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>

      {/* Drag handle — grab this top bar to resize */}
      <div
        onPointerDown={onResizeStart}
        title="Drag to resize"
        style={{ height: 8, cursor: "row-resize", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, touchAction: "none" }}
      >
        <span style={{ width: 36, height: 2, borderRadius: 2, background: C.divider, opacity: 0.6 }} />
      </div>

      {/* Content row */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", alignItems: "flex-start", gap: 0, padding: "0 14px 10px" }}>

        {/* Label + status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 56, flexShrink: 0, paddingRight: 14, borderRight: `1px solid ${C.divider}`, marginRight: 14, paddingTop: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, fontFamily: NC_FONT_STACK, letterSpacing: 0.3 }}>Health</span>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: connected ? "#34A853" : C.faint, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: C.faint, fontFamily: NC_FONT_STACK, lineHeight: 1.3 }}>
              {connected ? (healthConfig?.oauthType === "google" ? "google" : data.source || "live") : "demo"}
            </span>
          </div>
          <button
            onClick={onOpenHealth}
            style={{ marginTop: 4, fontSize: 9.5, color: C.muted, background: "none", border: `1px solid ${C.divider}`, borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontFamily: NC_FONT_STACK, fontWeight: 500, whiteSpace: "nowrap", lineHeight: 1.4 }}
          >
            Open ↗
          </button>
        </div>

        {/* Steps */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
          <MetricSection label="Steps" C={C} rows={[
            ["D", fmtSteps(stepsD)],
            ["M", fmtSteps(stepsMAvg)],
            ["Y", fmtSteps(stepsYAvg)],
          ]} />
        </div>

        {/* Divider */}
        <div style={{ width: 1, alignSelf: "stretch", background: C.divider, flexShrink: 0, marginRight: 12 }} />

        {/* Sleep */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
          <MetricSection label="Sleep" C={C} rows={[
            ["D", formatSleep(sleepD)],
            ["M", formatSleep(sleepMAvg)],
            ["Y", formatSleep(sleepYAvg)],
          ]} />
        </div>

        {/* Divider */}
        <div style={{ width: 1, alignSelf: "stretch", background: C.divider, flexShrink: 0, marginRight: 12 }} />

        {/* Weight */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
          <MetricSection label="Weight" C={C} rows={[
            ["D", fmtWeight(weightD)],
            ["M", fmtWeight(weightMAvg)],
            ["Y", fmtWeight(weightYAvg)],
          ]} />
        </div>

        {/* Divider */}
        <div style={{ width: 1, alignSelf: "stretch", background: C.divider, flexShrink: 0, marginRight: 12 }} />

        {/* Heart Rate — line graph */}
        <div style={{ flex: 1.4, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: C.faint, fontFamily: NC_FONT_STACK, lineHeight: 1 }}>
            Pulse{hrNow != null ? ` · ${hrNow} bpm` : ""}
          </span>
          <div style={{ marginTop: 2 }}>
            <HRLine series={hrSeries} color={lineColor} height={Math.max(28, cardHeight - 52)} />
          </div>
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          title="Hide health card"
          style={{ marginLeft: 8, alignSelf: "flex-start", marginTop: 1, width: 18, height: 18, borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, padding: 0, flexShrink: 0, fontSize: 14, lineHeight: 1 }}
        >×</button>
      </div>
    </div>
  );
}
