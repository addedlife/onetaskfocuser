import { useEffect, useState } from 'react';
import { FilledButton, OutlinedButton, OutlinedTextField, FilterChip, Tabs, PrimaryTab } from '@/m3';
import { useData } from '@/state/data';
import { useUi, type FocusTab } from '@/state/store';
import { optTasks } from '@/lib/optimize';
import { gP } from '@/lib/priorities';
import { isTaskAged, ageLabel } from '@/lib/aging';
import { QueueTab } from '@/features/focus/QueueTab';
import { InsightsTab } from '@/features/focus/InsightsTab';
import { readableOn, SP, ELEV } from '@/theme';
import type { EnergyLevel } from '@/lib/types';

/**
 * Focus — the signature "one task at a time" card. Shows the top of the smart-sorted queue (optTasks)
 * on a priority-colored hero card with contrast-safe text, a Done + Park action pair, the priority
 * circles, and an inline add box with energy tags. (Zen, Shatter, hamburger, PostIt stack come later.)
 */
function FocusCard() {
  const tasks = useData((s) => s.tasks);
  const priorities = useData((s) => s.priorities);
  const addTask = useData((s) => s.addTask);
  const completeTask = useData((s) => s.completeTask);
  const parkTask = useData((s) => s.parkTask);

  // Keep the clock + age labels fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  const [selPri, setSelPri] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [energy, setEnergy] = useState<EnergyLevel | undefined>(undefined);

  const now = Date.now();
  const active = tasks.filter(
    (t) => !t.completed && !t.blocked && !(t.snoozedUntil && t.snoozedUntil > now),
  );
  const current = optTasks(active, priorities)[0] ?? null;
  const doneCount = tasks.filter((t) => t.completed).length;
  const activePris = priorities.filter((p) => !p.deleted);

  const submit = () => {
    if (!selPri || !text.trim()) return;
    addTask(text, selPri, energy);
    setText('');
    setEnergy(undefined);
    setSelPri(null);
  };

  const cardColor = current ? gP(priorities, current.priority).color : '#FFFFFF';
  const onCard = readableOn(cardColor);
  const clock = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SP.lg,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          color: 'var(--shp-color-muted)',
          fontSize: 14,
        }}
      >
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{clock}</span>
        <span>{doneCount} done</span>
      </div>

      {current ? (
        <div
          style={{
            background: cardColor,
            color: onCard,
            borderRadius: 'var(--shp-radius-xl)',
            padding: '40px 28px',
            minHeight: 200,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            boxShadow: ELEV[3],
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 16,
              opacity: 0.85,
              fontSize: 12,
              fontWeight: 600,
              flexWrap: 'wrap',
              letterSpacing: 0.3,
            }}
          >
            <span>{gP(priorities, current.priority).label.toUpperCase()}</span>
            {isTaskAged(current, priorities) && <span>· {ageLabel(current.createdAt)}</span>}
            {current.parentTask && <span>· part of “{current.parentTask}”</span>}
            {current.energy && (
              <span>· {current.energy === 'high' ? '⚡ high energy' : '🌊 low energy'}</span>
            )}
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25 }}>{current.text}</div>
        </div>
      ) : (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 28px',
            border: '1px dashed var(--shp-color-divider)',
            borderRadius: 'var(--shp-radius-xl)',
          }}
        >
          <div style={{ fontSize: 40 }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>All clear</div>
          <div style={{ color: 'var(--shp-color-muted)', marginTop: 4 }}>
            Nothing waiting right now. Add something below.
          </div>
        </div>
      )}

      {current && (
        <div style={{ display: 'flex', gap: SP.sm, justifyContent: 'center' }}>
          <FilledButton onClick={() => completeTask(current.id)}>
            <span>Done</span>
          </FilledButton>
          <OutlinedButton onClick={() => parkTask(current.id)}>
            <span>Park till tomorrow</span>
          </OutlinedButton>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: SP.md,
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginTop: SP.sm,
        }}
      >
        {activePris.map((p) => {
          const sel = selPri === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setSelPri(sel ? null : p.id)}
              title={`Add a ${p.label} task`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: p.color,
                  boxShadow: sel ? `0 0 0 3px var(--shp-color-card), 0 0 0 6px ${p.color}` : 'none',
                  transition: 'box-shadow .15s',
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: sel ? 'var(--shp-color-text)' : 'var(--shp-color-muted)',
                  fontWeight: sel ? 600 : 500,
                }}
              >
                {p.label}
              </span>
            </button>
          );
        })}
      </div>

      {selPri && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: SP.sm,
            padding: SP.md,
            border: '1px solid var(--shp-color-divider)',
            borderRadius: 'var(--shp-radius-lg)',
            background: 'var(--shp-color-card)',
          }}
        >
          <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center' }}>
            <OutlinedTextField
              label={`New ${gP(priorities, selPri).label} task`}
              value={text}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              style={{ flex: 1 }}
            />
            <FilledButton onClick={submit}>
              <span>Add</span>
            </FilledButton>
          </div>
          <div style={{ display: 'flex', gap: SP.xs }}>
            <FilterChip
              label="⚡ High energy"
              selected={energy === 'high'}
              onClick={() => setEnergy(energy === 'high' ? undefined : 'high')}
            />
            <FilterChip
              label="🌊 Low energy"
              selected={energy === 'low'}
              onClick={() => setEnergy(energy === 'low' ? undefined : 'low')}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const TAB_ORDER: FocusTab[] = ['focus', 'queue', 'insights'];

/**
 * Focus surface shell — hosts the genuine M3 `md-tabs` switch (focus / queue / insights) wired to the
 * UI store's `tab` slice. The Focus tab is the live one-task card; Queue and Insights are honest
 * placeholders until their phases (4.5 / 4.6), which build on their own ANALYSIS specs.
 */
export function FocusSurface() {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: SP.xl,
        display: 'flex',
        flexDirection: 'column',
        gap: SP.lg,
      }}
    >
      <Tabs
        activeTabIndex={TAB_ORDER.indexOf(tab)}
        onChange={(e: Event) => {
          const idx = (e.target as unknown as { activeTabIndex: number }).activeTabIndex;
          const next = TAB_ORDER[idx];
          if (next) setTab(next);
        }}
      >
        <PrimaryTab>
          <span>Focus</span>
        </PrimaryTab>
        <PrimaryTab>
          <span>Queue</span>
        </PrimaryTab>
        <PrimaryTab>
          <span>Insights</span>
        </PrimaryTab>
      </Tabs>

      {tab === 'focus' ? (
        <FocusCard />
      ) : tab === 'queue' ? (
        <QueueTab />
      ) : (
        <InsightsTab />
      )}
    </div>
  );
}
