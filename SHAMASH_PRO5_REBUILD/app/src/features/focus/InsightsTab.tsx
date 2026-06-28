import { useMemo } from 'react';
import { Divider } from '@/m3';
import { useData } from '@/state/data';
import { SP } from '@/theme';

// Rotating ADHD-friendly daily tips (faithful to Pro 4's "daily tip").
const TIPS = [
  'Pick the smallest next step — momentum beats motivation.',
  'Two-minute rule: if it takes under two minutes, do it now.',
  'Park, don’t drop. Snooze a task instead of carrying the guilt.',
  'One task on screen. The queue can wait its turn.',
  'Done is a number you can grow. Aim for one more.',
  'Energy first: match the task to how you feel right now.',
  'Name the resistance — often the block is just the first sentence.',
];

const DAY = 86_400_000;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 96,
        padding: SP.md,
        borderRadius: 'var(--shp-radius-lg)',
        background: 'var(--shp-color-card)',
        border: '1px solid var(--shp-color-divider)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--shp-color-muted)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

const cardStyle = {
  padding: SP.md,
  borderRadius: 'var(--shp-radius-lg)',
  background: 'var(--shp-color-card)',
  border: '1px solid var(--shp-color-divider)',
};

/**
 * Insights tab (Phase 4.6 core) — completion stats + a 7-day bar chart + the daily tip, all driven by the
 * real `completedAt` timestamps. The AI insight + AI chat are honestly deferred to the backend (Phase 11):
 * the `services/ai` gateway is wired but stays dark in dev so no real AI call is ever made without the proxy.
 */
export function InsightsTab() {
  const tasks = useData((s) => s.tasks);

  const { doneToday, doneWeek, allTime, week } = useMemo(() => {
    const t0 = startOfToday();
    const completed = tasks.filter((t) => t.completed);
    const timed = completed.filter((t): t is typeof t & { completedAt: number } => typeof t.completedAt === 'number');
    const days = Array.from({ length: 7 }, (_, i) => {
      const start = t0 - (6 - i) * DAY;
      const end = start + DAY;
      return {
        label: new Date(start).toLocaleDateString([], { weekday: 'short' }),
        count: timed.filter((t) => t.completedAt >= start && t.completedAt < end).length,
        isToday: i === 6,
      };
    });
    const weekStart = t0 - 6 * DAY;
    return {
      doneToday: timed.filter((t) => t.completedAt >= t0).length,
      doneWeek: timed.filter((t) => t.completedAt >= weekStart).length,
      allTime: completed.length,
      week: days,
    };
  }, [tasks]);

  const maxCount = Math.max(1, ...week.map((d) => d.count));
  const tip = TIPS[new Date().getDate() % TIPS.length];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.lg }}>
      {/* Stat tiles */}
      <div style={{ display: 'flex', gap: SP.sm }}>
        <StatTile value={doneToday} label="done today" />
        <StatTile value={doneWeek} label="this week" />
        <StatTile value={allTime} label="all time" />
      </div>

      {/* 7-day completion chart */}
      <div style={cardStyle}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--shp-color-muted)',
            marginBottom: SP.md,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Last 7 days
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: SP.sm, height: 120 }}>
          {week.map((d, i) => (
            <div
              key={i}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
            >
              <div style={{ fontSize: 11, color: 'var(--shp-color-muted)', minHeight: 14 }}>
                {d.count || ''}
              </div>
              <div
                style={{
                  width: '100%',
                  height: `${(d.count / maxCount) * 80}px`,
                  minHeight: d.count ? 4 : 2,
                  borderRadius: 'var(--shp-radius-sm)',
                  background: d.isToday ? 'var(--md-sys-color-primary)' : 'var(--shp-color-divider)',
                  transition: 'height .2s',
                }}
              />
              <div
                style={{
                  fontSize: 11,
                  color: d.isToday ? 'var(--shp-color-text)' : 'var(--shp-color-muted)',
                  fontWeight: d.isToday ? 600 : 400,
                }}
              >
                {d.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily tip */}
      <div style={{ ...cardStyle, display: 'flex', gap: SP.sm, alignItems: 'flex-start' }}>
        <span className="material-symbols-rounded" style={{ fontSize: 20, color: 'var(--md-sys-color-primary)' }}>
          lightbulb
        </span>
        <div>
          <div style={{ fontSize: 12, color: 'var(--shp-color-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Daily tip
          </div>
          <div style={{ marginTop: 2 }}>{tip}</div>
        </div>
      </div>

      {/* AI insight + chat — deferred to the backend phase */}
      <div>
        <Divider />
        <div style={{ padding: `${SP.md} 0`, color: 'var(--shp-color-muted)', fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--shp-color-text)' }}>AI insight &amp; chat</strong> — the
          “what should I focus on?” summary and the chat assistant arrive with the AI backend (Phase 11).
          The gateway (<code>services/ai.ts</code>) is wired and waiting; it stays dark until the proxy is
          live so dev never makes a real AI call.
        </div>
      </div>
    </div>
  );
}
