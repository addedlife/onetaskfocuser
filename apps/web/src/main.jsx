import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './00-auth.jsx';
import { DeskPhoneWebPanel } from './10-deskphone-web.jsx';
import { RelayTesterPage } from './11-relay-tester.jsx';
import { GV_CLEAN } from './08-app-split/ui-tokens.jsx';
import { registerOfflineShell } from './offline-support.js';

registerOfflineShell();

// Dev-only UI drift logger — opt in with ?uiaudit=1. Lazily imported so it is
// never loaded or run in normal/production use. Read-only; changes nothing visual.
try {
  const q = new URLSearchParams(window.location.search);
  if (q.has('uiaudit')) {
    import('./dev/ui-audit.js').then((m) => m.startUiAudit()).catch(() => {});
  }
  // Master-style enforcer: force every classified element to the M3 master at
  // runtime (no source edits). Opt in with ?uistyle=1; reload without it to revert.
  if (q.has('uistyle')) {
    import('./dev/ui-style-override.js').then((m) => m.startUiStyle()).catch(() => {});
  }
} catch {}

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
      // 1. Fetch initial theme from local status API
      fetch("http://127.0.0.1:8765/status")
        .then(res => res.json())
        .then(data => {
          const active = data?.activeTheme;
          if (active?.colors && typeof active.colors === 'object') {
            setT(prev => ({ ...prev, ...active.colors }));
          }
        })
        .catch(() => {});

      // 2. Listen for postMessage from parent iframe (when embedded)
      const onMessage = (event) => {
        if (event.data?.type !== 'dp-theme') return;
        const next = event.data.T;
        if (next && typeof next === 'object') setT(next);
      };
      window.addEventListener('message', onMessage);

      // 3. Listen for webview theme updates from host
      let onWebviewMessage;
      if (window.chrome?.webview) {
        onWebviewMessage = (event) => {
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (data?.type === 'dp-theme-update') {
              const next = data.colors;
              if (next && typeof next === 'object') {
                setT(prev => ({ ...prev, ...next }));
              }
            }
          } catch {}
        };
        window.chrome.webview.addEventListener('message', onWebviewMessage);
      }

      // Tell the parent iframe we're ready
      try { window.parent.postMessage({ type: 'dp-ready' }, '*'); } catch {}

      return () => {
        window.removeEventListener('message', onMessage);
        if (window.chrome?.webview && onWebviewMessage) {
          window.chrome.webview.removeEventListener('message', onWebviewMessage);
        }
      };
    }, []);
    return <DeskPhoneWebPanel T={T} embedded={standaloneEmbedded} />;
  }

  root.render(<StandaloneShell />);
} else if (standaloneView === 'relaytester') {
  // Standalone GM3 tester for the phone-relay v2 rebuild — see 11-relay-tester.jsx.
  // Unlike the DeskPhone standalone view above, this one DOES require owner
  // sign-in (it calls owner-authenticated phoneRelayV2 actions), so it renders
  // its own auth gate rather than trusting the loopback origin.
  document.title = 'Phone Relay v2 Tester';
  root.render(<RelayTesterPage />);
} else {
  root.render(<AuthGate />);
}
