import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '@/state/data';
import { useUi } from '@/state/store';
import { runAIJob } from '@/services/ai';
import { SP } from '@/theme';
import type { Task, Shaila } from '@/lib/types';

/**
 * Task River — "one calm river of everything, prioritized ONLY by AI" (faithful port of Pro 4's
 * `TaskRiverPanel`). A single tightly-spaced list mixing all sources (tasks, shailos, and — once those
 * integrations land — calendar + mail). Ordering, the terse line, and the short reason come exclusively
 * from the `dashboard.river_rank.v1` AI job; with no AI it is honest — items sit in interleaved source
 * order and it says "AI unavailable", inventing no priority. A continuous colour bar runs down the left.
 */

const COL_TASK = '#8FB7C9'; // steel blue — all tasks
const COL_SHAILA = '#5BA8A0'; // teal
const COL_CAL = '#D9A23B'; // amber (joins with Google Calendar)
const COL_MAIL = '#8E86C9'; // indigo (joins with Gmail)
const ORDER_KEY = 'shp5.taskriver_order';

type RiverType = 'task' | 'shaila' | 'calendar' | 'mail';
interface RiverItem {
  id: string;
  type: RiverType;
  text: string;
  meta: string;
  color: string;
  pinned?: boolean;
}
interface AiEntry {
  score?: number;
  label?: string;
  reason?: string;
}

function hexToRgb(hex: string) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return { r: 120, g: 160, b: 175 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgba(hex: string, a: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Shorten the item's OWN text (authentic — not a generated summary) when no AI label exists. */
function clip(t: string) {
  t = (t || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  const sp = cut.lastIndexOf(' ');
  return sp > 30 ? cut.slice(0, sp) : cut;
}
const readOrder = (): string[] => {
  try {
    return (JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') as string[]) || [];
  } catch {
    return [];
  }
};
const writeOrder = (a: string[]) => {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable — non-fatal */
  }
};

/** Collect the items — NO priority/scoring assumptions (that is the AI's job). */
function buildItems(tasks: Task[], shailos: Shaila[]): RiverItem[] {
  const items: RiverItem[] = [];
  tasks.forEach((t) => {
    if (!t || t.completed || t.shailaId) return; // shaila-work tasks live on the Shailos surface
    items.push({ id: t.id, type: 'task', text: (t.text || 'Untitled').trim(), meta: '', color: COL_TASK, pinned: !!t.pinned });
  });
  shailos.forEach((s) => {
    if (!s || s.status === 'got_back') return; // answered-and-returned = done
    items.push({
      id: s.id,
      type: 'shaila',
      text: (s.synopsis || s.content || 'Open shaila').trim(),
      meta: s.status === 'answered' ? 'waiting to reply' : 'pending answer',
      color: COL_SHAILA,
    });
  });
  // calendarEvents + gmailMessages join here once those integrations land (Phases 6.3 / Google).
  return items;
}

/** Manual (user) order wins. Otherwise AI score order when present; else interleave by type. */
function applyOrder(items: RiverItem[], order: string[], aiMeta: Record<string, AiEntry>): RiverItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: RiverItem[] = [];
  order.forEach((id) => {
    const it = byId.get(id);
    if (it) {
      out.push(it);
      seen.add(id);
    }
  });
  const rest = items.filter((i) => !seen.has(i.id));
  const hasAi = rest.some((i) => aiMeta[i.id] && aiMeta[i.id].score != null);
  if (hasAi) {
    rest.sort((a, b) => (aiMeta[b.id]?.score ?? -1) - (aiMeta[a.id]?.score ?? -1));
  } else {
    const buckets: Record<string, RiverItem[]> = {};
    rest.forEach((i) => {
      (buckets[i.type] = buckets[i.type] || []).push(i);
    });
    const lanes = Object.values(buckets);
    rest.length = 0;
    for (let r = 0; lanes.some((l) => r < l.length); r++) {
      lanes.forEach((l) => {
        if (r < l.length) rest.push(l[r]);
      });
    }
  }
  return [...out, ...rest];
}

type AiState = 'idle' | 'ranking' | 'ok' | 'error';

export function TaskRiverSurface() {
  const tasks = useData((s) => s.tasks);
  const shailos = useData((s) => s.shailos);
  const completeTask = useData((s) => s.completeTask);
  const setSuiteView = useUi((s) => s.setSuiteView);

  const items = useMemo(() => buildItems(tasks, shailos), [tasks, shailos]);
  const rankKey = useMemo(() => items.map((i) => i.id).join('|'), [items]);

  const [aiMeta, setAiMeta] = useState<Record<string, AiEntry>>({});
  const [aiState, setAiState] = useState<AiState>('idle');
  const [rankNonce, setRankNonce] = useState(0);
  const inFlight = useRef(false);
  const lastKey = useRef('');

  // AI ranking — the only source of priority. Null result (no backend / 401 / timeout) → honest "AI unavailable".
  useEffect(() => {
    if (!items.length) {
      setAiState('idle');
      return;
    }
    if (inFlight.current) return;
    if (lastKey.current === rankKey && Object.keys(aiMeta).length) {
      setAiState('ok');
      return;
    }
    inFlight.current = true;
    setAiState('ranking');
    const payload = items.map((i) => ({ id: i.id, type: i.type, text: (i.text || '').slice(0, 200), meta: i.meta || '' }));
    // No cancel-on-cleanup: under StrictMode the effect double-invokes, and discarding the in-flight
    // result there would strand the state on "ranking". Let the single request always settle.
    runAIJob('dashboard.river_rank.v1', { items: payload, currentTime: new Date().toLocaleString() }, undefined, {
      genConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    })
      .then((job) => {
        const ranking = (job?.output as { ranking?: { id?: string; score?: number; label?: string; reason?: string }[] } | undefined)?.ranking;
        if (Array.isArray(ranking) && ranking.length) {
          const map: Record<string, AiEntry> = {};
          ranking.forEach((r) => {
            if (r && r.id != null) map[r.id] = { score: r.score, label: r.label, reason: r.reason };
          });
          setAiMeta(map);
          lastKey.current = rankKey;
          setAiState('ok');
        } else {
          setAiState('error');
        }
      })
      .catch(() => setAiState('error'))
      .finally(() => {
        inFlight.current = false;
      });
  }, [rankKey, rankNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const [order, setOrder] = useState<string[]>(readOrder);
  useEffect(() => writeOrder(order), [order]);
  const ordered = useMemo(() => applyOrder(items, order, aiMeta), [items, order, aiMeta]);
  const manual = order.length > 0;
  const aiOn = aiState === 'ok';

  const view = useMemo(
    () =>
      ordered.map((it) => ({
        ...it,
        line: aiMeta[it.id]?.label || clip(it.text),
        reason: aiOn ? aiMeta[it.id]?.reason || '' : '',
      })),
    [ordered, aiMeta, aiOn],
  );

  // Pointer drag-to-reorder.
  const [dragId, setDragId] = useState<string | null>(null);
  const dropBefore = (drag: string, target: string) => {
    if (drag === target) return;
    const a = view.map((i) => i.id).filter((x) => x !== drag);
    const t = a.indexOf(target);
    if (t < 0) a.push(drag);
    else a.splice(t, 0, drag);
    setOrder(a);
  };
  const onHandleDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragId(id);
    const mv = (ev: PointerEvent) => {
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-river-row]');
      const over = row?.getAttribute('data-river-row');
      if (over && over !== id) dropBefore(id, over);
    };
    const up = () => {
      setDragId(null);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const reprioritize = () => {
    setOrder([]);
    lastKey.current = '';
    setRankNonce((n) => n + 1);
  };
  const act = (it: RiverItem) => {
    if (it.type === 'task') completeTask(it.id);
    else if (it.type === 'shaila') setSuiteView('shailos');
    else if (it.type === 'mail') window.open('https://mail.google.com/mail/u/0/#inbox', '_blank');
    else if (it.type === 'calendar') window.open('https://calendar.google.com/calendar/r', '_blank');
  };

  const riverGradient = view.length
    ? `linear-gradient(to bottom, ${view.map((it, i) => `${rgba(it.color, 0.85)} ${(i / Math.max(1, view.length - 1)) * 100}%`).join(', ')})`
    : rgba(COL_SHAILA, 0.4);
  const statusText =
    aiState === 'ranking' ? 'AI prioritizing…' : aiState === 'ok' ? 'AI-prioritized' : aiState === 'error' ? 'AI unavailable' : '';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '20px clamp(16px,3vw,32px) 8px', display: 'flex', alignItems: 'baseline', gap: SP.sm, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 24, fontWeight: 300, letterSpacing: -0.5 }}>The River</span>
        <span style={{ fontSize: 12, color: aiState === 'error' ? 'var(--shp-color-gold)' : 'var(--shp-color-muted)' }}>
          {view.length} items{statusText ? ` · ${statusText}` : ''}
        </span>
        <button
          onClick={reprioritize}
          title={manual ? 'Reset manual order and re-rank with AI' : 'Force a fresh AI ranking'}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            fontWeight: 500,
            color: manual || aiState === 'error' ? '#fff' : 'var(--shp-color-muted)',
            background: manual || aiState === 'error' ? rgba(COL_SHAILA, 0.9) : 'transparent',
            border: `1px solid ${manual || aiState === 'error' ? rgba(COL_SHAILA, 0.9) : 'var(--shp-color-divider)'}`,
            borderRadius: 'var(--shp-radius-pill)',
            padding: '4px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
            refresh
          </span>
          {aiState === 'error' ? 'Retry' : 'Re-prioritize'}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '2px clamp(12px,2vw,24px) 12px' }}>
        {view.length === 0 ? (
          <div style={{ padding: '50px 20px', textAlign: 'center', color: 'var(--shp-color-muted)', fontSize: 16 }}>
            The river is still. Nothing waiting.
          </div>
        ) : (
          <div style={{ position: 'relative', paddingLeft: 14 }}>
            <div
              aria-hidden
              style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 7, borderRadius: 'var(--shp-radius-xs)', background: riverGradient }}
            />
            {view.map((it) => (
              <div
                key={it.id}
                data-river-row={it.id}
                onClick={() => act(it)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: SP.sm,
                  padding: '4px 6px 4px 10px',
                  minHeight: 28,
                  cursor: 'pointer',
                  borderRadius: 'var(--shp-radius-sm)',
                  background: dragId === it.id ? rgba(it.color, 0.12) : 'transparent',
                  transition: 'background .12s',
                }}
              >
                <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
                  {it.meta && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--shp-color-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {it.meta}
                    </span>
                  )}
                  <span style={{ fontSize: 13, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                    {it.pinned && <span style={{ color: it.color, marginRight: 4 }}>★</span>}
                    {it.line}
                  </span>
                  {it.reason && (
                    <span style={{ fontSize: 11, color: 'var(--shp-color-muted)', fontStyle: 'italic', flexShrink: 0, whiteSpace: 'nowrap', marginLeft: 'auto', paddingLeft: 6 }}>
                      {it.reason}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onPointerDown={onHandleDown(it.id)}
                    title="Drag to reorder"
                    style={{ ...miniBtn, cursor: 'grab', touchAction: 'none' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                      drag_indicator
                    </span>
                  </button>
                  {it.type === 'task' && (
                    <button onClick={() => act(it)} title="Done" style={{ ...miniBtn, color: it.color }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                        check
                      </span>
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, borderTop: '1px solid var(--shp-color-divider)', padding: '8px clamp(16px,3vw,32px)', display: 'flex', alignItems: 'center', gap: SP.lg, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--shp-color-muted)', letterSpacing: 0.3 }}>Color key</span>
        {[
          { color: COL_TASK, label: 'Task' },
          { color: COL_SHAILA, label: 'Shaila' },
          { color: COL_CAL, label: 'Calendar' },
          { color: COL_MAIL, label: 'Email' },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--shp-color-muted)' }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 'var(--shp-radius-xs)',
  border: 'none',
  background: 'transparent',
  color: 'var(--shp-color-muted)',
  opacity: 0.85,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
