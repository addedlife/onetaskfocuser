import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './00-auth.jsx';
import { DeskPhoneWebPanel } from './10-deskphone-web.jsx';
import { GV_CLEAN } from './08-app-split/ui-tokens.jsx';
import { registerOfflineShell } from './offline-support.js';

registerOfflineShell();

// Standalone DeskPhone surface: the native Windows app embeds the exact same
// phone screen the webapp shows, served from DeskPhone's own loopback server
// (http://127.0.0.1:8765/?standalone=deskphone). Everything it renders comes
// from the host API on this PC, so there is no sign-in wall here — by design.
// This is what makes the native app and the webapp phone screen one UI.
const standaloneView = (() => {
  try { return (new URLSearchParams(window.location.search).get('standalone') || '').toLowerCase(); }
  catch { return ''; }
})();
const standaloneEmbedded = (() => {
  try { return new URLSearchParams(window.location.search).get('embedded') === '1'; }
  catch { return false; }
})();

const root = ReactDOM.createRoot(document.getElementById('root'));

if (standaloneView === 'deskphone' || standaloneView === 'phone') {
  document.title = 'DeskPhone';

  // StandaloneShell: listens for postMessage theme pushes from the parent
  // Shamash frame (App.jsx) and re-renders with the live T object.
  // Zero cloud cost — pure local iframe messaging, no polling.
  function StandaloneShell() {
    const [T, setT] = useState(GV_CLEAN);
    useEffect(() => {
      const onMessage = (event) => {
        // Only accept messages from the same origin or the loopback host.
        if (event.data?.type !== 'dp-theme') return;
        const next = event.data.T;
        if (next && typeof next === 'object') setT(next);
      };
      window.addEventListener('message', onMessage);
      // Tell the parent we're ready to receive the theme.
      try { window.parent.postMessage({ type: 'dp-ready' }, '*'); } catch {}
      return () => window.removeEventListener('message', onMessage);
    }, []);
    return <DeskPhoneWebPanel T={T} embedded={standaloneEmbedded} />;
  }

  root.render(<StandaloneShell />);
} else {
  root.render(<AuthGate />);
}
