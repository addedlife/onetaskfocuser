// Local-only harness for dev edit mode. NOT SHIPPED — it lives under src/dev/,
// which the GM3 ratchet skips, and its page is src/dev/edit-mode.html, which is not
// a build entry (verified: `npm run build` puts nothing of it in dist/).
//
// Why it exists: edit mode is an overlay measured against real layout, so jsdom
// cannot test it and the real app is behind Google sign-in. Run it with
//   npm run dev   →   http://localhost:5173/src/dev/edit-mode.html
// and drive it with Playwright. It reproduces the three things that have gone wrong
// so far: controls nested inside a row that is itself a button, rows scrolled out
// of a card's own scroller, and the page locking up while the dialog is open. The
// 200 ms re-render stands in for App.jsx's clock, which re-renders everything it
// owns — including this overlay — about once a second.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DevEditMode } from '../08-app-split/components/DevEditMode.jsx';
import { cleanTheme, NC_GLOBAL_CSS } from '../08-app-split/ui-tokens.jsx';

const C = cleanTheme({});
// The app injects its token variables globally; without them SP/RADIUS/ELEV resolve
// to nothing and the overlay lands in the wrong place.
const sheet = document.createElement('style');
sheet.textContent = NC_GLOBAL_CSS;
document.head.appendChild(sheet);

function Card({ title, rows, tag }) {
  return (
    <div style={{ border: '1px solid #ccc', borderRadius: 12, width: 320, height: 240, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, fontWeight: 600, borderBottom: '1px solid #eee' }}>{title}</div>
      <div className="card-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i}><div><div><div><div style={{ padding: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
            <button>Row {tag}-{i}</button>
            <input readOnly value={`readonly ${tag}-${i}`} />
          </div></div></div></div></div>
        ))}
      </div>
    </div>
  );
}

function Harness() {
  const [on, setOn] = React.useState(true);
  // Stand-in for the real app's clock: App.jsx re-renders about once a second, and
  // everything it renders — DevEditMode included — re-renders with it.
  const [, tick] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => tick(n => n + 1), 200); return () => clearInterval(t); }, []);
  return (
    <div style={{ padding: 24, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <button id="toggle" onClick={() => setOn(v => !v)}>toggle</button>
      <div role="button" id="rowlike" style={{ padding: 8, border: '1px solid #999' }}>
        A row that is itself a button
        <input id="nested-readonly" readOnly value="nested readonly field" />
      </div>
      <textarea id="ta" defaultValue="a textarea" />
      {Array.from({ length: 12 }, (_, i) => <Card key={i} tag={i} title={`Scroller ${i}`} rows={40} />)}
      <DevEditMode enabled={on} T={C} onExit={() => setOn(false)} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
