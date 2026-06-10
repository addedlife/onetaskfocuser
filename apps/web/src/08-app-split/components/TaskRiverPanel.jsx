/**
 * TaskRiverPanel — one calm, flowing river of everything to do.
 *
 * A single combined, auto-prioritized list drawn from all actionable sources
 * (tasks + shailos). Reorder by drag, tap-drag, or up/down buttons; "Re-prioritize"
 * drops your manual order and lets the auto-sort take over again. A muted running-water
 * backdrop and soft left-edge color bands that bleed into one another give it the feel
 * of a slow, relaxing stream rather than a checklist.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanTheme, NC_FONT_STACK } from '../ui-tokens.jsx';
import { isNerveTaskShailaWork } from '../utils/shailosQueue.js';

// ── color helpers ─────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return { r: 120, g: 160, b: 175 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  const r = Math.round(x.r + (y.r - x.r) * t);
  const g = Math.round(x.g + (y.g - x.g) * t);
  const bl = Math.round(x.b + (y.b - x.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const SHAILA_COLOR = '#5BA8A0';        // calm teal for shailos
const ORDER_KEY = 'taskriver_order_v1';
const readOrder = () => { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') || []; } catch { return []; } };
const writeOrder = (arr) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(arr)); } catch {} };

// ── build the combined, scored stream ───────────────────────────────────────────
function buildItems(tasks, shailos, priorities) {
  const priById = new Map((priorities || []).map(p => [p.id, p]));
  const weights = (priorities || []).filter(p => !p.deleted).map(p => Number(p.weight) || 0);
  const maxW = weights.length ? Math.max(...weights) : 1;

  const items = [];

  (tasks || []).forEach(t => {
    if (!t || t.completed || t.deleted) return;
    if (isNerveTaskShailaWork(t)) return; // shown once, in the shaila stream
    const pri = priById.get(t.priority);
    const color = pri?.color || '#8FB7C9';
    const weight = Number(pri?.weight) || 0;
    items.push({
      id: t.id,
      type: 'task',
      text: (t.ncSummary || t.text || 'Untitled').trim(),
      color,
      pinned: !!t.pinned,
      score: (t.pinned ? 1e9 : 0) + weight * 1000 + (Number(t.createdAt) || 0) / 1e9,
      priLabel: pri?.label || '',
      raw: t,
    });
  });

  (shailos || []).forEach(s => {
    if (!s || s.deleted || s.completed || s.status === 'answered') return;
    const getBack = s.status === 'get_back' || !!s.isGetBackStep;
    items.push({
      id: s.id,
      type: 'shaila',
      text: (s.synopsis || s.text || s.content || 'Open shaila').trim(),
      color: SHAILA_COLOR,
      pinned: false,
      // shailos surface in the upper-middle of the current by default
      score: maxW * (getBack ? 0.5 : 0.78) * 1000 + (Number(s.createdAt) || 0) / 1e9,
      priLabel: getBack ? 'waiting to reply' : 'pending answer',
      raw: s,
    });
  });

  return items;
}

// Apply the saved manual order; unseen items fall in by auto-score at the end.
function applyOrder(items, order) {
  const byId = new Map(items.map(i => [i.id, i]));
  const seen = new Set();
  const out = [];
  (order || []).forEach(id => { const it = byId.get(id); if (it) { out.push(it); seen.add(id); } });
  const rest = items.filter(i => !seen.has(i.id)).sort((a, b) => b.score - a.score);
  return [...out, ...rest];
}

export function TaskRiverPanel({
  T,
  tasks = [],
  shailos = [],
  priorities = [],
  sidebarW = 64,
  topOffset = 0,
  clockTime,
  onCompleteTask,
  onOpenTasks,
  onOpenShailos,
}) {
  const C = cleanTheme(T);
  const now = clockTime instanceof Date ? clockTime : new Date(clockTime || Date.now());

  const items = useMemo(() => buildItems(tasks, shailos, priorities), [tasks, shailos, priorities]);
  const [order, setOrder] = useState(readOrder);
  const ordered = useMemo(() => applyOrder(items, order), [items, order]);
  const manual = (order || []).length > 0;

  const [dragId, setDragId] = useState(null);
  const listRef = useRef(null);

  // Persist whenever the manual order changes.
  useEffect(() => { writeOrder(order); }, [order]);

  // Freeze the current visible order into an explicit id list (so auto items get fixed
  // positions we can then nudge), and apply a transform.
  const reorderTo = (idList) => setOrder(idList);
  const currentIds = () => ordered.map(i => i.id);

  const move = (id, dir) => {
    const ids = currentIds();
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorderTo(ids);
  };

  const dropBefore = (dragId, targetId) => {
    if (dragId === targetId) return;
    const ids = currentIds().filter(x => x !== dragId);
    const t = ids.indexOf(targetId);
    if (t < 0) ids.push(dragId); else ids.splice(t, 0, dragId);
    reorderTo(ids);
  };

  const reprioritize = () => { setOrder([]); };

  // Pointer drag (works for mouse + touch). The drag handle starts it; movement finds the
  // row under the finger and slots the dragged item before it.
  const onHandleDown = (id) => (e) => {
    e.preventDefault();
    setDragId(id);
    const move_ = (ev) => {
      const pt = ev.touches?.[0] || ev;
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const row = el && el.closest ? el.closest('[data-river-row]') : null;
      const overId = row?.getAttribute('data-river-row');
      if (overId && overId !== id) dropBefore(id, overId);
    };
    const up = () => {
      setDragId(null);
      window.removeEventListener('pointermove', move_);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('touchmove', move_);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('pointermove', move_, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('touchmove', move_, { passive: false });
    window.addEventListener('touchend', up);
  };

  const complete = (it) => {
    if (it.type === 'task') onCompleteTask?.(it.id);
    else onOpenShailos?.();
  };
  const open = (it) => { if (it.type === 'task') onOpenTasks?.(); else onOpenShailos?.(); };

  // Header supercrunch — a calm, deterministic one-liner of what's flowing.
  const supercrunch = ordered.slice(0, 6).map(i => i.text.replace(/\s+/g, ' ').slice(0, 42)).join('  ·  ');

  // Muted running-water backdrop: layered soft teal/blue gradients over the theme bg.
  const waterBg = {
    background: `
      radial-gradient(120% 60% at 20% -10%, ${rgba('#7FC6D9', 0.07)} 0%, transparent 60%),
      radial-gradient(120% 70% at 90% 110%, ${rgba('#4F9AA6', 0.08)} 0%, transparent 55%),
      repeating-linear-gradient(115deg, ${rgba('#9ED4E0', 0.018)} 0px, ${rgba('#9ED4E0', 0.018)} 2px, transparent 2px, transparent 26px),
      linear-gradient(180deg, ${C.bg} 0%, ${mix(C.bg, '#16323a', 0.10)} 100%)
    `,
  };

  return (
    <div style={{
      position: 'fixed', top: topOffset, left: sidebarW, right: 0, bottom: 0,
      zIndex: 1, display: 'flex', flexDirection: 'column',
      borderLeft: `1px solid ${C.divider}`, overflow: 'hidden', ...waterBg,
    }}>
      {/* ── Header ── */}
      <div style={{ flexShrink: 0, padding: '18px clamp(16px,4vw,40px) 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 26, fontWeight: 300, letterSpacing: -0.5, color: C.text, fontFamily: NC_FONT_STACK }}>The River</span>
          <span style={{ fontSize: 13, color: C.muted, fontFamily: NC_FONT_STACK }}>
            {ordered.length} flowing · {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
          <button onClick={reprioritize} disabled={!manual} title="Drop manual order and let priority flow again"
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12.5, fontFamily: NC_FONT_STACK, fontWeight: 500,
              color: manual ? '#fff' : C.faint, background: manual ? rgba(SHAILA_COLOR, 0.9) : 'transparent',
              border: `1px solid ${manual ? rgba(SHAILA_COLOR, 0.9) : C.divider}`, borderRadius: 18,
              padding: '5px 14px', cursor: manual ? 'pointer' : 'default',
            }}>
            ↻ Re-prioritize
          </button>
        </div>
        {supercrunch && (
          <div style={{
            fontSize: 13, color: C.muted, fontFamily: NC_FONT_STACK, fontStyle: 'italic',
            lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            paddingBottom: 2, borderBottom: `1px solid ${C.divider}`,
          }}>{supercrunch}</div>
        )}
      </div>

      {/* ── The stream ── */}
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px clamp(10px,3vw,32px) 40px' }}>
        {ordered.length === 0 && (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: C.faint, fontFamily: NC_FONT_STACK, fontSize: 15 }}>
            The river is still. Nothing waiting.
          </div>
        )}
        {ordered.map((it, idx) => {
          const prev = ordered[idx - 1] || it;
          const next = ordered[idx + 1] || it;
          // Soft left band that bleeds from the row above into the row below — the "river".
          const band = `linear-gradient(to bottom,
            ${rgba(mix(prev.color, it.color, 0.5), 0.6)} 0%,
            ${rgba(it.color, 0.62)} 50%,
            ${rgba(mix(it.color, next.color, 0.5), 0.6)} 100%)`;
          const isDrag = dragId === it.id;
          return (
            <div key={it.id} data-river-row={it.id}
              onClick={() => open(it)}
              style={{
                position: 'relative', display: 'grid', gridTemplateColumns: '10px 1fr auto',
                alignItems: 'center', gap: 12, padding: '11px 12px 11px 0', cursor: 'pointer',
                borderRadius: 12, marginBottom: 2,
                background: isDrag ? rgba(it.color, 0.10) : 'transparent',
                boxShadow: isDrag ? `0 6px 22px ${rgba('#000', 0.18)}` : 'none',
                transition: 'background 0.15s',
              }}>
              {/* river color band */}
              <span style={{ alignSelf: 'stretch', width: 10, borderRadius: 6, background: band }} />
              {/* text */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, color: C.text, fontFamily: NC_FONT_STACK, lineHeight: 1.32, wordBreak: 'break-word' }}>
                  {it.pinned && <span style={{ color: it.color, marginRight: 6 }}>★</span>}
                  {it.text}
                </div>
                <div style={{ fontSize: 11.5, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 2 }}>
                  {it.type === 'shaila' ? 'Shaila' : (it.priLabel || 'Task')}{it.type === 'shaila' && it.priLabel ? ` · ${it.priLabel}` : ''}
                </div>
              </div>
              {/* controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
                <button onClick={() => move(it.id, -1)} disabled={idx === 0} title="Move up"
                  style={ctrlBtn(C, idx === 0)}>▲</button>
                <button onClick={() => move(it.id, +1)} disabled={idx === ordered.length - 1} title="Move down"
                  style={ctrlBtn(C, idx === ordered.length - 1)}>▼</button>
                <button onPointerDown={onHandleDown(it.id)} onTouchStart={onHandleDown(it.id)} title="Drag to reorder"
                  style={{ ...ctrlBtn(C, false), cursor: 'grab', touchAction: 'none', color: C.muted, fontSize: 15 }}>⠿</button>
                <button onClick={() => complete(it)} title={it.type === 'task' ? 'Done' : 'Open'}
                  style={{ ...ctrlBtn(C, false), color: it.color, fontSize: 15 }}>
                  {it.type === 'task' ? '✓' : '›'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ctrlBtn(C, disabled) {
  return {
    width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent',
    color: disabled ? C.faint : C.muted, opacity: disabled ? 0.35 : 1,
    cursor: disabled ? 'default' : 'pointer', fontSize: 11, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: NC_FONT_STACK,
  };
}
