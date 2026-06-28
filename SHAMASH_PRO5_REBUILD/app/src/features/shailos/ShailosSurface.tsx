import { useMemo, useState } from 'react';
import {
  List,
  ListItem,
  denseListVars,
  ActionBtn,
  FilledButton,
  OutlinedTextField,
  FilterChip,
  ChipSet,
  IconBtn,
  Dialog,
  Divider,
} from '@/m3';
import { useData } from '@/state/data';
import { SP } from '@/theme';
import type { Shaila, ShailaStatus } from '@/lib/types';

const STATUS_LABEL: Record<ShailaStatus, string> = {
  pending: 'Pending answer',
  answered: 'Answered — reply owed',
  got_back: 'Got back',
};

type Filter = 'all' | ShailaStatus;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'answered', label: 'Answered' },
  { id: 'got_back', label: 'Got back' },
];

const GOLD = 'var(--shp-color-gold)';
const GOLD_INK = '#1A1407';
const sectionLabel = {
  fontSize: 12,
  color: 'var(--shp-color-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
};

/**
 * Shailos — the highest-priority surface (standing rule). Live store data on genuine md-list in the fixed
 * category gold, with status filters + counts, manual quick-add, copy-to-clipboard, the "Got back" toggle,
 * and an md-dialog answer composer (answer text + answerer → status `answered`). Recording / transcription /
 * AI parse / research / dedup are gated on the AI backend (Phase 11) and land then.
 */
export function ShailosSurface() {
  const shailos = useData((s) => s.shailos);
  const markGotBack = useData((s) => s.markGotBack);
  const addShaila = useData((s) => s.addShaila);
  const answerShaila = useData((s) => s.answerShaila);

  const [filter, setFilter] = useState<Filter>('all');
  const [addText, setAddText] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [answerer, setAnswerer] = useState('');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: shailos.length, pending: 0, answered: 0, got_back: 0 };
    shailos.forEach((q) => {
      c[q.status] += 1;
    });
    return c;
  }, [shailos]);

  const visible = filter === 'all' ? shailos : shailos.filter((q) => q.status === filter);
  const detail = detailId ? (shailos.find((q) => q.id === detailId) ?? null) : null;

  const openDetail = (q: Shaila) => {
    setDetailId(q.id);
    setAnswer(q.answer || '');
    setAnswerer(q.answererName || '');
  };
  const copy = (q: Shaila) => void navigator.clipboard?.writeText(q.content || q.synopsis || '');
  const submitAdd = () => {
    if (!addText.trim()) return;
    addShaila(addText);
    setAddText('');
  };
  const saveAnswer = () => {
    if (detail && answer.trim()) answerShaila(detail.id, answer, answerer || undefined);
    setDetailId(null);
  };

  return (
    <div
      style={{
        padding: SP.xxl,
        maxWidth: 820,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: SP.lg,
      }}
    >
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, color: GOLD }}>Shailos</h1>
        <p style={{ color: 'var(--shp-color-muted)', marginTop: SP.xs }}>
          Questions awaiting answers — the highest-priority surface.
        </p>
      </div>

      {/* Quick-add */}
      <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center' }}>
        <OutlinedTextField
          label="Add a shaila"
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

      {/* Status filters */}
      <ChipSet>
        {FILTERS.map((f) => (
          <FilterChip
            key={f.id}
            label={`${f.label} (${counts[f.id]})`}
            selected={filter === f.id}
            onClick={() => setFilter(f.id)}
          />
        ))}
      </ChipSet>

      {/* List */}
      <div
        style={{
          border: '1px solid var(--shp-color-divider)',
          borderRadius: 'var(--shp-radius-md)',
          overflow: 'hidden',
        }}
      >
        {visible.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--shp-color-muted)' }}>
            No shailos here.
          </div>
        ) : (
          <List style={denseListVars({ primary: 'var(--shp-color-text)', secondary: 'var(--shp-color-muted)' })}>
            {visible.map((q) => (
              <ListItem key={q.id}>
                {q.synopsis || q.content || 'Shaila'}
                <span slot="supporting-text">
                  {q.askerName ? `${q.askerName} · ` : ''}
                  {STATUS_LABEL[q.status]}
                </span>
                <span
                  slot="start"
                  style={{ width: 10, height: 10, borderRadius: '50%', background: GOLD, flexShrink: 0 }}
                />
                <span slot="end" style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <IconBtn icon="content_copy" iconSize={16} size={34} title="Copy question" onClick={() => copy(q)} />
                  <IconBtn icon="open_in_full" iconSize={16} size={34} title="Open / answer" onClick={() => openDetail(q)} />
                  {q.status !== 'got_back' ? (
                    <ActionBtn
                      variant="tonal"
                      height={32}
                      labelSize={12}
                      containerColor={GOLD}
                      labelColor={GOLD_INK}
                      onClick={() => markGotBack(q.id, true)}
                    >
                      Got back
                    </ActionBtn>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--shp-color-success)' }}>✓ done</span>
                  )}
                </span>
              </ListItem>
            ))}
          </List>
        )}
      </div>

      {/* Detail + answer composer */}
      <Dialog open={!!detail} onClosed={() => setDetailId(null)}>
        {detail && (
          <>
            <div slot="headline" style={{ color: GOLD }}>
              {detail.synopsis || 'Shaila'}
            </div>
            <div slot="content" style={{ display: 'flex', flexDirection: 'column', gap: SP.md, textAlign: 'left' }}>
              <div>
                <div style={sectionLabel}>Question</div>
                <div style={{ marginTop: 4 }}>{detail.content || detail.synopsis}</div>
                {detail.askerName && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--shp-color-muted)' }}>
                    asked by {detail.askerName}
                  </div>
                )}
              </div>
              <Divider />
              <div>
                <div style={sectionLabel}>Answer</div>
                <OutlinedTextField
                  type="textarea"
                  rows={3}
                  label="The answer"
                  value={answer}
                  onInput={(e) => setAnswer((e.target as HTMLInputElement).value)}
                  style={{ width: '100%', marginTop: 6 }}
                />
                <OutlinedTextField
                  label="Answered by"
                  value={answerer}
                  onInput={(e) => setAnswerer((e.target as HTMLInputElement).value)}
                  style={{ width: '100%', marginTop: 8 }}
                />
              </div>
            </div>
            <div slot="actions" style={{ display: 'flex', gap: SP.sm }}>
              {detail.status !== 'got_back' && (
                <ActionBtn
                  variant="text"
                  onClick={() => {
                    markGotBack(detail.id, true);
                    setDetailId(null);
                  }}
                >
                  Mark got back
                </ActionBtn>
              )}
              <ActionBtn variant="tonal" containerColor={GOLD} labelColor={GOLD_INK} onClick={saveAnswer}>
                Save answer
              </ActionBtn>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
