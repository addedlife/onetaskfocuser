import { useMemo } from 'react';
import { IconBtn } from '@/m3';
import { useData } from '@/state/data';
import { optTasks } from '@/lib/optimize';
import { fmtMs } from '@/lib/dates';
import { readableOn, SP, ELEV } from '@/theme';

/**
 * Task River (Phase 6 sibling) — the playful view: active tasks flow in horizontal lanes by priority tier,
 * each card tinted its tier colour with contrast-safe ink and a one-tap Done. Faithful to Pro 4's
 * `TaskRiverPanel` lane model; the river is just another lens on the same store, so it stays live.
 */
export function TaskRiverSurface() {
  const tasks = useData((s) => s.tasks);
  const priorities = useData((s) => s.priorities);
  const completeTask = useData((s) => s.completeTask);

  const now = Date.now();
  const lanes = useMemo(() => {
    const active = tasks.filter(
      (t) => !t.completed && !t.blocked && !(t.snoozedUntil && t.snoozedUntil > now),
    );
    return priorities
      .filter((p) => !p.deleted)
      .sort((a, b) => b.weight - a.weight)
      .map((pri) => ({ pri, items: optTasks(active.filter((t) => t.priority === pri.id), priorities) }));
  }, [tasks, priorities, now]);

  const inMotion = lanes.reduce((n, l) => n + l.items.length, 0);

  return (
    <div style={{ padding: SP.xxl, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: SP.lg }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Task River</h1>
        <p style={{ color: 'var(--shp-color-muted)', marginTop: SP.xs }}>
          Your tasks, flowing by priority — {inMotion} in motion.
        </p>
      </div>

      {lanes.map(({ pri, items }) => (
        <div key={pri.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SP.sm }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: pri.color }} />
            <span style={{ fontWeight: 600 }}>{pri.label}</span>
            <span style={{ color: 'var(--shp-color-muted)', fontSize: 12 }}>{items.length}</span>
          </div>
          {items.length === 0 ? (
            <div style={{ color: 'var(--shp-color-muted)', fontSize: 13, fontStyle: 'italic', padding: '4px 0' }}>
              calm waters
            </div>
          ) : (
            <div style={{ display: 'flex', gap: SP.sm, overflowX: 'auto', paddingBottom: SP.sm }}>
              {items.map((t) => {
                const ink = readableOn(pri.color);
                return (
                  <div
                    key={t.id}
                    style={{
                      flex: '0 0 auto',
                      width: 184,
                      minHeight: 92,
                      background: pri.color,
                      color: ink,
                      borderRadius: 'var(--shp-radius-md)',
                      padding: SP.md,
                      boxShadow: ELEV[1],
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, flex: 1 }}>{t.text}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, opacity: 0.85 }}>{fmtMs(now - t.createdAt)}</span>
                      <IconBtn icon="check" iconSize={16} size={28} color={ink} title="Done" onClick={() => completeTask(t.id)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
