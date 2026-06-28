import { useEffect, useState } from 'react';
import { IconBtn } from '@/m3';
import { SP } from '@/theme';
import { useUi, type SuiteView } from '@/state/store';
import { greeting, hebrewDate } from '@/lib/dates';

interface Surface {
  id: SuiteView;
  label: string;
  icon: string; // Material Symbols glyph name
  gold?: boolean; // Shailos = the highest-priority surface, gets the category-gold tint
}

const SURFACES: Surface[] = [
  { id: 'focus', label: 'Focus', icon: 'task_alt' },
  { id: 'nervecenter', label: 'NerveCenter', icon: 'dashboard' },
  { id: 'taskriver', label: 'Task River', icon: 'water' },
  { id: 'deskphone', label: 'DeskPhone', icon: 'smartphone' },
  { id: 'shailos', label: 'Shailos', icon: 'help', gold: true },
  { id: 'health', label: 'Health', icon: 'ecg_heart' },
];

/** A `Date` that re-renders on an interval (default every 30s) so the rail clock stays fresh. */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Rail footer — live clock + Gregorian + Hebrew date + greeting (compact when the rail is collapsed). */
function RailClock({ open }: { open: boolean }) {
  const now = useNow();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!open) {
    return (
      <div
        style={{
          marginTop: 'auto',
          paddingTop: SP.sm,
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--shp-color-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {time.replace(/\s?[AP]M$/i, '')}
      </div>
    );
  }
  const greg = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const heb = hebrewDate(now);
  return (
    <div
      style={{
        marginTop: 'auto',
        padding: `${SP.sm} 8px 4px`,
        borderTop: '1px solid var(--shp-color-divider)',
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {time}
      </div>
      <div style={{ fontSize: 12, color: 'var(--shp-color-muted)', marginTop: 2 }}>{greg}</div>
      {heb && (
        <div style={{ fontSize: 12, color: 'var(--shp-color-gold, var(--shp-color-muted))', marginTop: 1 }}>
          {heb}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--shp-color-muted)', marginTop: 4 }}>{greeting(now)}</div>
    </div>
  );
}

/**
 * The left navigation rail / surface switcher. Nav-rail items have no stable @material/web element
 * (md-navigation-rail is labs-only), so per the M3 fallback rule they're hand-coded from tokens; the
 * collapse toggle uses a real M3 icon button.
 */
export function Switchboard() {
  const suiteView = useUi((s) => s.suiteView);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const setSuiteView = useUi((s) => s.setSuiteView);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const width = sidebarOpen ? 200 : 64;

  return (
    <nav
      style={{
        width,
        flex: `0 0 ${width}px`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: SP.xs,
        padding: SP.sm,
        boxSizing: 'border-box',
        background: 'var(--shp-color-card)',
        borderRight: '1px solid var(--shp-color-divider)',
        transition: 'width .2s cubic-bezier(.2, 0, 0, 1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: sidebarOpen ? 'space-between' : 'center',
          alignItems: 'center',
          marginBottom: SP.sm,
        }}
      >
        {sidebarOpen && (
          <span style={{ fontWeight: 600, fontSize: 14, paddingLeft: 8 }}>Shamash Pro 5</span>
        )}
        <IconBtn
          icon={sidebarOpen ? 'menu_open' : 'menu'}
          title="Toggle navigation rail"
          color="var(--shp-color-muted)"
          onClick={toggleSidebar}
        />
      </div>

      {SURFACES.map((s) => {
        const active = suiteView === s.id;
        const tint = s.gold ? 'var(--shp-color-gold)' : 'var(--shp-color-primary)';
        return (
          <button
            key={s.id}
            onClick={() => setSuiteView(s.id)}
            title={s.label}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              height: 44,
              padding: '0 12px',
              border: 'none',
              borderRadius: 'var(--shp-radius-pill)',
              cursor: 'pointer',
              font: 'inherit',
              fontWeight: 500,
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              background: active ? `color-mix(in srgb, ${tint} 16%, var(--shp-color-card))` : 'transparent',
              color: active ? tint : 'var(--shp-color-muted)',
              transition: 'background .15s, color .15s',
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
              {s.icon}
            </span>
            {sidebarOpen && <span style={{ fontSize: 13.5 }}>{s.label}</span>}
          </button>
        );
      })}

      <RailClock open={sidebarOpen} />
    </nav>
  );
}
