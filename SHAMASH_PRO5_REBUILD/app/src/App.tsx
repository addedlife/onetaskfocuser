import { Switchboard } from '@/features/switchboard/Switchboard';
import { useUi, type SuiteView } from '@/state/store';
import { getScheme, globalCss, themeVarsCss, SCHEMES, FONT_STACK, SP, type Scheme } from '@/theme';
import { FilledButton, TonalButton, OutlinedButton, FilterChip, ChipSet, List, ListItem } from '@/m3';
import { ShailosSurface } from '@/features/shailos/ShailosSurface';
import { FocusSurface } from '@/features/focus/FocusSurface';

/**
 * The theme bridge in the DOM: `globalCss()` is the static token layer + reset (injected once);
 * `themeVarsCss(scheme)` is the reactive per-theme rule that repaints every M3 component when the
 * theme changes. Two <style> tags — React keeps the second in sync with the active scheme.
 */
function ThemeStyle({ scheme }: { scheme: Scheme }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: globalCss() }} />
      <style dangerouslySetInnerHTML={{ __html: themeVarsCss(scheme) }} />
    </>
  );
}

const TITLES: Record<SuiteView, string> = {
  focus: 'Focus',
  nervecenter: 'NerveCenter',
  taskriver: 'Task River',
  deskphone: 'DeskPhone',
  shailos: 'Shailos',
  health: 'Health',
};

const sectionLabel = {
  fontSize: 13,
  color: 'var(--shp-color-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
  marginTop: SP.xl,
};

/**
 * Phase-1 placeholder for each surface. Doubles as the live smoke test of the foundation: genuine
 * @material/web components (buttons, chips, list) rendered through the theme bridge, with a chip row
 * that switches all 8 themes instantly — proving the reactive `--md-sys-*` repaint works.
 */
function SurfacePlaceholder({ view }: { view: SuiteView }) {
  const schemeId = useUi((s) => s.schemeId);
  const setScheme = useUi((s) => s.setScheme);
  return (
    <div style={{ padding: SP.xxl, maxWidth: 880, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>{TITLES[view]}</h1>
      <p style={{ color: 'var(--shp-color-muted)', marginTop: SP.sm }}>
        Foundation shell (Phase 1). The controls below are real Google Material 3 components, themed
        live through the bridge.
      </p>

      <h3 style={sectionLabel}>Theme — live</h3>
      <ChipSet>
        {SCHEMES.map((s) => (
          <FilterChip
            key={s.id}
            label={s.name}
            selected={schemeId === s.id}
            onClick={() => setScheme(s.id)}
          />
        ))}
      </ChipSet>

      <h3 style={sectionLabel}>Buttons</h3>
      <div style={{ display: 'flex', gap: SP.sm, flexWrap: 'wrap' }}>
        <FilledButton>
          <span>Primary</span>
        </FilledButton>
        <TonalButton>
          <span>Tonal</span>
        </TonalButton>
        <OutlinedButton>
          <span>Outlined</span>
        </OutlinedButton>
      </div>

      <h3 style={sectionLabel}>List</h3>
      <div
        style={{
          border: '1px solid var(--shp-color-divider)',
          borderRadius: 'var(--shp-radius-md)',
          overflow: 'hidden',
        }}
      >
        <List>
          <ListItem>
            First item
            <span slot="supporting-text">Real md-list-item, slotted supporting text</span>
          </ListItem>
          <ListItem>
            Second item
            <span slot="supporting-text">Themed through the M3 bridge</span>
          </ListItem>
        </List>
      </div>
    </div>
  );
}

export function App() {
  const scheme = getScheme(useUi((s) => s.schemeId));
  const view = useUi((s) => s.suiteView);
  return (
    <>
      <ThemeStyle scheme={scheme} />
      <div
        style={{
          display: 'flex',
          height: '100vh',
          background: 'var(--shp-color-bg)',
          color: 'var(--shp-color-text)',
          fontFamily: FONT_STACK,
        }}
      >
        <Switchboard />
        <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {view === 'shailos' ? (
            <ShailosSurface />
          ) : view === 'focus' ? (
            <FocusSurface />
          ) : (
            <SurfacePlaceholder view={view} />
          )}
        </main>
      </div>
    </>
  );
}
