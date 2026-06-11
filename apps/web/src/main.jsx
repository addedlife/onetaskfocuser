import React from 'react';
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

const root = ReactDOM.createRoot(document.getElementById('root'));
if (standaloneView === 'deskphone' || standaloneView === 'phone') {
  document.title = 'DeskPhone';
  root.render(<DeskPhoneWebPanel T={GV_CLEAN} />);
} else {
  root.render(<AuthGate />);
}
