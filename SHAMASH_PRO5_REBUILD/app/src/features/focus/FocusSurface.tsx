import { List, ListItem, denseListVars, IconBtn } from '@/m3';
import { useData } from '@/state/data';
import { MOCK_PRIORITIES } from '@/mock/seed';
import { SP } from '@/theme';

const PRI_COLOR: Record<string, string> = Object.fromEntries(
  MOCK_PRIORITIES.map((p) => [p.id, p.color]),
);
const PRI_ORDER: Record<string, number> = Object.fromEntries(
  MOCK_PRIORITIES.map((p) => [p.id, p.order]),
);

function ageLabel(createdAt: number): string {
  const h = Math.floor((Date.now() - createdAt) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d waiting`;
}

/**
 * Focus — interim queue-style task list (the one-task-at-a-time card view is Phase 4). Second real
 * surface: live tasks from the store on genuine md-list, sorted by priority then age, with a priority
 * color dot and a working "done" action.
 */
export function FocusSurface() {
  const tasks = useData((s) => s.tasks);
  const toggleDone = useData((s) => s.toggleDone);

  const open = tasks
    .filter((t) => !t.completedAt)
    .sort(
      (a, b) =>
        (PRI_ORDER[a.priorityId] ?? 9) - (PRI_ORDER[b.priorityId] ?? 9) || a.createdAt - b.createdAt,
    );

  return (
    <div style={{ padding: SP.xxl, maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Focus</h1>
      <p style={{ color: 'var(--shp-color-muted)', marginTop: SP.sm }}>
        {open.length} open {open.length === 1 ? 'task' : 'tasks'} — interim list; the one-task card view
        lands in Phase 4.
      </p>

      <div
        style={{
          marginTop: SP.lg,
          border: '1px solid var(--shp-color-divider)',
          borderRadius: 'var(--shp-radius-md)',
          overflow: 'hidden',
        }}
      >
        <List
          style={denseListVars({
            primary: 'var(--shp-color-text)',
            secondary: 'var(--shp-color-muted)',
          })}
        >
          {open.map((t) => (
            <ListItem key={t.id}>
              <span
                slot="start"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: PRI_COLOR[t.priorityId] ?? 'var(--shp-color-faint)',
                  display: 'inline-block',
                }}
              />
              {t.title}
              <span slot="supporting-text">
                {ageLabel(t.createdAt)}
                {t.blocked ? ' · blocked' : ''}
                {t.energy ? ` · ${t.energy === 'high' ? '⚡ high' : '🌊 low'}` : ''}
              </span>
              <span slot="end">
                <IconBtn
                  icon="check_circle"
                  iconSize={20}
                  color="var(--shp-color-success)"
                  title="Mark done"
                  onClick={() => toggleDone(t.id)}
                />
              </span>
            </ListItem>
          ))}
        </List>
      </div>
    </div>
  );
}
