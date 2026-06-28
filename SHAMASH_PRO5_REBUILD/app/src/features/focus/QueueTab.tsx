import { useMemo, useState } from 'react';
import {
  List,
  ListItem,
  OutlinedTextField,
  FilledButton,
  FilterChip,
  ChipSet,
  IconBtn,
  Divider,
  TextButton,
  denseListVars,
} from '@/m3';
import { useData } from '@/state/data';
import { optTasks } from '@/lib/optimize';
import { gP } from '@/lib/priorities';
import { ageLabel, isTaskAged } from '@/lib/aging';
import { SP } from '@/theme';
import type { Task, Priority } from '@/lib/types';

// Pro 4 defaults: overwhelmThreshold 7; opt-in focus mode shows the top 3.
const OVERWHELM_THRESHOLD = 7;
const FOCUS_LIMIT = 3;

/** One queue row — priority dot, text, age/energy meta, and inline Park + Done actions. */
function QueueRow({
  task,
  priorities,
  onDone,
  onPark,
}: {
  task: Task;
  priorities: Priority[];
  onDone: () => void;
  onPark: () => void;
}) {
  const pri = gP(priorities, task.priority);
  const meta = [
    pri.label,
    isTaskAged(task, priorities) ? ageLabel(task.createdAt) : null,
    task.energy ? (task.energy === 'high' ? '⚡ high' : '🌊 low') : null,
    task.parentTask ? `part of ${task.parentTask}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListItem>
      {task.text}
      <span slot="supporting-text">{meta}</span>
      <span
        slot="start"
        style={{ width: 12, height: 12, borderRadius: '50%', background: pri.color, flexShrink: 0 }}
      />
      <span slot="end" style={{ display: 'flex', gap: 2 }}>
        <IconBtn icon="bedtime" iconSize={18} size={36} title="Park till tomorrow" onClick={onPark} />
        <IconBtn icon="check_circle" iconSize={20} size={36} color={pri.color} title="Done" onClick={onDone} />
      </span>
    </ListItem>
  );
}

/**
 * Queue tab (Phase 4.5 core) — the full task list. Smart-sorted via `optTasks`, with search, a quick-add
 * bar (tier chips + text), the opt-in overwhelm "focus on top 3" toggle, and the completed Shelf.
 * Faithful to Pro 4's queue block in `App.jsx`; Shatter/subtask-group collapse arrives with Phase 4.4.
 */
export function QueueTab() {
  const tasks = useData((s) => s.tasks);
  const priorities = useData((s) => s.priorities);
  const addTask = useData((s) => s.addTask);
  const completeTask = useData((s) => s.completeTask);
  const toggleDone = useData((s) => s.toggleDone);
  const parkTask = useData((s) => s.parkTask);

  const [search, setSearch] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [addPri, setAddPri] = useState('');
  const [addText, setAddText] = useState('');

  const now = Date.now();
  const activePris = priorities.filter((p) => !p.deleted);
  // Quick-add defaults to the top *general* tier (Now), not Shaila — that's the special rabbi-question tier.
  const defaultPri = activePris.find((p) => !p.isShaila)?.id ?? activePris[0]?.id ?? '';
  const selectedPri = addPri || defaultPri;

  const active = useMemo(
    () =>
      optTasks(
        tasks.filter(
          (t) => !t.completed && !t.blocked && !(t.snoozedUntil && t.snoozedUntil > now),
        ),
        priorities,
      ),
    [tasks, priorities, now],
  );

  const q = search.trim().toLowerCase();
  const filtered = q ? active.filter((t) => t.text.toLowerCase().includes(q)) : active;
  const overwhelmed = focusMode && filtered.length > FOCUS_LIMIT;
  const shown = overwhelmed ? filtered.slice(0, FOCUS_LIMIT) : filtered;

  const completed = useMemo(
    () => tasks.filter((t) => t.completed).sort((a, b) => b.createdAt - a.createdAt),
    [tasks],
  );

  const submitAdd = () => {
    if (!selectedPri || !addText.trim()) return;
    addTask(addText, selectedPri);
    setAddText('');
  };

  const listStyle = {
    ...denseListVars({ primary: 'var(--shp-color-text)', secondary: 'var(--shp-color-muted)' }),
    background: 'transparent',
    padding: 0,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
      {/* Quick-add */}
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
            label="Add a task"
            value={addText}
            onInput={(e) => setAddText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAdd();
            }}
            style={{ flex: 1 }}
          />
          <FilledButton onClick={submitAdd}>
            <span>Add</span>
          </FilledButton>
        </div>
        <ChipSet>
          {activePris.map((p) => (
            <FilterChip
              key={p.id}
              label={p.label}
              selected={selectedPri === p.id}
              onClick={() => setAddPri(p.id)}
            />
          ))}
        </ChipSet>
      </div>

      {/* Search */}
      <OutlinedTextField
        label="Search the queue"
        value={search}
        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        style={{ width: '100%' }}
      >
        <span slot="leading-icon" className="material-symbols-rounded">
          search
        </span>
      </OutlinedTextField>

      {/* Overwhelm banner (opt-in focus mode) */}
      {filtered.length > OVERWHELM_THRESHOLD && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: SP.sm,
            padding: `${SP.sm} ${SP.md}`,
            borderRadius: 'var(--shp-radius-md)',
            background: 'var(--shp-color-card)',
            border: '1px solid var(--shp-color-divider)',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--shp-color-muted)' }}>
            {filtered.length} waiting{overwhelmed ? ` — showing top ${FOCUS_LIMIT}` : ''}.
          </span>
          <TextButton onClick={() => setFocusMode((v) => !v)}>
            <span>{overwhelmed ? 'Show all' : 'Focus on top 3'}</span>
          </TextButton>
        </div>
      )}

      {/* The queue */}
      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--shp-color-muted)' }}>
          {q ? 'No tasks match your search.' : 'Queue is empty — nice.'}
        </div>
      ) : (
        <List style={listStyle}>
          {shown.map((t) => (
            <QueueRow
              key={t.id}
              task={t}
              priorities={priorities}
              onDone={() => completeTask(t.id)}
              onPark={() => parkTask(t.id)}
            />
          ))}
        </List>
      )}

      {/* Shelf — completed today, collapsible, restore via undo */}
      {completed.length > 0 && (
        <div>
          <Divider />
          <button
            onClick={() => setShelfOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SP.xs,
              width: '100%',
              padding: `${SP.sm} 0`,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--shp-color-muted)',
              font: 'inherit',
              fontSize: 13,
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
              {shelfOpen ? 'expand_more' : 'chevron_right'}
            </span>
            Done today ({completed.length})
          </button>
          {shelfOpen && (
            <List style={listStyle}>
              {completed.map((t) => (
                <ListItem key={t.id}>
                  <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{t.text}</span>
                  <span slot="end">
                    <IconBtn
                      icon="undo"
                      iconSize={18}
                      size={36}
                      title="Restore to queue"
                      onClick={() => toggleDone(t.id)}
                    />
                  </span>
                </ListItem>
              ))}
            </List>
          )}
        </div>
      )}
    </div>
  );
}
