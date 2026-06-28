import { useMemo, type ReactNode } from 'react';
import { List, ListItem, denseListVars, IconBtn } from '@/m3';
import { useData } from '@/state/data';
import { useUi } from '@/state/store';
import { optTasks } from '@/lib/optimize';
import { gP } from '@/lib/priorities';
import { SP } from '@/theme';

/** A NerveCenter dashboard card — header (icon + title + count + optional open arrow) over a body. */
function Card({
  title,
  icon,
  accent,
  count,
  onOpen,
  children,
}: {
  title: string;
  icon: string;
  accent?: string;
  count?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--shp-color-card)',
        border: '1px solid var(--shp-color-divider)',
        borderRadius: 'var(--shp-radius-lg)',
        overflow: 'hidden',
        minHeight: 168,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: `${SP.md} ${SP.sm} ${SP.sm} ${SP.md}` }}>
        <span className="material-symbols-rounded" style={{ fontSize: 20, color: accent || 'var(--md-sys-color-primary)' }}>
          {icon}
        </span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          {count != null && <span style={{ fontSize: 12, color: 'var(--shp-color-muted)' }}>{count}</span>}
          {onOpen && (
            <IconBtn icon="arrow_forward" iconSize={18} size={32} title={`Open ${title}`} onClick={onOpen} />
          )}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </section>
  );
}

function EmptyState({ icon, label, sub }: { icon: string; label: string; sub?: string }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '24px 16px',
        textAlign: 'center',
        color: 'var(--shp-color-muted)',
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: 28, opacity: 0.6 }}>
        {icon}
      </span>
      <div style={{ fontSize: 13 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, opacity: 0.8 }}>{sub}</div>}
    </div>
  );
}

/**
 * NerveCenter (Phase 6) — the at-a-glance dashboard. Tasks + Shailos cards are live from the store; Mail,
 * Phone, Calendar, and Health are faithful cards in honest "needs integration" empty states until their
 * services land (Google/phone, Phases 6.3 / 7 / 8). Layout-switch (columns/accordion + density) + AI card
 * headlines come next.
 */
export function NerveCenterSurface() {
  const tasks = useData((s) => s.tasks);
  const priorities = useData((s) => s.priorities);
  const shailos = useData((s) => s.shailos);
  const setSuiteView = useUi((s) => s.setSuiteView);

  const now = Date.now();
  const active = useMemo(
    () =>
      optTasks(
        tasks.filter((t) => !t.completed && !t.blocked && !(t.snoozedUntil && t.snoozedUntil > now)),
        priorities,
      ),
    [tasks, priorities, now],
  );
  const topTasks = active.slice(0, 5);
  const pendingShailos = shailos.filter((q) => q.status !== 'got_back');
  const listStyle = denseListVars({ primary: 'var(--shp-color-text)', secondary: 'var(--shp-color-muted)' });

  return (
    <div style={{ padding: SP.xxl, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>NerveCenter</h1>
      <p style={{ color: 'var(--shp-color-muted)', marginTop: SP.xs }}>Everything that needs you, at a glance.</p>

      <div
        style={{
          marginTop: SP.lg,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: SP.md,
        }}
      >
        <Card title="Tasks" icon="task_alt" count={`${active.length} active`} onOpen={() => setSuiteView('focus')}>
          {topTasks.length === 0 ? (
            <EmptyState icon="check_circle" label="Queue is clear" />
          ) : (
            <List style={listStyle}>
              {topTasks.map((t) => {
                const pri = gP(priorities, t.priority);
                return (
                  <ListItem key={t.id}>
                    {t.text}
                    <span slot="supporting-text">{pri.label}</span>
                    <span slot="start" style={{ width: 10, height: 10, borderRadius: '50%', background: pri.color, flexShrink: 0 }} />
                  </ListItem>
                );
              })}
            </List>
          )}
        </Card>

        <Card
          title="Shailos"
          icon="help"
          accent="var(--shp-color-gold)"
          count={`${pendingShailos.length} open`}
          onOpen={() => setSuiteView('shailos')}
        >
          {pendingShailos.length === 0 ? (
            <EmptyState icon="done_all" label="No open shailos" />
          ) : (
            <List style={listStyle}>
              {pendingShailos.slice(0, 5).map((q) => (
                <ListItem key={q.id}>
                  {q.synopsis || q.content || 'Shaila'}
                  <span slot="supporting-text">{q.status === 'answered' ? 'reply owed' : 'pending'}</span>
                  <span slot="start" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--shp-color-gold)', flexShrink: 0 }} />
                </ListItem>
              ))}
            </List>
          )}
        </Card>

        <Card title="Calendar" icon="calendar_month">
          <EmptyState icon="event" label="Connect Google Calendar" sub="Timeline + agenda · Phase 6.3" />
        </Card>

        <Card title="Mail" icon="mail">
          <EmptyState icon="inbox" label="Connect Gmail" sub="Needs Google integration" />
        </Card>

        <Card title="Phone" icon="smartphone" onOpen={() => setSuiteView('deskphone')}>
          <EmptyState icon="call" label="Connect DeskPhone" sub="Host + relay · Phase 7" />
        </Card>

        <Card title="Health" icon="ecg_heart" onOpen={() => setSuiteView('health')}>
          <EmptyState icon="favorite" label="Connect Google Health" sub="Rings + metrics · Phase 8" />
        </Card>
      </div>
    </div>
  );
}
