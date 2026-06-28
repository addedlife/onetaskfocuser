import { List, ListItem, denseListVars, ActionBtn } from '@/m3';
import { useData } from '@/state/data';
import { SP } from '@/theme';
import type { ShailaStatus } from '@/lib/types';

const STATUS_LABEL: Record<ShailaStatus, string> = {
  pending: 'Pending answer',
  answered: 'Answered — reply owed',
  got_back: 'Got back',
};

/**
 * Shailos — the highest-priority surface (standing rule). First "real" Pro 5 surface: live store data
 * rendered on genuine md-list, in the fixed category gold, with a working "Got back" action. Phase 5
 * fills in recording / transcription / research / dedup.
 */
export function ShailosSurface() {
  const shailos = useData((s) => s.shailos);
  const markGotBack = useData((s) => s.markGotBack);

  return (
    <div style={{ padding: SP.xxl, maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, color: 'var(--shp-color-gold)' }}>
        Shailos
      </h1>
      <p style={{ color: 'var(--shp-color-muted)', marginTop: SP.sm }}>
        Questions awaiting answers — the highest-priority surface. ({shailos.length})
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
          {shailos.map((q) => (
            <ListItem key={q.id}>
              {q.synopsis || q.content || 'Shaila'}
              <span slot="supporting-text">
                {q.answererName ? `${q.answererName} · ` : ''}
                {STATUS_LABEL[q.status]}
              </span>
              <span slot="end">
                {q.status !== 'got_back' ? (
                  <ActionBtn
                    variant="tonal"
                    height={32}
                    labelSize={12}
                    containerColor="var(--shp-color-gold)"
                    labelColor="#1A1407"
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
      </div>
    </div>
  );
}
